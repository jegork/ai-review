import { describe, it, expect, vi, beforeEach } from "vitest";
import { countTokens } from "../diff/compress.js";
import type { FilePatch, ReviewConfig, ReviewResult, TicketInfo } from "../types.js";

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
      },
    ],
    observations: [],
    ticketCompliance: [],
    filesReviewed: ["a.ts"],
    modelUsed: "test-model",
    tokenCount: countTokens(diff),
  };
}

vi.mock("../agent/review.js", () => ({
  runReview: vi.fn(async (_config, diff, _prMeta, _tickets, _opts) => makeMockReview(diff)),
}));

const { runMultiCallReview } = await import("../agent/multi-call.js");
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

  it("handles empty patches", async () => {
    runReviewMock.mockResolvedValueOnce({
      summary: "Nothing to review",
      recommendation: "looks_good",
      findings: [],
      observations: [],
      ticketCompliance: [],
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
    expect(result.consensusMetadata).toEqual({ passes: 3, threshold: 2 });
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });
});
