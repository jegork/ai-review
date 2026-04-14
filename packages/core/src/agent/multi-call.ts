import { compressDiff, countTokens } from "../diff/compress.js";
import type {
  FilePatch,
  ReviewConfig,
  PRMetadata,
  TicketInfo,
  ReviewResult,
  Finding,
  Observation,
} from "../types.js";
import { runReview, type RunReviewOptions, type ReviewTier } from "./review.js";
import type { McpServerConfig } from "../mcp/types.js";
import { connectMcpServers } from "../mcp/client.js";
import { logger } from "../logger.js";

export interface MultiCallReviewOptions extends RunReviewOptions {
  mcpServers?: McpServerConfig;
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 60_000;

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

  // preserve triageStats from any result that has it
  const triageStats = results.find((r) => r.triageStats)?.triageStats;

  return {
    summary,
    recommendation,
    findings: dedupedFindings,
    observations: allObservations,
    filesReviewed: [...allFiles],
    modelUsed,
    tokenCount: totalTokens,
    ...(triageStats ? { triageStats } : {}),
  };
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

    // first group gets ticket context, subsequent ones don't (avoid redundant compliance checks)
    const results: ReviewResult[] = [];
    for (let i = 0; i < groups.length; i++) {
      const { compressed: groupDiff } = compressDiff(groups[i], maxTokens);
      const groupTickets = i === 0 ? ticketContext : undefined;
      const result = await runReview(config, groupDiff, prMetadata, groupTickets, resolvedOptions);
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

    // skim pass: diff-only context, no tools
    const skimResults = await runTieredReview(
      skimPatches,
      config,
      prMetadata,
      undefined,
      resolvedOptions,
      maxTokens,
      "skim",
    );
    allResults.push(...skimResults);

    // deep-review pass: full context + tools, gets ticket context
    const deepResults = await runTieredReview(
      deepPatches,
      config,
      prMetadata,
      ticketContext,
      resolvedOptions,
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
        filesReviewed: [],
        modelUsed: "unknown",
        tokenCount: 0,
      };
    }

    return mergeResults(allResults, allResults[0]?.modelUsed ?? "unknown");
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
