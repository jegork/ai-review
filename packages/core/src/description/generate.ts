import { Agent } from "@mastra/core/agent";
import { compressDiff } from "../diff/compress.js";
import { resolveModelConfig, resolveModel, getModelDisplayName } from "../agent/model.js";
import { PRDescriptionOutputSchema, type PRDescriptionOutput } from "./schema.js";
import { buildDescriptionSystemPrompt, buildDescriptionUserMessage } from "./prompt.js";
import type { FilePatch, PRMetadata } from "../types.js";

const DESCRIPTION_MARKER = "<!-- rusty-bot-description -->";
const MAX_DESCRIPTION_TOKENS = 30_000;

export interface GenerateDescriptionResult {
  markdown: string;
  modelUsed: string;
  tokenCount: number;
}

const PLACEHOLDER_PATTERNS = [
  /^\s*$/,
  /^(todo|wip|fixme|tbd|placeholder|fill\s*(this\s*)?in)\s*\.?$/i,
  /^(no\s+description|update|fix|changes?)\s*\.?$/i,
];

export function shouldGenerateDescription(currentDescription: string): boolean {
  const trimmed = currentDescription.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.includes(DESCRIPTION_MARKER)) return true;
  if (trimmed.length < 20 && PLACEHOLDER_PATTERNS.some((p) => p.test(trimmed))) return true;
  return false;
}

export function formatDescription(output: PRDescriptionOutput): string {
  const lines: string[] = [DESCRIPTION_MARKER, ""];

  lines.push("## Summary");
  lines.push("");
  lines.push(output.summary);
  lines.push("");

  if (output.fileChanges.length > 0) {
    lines.push("## Changes");
    lines.push("");
    lines.push("| File | Description |");
    lines.push("|------|-------------|");
    for (const change of output.fileChanges) {
      const path = change.path.replace(/\|/g, "\\|");
      const desc = change.description.replace(/\|/g, "\\|").replace(/\n+/g, " ");
      lines.push(`| \`${path}\` | ${desc} |`);
    }
    lines.push("");
  }

  if (output.breakingChanges.length > 0) {
    lines.push("## Breaking Changes");
    lines.push("");
    for (const change of output.breakingChanges) {
      lines.push(`- ${change}`);
    }
    lines.push("");
  }

  if (output.migrationNotes) {
    lines.push("## Migration Notes");
    lines.push("");
    lines.push(output.migrationNotes);
    lines.push("");
  }

  return lines.join("\n");
}

export async function generatePRDescription(
  patches: FilePatch[],
  prMetadata: PRMetadata,
): Promise<GenerateDescriptionResult> {
  const { compressed } = compressDiff(patches, MAX_DESCRIPTION_TOKENS);

  const modelConfig = resolveModelConfig();
  const model = resolveModel(modelConfig);
  const modelName = getModelDisplayName(modelConfig);

  const agent = new Agent({
    id: "description-agent",
    name: "Rusty Bot Description Generator",
    instructions: buildDescriptionSystemPrompt(),
    model,
  });

  const userMessage = buildDescriptionUserMessage(compressed, prMetadata);

  const response = await agent.generate(userMessage, {
    structuredOutput: { schema: PRDescriptionOutputSchema },
  });

  const parsed = response.object;
  const tokenCount = response.usage.totalTokens ?? 0;

  return {
    markdown: formatDescription(parsed),
    modelUsed: modelName,
    tokenCount,
  };
}
