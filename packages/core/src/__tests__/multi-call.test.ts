import { describe, it, expect, vi, beforeEach } from "vitest";
import { countTokens } from "../diff/compress.js";
import type { FilePatch, ReviewConfig, ReviewResult, TicketInfo, Observation } from "../types.js";
import type { OpenGrepFinding } from "../opengrep/types.js";

function makeMockReview(diff: string): ReviewResult {
  return {
    summary: `Reviewed ${countTokens(diff)} tokens`,
    recommendation: "looks_good" as const,
    findings: [
      {
        file: "a.ts",
        line: 1,
        endLine: 1,
        severity: "warning" as const,
        category: "bugs" as const,
        message: `finding from chunk with ${countTokens(diff)} tokens`,
        suggestedFix: null,
      },
    ],
    observations: [],
    ticketCompliance: [],
    missingTests: [],
    filesReviewed: ["a.ts"],
    modelUsed: "test-model",
    tokenCount: countTokens(diff),
  };
}

vi.mock("../agent/review.js", () => ({
  runReview: vi.fn(async (_config, diff, _prMeta, _tickets, _opts) => makeMockReview(diff)),
}));

const { runMultiCallReview, runCascadeReview, filterObservationsForPrFiles, mergeResults } =
  await import("../agent/multi-call.js");
const { runReview } = await import("../agent/review.js");
const runReviewMock = vi.mocked(runReview);

function makePatch(path: string, contentSize: number): FilePatch {
  const lines = Array.from({ length: contentSize }, (_, i) => `+line ${i}`).join("\n");
  return {
    path,
    additions: contentSize,
    deletions: 0,
    isBinary: false,
    hunks: [
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: contentSize,
        content: lines,
      },
    ],
  };
}

const prMetadata = {
  id: "1",
  title: "test PR",
  description: "",
  author: "dev",
  sourceBranch: "feat",
  targetBranch: "main",
  url: "https://example.com/pr/1",
};

const config: ReviewConfig = {
  style: "balanced",
  focusAreas: [],
  ignorePatterns: [],
  consensusPasses: 1,
};

const tickets: TicketInfo[] = [
  {
    id: "AUTH-42",
    title: "Implement auth",
    description: "Add JWT auth",
    acceptanceCriteria: "- Login returns JWT\n- Protected routes validate JWT",
    labels: [],
    source: "jira",
  },
];

