import type { PriorReviewContext, PriorReviewContextFinding, ReviewResult } from "../types.js";

const MARKER_PREFIX = "<!-- rusty-bot:context:";
const MARKER_SUFFIX = " -->";
export const PRIOR_CONTEXT_MARKER_RE = /<!--\s*rusty-bot:context:([A-Za-z0-9+/=]+)\s*-->/i;

const SUMMARY_CHAR_CAP = 4_000;
const FINDING_MESSAGE_CHAR_CAP = 250;
const FINDINGS_COUNT_CAP = 50;
const TRUNCATED_SUFFIX = "\n\n[truncated]";
const ELLIPSIS = "…";

const RECOMMENDATIONS = new Set(["looks_good", "address_before_merge", "critical_issues"]);

const SEVERITIES = new Set(["suggestion", "warning", "critical"]);

function truncateMessage(message: string): string {
  if (message.length <= FINDING_MESSAGE_CHAR_CAP) return message;
  return message.slice(0, FINDING_MESSAGE_CHAR_CAP) + ELLIPSIS;
}

function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_CHAR_CAP) return summary;
  return summary.slice(0, SUMMARY_CHAR_CAP) + TRUNCATED_SUFFIX;
}

export function buildPriorContextFromReview(review: ReviewResult): PriorReviewContext {
  return {
    summary: review.summary,
    recommendation: review.recommendation,
    findings: review.findings.map((f) => ({
      file: f.file,
      line: f.line,
      severity: f.severity,
      message: f.message,
    })),
  };
}

/** serialize prior-context state into a hidden comment marker, applying caps. */
export function encodePriorReviewContext(ctx: PriorReviewContext): string {
  const truncated: PriorReviewContext = {
    summary: truncateSummary(ctx.summary),
    recommendation: ctx.recommendation,
    findings: ctx.findings.slice(0, FINDINGS_COUNT_CAP).map((f) => ({
      file: f.file,
      line: f.line,
      severity: f.severity,
      message: truncateMessage(f.message),
    })),
  };
  const json = JSON.stringify(truncated);
  const b64 = Buffer.from(json, "utf-8").toString("base64");
  return `${MARKER_PREFIX}${b64}${MARKER_SUFFIX}`;
}

function isFinding(value: unknown): value is PriorReviewContextFinding {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.file === "string" &&
    typeof v.line === "number" &&
    typeof v.severity === "string" &&
    SEVERITIES.has(v.severity) &&
    typeof v.message === "string"
  );
}

function isContext(value: unknown): value is PriorReviewContext {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.summary !== "string") return false;
  if (typeof v.recommendation !== "string") return false;
  if (!RECOMMENDATIONS.has(v.recommendation)) return false;
  if (!Array.isArray(v.findings)) return false;
  return v.findings.every(isFinding);
}

/** extract a prior-context marker from a comment body. returns null on absence or any malformedness. */
export function extractPriorReviewContext(commentBody: string): PriorReviewContext | null {
  const match = PRIOR_CONTEXT_MARKER_RE.exec(commentBody);
  if (!match) return null;
  try {
    const json = Buffer.from(match[1], "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    return isContext(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const PRIOR_CONTEXT_LIMITS = {
  summaryCharCap: SUMMARY_CHAR_CAP,
  findingMessageCharCap: FINDING_MESSAGE_CHAR_CAP,
  findingsCountCap: FINDINGS_COUNT_CAP,
} as const;
