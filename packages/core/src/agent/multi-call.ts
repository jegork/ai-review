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
import { runReview, type RunReviewOptions, type ReviewTier } from "./review.js";
import { runConsensusReview } from "./consensus.js";
import { judgeReviewResult, resolveJudgeConfig } from "./judge.js";
import type { McpServerConfig } from "../mcp/types.js";
import { connectMcpServers } from "../mcp/client.js";
import { logger } from "../logger.js";

export interface MultiCallReviewOptions extends RunReviewOptions {
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

function estimateTicketContextTokens(ticketContext?: TicketInfo[]): number {
  if (!ticketContext || ticketContext.length === 0) return 0;

  const serialized = ticketContext
    .map((ticket) =>
      [
        ticket.id,
        ticket.title,
        ticket.description,
        ticket.acceptanceCriteria ?? "",
        ticket.labels.join(","),
      ].join("\n"),
    )
    .join("\n\n");

  return countTokens(serialized);
}

function normalizePath(file: string): string {
  return file
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/:\d+(?::\d+)?$/, "");
}

export function filterObservationsForPrFiles(
  observations: Observation[],
  prFiles: Set<string>,
): Observation[] {
  const normalizedPrFiles = new Set(Array.from(prFiles, normalizePath));
  return observations.filter((o) => !normalizedPrFiles.has(normalizePath(o.file)));
}

export function mergeResults(results: ReviewResult[], modelUsed: string): ReviewResult {
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

  const seen = new Set<string>();
  const dedupedFindings = allFindings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const criticalCount = dedupedFindings.filter((f) => f.severity === "critical").length;

  const summaries = results.map((r) => r.summary).filter(Boolean);
  const summary =
    summaries.length === 1
      ? summaries[0]
      : `Reviewed in ${results.length} passes.\n\n${summaries.join("\n\n")}`;

  const triageStats = results.find((r) => r.triageStats)?.triageStats;
  const consensusMetadata = results.find((r) => r.consensusMetadata)?.consensusMetadata;

  // preserve elevated recommendations from consensus passes even after merging
  const elevatedRecommendation = consensusMetadata?.recommendationElevated
    ? results.find((r) => r.consensusMetadata?.recommendationElevated)?.recommendation
    : undefined;

  const recommendation =
    elevatedRecommendation ??
    (criticalCount > 0
      ? ("critical_issues" as const)
      : dedupedFindings.length > 0
        ? ("address_before_merge" as const)
        : ("looks_good" as const));

  return {
    summary,
    recommendation,
    findings: dedupedFindings,
    observations: allObservations,
    ticketCompliance: mergeTicketCompliance(results),
    filesReviewed: [...allFiles],
    modelUsed,
    tokenCount: totalTokens,
    ...(triageStats ? { triageStats } : {}),
    ...(consensusMetadata && { consensusMetadata }),
  };
}

function normalizeEvidence(evidence: string | null): string | null {
  const trimmed = evidence?.trim();
  return trimmed ? trimmed : null;
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
    evidence: evidenceParts.length > 0 ? evidenceParts.join(" | ") : null,
  }));
}