describe("runMultiCallReview", () => {
  beforeEach(() => {
    runReviewMock.mockReset();
    runReviewMock.mockImplementation(async (_config, diff) => makeMockReview(diff));
  });

  it("uses single call when diff fits in budget", async () => {
    const patches = [makePatch("small.ts", 10)];
    const result = await runMultiCallReview(patches, config, prMetadata);
    expect(result.findings).toHaveLength(1);
    expect(result.modelUsed).toBe("test-model");
  });

  it("splits into multiple calls when diff exceeds budget", async () => {
    const patches = [makePatch("big1.ts", 1000), makePatch("big2.ts", 1000)];
    const result = await runMultiCallReview(patches, config, prMetadata, undefined, {
      maxTokens: 3000,
    });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it("deduplicates findings with same file+line+message", async () => {
    const patches = [makePatch("a.ts", 10)];
    const result = await runMultiCallReview(patches, config, prMetadata);
    expect(result.findings).toHaveLength(1);
  });

  it("merges summaries from multiple passes", async () => {
    const patches = [
      makePatch("big1.ts", 1000),
      makePatch("big2.ts", 1000),
      makePatch("big3.ts", 1000),
    ];
    const result = await runMultiCallReview(patches, config, prMetadata, undefined, {
      maxTokens: 3000,
    });
    expect(result.summary).toContain("passes");
  });

  it("merges ticket compliance and keeps the strongest status", async () => {
    runReviewMock
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-1"),
        summary: "First chunk",
        ticketCompliance: [
          {
            ticketId: "AUTH-42",
            requirement: "Protected routes validate JWT",
            status: "unclear",
            evidence: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-2"),
        summary: "Second chunk",
        ticketCompliance: [
          {
            ticketId: "AUTH-42",
            requirement: "Protected routes validate JWT",
            status: "addressed",
            evidence: "auth-middleware.ts verifies JWT on protected endpoints",
          },
        ],
      });

    const patches = [makePatch("big1.ts", 1000), makePatch("big2.ts", 1000)];
    const result = await runMultiCallReview(patches, config, prMetadata, tickets, {
      maxTokens: 3000,
    });

    expect(result.ticketCompliance).toEqual([
      {
        ticketId: "AUTH-42",
        requirement: "Protected routes validate JWT",
        status: "addressed",
        evidence: "auth-middleware.ts verifies JWT on protected endpoints",
      },
    ]);
  });

  it("merges evidence when duplicate compliance items have the same priority", async () => {
    runReviewMock
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-1"),
        ticketCompliance: [
          {
            ticketId: "AUTH-42",
            requirement: "Protected routes validate JWT",
            status: "partially_addressed",
            evidence: "middleware.ts validates most protected routes",
          },
        ],
      })
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-2"),
        ticketCompliance: [
          {
            ticketId: "auth-42",
            requirement: "protected routes validate jwt",
            status: "partially_addressed",
            evidence: "admin.ts still has one bypass path",
          },
        ],
      });

    const patches = [makePatch("big1.ts", 1000), makePatch("big2.ts", 1000)];
    const result = await runMultiCallReview(patches, config, prMetadata, tickets, {
      maxTokens: 3000,
    });

    expect(result.ticketCompliance).toEqual([
      {
        ticketId: "AUTH-42",
        requirement: "Protected routes validate JWT",
        status: "partially_addressed",
        evidence:
          "middleware.ts validates most protected routes | admin.ts still has one bypass path",
      },
    ]);
  });

  it("preserves previously accumulated evidence when a later chunk upgrades the status", async () => {
    runReviewMock
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-1"),
        ticketCompliance: [
          {
            ticketId: "AUTH-42",
            requirement: "Protected routes validate JWT",
            status: "unclear",
            evidence: "middleware.ts is added",
          },
        ],
      })
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-2"),
        ticketCompliance: [
          {
            ticketId: "AUTH-42",
            requirement: "Protected routes validate JWT",
            status: "unclear",
            evidence: "route-guard.ts is wired into most routes",
          },
        ],
      })
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-3"),
        ticketCompliance: [
          {
            ticketId: "AUTH-42",
            requirement: "Protected routes validate JWT",
            status: "addressed",
            evidence: "admin-routes.ts now uses the shared auth guard",
          },
        ],
      });

    const patches = [
      makePatch("big1.ts", 1000),
      makePatch("big2.ts", 1000),
      makePatch("big3.ts", 1000),
    ];
    const result = await runMultiCallReview(patches, config, prMetadata, tickets, {
      maxTokens: 3000,
    });

    expect(result.ticketCompliance).toEqual([
      {
        ticketId: "AUTH-42",
        requirement: "Protected routes validate JWT",
        status: "addressed",
        evidence:
          "middleware.ts is added | route-guard.ts is wired into most routes | admin-routes.ts now uses the shared auth guard",
      },
    ]);
  });

  it("merges and deduplicates missing tests across chunks", async () => {
    runReviewMock
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-1"),
        missingTests: [
          { file: "src/auth.ts", description: "edge case: empty token string" },
          { file: "src/db.ts", description: "error path: connection refused" },
        ],
      })
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-2"),
        missingTests: [
          { file: "src/auth.ts", description: "edge case: empty token string" },
          { file: "src/auth.ts", description: "boundary: token with 0 expiry" },
        ],
      });

    const patches = [makePatch("big1.ts", 1000), makePatch("big2.ts", 1000)];
    const result = await runMultiCallReview(patches, config, prMetadata, undefined, {
      maxTokens: 3000,
    });

    expect(result.missingTests).toHaveLength(3);
    expect(result.missingTests).toEqual([
      { file: "src/auth.ts", description: "edge case: empty token string" },
      { file: "src/db.ts", description: "error path: connection refused" },
      { file: "src/auth.ts", description: "boundary: token with 0 expiry" },
    ]);
  });

  it("deduplicates missing tests case-insensitively", async () => {
    runReviewMock
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-1"),
        missingTests: [{ file: "src/Auth.ts", description: "Edge case: empty token" }],
      })
      .mockResolvedValueOnce({
        ...makeMockReview("chunk-2"),
        missingTests: [{ file: "src/auth.ts", description: "edge case: empty token" }],
      });

    const patches = [makePatch("big1.ts", 1000), makePatch("big2.ts", 1000)];
    const result = await runMultiCallReview(patches, config, prMetadata, undefined, {
      maxTokens: 3000,
    });

    expect(result.missingTests).toHaveLength(1);
  });

  it("returns empty missing tests when no chunks produce them", async () => {
    const patches = [makePatch("small.ts", 10)];
    const result = await runMultiCallReview(patches, config, prMetadata);
    expect(result.missingTests).toEqual([]);
  });

  it("handles empty patches", async () => {
    runReviewMock.mockResolvedValueOnce({
      summary: "Nothing to review",
      recommendation: "looks_good",
      findings: [],
      observations: [],
      ticketCompliance: [],
      missingTests: [],
      filesReviewed: [],
      modelUsed: "test",
      tokenCount: 0,
    });
    const result = await runMultiCallReview([], config, prMetadata);
    expect(result.findings).toHaveLength(0);
  });

  it("routes through consensus when consensusPasses > 1", async () => {
    const consensusConfig: ReviewConfig = { ...config, consensusPasses: 3 };
    const patches = [makePatch("small.ts", 10)];
    const result = await runMultiCallReview(patches, consensusConfig, prMetadata);
    expect(result.consensusMetadata).toMatchObject({ passes: 3, threshold: 2 });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  it("passes otherPrFiles to each chunk in multi-call review", async () => {
    const patches = [makePatch("big1.ts", 1000), makePatch("big2.ts", 1000)];
    await runMultiCallReview(patches, config, prMetadata, undefined, {
      maxTokens: 3000,
    });

    expect(runReviewMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of runReviewMock.mock.calls) {
      const opts = call[4];
      expect(opts?.otherPrFiles).toBeDefined();
      expect(opts!.otherPrFiles!.length).toBeGreaterThan(0);
    }

    // first chunk sees big1.ts, so otherPrFiles should contain big2.ts
    const firstCallOpts = runReviewMock.mock.calls[0][4];
    const secondCallOpts = runReviewMock.mock.calls[1][4];
    expect(firstCallOpts?.otherPrFiles).toContain("big2.ts");
    expect(secondCallOpts?.otherPrFiles).toContain("big1.ts");
  });

  it("does not pass otherPrFiles in single-call mode", async () => {
    const patches = [makePatch("small.ts", 10)];
    await runMultiCallReview(patches, config, prMetadata);

    expect(runReviewMock).toHaveBeenCalledTimes(1);
    const opts = runReviewMock.mock.calls[0][4];
    expect(opts?.otherPrFiles).toBeUndefined();
  });

  it("filters observations that target files changed in the PR", async () => {
    runReviewMock.mockResolvedValueOnce({
      ...makeMockReview("chunk"),
      observations: [
        {
          file: "big1.ts",
          line: 10,
          severity: "warning" as const,
          category: "bugs" as const,
          message: "stale reference found via searchCode",
        },
        {
          file: "unrelated-lib.ts",
          line: 5,
          severity: "suggestion" as const,
          category: "style" as const,
          message: "genuine observation about unchanged code",
        },
      ],
    });

    const patches = [makePatch("big1.ts", 10)];
    const result = await runMultiCallReview(patches, config, prMetadata);

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].file).toBe("unrelated-lib.ts");
  });
});

