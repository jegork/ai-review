import { Agent } from "@mastra/core/agent";
import { ReviewOutputSchema } from "./schema.js";
import { buildSystemPrompt, buildUserMessage } from "./prompts.js";
import type { ReviewConfig, PRMetadata, TicketInfo, ReviewResult } from "../types.js";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514";

function getModel(): string {
  return process.env.RUSTY_LLM_MODEL ?? DEFAULT_MODEL;
}

export async function runReview(
  config: ReviewConfig,
  diff: string,
  prMetadata: PRMetadata,
  ticketContext?: TicketInfo[],
): Promise<ReviewResult> {
  const systemPrompt = buildSystemPrompt(config);
  const userMessage = buildUserMessage(diff, prMetadata, ticketContext);
  const model = getModel();

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
    modelUsed: model,
    tokenCount: response.usage?.totalTokens ?? 0,
  };
}