async function runTieredReview(
  patches: FilePatch[],
  config: ReviewConfig,
  prMetadata: PRMetadata,
  ticketContext: TicketInfo[] | undefined,
  resolvedOptions: RunReviewOptions,
  maxTokens: number,
  tier: ReviewTier,
): Promise<ReviewResult[]> {
  if (patches.length === 0) return [];

  const tierOptions: RunReviewOptions = { ...resolvedOptions, tier };

  if (tier === "skim") {
    const { compressed, skippedFiles } = compressDiff(patches, maxTokens);
    if (skippedFiles.length === 0) {
      const result = await runReview(config, compressed, prMetadata, ticketContext, tierOptions);
      return [result];
    }
    const groups = splitIntoGroups(patches, maxTokens);
    const results: ReviewResult[] = [];
    for (let i = 0; i < groups.length; i++) {
      const { compressed: groupDiff } = compressDiff(groups[i], maxTokens);
      const groupTickets = i === 0 ? ticketContext : undefined;
      const result = await runReview(config, groupDiff, prMetadata, groupTickets, tierOptions);
      results.push(result);
    }
    return results;
  }

  // deep-review: consensus + ticket compliance
  const { compressed, skippedFiles } = compressDiff(patches, maxTokens);
  if (skippedFiles.length === 0) {
    const result = await runConsensusReview(
      patches,
      config,
      prMetadata,
      compressed,
      ticketContext,
      tierOptions,
    );
    return [result];
  }

  const groups = splitIntoGroups(patches, maxTokens);
  const results: ReviewResult[] = [];
  for (const group of groups) {
    const groupCompressed = compressDiff(group, maxTokens).compressed;
    const groupResult = await runConsensusReview(
      group,
      config,
      prMetadata,
      groupCompressed,
      ticketContext,
      tierOptions,
    );
    results.push(groupResult);
  }
  return results;
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

    let result: ReviewResult;

    if (skippedFiles.length === 0) {
      result = await runConsensusReview(
        patches,
        config,
        prMetadata,
        compressed,
        ticketContext,
        resolvedOptions,
      );
    } else {
      const groups = splitIntoGroups(patches, maxTokens);

      if (ticketContext && ticketContext.length > 0 && groups.length > 1) {
        const ticketContextTokens = estimateTicketContextTokens(ticketContext);
        logger.info(
          {
            chunks: groups.length,
            linkedTickets: ticketContext.length,
            estimatedRepeatedTicketTokens: ticketContextTokens * Math.max(groups.length - 1, 0),
          },
          "multi-call review is reusing ticket context across chunks to accumulate compliance evidence",
        );
      }

      const allPaths = patches.map((p) => p.path);

      const results: ReviewResult[] = [];
      for (const group of groups) {
        const groupPaths = new Set(group.map((p) => p.path));
        const otherPrFiles = allPaths.filter((f) => !groupPaths.has(f));
        const groupCompressed = compressDiff(group, maxTokens).compressed;
        const groupResult = await runConsensusReview(
          group,
          config,
          prMetadata,
          groupCompressed,
          ticketContext,
          { ...resolvedOptions, otherPrFiles },
        );
        results.push(groupResult);
      }

      result = mergeResults(results, results[0]?.modelUsed ?? "unknown");
    }

    const prFileSet = new Set(patches.map((p) => p.path));
    const beforeCount = result.observations.length;
    result.observations = filterObservationsForPrFiles(result.observations, prFileSet);
    const droppedCount = beforeCount - result.observations.length;
    if (droppedCount > 0) {
      logger.info(
        { dropped: droppedCount, total: beforeCount },
        "filtered observations that targeted files changed in this PR",
      );
    }

    const judgeConfig = resolveJudgeConfig();
    const judgeDiff =
      skippedFiles.length === 0 ? compressed : compressDiff(patches, Infinity).compressed;
    return await judgeReviewResult(result, judgeDiff, judgeConfig);
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

export async function runCascadeReview(
  skimPatches: FilePatch[],
  deepPatches: FilePatch[],
  config: ReviewConfig,
  prMetadata: PRMetadata,
  ticketContext: TicketInfo[] | undefined,
  options?: MultiCallReviewOptions,
): Promise<ReviewResult> {
  const { mcpServers, maxTokens: maxTokensOpt, ...reviewOptions } = options ?? {};
  const maxTokens = maxTokensOpt ?? DEFAULT_MAX_TOKENS;

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
    const allResults: ReviewResult[] = [];

    // when there are no deep-review files but tickets exist,
    // pass ticket context to the skim pass so it's at least visible in the prompt
    const hasDeepFiles = deepPatches.length > 0;
    const skimTickets = hasDeepFiles ? undefined : ticketContext;
    const deepTickets = ticketContext;

    const skimResults = await runTieredReview(
      skimPatches,
      config,
      prMetadata,
      skimTickets,
      resolvedOptions,
      maxTokens,
      "skim",
    );
    allResults.push(...skimResults);

    // pass skim file paths to the deep tier so the LLM knows they exist
    // (particularly important for ticket compliance — e.g. test files triaged
    // as skim should still count as evidence when evaluating "add tests" requirements)
    const skimFilePaths = skimPatches.map((p) => p.path);
    const deepOptionsWithSkimContext: RunReviewOptions =
      skimFilePaths.length > 0
        ? {
            ...resolvedOptions,
            otherPrFiles: [...(resolvedOptions.otherPrFiles ?? []), ...skimFilePaths],
          }
        : resolvedOptions;

    const deepResults = await runTieredReview(
      deepPatches,
      config,
      prMetadata,
      deepTickets,
      deepOptionsWithSkimContext,
      maxTokens,
      "deep-review",
    );
    allResults.push(...deepResults);

    if (allResults.length === 0) {
      return {
        summary: "No files required review after triage.",
        recommendation: "looks_good",
        findings: [],
        observations: [],
        ticketCompliance: [],
        filesReviewed: [],
        modelUsed: "unknown",
        tokenCount: 0,
      };
    }

    const merged = mergeResults(allResults, allResults[0]?.modelUsed ?? "unknown");

    const allPatches = [...skimPatches, ...deepPatches];
    const judgeDiff = compressDiff(allPatches, Infinity).compressed;
    const judgeConfig = resolveJudgeConfig();
    return await judgeReviewResult(merged, judgeDiff, judgeConfig);
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
