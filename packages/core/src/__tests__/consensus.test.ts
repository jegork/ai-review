import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReviewResult, Finding, ReviewConfig, PRMetadata } from "../types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/index.ts",
    line: 10,
    endLine: null,
    severity: "warning",
    category: "bugs",
    message: "potential null reference in handler function",
    suggestedFix: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    summary: "Looks fine",
    recommendation: "looks_good",
    findings: [],
    observations: [],
    ticketCompliance: [],
    filesReviewed: ["src/index.ts"],
    modelUsed: "test-model",
    tokenCount: 100,
    ...overrides,
  };
}

const sharedFinding = makeFinding();
const uniqueFinding = makeFinding({
  file: "src/other.ts",
  line: 99,
  message: "completely different issue in another file about performance",
});

let callCount = 0;
let mockBehavior: "default" | "no-findings-but-flagged" = "default";

vi.mock("../agent/review.js", () => ({
  runReview: vi.fn(async () => {
    const idx = callCount++;

    if (mockBehavior === "no-findings-but-flagged") {
      return makeResult({
        recommendation: "address_before_merge",
        summary: "resource cleanup issue should be fixed before merge",
        findings: [],
      });
    }

    if (idx % 3 === 2) {
      return makeResult({ findings: [uniqueFinding], tokenCount: 100 });
    }
    return makeResult({ findings: [sharedFinding], tokenCount: 100 });
  }),
}));

const { runConsensusReview } = await import("../agent/consensus.js");

const prMetadata: PRMetadata = {
  id: "42",
  title: "test PR",
  description: "",
  author: "dev",
  sourceBranch: "feat/test",
  targetBranch: "main",
  url: "https://example.com/pr/42",
};

const config: ReviewConfig = {
  style: "balanced",
  focusAreas: [],
  ignorePatterns: [],
};

