import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  resolveModelConfig,
  resolveModelConfigWithOverride,
  resolveModel,
  getModelDisplayName,
  resolveModelSettings,
  resolveDefaultAgentOptions,
  resolveJsonPromptInjection,
  supportsAnthropicCacheControl,
  applyModelConstraints,
} from "./model.js";
import { buildCachedSystemMessages } from "./prompts.js";
import type { Finding, ReviewResult } from "../types.js";
import { logger } from "../logger.js";

const log = logger.child({ module: "judge" });

export interface JudgeConfig {
  enabled: boolean;
  /** minimum confidence score (0–10) to keep a finding. defaults to 6 */
  threshold: number;
  /** override model for the judge (e.g. a cheaper one). falls back to RUSTY_LLM_MODEL */
  model?: string;
}

interface JudgeEvaluation {
  index: number;
  confidence: number;
  reasoning: string;
}

const EvaluationSchema = z.object({
  index: z.number().describe("zero-based index of the finding being evaluated"),
  confidence: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "confidence that this finding is a real, actionable issue (0 = certainly wrong, 10 = certainly correct)",
    ),
  reasoning: z.string().describe("one sentence explaining the confidence score"),
});

const JudgeOutputSchema = z.object({
  evaluations: z
    .array(EvaluationSchema)
    .describe("one evaluation per finding, in the same order as the input"),
});

const JUDGE_SYSTEM_PROMPT = `You are a skeptical code review quality judge. Your job is to reject weak findings, not to confirm them. Default to rejection unless the finding is clearly correct, grounded in the provided diff, and worth surfacing to a developer.

For each finding you receive, rate your confidence from 0 to 10 that the finding is correct and worth surfacing to a developer:

- 10: directly proven by the diff, with a concrete production or security impact
- 9: clearly correct and actionable, with strong evidence in the diff
- 7-8: likely correct, grounded, and worth developer attention
- 4-6: plausible but uncertain, incomplete, or not clearly worth surfacing
- 1-3: likely wrong, speculative, severity-inflated, or nitpicking
- 0: clearly hallucinated or factually incorrect

Reject or heavily penalize findings that are:
- claiming something is unused/missing without evidence
- flagging standard patterns as bugs (e.g. intentional fallthrough, optional chaining on purpose)
- suggesting changes that would break the code
- duplicating another finding with different wording
- nitpicking style when the review didn't ask for style feedback
- hallucinated line numbers or code references that don't match the diff
- about code outside the reviewed diff/chunk unless the finding explains why the changed code creates the issue
- missing-test complaints without a concrete changed behavior, edge case, or regression risk
- generic maintainability advice without a specific consequence
- severity-inflated findings where a suggestion or observation is labeled as warning/critical
- suggested fixes that contain prose, omit required surrounding syntax, or would not directly replace the target lines

You MUST return exactly one evaluation per finding, in the same order they were provided.`;

function buildDiffBlock(diff: string): string {
  return `## Diff under review\n\n${diff}\n`;
}

function buildFindingsBlock(findings: readonly Finding[]): string {
  const parts: string[] = ["## Findings to evaluate\n"];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const lineRange = f.endLine ? `${f.line}-${f.endLine}` : `${f.line}`;
    parts.push(`### Finding ${i}`);
    parts.push(`- **File:** ${f.file}`);
    parts.push(`- **Line:** ${lineRange}`);
    parts.push(`- **Severity:** ${f.severity}`);
    parts.push(`- **Category:** ${f.category}`);
    parts.push(`- **Message:** ${f.message}`);
    if (f.suggestedFix) {
      parts.push(`- **Suggested fix:**\n\`\`\`\n${f.suggestedFix}\n\`\`\``);
    }
    parts.push("");
  }
  return parts.join("\n");
}

interface CacheableTextPart {
  type: "text";
  text: string;
  providerOptions?: { anthropic: { cacheControl: { type: "ephemeral" } } };
}

interface CacheableUserMessage {
  role: "user";
  content: CacheableTextPart[];
}

/**
 * Build the user message for the judge. When the underlying provider supports
 * Anthropic-style ephemeral cache markers, the diff (the bulk of the input) is
 * placed in its own text block with cacheControl set so it can be reused
 * across calls. The findings list comes after the cache breakpoint so it
 * doesn't invalidate the cached prefix.
 *
 * Real cache hits require the cached prefix (system + earlier blocks + this
 * block) to be byte-identical, AND the prefix to clear Anthropic's 1024-token
 * floor for ephemeral cache. So this only earns its keep when the same diff
 * is judged again within ~5 minutes — typically a manual re-run of the same
 * PR. For non-Anthropic providers we fall back to a plain string and let
 * Azure OpenAI's automatic prefix caching do its thing server-side.
 */
export function buildJudgeUserMessage(
  findings: readonly Finding[],
  diff: string,
  options: { anthropicCacheControl: boolean },
): string | CacheableUserMessage {
  const diffBlock = buildDiffBlock(diff);
  const findingsBlock = buildFindingsBlock(findings);

  if (!options.anthropicCacheControl) {
    return `${diffBlock}\n${findingsBlock}`;
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: diffBlock,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      { type: "text", text: findingsBlock },
    ],
  };
}

