import { compressDiff, countTokens } from "../diff/compress.js";
import type {
  FilePatch,
  ReviewConfig,
  PRMetadata,
  TicketInfo,
  ReviewResult,
  Finding,
  Observation,
  TicketComplianceItem,
  TicketComplianceStatus,
} from "../types.js";
import { runReview, type RunReviewOptions } from "./review.js";

const DEFAULT_MAX_TOKENS = 60_000;
const TICKET_COMPLIANCE_PRIORITY: Record<TicketComplianceStatus, number> = {
  addressed: 3,
  partially_addressed: 2,
  unclear: 1,
  not_addressed: 0,
};

function splitIntoGroups(patches: FilePatch[], maxTokensPerGroup: number): FilePatch[][] {
  const groups: FilePatch[][] = [];
  let currentGroup: FilePatch[] = [];
  let currentTokens = 0;

  for (const patch of patches) {
    const { compressed } = compressDiff([patch], Infinity);
    const tokens = countTokens(compressed);

    if (currentGroup.length > 0 && currentTokens + tokens > maxTokensPerGroup) {
      groups.push(currentGroup);
      currentGroup = [patch];
      currentTokens = tokens;
    } else {
      currentGroup.push(patch);
      currentTokens += tokens;
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function mergeResults(results: ReviewResult[], modelUsed: string): ReviewResult {
  const allFindings: Finding[] = [];
  const allObservations: Observation[] = [];
  const allFiles = new Set<string>();
  let totalTokens = 0;

  for (const result of results) {
    allFindings.push(...result.findings);
    allObservations.push(...result.observations);
    result.filesReviewed.forEach((f) => allFiles.add(f));
    totalTokens += result.tokenCount;
  }

  // deduplicate findings by file+line+message
  const seen = new Set<string>();
  const dedupedFindings = allFindings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const criticalCount = dedupedFindings.filter((f) => f.severity === "critical").length;
  const recommendation =
    criticalCount > 0
      ? ("critical_issues" as const)
      : dedupedFindings.length > 0
        ? ("address_before_merge" as const)
        : ("looks_good" as const);

  // combine summaries
  const summaries = results.map((r) => r.summary).filter(Boolean);
  const summary =
    summaries.length === 1
      ? summaries[0]
      : `Reviewed in ${results.length} passes.\n\n${summaries.join("\n\n")}`;

  return {
    summary,
    recommendation,
    findings: dedupedFindings,
    observations: allObservations,
    ticketCompliance: mergeTicketCompliance(results),
    filesReviewed: [...allFiles],
    modelUsed,
    tokenCount: totalTokens,
  };
}

function normalizeEvidence(evidence?: string): string | undefined {
  const trimmed = evidence?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeComplianceKeyPart(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function mergeEvidence(left?: string, right?: string): string | undefined {
  const merged = [...new Set([normalizeEvidence(left), normalizeEvidence(right)].filter(Boolean))];
  return merged.length > 0 ? merged.join(" | ") : undefined;
}

function mergeTicketCompliance(results: ReviewResult[]): TicketComplianceItem[] {
  const merged = new Map<string, TicketComplianceItem>();

  for (const result of results) {
    for (const item of result.ticketCompliance) {
      const key = `${normalizeComplianceKeyPart(item.ticketId)}:${normalizeComplianceKeyPart(item.requirement)}`;
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, { ...item, evidence: normalizeEvidence(item.evidence) });
        continue;
      }

      const existingPriority = TICKET_COMPLIANCE_PRIORITY[existing.status];
      const nextPriority = TICKET_COMPLIANCE_PRIORITY[item.status];

      if (nextPriority > existingPriority) {
        merged.set(key, {
          ...item,
          evidence: mergeEvidence(item.evidence, existing.evidence),
        });
        continue;
      }

      if (nextPriority === existingPriority) {
        existing.evidence = mergeEvidence(existing.evidence, item.evidence);
      }
    }
  }

  return [...merged.values()];
}

export async function runMultiCallReview(
  patches: FilePatch[],
  config: ReviewConfig,
  prMetadata: PRMetadata,
  ticketContext?: TicketInfo[],
  options?: RunReviewOptions & { maxTokens?: number },
): Promise<ReviewResult> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

  const { compressed, skippedFiles } = compressDiff(patches, maxTokens);

  // if everything fits in one call, use the simple path
  if (skippedFiles.length === 0) {
    return runReview(config, compressed, prMetadata, ticketContext, options);
  }

  // split into groups that each fit within the token budget
  const groups = splitIntoGroups(patches, maxTokens);

  // Each chunk needs the same ticket context so compliance evidence can be gathered
  // across the full PR, then merged into one checklist.
  const results: ReviewResult[] = [];
  for (let i = 0; i < groups.length; i++) {
    const { compressed: groupDiff } = compressDiff(groups[i], maxTokens);
    const result = await runReview(config, groupDiff, prMetadata, ticketContext, options);
    results.push(result);
  }

  return mergeResults(results, results[0]?.modelUsed ?? "unknown");
}
