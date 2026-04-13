import { Agent } from "@mastra/core/agent";
import { ReviewOutputSchema } from "./schema.js";
import { buildSystemPrompt, buildUserMessage } from "./prompts.js";
import { resolveModelConfig, resolveModel, getModelDisplayName } from "./model.js";
import type { ReviewConfig, PRMetadata, TicketInfo, ReviewResult } from "../types.js";

export async function runReview(
  config: ReviewConfig,
  diff: string,
  prMetadata: PRMetadata,
  ticketContext?: TicketInfo[],
): Promise<ReviewResult> {
  const systemPrompt = buildSystemPrompt(config);
  const userMessage = buildUserMessage(diff, prMetadata, ticketContext);
  const modelConfig = resolveModelConfig();
  const model = resolveModel(modelConfig);
  const modelName = getModelDisplayName(modelConfig);

  const agent = new Agent({
    id: "review-agent",
    name: "Rusty Bot Reviewer",
    instructions: systemPrompt,
    model,
  });

  const response = await agent.generate(userMessage, {
    structuredOutput: {
      schema: ReviewOutputSchema,
    },
  });

  const parsed = response.object;

  return {
    summary: parsed.summary,
    recommendation: parsed.recommendation,
    findings: parsed.findings,
    observations: parsed.observations,
    filesReviewed: parsed.filesReviewed,
    modelUsed: modelName,
    tokenCount: response.usage?.totalTokens ?? 0,
  };
}