function resolveJudgeModel(judgeModelOverride?: string) {
  // override must go through the full resolution chain so azure-openai/ prefix
  // + API key + resource name get wrapped in createAzure() — otherwise the
  // raw string is handed to mastra's model router which doesn't know the
  // azure-openai provider
  const config = judgeModelOverride
    ? resolveModelConfigWithOverride(judgeModelOverride)
    : resolveModelConfig();
  return {
    displayName: getModelDisplayName(config),
    config,
  };
}

export function resolveJudgeConfig(): JudgeConfig {
  const enabled = process.env.RUSTY_JUDGE_ENABLED;
  const threshold = process.env.RUSTY_JUDGE_THRESHOLD;
  const model = process.env.RUSTY_JUDGE_MODEL;

  return {
    enabled: enabled === "true" || enabled === "1",
    threshold: threshold && !Number.isNaN(Number(threshold)) ? Number(threshold) : 6,
    model: model || undefined,
  };
}

export interface JudgeResult {
  accepted: Finding[];
  rejected: Finding[];
  evaluations: JudgeEvaluation[];
  tokenCount: number;
}

export async function judgeFindings(
  findings: readonly Finding[],
  diff: string,
  config: JudgeConfig,
): Promise<JudgeResult> {
  if (!config.enabled || findings.length === 0) {
    return { accepted: [...findings], rejected: [], evaluations: [], tokenCount: 0 };
  }

  const { displayName, config: modelConfig } = resolveJudgeModel(config.model);

  log.info(
    { findingCount: findings.length, model: displayName, threshold: config.threshold },
    "running judge pass",
  );

  const defaultOptions = resolveDefaultAgentOptions(modelConfig);
  const anthropicCacheControl = supportsAnthropicCacheControl(modelConfig);
  const agent = new Agent({
    id: "review-judge",
    name: "Rusty Bot Judge",
    instructions: () => buildCachedSystemMessages(JUDGE_SYSTEM_PROMPT, { anthropicCacheControl }),
    model: () => resolveModel(modelConfig),
    ...(defaultOptions && { defaultOptions }),
  });

  const userMessage = buildJudgeUserMessage(findings, diff, { anthropicCacheControl });

  let evaluations: JudgeEvaluation[];
  let tokenCount = 0;
  try {
    const modelSettings = applyModelConstraints(modelConfig, resolveModelSettings("judge"));
    const jsonPromptInjection = resolveJsonPromptInjection(modelConfig);
    const response = await agent.generate(
      typeof userMessage === "string" ? userMessage : [userMessage],
      {
        structuredOutput: { schema: JudgeOutputSchema, jsonPromptInjection },
        ...(Object.keys(modelSettings).length > 0 && { modelSettings }),
      },
    );
    evaluations = response.object.evaluations;
    tokenCount = response.usage.totalTokens ?? 0;
  } catch (err) {
    log.warn({ err }, "judge pass failed, keeping all findings");
    return { accepted: [...findings], rejected: [], evaluations: [], tokenCount: 0 };
  }

  // build a lookup so we handle models returning fewer or out-of-order evaluations
  const evalByIndex = new Map(evaluations.map((e) => [e.index, e]));
  const accepted: Finding[] = [];
  const rejected: Finding[] = [];
  const rejectedWithEval: { finding: Finding; evaluation: JudgeEvaluation }[] = [];
  const resolvedEvaluations: JudgeEvaluation[] = [];

  for (let i = 0; i < findings.length; i++) {
    const evaluation = evalByIndex.get(i);
    const resolved: JudgeEvaluation = evaluation ?? {
      index: i,
      confidence: config.threshold,
      reasoning: "no evaluation returned",
    };
    resolvedEvaluations.push(resolved);

    if (resolved.confidence >= config.threshold) {
      accepted.push(findings[i]);
    } else {
      rejected.push(findings[i]);
      rejectedWithEval.push({ finding: findings[i], evaluation: resolved });
    }
  }

  for (const { finding, evaluation } of rejectedWithEval) {
    log.debug(
      {
        file: finding.file,
        line: finding.line,
        severity: finding.severity,
        confidence: evaluation.confidence,
        reasoning: evaluation.reasoning,
      },
      "finding filtered by judge",
    );
  }

  log.info(
    { accepted: accepted.length, rejected: rejected.length, total: findings.length, tokenCount },
    "judge pass complete",
  );

  return { accepted, rejected, evaluations: resolvedEvaluations, tokenCount };
}

export async function judgeReviewResult(
  result: ReviewResult,
  diff: string,
  config: JudgeConfig,
): Promise<ReviewResult> {
  if (!config.enabled) {
    return result;
  }

  const { accepted, rejected, tokenCount } = await judgeFindings(result.findings, diff, config);

  // when consensus elevated the recommendation based on pass votes (not findings),
  // and there are no findings for the judge to evaluate, preserve it
  const shouldPreserveElevated =
    accepted.length === 0 && result.consensusMetadata?.recommendationElevated === true;

  const criticalCount = accepted.filter((f) => f.severity === "critical").length;
  const recommendation = shouldPreserveElevated
    ? result.recommendation
    : criticalCount > 0
      ? ("critical_issues" as const)
      : accepted.length > 0
        ? ("address_before_merge" as const)
        : ("looks_good" as const);

  return {
    ...result,
    findings: accepted,
    recommendation,
    filteredCount: rejected.length,
    judgeTokenCount: tokenCount,
  };
}