describe("filterObservationsForPrFiles", () => {
  function makeObservation(file: string): Observation {
    return {
      file,
      line: 1,
      severity: "warning",
      category: "bugs",
      message: `observation in ${file}`,
    };
  }

  it("removes observations whose file is in the PR", () => {
    const observations = [makeObservation("src/a.ts"), makeObservation("src/b.ts")];
    const prFiles = new Set(["src/a.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toEqual([makeObservation("src/b.ts")]);
  });

  it("keeps all observations when none match PR files", () => {
    const observations = [makeObservation("lib/x.ts"), makeObservation("lib/y.ts")];
    const prFiles = new Set(["src/a.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toHaveLength(2);
  });

  it("removes all observations when all match PR files", () => {
    const observations = [makeObservation("src/a.ts"), makeObservation("src/b.ts")];
    const prFiles = new Set(["src/a.ts", "src/b.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toHaveLength(0);
  });

  it("returns empty array for empty observations", () => {
    const filtered = filterObservationsForPrFiles([], new Set(["src/a.ts"]));
    expect(filtered).toHaveLength(0);
  });

  it("requires exact path match (no partial matching)", () => {
    const observations = [makeObservation("src/auth.ts")];
    const prFiles = new Set(["src/auth.test.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toHaveLength(1);
  });

  it("matches observation with leading ./ against PR file without it", () => {
    const observations = [makeObservation("./src/a.ts")];
    const prFiles = new Set(["src/a.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toHaveLength(0);
  });

  it("matches observation with trailing line number against PR file", () => {
    const observations = [makeObservation("src/a.ts:42")];
    const prFiles = new Set(["src/a.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toHaveLength(0);
  });

  it("matches observation with trailing line:col against PR file", () => {
    const observations = [makeObservation("src/a.ts:42:10")];
    const prFiles = new Set(["src/a.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toHaveLength(0);
  });

  it("matches observation with backslash separators against PR file", () => {
    const observations = [makeObservation("src\\utils\\a.ts")];
    const prFiles = new Set(["src/utils/a.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toHaveLength(0);
  });

  it("handles mixed normalization between observation and PR files", () => {
    const observations = [makeObservation("./src\\config.ts:15")];
    const prFiles = new Set(["src/config.ts"]);
    const filtered = filterObservationsForPrFiles(observations, prFiles);
    expect(filtered).toHaveLength(0);
  });
});

describe("mergeResults", () => {
  it("preserves elevated recommendation from consensus pass when merging with skim results", () => {
    const skimResult: ReviewResult = {
      summary: "Skim pass looks fine",
      recommendation: "looks_good",
      findings: [],
      observations: [],
      ticketCompliance: [],
      missingTests: [],
      filesReviewed: ["a.ts"],
      modelUsed: "test-model",
      tokenCount: 100,
    };

    const deepResult: ReviewResult = {
      summary: "Deep pass found an issue described in prose",
      recommendation: "address_before_merge",
      findings: [],
      observations: [],
      ticketCompliance: [],
      missingTests: [],
      filesReviewed: ["b.ts"],
      modelUsed: "test-model",
      tokenCount: 500,
      consensusMetadata: {
        passes: 3,
        threshold: 2,
        agreementRate: 0,
        recommendationElevated: true,
        passRecommendations: [
          "address_before_merge",
          "address_before_merge",
          "address_before_merge",
        ],
        failedPasses: 0,
      },
    };

    const merged = mergeResults([skimResult, deepResult], "test-model");
    expect(merged.recommendation).toBe("address_before_merge");
    expect(merged.consensusMetadata?.recommendationElevated).toBe(true);
  });

  it("does not elevate when no consensus pass has recommendationElevated", () => {
    const result1: ReviewResult = {
      summary: "Pass 1",
      recommendation: "looks_good",
      findings: [],
      observations: [],
      ticketCompliance: [],
      missingTests: [],
      filesReviewed: ["a.ts"],
      modelUsed: "test-model",
      tokenCount: 100,
    };

    const result2: ReviewResult = {
      summary: "Pass 2",
      recommendation: "looks_good",
      findings: [],
      observations: [],
      ticketCompliance: [],
      missingTests: [],
      filesReviewed: ["b.ts"],
      modelUsed: "test-model",
      tokenCount: 100,
    };

    const merged = mergeResults([result1, result2], "test-model");
    expect(merged.recommendation).toBe("looks_good");
  });
});

describe("runCascadeReview", () => {
  beforeEach(() => {
    runReviewMock.mockReset();
    runReviewMock.mockImplementation(async (_config, diff) => makeMockReview(diff));
  });

  it("passes skim file paths as otherPrFiles to the deep-review tier", async () => {
    const skimPatches = [makePatch("tests/test_auth.py", 20)];
    const deepPatches = [makePatch("src/auth.ts", 20)];

    await runCascadeReview(skimPatches, deepPatches, config, prMetadata, undefined);

    // find the deep-review call (tier !== "skim")
    const deepCalls = runReviewMock.mock.calls.filter((call) => call[4]?.tier !== "skim");
    expect(deepCalls.length).toBeGreaterThanOrEqual(1);

    const deepOpts = deepCalls[0][4];
    expect(deepOpts?.otherPrFiles).toContain("tests/test_auth.py");
  });

  it("does not inject skim paths when there are no skim files", async () => {
    const deepPatches = [makePatch("src/auth.ts", 20)];

    await runCascadeReview([], deepPatches, config, prMetadata, undefined);

    const deepCalls = runReviewMock.mock.calls.filter((call) => call[4]?.tier !== "skim");
    expect(deepCalls.length).toBeGreaterThanOrEqual(1);

    const deepOpts = deepCalls[0][4];
    expect(deepOpts?.otherPrFiles).toBeUndefined();
  });

  function makeFinding(file: string): OpenGrepFinding {
    return {
      ruleId: "python.sqlalchemy.security.text-sql-injection",
      file,
      startLine: 10,
      endLine: 10,
      message: "Potential SQL injection",
      severity: "error",
    };
  }

  it("does not leak skim-file opengrep findings into the deep-review tier (single-group)", async () => {
    const skimPatches = [makePatch("tests/test_auth.py", 20)];
    const deepPatches = [makePatch("src/datasource_service.py", 20)];
    const findings = [makeFinding("tests/test_auth.py")];

    await runCascadeReview(skimPatches, deepPatches, config, prMetadata, undefined, {
      openGrepFindings: findings,
    });

    const skimCalls = runReviewMock.mock.calls.filter((call) => call[4]?.tier === "skim");
    const deepCalls = runReviewMock.mock.calls.filter((call) => call[4]?.tier !== "skim");
    expect(skimCalls.length).toBeGreaterThanOrEqual(1);
    expect(deepCalls.length).toBeGreaterThanOrEqual(1);

    expect(skimCalls[0][4]?.openGrepFindings).toHaveLength(1);
    expect(skimCalls[0][4]?.openGrepFindings?.[0].file).toBe("tests/test_auth.py");
    expect(deepCalls[0][4]?.openGrepFindings).toBeUndefined();
  });

  it("does not leak deep-file opengrep findings into the skim tier (single-group)", async () => {
    const skimPatches = [makePatch("tests/test_auth.py", 20)];
    const deepPatches = [makePatch("src/datasource_service.py", 20)];
    const findings = [makeFinding("src/datasource_service.py")];

    await runCascadeReview(skimPatches, deepPatches, config, prMetadata, undefined, {
      openGrepFindings: findings,
    });

    const skimCalls = runReviewMock.mock.calls.filter((call) => call[4]?.tier === "skim");
    const deepCalls = runReviewMock.mock.calls.filter((call) => call[4]?.tier !== "skim");

    expect(skimCalls[0][4]?.openGrepFindings).toBeUndefined();
    expect(deepCalls[0][4]?.openGrepFindings).toHaveLength(1);
    expect(deepCalls[0][4]?.openGrepFindings?.[0].file).toBe("src/datasource_service.py");
  });

  it("routes opengrep findings to both tiers when each has a matching file", async () => {
    const skimPatches = [makePatch("tests/test_auth.py", 20)];
    const deepPatches = [makePatch("src/datasource_service.py", 20)];
    const findings = [makeFinding("tests/test_auth.py"), makeFinding("src/datasource_service.py")];

    await runCascadeReview(skimPatches, deepPatches, config, prMetadata, undefined, {
      openGrepFindings: findings,
    });

    const skimCalls = runReviewMock.mock.calls.filter((call) => call[4]?.tier === "skim");
    const deepCalls = runReviewMock.mock.calls.filter((call) => call[4]?.tier !== "skim");

    expect(skimCalls[0][4]?.openGrepFindings).toHaveLength(1);
    expect(skimCalls[0][4]?.openGrepFindings?.[0].file).toBe("tests/test_auth.py");
    expect(deepCalls[0][4]?.openGrepFindings).toHaveLength(1);
    expect(deepCalls[0][4]?.openGrepFindings?.[0].file).toBe("src/datasource_service.py");
  });

  it("drops findings whose file is in neither tier", async () => {
    const skimPatches = [makePatch("tests/test_auth.py", 20)];
    const deepPatches = [makePatch("src/auth.py", 20)];
    const findings = [makeFinding("src/not-in-pr.py")];

    await runCascadeReview(skimPatches, deepPatches, config, prMetadata, undefined, {
      openGrepFindings: findings,
    });

    for (const call of runReviewMock.mock.calls) {
      expect(call[4]?.openGrepFindings).toBeUndefined();
    }
  });
});
