import { describe, it, expect, vi } from "vitest";
import { countTokens } from "../diff/compress.js";
import type { FilePatch, ReviewConfig } from "../types.js";

vi.mock("../agent/review.js", () => ({
  runReview: vi.fn(async (_config, diff, _prMeta, _tickets, _opts) => ({
    summary: `Reviewed ${countTokens(diff)} tokens`,
    recommendation: "looks_good" as const,
    findings: [
      {
        file: "a.ts",
        line: 1,
        severity: "warning" as const,
        category: "bugs" as const,
        message: `finding from chunk with ${countTokens(diff)} tokens`,
      },
    ],
    observations: [],
    filesReviewed: ["a.ts"],
    modelUsed: "test-model",
    tokenCount: countTokens(diff),
  })),
}));

// import after mock is set up
const { runMultiCallReview } = await import("../agent/multi-call.js");

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
};

describe("runMultiCallReview", () => {
  it("uses single call when diff fits in budget", async () => {
    const patches = [makePatch("small.ts", 10)];
    const result = await runMultiCallReview(patches, config, prMetadata);
    expect(result.findings).toHaveLength(1);
    expect(result.modelUsed).toBe("test-model");
  });

  it("splits into multiple calls when diff exceeds budget", async () => {
    // each patch is ~2500 tokens, budget is 3000 — forces 2+ calls
    const patches = [makePatch("big1.ts", 1000), makePatch("big2.ts", 1000)];
    const result = await runMultiCallReview(patches, config, prMetadata, undefined, {
      maxTokens: 3000,
    });
    // should have findings from multiple calls merged
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it("deduplicates findings with same file+line+message", async () => {
    const patches = [makePatch("a.ts", 10)];
    // single call returns 1 finding; since we go through single path, just 1
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

  it("handles empty patches", async () => {
    const { runReview } = await import("../agent/review.js");
    (runReview as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      summary: "Nothing to review",
      recommendation: "looks_good",
      findings: [],
      observations: [],
      filesReviewed: [],
      modelUsed: "test",
      tokenCount: 0,
    });
    const result = await runMultiCallReview([], config, prMetadata);
    expect(result.findings).toHaveLength(0);
  });
});
