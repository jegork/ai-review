import type { Finding } from "../types.js";

const SEVERITY_BADGE: Record<Finding["severity"], string> = {
  critical: "**CRITICAL**",
  warning: "**WARNING**",
  suggestion: "**SUGGESTION**",
};

// sentences ending with punctuation followed by whitespace are a strong signal
// that the "fix" is actually prose, not code
const PROSE_PATTERN = /[.!?]\s+[A-Z]/;

function looksLikeCode(text: string): boolean {
  if (PROSE_PATTERN.test(text)) return false;
  const lines = text.split("\n");
  const proseLines = lines.filter((l) => PROSE_PATTERN.test(l));
  return proseLines.length < lines.length / 2;
}

export function formatInlineComment(finding: Finding): string {
  const lines: string[] = [];

  lines.push(`${SEVERITY_BADGE[finding.severity]} (${finding.category})`);
  lines.push("");
  lines.push(finding.message);

  if (finding.suggestedFix) {
    lines.push("");
    if (looksLikeCode(finding.suggestedFix)) {
      lines.push("```suggestion");
      lines.push(finding.suggestedFix);
      lines.push("```");
    } else {
      lines.push("**Suggested fix:**");
      lines.push("");
      lines.push("```");
      lines.push(finding.suggestedFix);
      lines.push("```");
    }
  }

  return lines.join("\n");
}
