import type {
  FilePatch,
  ReviewConfig,
  PRMetadata,
  TicketInfo,
  ReviewResult,
  Finding,
  Observation,
  Recommendation,
  DroppedFinding,
} from "../types.js";
import { compressDiff } from "../diff/compress.js";
import { shufflePatches } from "../diff/shuffle.js";
import { clusterFindings, clusterObservations } from "./cluster.js";
import { runReview, type RunReviewOptions } from "./review.js";
import { logger } from "../logger.js";

const DEFAULT_CONSENSUS_PASSES = 3;

const RECOMMENDATION_SEVERITY: Record<Recommendation, number> = {
  looks_good: 0,
  address_before_merge: 1,
  critical_issues: 2,
};

function deriveBaseSeed(prMetadata: PRMetadata): number {
  let hash = 0;
  const str = `${prMetadata.id}:${prMetadata.sourceBranch}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function deriveRecommendation(
  findings: Finding[],
  passRecommendations: Recommendation[],
  threshold: number,
): Recommendation {
  const hasCritical = findings.some((f) => f.severity === "critical");
  if (hasCritical) return "critical_issues";
  if (findings.length > 0) return "address_before_merge";

  // when findings are empty, check if a majority of passes flagged issues —
  // this catches cases where the LLM describes problems in its summary/recommendation
  // but doesn't emit structured findings
  const nonGoodCount = passRecommendations.filter((r) => RECOMMENDATION_SEVERITY[r] > 0).length;

  if (nonGoodCount >= threshold) {
    const criticalCount = passRecommendations.filter((r) => r === "critical_issues").length;
    if (criticalCount >= threshold) return "critical_issues";
    return "address_before_merge";
  }

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
  const passRecommendations = results.map((r) => r.recommendation);

  const findingClusters = clusterFindings(findingsByPass);
  const observationClusters = clusterObservations(observationsByPass);

  const survivingClusters = findingClusters.filter((c) => c.voteCount >= threshold);
  const droppedClusters = findingClusters.filter((c) => c.voteCount < threshold);

  const survivingFindings: Finding[] = survivingClusters.map((c) => ({
    ...c.representative,
    voteCount: c.voteCount,
  }));

  const droppedFindings: DroppedFinding[] = droppedClusters.map((c) => ({
    file: c.representative.file,
    line: c.representative.line,
    severity: c.representative.severity,
    message: c.representative.message,
    voteCount: c.voteCount,
  }));

  const survivingObservations: Observation[] = observationClusters
    .filter((c) => c.voteCount >= threshold)
    .map((c) => ({ ...c.representative, voteCount: c.voteCount }));

  const allFiles = new Set(results.flatMap((r) => r.filesReviewed));
  const totalTokens = results.reduce((sum, r) => sum + r.tokenCount, 0);

  const totalRawObservations = observationsByPass.reduce((sum, pass) => sum + pass.length, 0);

  const recommendation = deriveRecommendation(survivingFindings, passRecommendations, threshold);
  const recommendationElevated = survivingFindings.length === 0 && recommendation !== "looks_good";

  const agreementRate =
    findingClusters.length > 0 ? survivingClusters.length / findingClusters.length : 1;

  logger.info(
    {
      passes,
      threshold,
      totalClusters: findingClusters.length,
      surviving: survivingFindings.length,
      dropped: droppedFindings.length,
      droppedObservations: totalRawObservations - survivingObservations.length,
      agreementRate,
      passRecommendations,
    },
    "consensus voting complete",
  );

  const summaries = results.map((r) => r.summary).filter(Boolean);
  const summary =
    summaries.length <= 1
      ? (summaries[0] ?? "")
      : `Consensus review (${passes} passes, threshold ${threshold}).\n\n${summaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;

  return {
    summary,
    recommendation,
    findings: survivingFindings,
    observations: survivingObservations,
    ticketCompliance: results[0]?.ticketCompliance ?? [],
    missingTests: results.flatMap((r) => r.missingTests),
    filesReviewed: [...allFiles],
    modelUsed: results[0]?.modelUsed ?? "unknown",
    tokenCount: totalTokens,
    consensusMetadata: {
      passes,
      threshold,
      agreementRate,
      recommendationElevated,
      passRecommendations,
    },
    droppedFindings: droppedFindings.length > 0 ? droppedFindings : undefined,
  };
}
