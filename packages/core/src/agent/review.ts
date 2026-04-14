import { Agent } from "@mastra/core/agent";
import type { ToolsInput } from "@mastra/core/agent";
import { ReviewOutputSchema } from "./schema.js";
import { buildSystemPrompt, buildUserMessage } from "./prompts.js";
import { resolveModelConfig, resolveModel, getModelDisplayName } from "./model.js";
import type { ReviewConfig, PRMetadata, TicketInfo, ReviewResult, GitProvider } from "../types.js";
import { createSearchCodeTool, createGetFileContextTool } from "./tools.js";

export interface RunReviewOptions {
  provider?: GitProvider;
  sourceRef?: string;
  /** Additional tools to provide to the review agent (e.g. from MCP servers). */
  extraTools?: ToolsInput;
  languageSummary?: string;
}

function buildTools(options?: RunReviewOptions): ToolsInput {
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
  const systemPrompt = buildSystemPrompt(config);
  const userMessage = buildUserMessage(diff, prMetadata, ticketContext, options?.languageSummary);
  const modelConfig = resolveModelConfig();
  const model = resolveModel(modelConfig);
  const modelName = getModelDisplayName(modelConfig);

  const builtInTools = buildTools(options);
  const extraTools = options?.extraTools ?? {};

  const agent = new Agent({
    id: "review-agent",
    name: "Rusty Bot Reviewer",
    instructions: systemPrompt,
    model,
    // MCPClient.listTools() namespaces tools as serverName_toolName,
    // so collisions with built-in tool names are unlikely in practice.
    tools: { ...builtInTools, ...extraTools },
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
