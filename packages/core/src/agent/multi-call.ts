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
import type { McpServerConfig } from "../mcp/types.js";
import { connectMcpServers } from "../mcp/client.js";
import { logger } from "../logger.js";

export interface MultiCallReviewOptions extends RunReviewOptions {
  /** MCP servers to connect to for additional tools. */
  mcpServers?: McpServerConfig;
  maxTokens?: number;
}

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

function normalizeEvidence(evidence?: string | null): string | undefined {
  const trimmed = evidence?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeComplianceKeyPart(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

interface TicketComplianceAccumulator extends TicketComplianceItem {
  evidenceParts: string[];
}

function mergeTicketCompliance(results: ReviewResult[]): TicketComplianceItem[] {
  const merged = new Map<string, TicketComplianceAccumulator>();

  for (const result of results) {
    for (const item of result.ticketCompliance) {
      const key = `${normalizeComplianceKeyPart(item.ticketId)}:${normalizeComplianceKeyPart(item.requirement)}`;
      const evidence = normalizeEvidence(item.evidence);
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, {
          ...item,
          evidence,
          evidenceParts: evidence ? [evidence] : [],
        });
        continue;
      }

      if (evidence && !existing.evidenceParts.includes(evidence)) {
        existing.evidenceParts.push(evidence);
      }

      const existingPriority = TICKET_COMPLIANCE_PRIORITY[existing.status];
      const nextPriority = TICKET_COMPLIANCE_PRIORITY[item.status];

      if (nextPriority > existingPriority) {
        existing.ticketId = item.ticketId;
        existing.requirement = item.requirement;
        existing.status = item.status;
      }
    }
  }

  return [...merged.values()].map(({ evidenceParts, ...item }) => ({
    ...item,
    evidence: evidenceParts.length > 0 ? evidenceParts.join(" | ") : undefined,
  }));
}

export async function runMultiCallReview(
  patches: FilePatch[],
  config: ReviewConfig,
  prMetadata: PRMetadata,
  ticketContext?: TicketInfo[],
  options?: MultiCallReviewOptions,
): Promise<ReviewResult> {
  const { mcpServers, maxTokens: maxTokensOpt, ...reviewOptions } = options ?? {};
  const maxTokens = maxTokensOpt ?? DEFAULT_MAX_TOKENS;

  // connect to MCP servers once for the entire review
  let mcpDisconnect: (() => Promise<void>) | undefined;
  let resolvedOptions: RunReviewOptions = reviewOptions;

  if (mcpServers && Object.keys(mcpServers).length > 0) {
    try {
      const mcp = await connectMcpServers(mcpServers);
      mcpDisconnect = mcp.disconnect;
      resolvedOptions = {
        ...reviewOptions,
        extraTools: { ...reviewOptions.extraTools, ...mcp.tools },
      };
    } catch (err) {
      logger.warn({ err }, "failed to connect MCP servers; continuing without MCP tools");
    }
  }

  try {
    const { compressed, skippedFiles } = compressDiff(patches, maxTokens);

    // if everything fits in one call, use the simple path
    if (skippedFiles.length === 0) {
      return await runReview(config, compressed, prMetadata, ticketContext, resolvedOptions);
    }

    // split into groups that each fit within the token budget
    const groups = splitIntoGroups(patches, maxTokens);

    // Each chunk needs the same ticket context so compliance evidence can be
    // gathered across the full PR, then merged into one checklist.
    const results: ReviewResult[] = [];
    for (const group of groups) {
      const { compressed: groupDiff } = compressDiff(group, maxTokens);
      const result = await runReview(config, groupDiff, prMetadata, ticketContext, resolvedOptions);
      results.push(result);
    }

    return mergeResults(results, results[0]?.modelUsed ?? "unknown");
  } finally {
    if (mcpDisconnect) {
      try {
        await mcpDisconnect();
      } catch (err) {
        logger.warn({ err }, "MCP disconnect error");
      }
    }
  }
}
