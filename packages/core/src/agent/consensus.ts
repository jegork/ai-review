import type {
  FilePatch,
  ReviewConfig,
  PRMetadata,
  TicketInfo,
  ReviewResult,
  Finding,
  Observation,
  Recommendation,
} from "../types.js";
import { compressDiff } from "../diff/compress.js";
import { shufflePatches } from "../diff/shuffle.js";
import { clusterFindings, clusterObservations } from "./cluster.js";
import { runReview, type RunReviewOptions } from "./review.js";
import { logger } from "../logger.js";

const DEFAULT_CONSENSUS_PASSES = 3;

function deriveBaseSeed(prMetadata: PRMetadata): number {
  let hash = 0;
  const str = `${prMetadata.id}:${prMetadata.sourceBranch}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function deriveRecommendation(findings: Finding[]): Recommendation {
  const hasCritical = findings.some((f) => f.severity === "critical");
  if (hasCritical) return "critical_issues";
  if (findings.length > 0) return "address_before_merge";
  return "looks_good";
}

export async function runConsensusReview(
  patches: FilePatch[],
  config: ReviewConfig,
  prMetadata: PRMetadata,
  diff: string,
  ticketContext?: TicketInfo[],
  options?: RunReviewOptions,
): Promise<ReviewResult> {
  const passes = config.consensusPasses ?? DEFAULT_CONSENSUS_PASSES;

  if (passes <= 1) {
    return runReview(config, diff, prMetadata, ticketContext, options);
  }

  const threshold = config.consensusThreshold ?? Math.ceil(passes / 2);
  const baseSeed = deriveBaseSeed(prMetadata);

  logger.info({ passes, threshold, prId: prMetadata.id }, "starting consensus review");

  const passPromises = Array.from({ length: passes }, (_, i) => {
    const shuffled = shufflePatches(patches, baseSeed + i);
    const { compressed } = compressDiff(shuffled, Infinity);
    const tickets = i === 0 ? ticketContext : undefined;
    return runReview(config, compressed, prMetadata, tickets, options);
  });

  const results = await Promise.all(passPromises);

  const findingsByPass = results.map((r) => r.findings);
  const observationsByPass = results.map((r) => r.observations);

  const findingClusters = clusterFindings(findingsByPass);
  const observationClusters = clusterObservations(observationsByPass);

  const survivingFindings: Finding[] = findingClusters
    .filter((c) => c.voteCount >= threshold)
    .map((c) => ({ ...c.representative, voteCount: c.voteCount }));

  const survivingObservations: Observation[] = observationClusters
    .filter((c) => c.voteCount >= threshold)
    .map((c) => ({ ...c.representative, voteCount: c.voteCount }));

  const allFiles = new Set(results.flatMap((r) => r.filesReviewed));
  const totalTokens = results.reduce((sum, r) => sum + r.tokenCount, 0);

  const droppedFindings = findingClusters.length - survivingFindings.length;
  const droppedObservations = observationClusters.length - survivingObservations.length;

  logger.info(
    {
      passes,
      threshold,
      totalClusters: findingClusters.length,
      surviving: survivingFindings.length,
      dropped: droppedFindings,
      droppedObservations,
    },
    "consensus voting complete",
  );

  const summaries = results.map((r) => r.summary).filter(Boolean);
  const summary =
    summaries.length === 1
      ? summaries[0]
      : `Consensus review (${passes} passes, threshold ${threshold}).\n\n${summaries[0]}`;

  return {
    summary,
    recommendation: deriveRecommendation(survivingFindings),
    findings: survivingFindings,
    observations: survivingObservations,
    filesReviewed: [...allFiles],
    modelUsed: results[0]?.modelUsed ?? "unknown",
    tokenCount: totalTokens,
    consensusMetadata: { passes, threshold },
  };
}
