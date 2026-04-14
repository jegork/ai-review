import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReviewConfig, PRMetadata, TicketInfo, FocusArea, ReviewStyle } from "../types.js";

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
  const customInstructions = config.customInstructions
    ? `\n\nAdditional instructions from the repository maintainer:\n${config.customInstructions}`
    : "";

  return base
    .replace("{{style_instructions}}", styleInstructions)
    .replace("{{focus_instructions}}", focusInstructions)
    .replace("{{custom_instructions}}", customInstructions);
}

export function buildUserMessage(
  diff: string,
  prMetadata: PRMetadata,
  ticketContext?: TicketInfo[],
  languageSummary?: string,
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
        "set ticketId when you can, cite diff evidence when available, use `not_addressed` " +
        "only when the visible changes clearly do not satisfy the requirement, and use `unclear` " +
        "when the visible changes are insufficient to decide.",
    );
  }

  parts.push("\n## Diff\n");
  parts.push(diff);

  return parts.join("\n");
}
