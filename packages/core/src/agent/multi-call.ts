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
import { type RunReviewOptions } from "./review.js";
import { runConsensusReview } from "./consensus.js";
import { judgeReviewResult, resolveJudgeConfig } from "./judge.js";
import type { McpServerConfig } from "../mcp/types.js";
import { connectMcpServers } from "../mcp/client.js";
import { logger } from "../logger.js";

export interface MultiCallReviewOptions extends RunReviewOptions {
  /** MCP servers to connect to for additional tools. */
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

  const summaries = results.map((r) => r.summary).filter(Boolean);
  const summary =
    summaries.length === 1
      ? summaries[0]
      : `Reviewed in ${results.length} passes.\n\n${summaries.join("\n\n")}`;

  const consensusMetadata = results[0]?.consensusMetadata;

  return {
    summary,
    recommendation,
    findings: dedupedFindings,
    observations: allObservations,
    filesReviewed: [...allFiles],
    modelUsed,
    tokenCount: totalTokens,
    ...(consensusMetadata && { consensusMetadata }),
  };
}

async function reviewChunk(
  patches: FilePatch[],
  config: ReviewConfig,
  prMetadata: PRMetadata,
  maxTokens: number,
  ticketContext?: TicketInfo[],
  options?: RunReviewOptions,
): Promise<ReviewResult> {
  const { compressed } = compressDiff(patches, maxTokens);
  return runConsensusReview(patches, config, prMetadata, compressed, ticketContext, options);
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
    const { skippedFiles } = compressDiff(patches, maxTokens);

    let result: ReviewResult;

    if (skippedFiles.length === 0) {
      result = await reviewChunk(
        patches,
        config,
        prMetadata,
        maxTokens,
        ticketContext,
        resolvedOptions,
      );
    } else {
      const groups = splitIntoGroups(patches, maxTokens);

      const results: ReviewResult[] = [];
      for (let i = 0; i < groups.length; i++) {
        const groupTickets = i === 0 ? ticketContext : undefined;
        const groupResult = await reviewChunk(
          groups[i],
          config,
          prMetadata,
          maxTokens,
          groupTickets,
          resolvedOptions,
        );
        results.push(groupResult);
      }

      result = mergeResults(results, results[0]?.modelUsed ?? "unknown");
    }

    const judgeConfig = resolveJudgeConfig();
    const fullDiff = compressDiff(patches, Infinity).compressed;
    return await judgeReviewResult(result, fullDiff, judgeConfig);
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
