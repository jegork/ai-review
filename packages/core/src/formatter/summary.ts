import type {
  ReviewResult,
  Severity,
  Finding,
  Observation,
  TriageStats,
  TicketComplianceStatus,
  TicketResolutionStatus,
} from "../types.js";

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "suggestion"];

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  suggestion: "SUGGESTION",
};

const RECOMMENDATION_TEXT: Record<ReviewResult["recommendation"], string> = {
  looks_good: "Looks good!",
  address_before_merge: "Address before merge",
  critical_issues: "Critical issues found",
};

const TICKET_COMPLIANCE_LABEL: Record<TicketComplianceStatus, string> = {
  addressed: "Addressed",
  partially_addressed: "Partially addressed",
  not_addressed: "Not addressed",
  unclear: "Unclear",
};

function sanitizeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, "<br/>");
}

function buildIssueTable(items: (Finding | Observation)[]): string {
  const rows = items.map((item) => `| \`${item.file}\` | ${item.line} | ${item.message} |`);
  return ["| File | Line | Issue |", "|------|------|-------|", ...rows].join("\n");
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    warning: 0,
    suggestion: 0,
  };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

function buildTriageSection(stats: TriageStats): string {
  const lines: string[] = [];
  lines.push("<details>");
  lines.push("<summary>Triage Summary</summary>");
  lines.push("");
  lines.push("| Classification | Files |");
  lines.push("|----------------|-------|");
  lines.push(`| Skipped | ${stats.filesSkipped} |`);
  lines.push(`| Skimmed | ${stats.filesSkimmed} |`);
  lines.push(`| Deep Reviewed | ${stats.filesDeepReviewed} |`);
  lines.push("");
  lines.push(`Triage model: \`${stats.triageModelUsed}\` · ${stats.triageTokenCount} tokens`);
  lines.push("");
  lines.push("</details>");
  lines.push("");
  return lines.join("\n");
}

function buildTicketFetchMessage(status: TicketResolutionStatus): string {
  if (status.refsFound === 0) {
    return "No linked ticket references detected.";
  }

  const consideredSuffix =
    status.refsFound > status.refsConsidered ? ` (reviewed first ${status.refsConsidered})` : "";

  const detailParts: string[] = [];
  if (status.missingProvider > 0) {
    detailParts.push(`${status.missingProvider} skipped due to missing provider`);
  }
  if (status.fetchFailed > 0) {
    detailParts.push(`${status.fetchFailed} failed to fetch`);
  }

  if (status.fetched > 0) {
    const detailSuffix = detailParts.length > 0 ? ` ${detailParts.join(", ")}.` : "";
    return `Fetched ${status.fetched} of ${status.refsConsidered} linked ticket(s)${consideredSuffix}.${detailSuffix}`;
  }

  if (status.missingProvider > 0 && status.fetchFailed === 0) {
    return `Found ${status.refsConsidered} linked ticket reference(s)${consideredSuffix}, but no matching ticket provider was configured.`;
  }

  if (status.fetchFailed > 0 && status.missingProvider === 0) {
    return `Found ${status.refsConsidered} linked ticket reference(s)${consideredSuffix}, but ${status.fetchFailed} fetch${status.fetchFailed === 1 ? " failed" : "es failed"}.`;
  }

  return `Found ${status.refsConsidered} linked ticket reference(s)${consideredSuffix}, but could not fetch ticket details. ${detailParts.join(", ")}.`;
}

export function formatSummaryComment(
  review: ReviewResult,
  options?: { ticketResolution?: TicketResolutionStatus },
): string {
  const counts = countBySeverity(review.findings);
  const totalIssues = review.findings.length;

  const lines: string[] = [];

  lines.push("# Code Review Summary");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    `**Status:** ${totalIssues} Issues Found | **Recommendation:** ${RECOMMENDATION_TEXT[review.recommendation]}`,
  );
  lines.push("");

  if (review.triageStats) {
    lines.push(buildTriageSection(review.triageStats));
  }

  lines.push("## Overview");
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  for (const sev of SEVERITY_ORDER) {
    lines.push(`| ${SEVERITY_LABEL[sev]} | ${counts[sev]} |`);
  }
  lines.push("");

  const severitiesWithFindings = SEVERITY_ORDER.filter((sev) => counts[sev] > 0);

  lines.push("<details>");
  lines.push("<summary>Issue Details (click to expand)</summary>");
  lines.push("");

  if (severitiesWithFindings.length === 0) {
    lines.push("No issues found.");
    lines.push("");
  } else {
    for (const sev of severitiesWithFindings) {
      const items = review.findings.filter((f) => f.severity === sev);
      lines.push(SEVERITY_LABEL[sev]);
      lines.push("");
      lines.push(buildIssueTable(items));
      lines.push("");
    }
  }

  lines.push("</details>");
  lines.push("");

  if (options?.ticketResolution && options.ticketResolution.refsFound > 0) {
    lines.push("## Ticket Fetch");
    lines.push("");
    lines.push(buildTicketFetchMessage(options.ticketResolution));
    lines.push("");
  }

  if (review.observations.length > 0) {
    lines.push("<details>");
    lines.push("<summary>Other Observations (not in diff)</summary>");
    lines.push("");
    lines.push("Issues found in unchanged code that cannot receive inline comments:");
    lines.push("");
    lines.push(buildIssueTable(review.observations));
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (review.ticketCompliance.length > 0) {
    lines.push("<details>");
    lines.push(
      `<summary>Ticket Compliance (${review.ticketCompliance.length} requirements)</summary>`,
    );
    lines.push("");
    lines.push("| Ticket | Requirement | Status | Evidence |");
    lines.push("|--------|-------------|--------|----------|");
    for (const item of review.ticketCompliance) {
      lines.push(
        `| ${sanitizeTableCell(item.ticketId ?? "—")} | ${sanitizeTableCell(item.requirement)} | ${TICKET_COMPLIANCE_LABEL[item.status]} | ${sanitizeTableCell(item.evidence ?? "—")} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  const fileIssueCounts = new Map<string, number>();
  for (const file of review.filesReviewed) {
    fileIssueCounts.set(file, 0);
  }
  for (const f of review.findings) {
    fileIssueCounts.set(f.file, (fileIssueCounts.get(f.file) ?? 0) + 1);
  }

  lines.push("<details>");
  lines.push(`<summary>Files Reviewed (${review.filesReviewed.length} files)</summary>`);
  lines.push("");
  for (const file of review.filesReviewed) {
    const count = fileIssueCounts.get(file) ?? 0;
    lines.push(`- \`${file}\` - ${count} issues`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(review.summary);
  lines.push("");
  lines.push("---");
  lines.push("");
  const parts = [`Reviewed by ${review.modelUsed} · ${review.tokenCount} tokens (review)`];
  if (review.judgeTokenCount !== undefined) {
    parts.push(`${review.judgeTokenCount} tokens (judge)`);
  }
  if (review.filteredCount !== undefined) {
    parts.push(`${review.filteredCount} low-confidence findings filtered`);
  }
  lines.push(parts.join(" · "));
  lines.push("");

  return lines.join("\n");
}
