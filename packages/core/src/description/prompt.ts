import type { PRMetadata } from "../types.js";

const SYSTEM_PROMPT = `You are a PR description writer. Your job is to produce a clear, structured description of a pull request based on the diff and PR metadata.

Write from the perspective of someone explaining the PR to a reviewer. Be concise and factual — describe what changed and why, not whether the changes are good.

Rules:
- Focus on the intent and effect of the changes, not low-level line-by-line details
- Group related file changes by logical concern when the same feature touches multiple files
- Only list breaking changes when the diff clearly introduces API/contract/schema incompatibilities
- Only include migration notes when there are schema migrations, API changes, config changes, or dependency changes that consumers need to act on
- If the PR title or branch name hints at the purpose, use that context
- Do not invent context that isn't evident from the diff`;

export function buildDescriptionSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildDescriptionUserMessage(diff: string, prMetadata: PRMetadata): string {
  const parts: string[] = [];

  parts.push("## Pull Request");
  parts.push(`**Title:** ${prMetadata.title}`);
  parts.push(`**Author:** ${prMetadata.author}`);
  parts.push(`**Branch:** ${prMetadata.sourceBranch} → ${prMetadata.targetBranch}`);

  parts.push("\n## Diff\n");
  parts.push(diff);

  return parts.join("\n");
}
