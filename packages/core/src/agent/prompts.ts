import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReviewConfig, PRMetadata, TicketInfo, FocusArea, ReviewStyle } from "../types.js";
import type { OpenGrepFinding } from "../opengrep/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = resolve(__dirname, "../prompts");

function loadTemplate(relativePath: string): string {
  return readFileSync(resolve(promptsDir, relativePath), "utf-8");
}

const ALL_FOCUS_AREAS: FocusArea[] = ["security", "performance", "bugs", "style", "tests", "docs"];

function buildStyleInstructions(style: ReviewStyle): string {
  return loadTemplate(`styles/${style}.txt`);
}

function buildFocusInstructions(focusAreas: FocusArea[]): string {
  const areas = focusAreas.length > 0 ? focusAreas : ALL_FOCUS_AREAS;
  return areas.map((area) => loadTemplate(`focus/${area}.txt`)).join("\n\n");
}

export function buildSystemPrompt(config: ReviewConfig): string {
  const base = loadTemplate("base.txt");
  const styleInstructions = buildStyleInstructions(config.style);
  const focusInstructions = buildFocusInstructions(config.focusAreas);
  const conventionInstructions = config.conventionFile
    ? `\n\nAdditional instructions from the repository maintainer:\n${config.conventionFile}`
    : "";

  return base
    .replace("{{style_instructions}}", styleInstructions)
    .replace("{{focus_instructions}}", focusInstructions)
    .replace("{{convention_instructions}}", conventionInstructions);
}

function buildOpenGrepSection(findings: OpenGrepFinding[]): string {
  const parts: string[] = [];
  parts.push("## OpenGrep Pre-scan Findings");
  parts.push("");
  parts.push(
    "The following issues were detected by OpenGrep static analysis before your review. " +
      "For each finding, decide whether to **confirm** (include in your findings with the appropriate severity) " +
      "or **dismiss** (explain briefly in your summary why it is a false positive). " +
      "Confirmed OpenGrep findings should be reported as structured findings with exact file/line references. " +
      "You may also find additional issues that OpenGrep cannot detect (logic bugs, auth flaws, design problems).",
  );
  parts.push("");

  for (const f of findings) {
    parts.push(
      `- **${f.ruleId}** [\`${f.severity}\`] in \`${f.file}\` L${f.startLine}–${f.endLine}`,
    );
    parts.push(`  ${f.message}`);
    if (f.snippet) {
      parts.push(`  \`\`\`\`\n  ${f.snippet.trim()}\n  \`\`\`\``);
    }
  }

  return parts.join("\n");
}

export function buildUserMessage(
  diff: string,
  prMetadata: PRMetadata,
  ticketContext?: TicketInfo[],
  languageSummary?: string,
  otherPrFiles?: string[],
  openGrepFindings?: OpenGrepFinding[],
  chunkFiles?: string[],
): string {
  const parts: string[] = [];

  parts.push("## Pull Request");
  parts.push(`**Title:** ${prMetadata.title}`);
  parts.push(`**Author:** ${prMetadata.author}`);
  parts.push(`**Branch:** ${prMetadata.sourceBranch} → ${prMetadata.targetBranch}`);

  if (languageSummary) {
    parts.push(`\n**Languages:** ${languageSummary}`);
  }

  if (prMetadata.description) {
    parts.push(`\n**Description:**\n${prMetadata.description}`);
  }

  if (chunkFiles && chunkFiles.length > 0) {
    parts.push("\n## Files in this chunk");
    parts.push(
      "These are the only paths your `findings` may reference. Copy each path exactly as written — " +
        "do not change extensions (e.g. `.ts` → `.js`), do not normalize separators, do not invent " +
        "siblings. If you cannot anchor an issue to one of these paths and a line in the diff, " +
        "describe it in the summary or as an `observation` instead of a finding.\n",
    );
    parts.push(chunkFiles.map((f) => `- \`${f}\``).join("\n"));
  }

  if (ticketContext && ticketContext.length > 0) {
    parts.push("\n## Linked Tickets");
    for (const ticket of ticketContext) {
      parts.push(`\n### ${ticket.source}: ${ticket.id} — ${ticket.title}`);
      if (ticket.description) {
        parts.push(ticket.description);
      }
      if (ticket.acceptanceCriteria) {
        parts.push(`\n**Acceptance Criteria:**\n${ticket.acceptanceCriteria}`);
      }
      if (ticket.labels.length > 0) {
        parts.push(`**Labels:** ${ticket.labels.join(", ")}`);
      }
    }
    parts.push(
      "\nPlease extract the concrete requirements or acceptance criteria from each linked ticket " +
        "into the structured ticketCompliance output. Evaluate each requirement individually, " +
        "keep requirement wording stable across equivalent checks so later passes can merge into the same checklist, " +
        "and prefer adding evidence to an existing requirement rather than restating it with different phrasing. " +
        "set ticketId when you can, cite diff evidence when available, use `not_addressed` " +
        "only when the visible changes clearly do not satisfy the requirement, and use `unclear` " +
        "when the visible changes are insufficient to decide.",
    );
  }

  if (otherPrFiles && otherPrFiles.length > 0) {
    parts.push("\n## Other Files Changed in This PR");
    parts.push(
      "The following files are also being modified in this PR but are not included in this review chunk. " +
        'Do NOT report observations about these files as issues in "unchanged code" — they are actively changed in this PR ' +
        "and will be reviewed in a separate chunk. However, DO consider their presence when evaluating ticket compliance — " +
        "for example, if a ticket requires tests and test files appear in this list, that requirement is likely addressed " +
        "even though the test diffs are not shown here. If searchCode returns results in these files, " +
        "note that the search results may be stale (pre-merge content).\n",
    );
    parts.push(otherPrFiles.map((f) => `- \`${f}\``).join("\n"));
  }

  if (openGrepFindings && openGrepFindings.length > 0) {
    parts.push("");
    parts.push(buildOpenGrepSection(openGrepFindings));
  }

  parts.push("\n## Diff\n");
  parts.push(diff);

  return parts.join("\n");
}