describe("runConsensusReview", () => {
  beforeEach(() => {
    callCount = 0;
    mockBehavior = "default";
    vi.clearAllMocks();
  });

  it("passes through to runReview when consensusPasses=1", async () => {
    const singlePassConfig = { ...config, consensusPasses: 1 };
    const result = await runConsensusReview([], singlePassConfig, prMetadata, "diff content");
    const { runReview } = await import("../agent/review.js");
    expect(runReview).toHaveBeenCalledTimes(1);
    expect(result.consensusMetadata).toBeUndefined();
  });

  it("runs N passes and filters by majority vote", async () => {
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    const { runReview } = await import("../agent/review.js");
    expect(runReview).toHaveBeenCalledTimes(3);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("src/index.ts");
    expect(result.findings[0].voteCount).toBe(2);
  });

  it("drops findings below custom threshold", async () => {
    const strictConfig = { ...config, consensusPasses: 3, consensusThreshold: 3 };
    const result = await runConsensusReview([], strictConfig, prMetadata, "diff content");
    expect(result.findings).toHaveLength(0);
  });

  it("includes consensus metadata with agreement rate and pass recommendations", async () => {
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.consensusMetadata).toMatchObject({
      passes: 3,
      threshold: 2,
      recommendationElevated: false,
    });
    expect(result.consensusMetadata?.agreementRate).toBeGreaterThanOrEqual(0);
    expect(result.consensusMetadata?.agreementRate).toBeLessThanOrEqual(1);
    expect(result.consensusMetadata?.passRecommendations).toHaveLength(3);
  });

  it("derives recommendation from filtered findings only", async () => {
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.recommendation).toBe("address_before_merge");
  });

  it("aggregates token counts from all passes", async () => {
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.tokenCount).toBe(300);
  });

  it("defaults to 3 passes when consensusPasses not set", async () => {
    const result = await runConsensusReview([], config, prMetadata, "diff content");
    const { runReview } = await import("../agent/review.js");
    expect(runReview).toHaveBeenCalledTimes(3);
    expect(result.consensusMetadata?.passes).toBe(3);
  });

  it("populates droppedFindings for clusters below threshold", async () => {
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    // uniqueFinding only appears in 1/3 passes → dropped
    expect(result.droppedFindings).toBeDefined();
    expect(result.droppedFindings).toHaveLength(1);
    expect(result.droppedFindings![0].file).toBe("src/other.ts");
    expect(result.droppedFindings![0].voteCount).toBe(1);
  });

  it("omits droppedFindings when all clusters meet threshold", async () => {
    const { runReview } = await import("../agent/review.js");
    (runReview as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult({ findings: [sharedFinding], tokenCount: 100 }))
      .mockResolvedValueOnce(makeResult({ findings: [sharedFinding], tokenCount: 100 }))
      .mockResolvedValueOnce(makeResult({ findings: [sharedFinding], tokenCount: 100 }));
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.droppedFindings).toBeUndefined();
  });

  it("produces numbered summaries for multi-pass reviews", async () => {
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.summary).toContain("1. ");
    expect(result.summary).toContain("2. ");
    expect(result.summary).toContain("3. ");
    expect(result.summary).toMatch(/^Consensus review \(3 passes, threshold 2\)\./);
  });

  it("sets recommendationElevated when recommendation comes from pass votes not findings", async () => {
    mockBehavior = "no-findings-but-flagged";
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.consensusMetadata?.recommendationElevated).toBe(true);
  });

  it("sets recommendationElevated=false when recommendation is derived from findings", async () => {
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.consensusMetadata?.recommendationElevated).toBe(false);
  });

  it("agreement rate is 1 when all clusters survive", async () => {
    const { runReview } = await import("../agent/review.js");
    (runReview as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult({ findings: [sharedFinding], tokenCount: 100 }))
      .mockResolvedValueOnce(makeResult({ findings: [sharedFinding], tokenCount: 100 }))
      .mockResolvedValueOnce(makeResult({ findings: [sharedFinding], tokenCount: 100 }));
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.consensusMetadata?.agreementRate).toBe(1);
  });

  it("agreement rate is 0 when no clusters survive strict threshold", async () => {
    const strictConfig = { ...config, consensusPasses: 3, consensusThreshold: 3 };
    const result = await runConsensusReview([], strictConfig, prMetadata, "diff content");
    expect(result.consensusMetadata?.agreementRate).toBe(0);
  });

  it("agreement rate is 1 when there are zero finding clusters", async () => {
    const { runReview } = await import("../agent/review.js");
    (runReview as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult({ findings: [], tokenCount: 100 }))
      .mockResolvedValueOnce(makeResult({ findings: [], tokenCount: 100 }))
      .mockResolvedValueOnce(makeResult({ findings: [], tokenCount: 100 }));
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.consensusMetadata?.agreementRate).toBe(1);
  });

  it("uses per-pass recommendations when findings are empty but majority flags issues", async () => {
    mockBehavior = "no-findings-but-flagged";
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.findings).toHaveLength(0);
    // 3/3 passes said "address_before_merge" → recommendation should reflect that
    expect(result.recommendation).toBe("address_before_merge");
  });

  it("keeps looks_good when minority of passes flag issues", async () => {
    const { runReview } = await import("../agent/review.js");
    (runReview as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult({ recommendation: "address_before_merge", findings: [] }))
      .mockResolvedValueOnce(makeResult({ recommendation: "looks_good", findings: [] }))
      .mockResolvedValueOnce(makeResult({ recommendation: "looks_good", findings: [] }));
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    // 1/3 passes flagged → below threshold=2 → looks_good
    expect(result.recommendation).toBe("looks_good");
  });

  it("elevates to critical_issues when majority of passes flag critical", async () => {
    const { runReview } = await import("../agent/review.js");
    (runReview as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult({ recommendation: "critical_issues", findings: [] }))
      .mockResolvedValueOnce(makeResult({ recommendation: "critical_issues", findings: [] }))
      .mockResolvedValueOnce(makeResult({ recommendation: "looks_good", findings: [] }));
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    expect(result.recommendation).toBe("critical_issues");
  });

  it("downgrades to address_before_merge when critical is minority but issues are majority", async () => {
    const { runReview } = await import("../agent/review.js");
    (runReview as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResult({ recommendation: "critical_issues", findings: [] }))
      .mockResolvedValueOnce(makeResult({ recommendation: "address_before_merge", findings: [] }))
      .mockResolvedValueOnce(makeResult({ recommendation: "looks_good", findings: [] }));
    const consensusConfig = { ...config, consensusPasses: 3 };
    const result = await runConsensusReview([], consensusConfig, prMetadata, "diff content");
    // 2/3 flag issues (meets threshold) but only 1/3 flag critical (below threshold)
    expect(result.recommendation).toBe("address_before_merge");
  });
});
