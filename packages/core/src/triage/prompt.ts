import type { FilePatch } from "../types.js";
import { countTokens } from "../diff/compress.js";

const MAX_TOKENS_PER_FILE = 200;
const TRIAGE_SYSTEM_PROMPT = `You are a code review triage assistant. Your job is to classify files in a pull request by how much review attention they need.

For each file, assign one of these classifications:
- "skip": file needs no review (lock files, auto-generated code, vendored dependencies, binary assets)
- "skim": file needs lightweight review with diff-only context (documentation changes, config tweaks, test snapshots, simple renames, trivial formatting changes, dependency version bumps)
- "deep-review": file needs thorough review with full context (new business logic, security-relevant changes, complex refactors, API surface changes, authentication/authorization code, database schema changes, error handling changes)

Rules:
- lock files and auto-generated files → skip
- markdown, docs, changelogs, license files → skim
- test snapshot files → skim
- CI config changes (yaml/yml in .github/, .gitlab-ci, azure-pipelines) → skim
- .env.example, .gitignore, .editorconfig → skim
- new source files with logic → deep-review
- changes touching auth, crypto, SQL, permissions → deep-review
- changes adding/modifying error handling or validation → deep-review
- when uncertain, prefer deep-review over skim

Respond with a JSON object matching the schema. Do not include any explanation outside the JSON.`;

export function buildTriageSystemPrompt(): string {
  return TRIAGE_SYSTEM_PROMPT;
}

function truncatePatch(patch: FilePatch): string {
  const lines: string[] = [`## ${patch.path}`];
  for (const hunk of patch.hunks) {
    const hunkLines = hunk.content.split("\n");
    for (const line of hunkLines) {
      lines.push(line);
      if (countTokens(lines.join("\n")) > MAX_TOKENS_PER_FILE) {
        lines.push("... (truncated)");
        return lines.join("\n");
      }
    }
  }
  return lines.join("\n");
}

export function buildTriageUserMessage(patches: FilePatch[]): string {
  const parts = patches.map(truncatePatch);
  return `Classify each of these ${patches.length} files:\n\n${parts.join("\n\n")}`;
}
