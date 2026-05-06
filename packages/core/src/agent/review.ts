import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { ReviewOutputSchema, SkimReviewOutputSchema } from "./schema.js";
import { buildSystemPrompt, buildUserMessage, buildCachedSystemMessages } from "./prompts.js";
import {
  resolveModelConfig,
  resolveModel,
  getModelDisplayName,
  resolveModelSettings,
  resolveDefaultAgentOptions,
  resolveJsonPromptInjection,
  supportsAnthropicCacheControl,
  applyModelConstraints,
} from "./model.js";
import type { ModelConfig, ModelSettings } from "./model.js";
import type { ReviewConfig, PRMetadata, TicketInfo, ReviewResult, GitProvider } from "../types.js";
import type { OpenGrepFinding } from "../opengrep/types.js";
import { createSearchCodeTool, createGetFileContextTool } from "./tools.js";
import { logger } from "../logger.js";

const log = logger.child({ module: "review" });

const STRUCTURED_OUTPUT_VALIDATION_ERROR_ID = "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED";

function isStructuredOutputValidationError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "id" in err &&
    err.id === STRUCTURED_OUTPUT_VALIDATION_ERROR_ID
  );
}

// AI SDK marks transient upstream failures (headers timeout, 5xx, connection reset)
// with isRetryable=true. Mastra's internal pRetry handles per-request retries; this
// catches the case where its retries exhausted within a single tight timeout window
// and gives the caller a fresh request budget.
function isTransientRetryableError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "isRetryable" in err && err.isRetryable === true
  );
}

const TRANSIENT_RETRY_BACKOFF_MS = [500, 2_000];

function readMaxTransientRetries(): number {
  const raw = process.env.RUSTY_LLM_MAX_RETRIES;
  if (raw === undefined) return TRANSIENT_RETRY_BACKOFF_MS.length;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return TRANSIENT_RETRY_BACKOFF_MS.length;
  return Math.min(Math.floor(n), TRANSIENT_RETRY_BACKOFF_MS.length);
}

async function generateWithStructuredOutputRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isStructuredOutputValidationError(err)) throw err;
    log.warn(
      { err },
      "structured output validation failed, retrying once before giving up on this pass",
    );
    return await fn();
  }
}

async function generateWithTransientRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = readMaxTransientRetries();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientRetryableError(err) || attempt === maxRetries) throw err;
      const backoffMs = TRANSIENT_RETRY_BACKOFF_MS[attempt];
      log.warn(
        { err, attempt: attempt + 1, maxRetries, backoffMs },
        "transient LLM error, retrying after backoff",
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastErr;
}

export type ReviewTier = "skim" | "deep-review";

export interface RunReviewOptions {
  provider?: GitProvider;
  sourceRef?: string;
  extraTools?: ToolsInput;
  languageSummary?: string;
  tier?: ReviewTier;
  /** Files changed in the PR but not present in the current review chunk. */
  otherPrFiles?: string[];
  /** Files actually present in the current review chunk; used to constrain finding paths. */
  chunkFiles?: string[];
  /** OpenGrep findings to feed to the LLM for triage. */
  openGrepFindings?: OpenGrepFinding[];
  /** Ranked dependency context selected under a token budget for deep review. */
  rankedContext?: string;
  /** override used by consensus pass planning; defaults to RUSTY_LLM_MODEL. */
  modelConfig?: ModelConfig;
  /** override used by consensus pass planning; defaults to review env settings. */
  modelSettings?: ModelSettings;
}

function buildTools(options?: RunReviewOptions): ToolsInput {
  if (options?.tier === "skim") return {};

  const tools: ToolsInput = {};
  if (options?.provider) {
    tools.searchCode = createSearchCodeTool(options.provider);
    if (options.sourceRef) {
      tools.getFileContext = createGetFileContextTool(options.provider, options.sourceRef);
    }
  }
  return tools;
}

export async function runReview(
  config: ReviewConfig,
  diff: string,
  prMetadata: PRMetadata,
  ticketContext?: TicketInfo[],
  options?: RunReviewOptions,
): Promise<ReviewResult> {
  const tier = options?.tier ?? "deep-review";
  const systemPrompt = buildSystemPrompt(config);
  const userMessage = buildUserMessage(
    diff,
    prMetadata,
    ticketContext,
    options?.languageSummary,
    options?.otherPrFiles,
    options?.openGrepFindings,
    options?.chunkFiles,
    tier === "deep-review" ? options?.rankedContext : undefined,
  );
  const modelConfig = options?.modelConfig ?? resolveModelConfig();
  const modelName = getModelDisplayName(modelConfig);

  const builtInTools = buildTools(options);
  const extraTools = tier === "skim" ? {} : (options?.extraTools ?? {});

  const defaultOptions = resolveDefaultAgentOptions(modelConfig);

  const agent = new Agent({
    id: "review-agent",
    name: "Rusty Bot Reviewer",
    instructions: () =>
      buildCachedSystemMessages(systemPrompt, {
        anthropicCacheControl: supportsAnthropicCacheControl(modelConfig),
      }),
    model: () => resolveModel(modelConfig),
    tools: { ...builtInTools, ...extraTools },
    ...(defaultOptions && { defaultOptions }),
  });

  const schema = tier === "skim" ? SkimReviewOutputSchema : ReviewOutputSchema;

  const rawModelSettings = options?.modelSettings ?? resolveModelSettings("review");
  const modelSettings = applyModelConstraints(modelConfig, rawModelSettings);
  const jsonPromptInjection = resolveJsonPromptInjection(modelConfig);
  const response = await generateWithTransientRetry(() =>
    generateWithStructuredOutputRetry(async () => {
      const r = await agent.generate(userMessage, {
        structuredOutput: { schema, jsonPromptInjection },
        ...(Object.keys(modelSettings).length > 0 && { modelSettings }),
      });
      // mastra's prompt-injected JSON path can silently return object:undefined
      // when the model emits unparseable text instead of throwing the schema
      // validation error. surface it as one so the retry wrapper picks it up.
      // typed cast because mastra's return type marks .object as always defined.
      if (!(r as { object?: unknown }).object) {
        const err = new Error(
          "structured output parser returned no object (model likely emitted text outside the JSON block or truncated)",
        );
        (err as Error & { id?: string }).id = STRUCTURED_OUTPUT_VALIDATION_ERROR_ID;
        throw err;
      }
      return r;
    }),
  );

  const parsed = response.object;

  return {
    summary: parsed.summary,
    recommendation: parsed.recommendation,
    findings: parsed.findings.map((f) => ({
      ...f,
      suggestedFix: ((f as Record<string, unknown>).suggestedFix as string | null) ?? null,
    })),
    observations: parsed.observations,
    ticketCompliance:
      "ticketCompliance" in parsed
        ? ((parsed as Record<string, unknown>).ticketCompliance as ReviewResult["ticketCompliance"])
        : [],
    missingTests:
      "missingTests" in parsed
        ? ((parsed as Record<string, unknown>).missingTests as ReviewResult["missingTests"])
        : [],
    filesReviewed: parsed.filesReviewed,
    modelUsed: modelName,
    tokenCount: response.usage.totalTokens ?? 0,
  };
}
