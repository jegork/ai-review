import type { Finding } from "../types.js";

const SEVERITY_BADGE: Record<Finding["severity"], string> = {
  critical: "**CRITICAL**",
  warning: "**WARNING**",
  suggestion: "**SUGGESTION**",
};

export function formatInlineComment(finding: Finding): string {
  const lines: string[] = [];

  lines.push(`${SEVERITY_BADGE[finding.severity]} (${finding.category})`);
  lines.push("");
  lines.push(finding.message);

  if (finding.suggestedFix) {
    lines.push("");
    lines.push("```suggestion");
    lines.push(finding.suggestedFix);
    lines.push("```");
  }

  return lines.join("\n");
}
