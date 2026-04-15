import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { ReviewOutputSchema, SkimReviewOutputSchema } from "./schema.js";
import { buildSystemPrompt, buildUserMessage } from "./prompts.js";
import { resolveModelConfig, resolveModel, getModelDisplayName } from "./model.js";
import type { ReviewConfig, PRMetadata, TicketInfo, ReviewResult, GitProvider } from "../types.js";
import type { OpenGrepFinding } from "../opengrep/types.js";
import { createSearchCodeTool, createGetFileContextTool } from "./tools.js";

export type ReviewTier = "skim" | "deep-review";

export interface RunReviewOptions {
  provider?: GitProvider;
  sourceRef?: string;
  extraTools?: ToolsInput;
  languageSummary?: string;
  tier?: ReviewTier;
  /** Files changed in the PR but not present in the current review chunk. */
  otherPrFiles?: string[];
  /** OpenGrep findings to feed to the LLM for triage. */
  openGrepFindings?: OpenGrepFinding[];
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
  );
  const modelConfig = resolveModelConfig();
  const model = resolveModel(modelConfig);
  const modelName = getModelDisplayName(modelConfig);

  const builtInTools = buildTools(options);
  const extraTools = tier === "skim" ? {} : (options?.extraTools ?? {});

  const agent = new Agent({
    id: "review-agent",
    name: "Rusty Bot Reviewer",
    instructions: systemPrompt,
    model,
    tools: { ...builtInTools, ...extraTools },
  });

  const schema = tier === "skim" ? SkimReviewOutputSchema : ReviewOutputSchema;

  const response = await agent.generate(userMessage, {
    structuredOutput: { schema },
  });

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
    filesReviewed: parsed.filesReviewed,
    modelUsed: modelName,
    tokenCount: response.usage.totalTokens ?? 0,
  };
}
