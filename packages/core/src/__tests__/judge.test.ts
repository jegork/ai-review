import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Finding, ReviewResult } from "../types.js";

const generateMock = vi.fn();

vi.mock("@mastra/core/agent", () => ({
  Agent: vi.fn().mockImplementation(function () {
    return { generate: generateMock };
  }),
}));

vi.mock("../agent/model.js", () => ({
  resolveModelConfig: vi.fn(() => ({ type: "router", model: "test-model" })),
  resolveModel: vi.fn(() => "test-model"),
  getModelDisplayName: vi.fn(() => "test-model"),
}));

const { judgeFindings, judgeReviewResult, resolveJudgeConfig } = await import("../agent/judge.js");

const DIFF = `--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,5 @@\n+import { z } from "zod";\n const app = express();\n+app.get("/health", (req, res) => res.json({ ok: true }));\n`;

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/app.ts",
    line: 1,
    endLine: null,
    severity: "warning",
    category: "bugs",
    message: "potential null dereference",
    suggestedFix: "",
    ...overrides,
  };
}

function makeReviewResult(findings: Finding[]): ReviewResult {
  return {
    summary: "test review",
    recommendation: "address_before_merge",
    findings,
    observations: [],
    ticketCompliance: [],
    missingTests: [],
    filesReviewed: ["src/app.ts"],
    modelUsed: "test-model",
    tokenCount: 100,
  };
}

describe("resolveJudgeConfig", () => {
  beforeEach(() => {
    delete process.env.RUSTY_JUDGE_ENABLED;
    delete process.env.RUSTY_JUDGE_THRESHOLD;
    delete process.env.RUSTY_JUDGE_MODEL;
  });

  it("defaults to disabled with threshold 6", () => {
    const config = resolveJudgeConfig();
    expect(config.enabled).toBe(false);
    expect(config.threshold).toBe(6);
    expect(config.model).toBeUndefined();
  });

  it("parses RUSTY_JUDGE_ENABLED=true", () => {
    process.env.RUSTY_JUDGE_ENABLED = "true";
    expect(resolveJudgeConfig().enabled).toBe(true);
  });

  it("parses RUSTY_JUDGE_ENABLED=1", () => {
    process.env.RUSTY_JUDGE_ENABLED = "1";
    expect(resolveJudgeConfig().enabled).toBe(true);
  });

  it("parses RUSTY_JUDGE_THRESHOLD", () => {
    process.env.RUSTY_JUDGE_THRESHOLD = "8";
    expect(resolveJudgeConfig().threshold).toBe(8);
  });

  it("parses RUSTY_JUDGE_MODEL", () => {
    process.env.RUSTY_JUDGE_MODEL = "anthropic/claude-haiku";
    expect(resolveJudgeConfig().model).toBe("anthropic/claude-haiku");
  });

  it("falls back to default threshold on non-numeric value", () => {
    process.env.RUSTY_JUDGE_THRESHOLD = "abc";
    expect(resolveJudgeConfig().threshold).toBe(6);
  });

  it("treats empty RUSTY_JUDGE_MODEL as undefined", () => {
    process.env.RUSTY_JUDGE_MODEL = "";
    expect(resolveJudgeConfig().model).toBeUndefined();
  });
});

describe("judgeFindings", () => {
  const enabledConfig = { enabled: true, threshold: 6 };
  const disabledConfig = { enabled: false, threshold: 6 };

  beforeEach(() => {
    generateMock.mockReset();
  });

  it("passes through all findings when judge is disabled", async () => {
    const findings = [makeFinding(), makeFinding({ line: 2 })];
    const result = await judgeFindings(findings, DIFF, disabledConfig);

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.evaluations).toHaveLength(0);
    expect(result.tokenCount).toBe(0);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("passes through all findings when list is empty", async () => {
    const result = await judgeFindings([], DIFF, enabledConfig);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("filters findings below threshold", async () => {
    const findings = [
      makeFinding({ message: "real bug" }),
      makeFinding({ line: 3, message: "hallucinated issue" }),
      makeFinding({ line: 5, message: "borderline" }),
    ];

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [
          { index: 0, confidence: 9, reasoning: "clearly a bug" },
          { index: 1, confidence: 2, reasoning: "no evidence in diff" },
          { index: 2, confidence: 6, reasoning: "plausible" },
        ],
      },
      usage: { totalTokens: 350 },
    });

    const result = await judgeFindings(findings, DIFF, enabledConfig);

    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[0].message).toBe("real bug");
    expect(result.accepted[1].message).toBe("borderline");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].message).toBe("hallucinated issue");
    expect(result.tokenCount).toBe(350);
  });

  it("keeps findings at exact threshold", async () => {
    const findings = [makeFinding()];

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [{ index: 0, confidence: 6, reasoning: "just meets threshold" }],
      },
      usage: { totalTokens: 200 },
    });

    const result = await judgeFindings(findings, DIFF, enabledConfig);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects findings just below threshold", async () => {
    const findings = [makeFinding()];

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [{ index: 0, confidence: 5, reasoning: "not confident" }],
      },
      usage: { totalTokens: 200 },
    });

    const result = await judgeFindings(findings, DIFF, enabledConfig);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it("filters all findings when none meet threshold", async () => {
    const findings = [makeFinding({ message: "bad1" }), makeFinding({ line: 2, message: "bad2" })];

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [
          { index: 0, confidence: 1, reasoning: "hallucinated" },
          { index: 1, confidence: 3, reasoning: "speculative" },
        ],
      },
      usage: { totalTokens: 250 },
    });

    const result = await judgeFindings(findings, DIFF, enabledConfig);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
  });

  it("keeps findings when model returns fewer evaluations than findings", async () => {
    const findings = [
      makeFinding({ message: "first" }),
      makeFinding({ line: 2, message: "second" }),
      makeFinding({ line: 3, message: "third" }),
    ];

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [
          { index: 0, confidence: 8, reasoning: "valid" },
          // model only returned 1 evaluation for 3 findings
        ],
      },
      usage: { totalTokens: 150 },
    });

    const result = await judgeFindings(findings, DIFF, enabledConfig);
    // first finding passes, remaining two have no evaluation → kept (safe default)
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);
  });

  it("keeps all findings when judge call throws", async () => {
    const findings = [makeFinding()];

    generateMock.mockRejectedValueOnce(new Error("API rate limit"));

    const result = await judgeFindings(findings, DIFF, enabledConfig);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.evaluations).toHaveLength(0);
    expect(result.tokenCount).toBe(0);
  });

  it("respects custom threshold", async () => {
    const findings = [makeFinding()];

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [{ index: 0, confidence: 7, reasoning: "decent" }],
      },
      usage: { totalTokens: 200 },
    });

    const strictConfig = { enabled: true, threshold: 8 };
    const result = await judgeFindings(findings, DIFF, strictConfig);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it("respects custom model override", async () => {
    const { Agent } = await import("@mastra/core/agent");
    const findings = [makeFinding()];

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [{ index: 0, confidence: 9, reasoning: "valid" }],
      },
      usage: { totalTokens: 200 },
    });

    await judgeFindings(findings, DIFF, {
      enabled: true,
      threshold: 6,
      model: "anthropic/claude-haiku",
    });

    expect(Agent).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-haiku" }),
    );
  });
});

describe("judgeReviewResult", () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it("passes through unchanged when judge is disabled", async () => {
    const review = makeReviewResult([makeFinding()]);
    const result = await judgeReviewResult(review, DIFF, { enabled: false, threshold: 6 });

    expect(result.findings).toHaveLength(1);
    expect(result.filteredCount).toBeUndefined();
    expect(result.judgeTokenCount).toBeUndefined();
  });

  it("updates filteredCount on the result", async () => {
    const findings = [
      makeFinding({ message: "keep", severity: "critical" }),
      makeFinding({ line: 2, message: "drop" }),
    ];
    const review = makeReviewResult(findings);

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [
          { index: 0, confidence: 9, reasoning: "real" },
          { index: 1, confidence: 2, reasoning: "fake" },
        ],
      },
      usage: { totalTokens: 300 },
    });

    const result = await judgeReviewResult(review, DIFF, { enabled: true, threshold: 6 });
    expect(result.findings).toHaveLength(1);
    expect(result.filteredCount).toBe(1);
    expect(result.judgeTokenCount).toBe(300);
  });

  it("recalculates recommendation to looks_good when all findings filtered", async () => {
    const review = makeReviewResult([makeFinding({ severity: "critical" })]);

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [{ index: 0, confidence: 1, reasoning: "hallucinated" }],
      },
      usage: { totalTokens: 200 },
    });

    const result = await judgeReviewResult(review, DIFF, { enabled: true, threshold: 6 });
    expect(result.findings).toHaveLength(0);
    expect(result.recommendation).toBe("looks_good");
  });

  it("downgrades recommendation from critical_issues when critical finding is filtered", async () => {
    const findings = [
      makeFinding({ severity: "critical", message: "false alarm" }),
      makeFinding({ line: 2, severity: "warning", message: "real warning" }),
    ];
    const review = makeReviewResult(findings);

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [
          { index: 0, confidence: 3, reasoning: "no evidence" },
          { index: 1, confidence: 8, reasoning: "confirmed" },
        ],
      },
      usage: { totalTokens: 280 },
    });

    const result = await judgeReviewResult(review, DIFF, { enabled: true, threshold: 6 });
    expect(result.recommendation).toBe("address_before_merge");
    expect(result.filteredCount).toBe(1);
  });

  it("preserves elevated recommendation from consensus when no findings exist", async () => {
    const review: ReviewResult = {
      ...makeReviewResult([]),
      recommendation: "address_before_merge",
      consensusMetadata: {
        passes: 3,
        threshold: 2,
        agreementRate: 1,
        recommendationElevated: true,
        passRecommendations: [
          "address_before_merge",
          "address_before_merge",
          "address_before_merge",
        ],
      },
    };

    const result = await judgeReviewResult(review, DIFF, { enabled: true, threshold: 6 });
    expect(result.findings).toHaveLength(0);
    expect(result.recommendation).toBe("address_before_merge");
  });

  it("does not preserve recommendation when not elevated by consensus", async () => {
    const review: ReviewResult = {
      ...makeReviewResult([makeFinding({ severity: "warning" })]),
      recommendation: "address_before_merge",
      consensusMetadata: {
        passes: 3,
        threshold: 2,
        agreementRate: 1,
        recommendationElevated: false,
        passRecommendations: [
          "address_before_merge",
          "address_before_merge",
          "address_before_merge",
        ],
      },
    };

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [{ index: 0, confidence: 2, reasoning: "false positive" }],
      },
      usage: { totalTokens: 200 },
    });

    const result = await judgeReviewResult(review, DIFF, { enabled: true, threshold: 6 });
    expect(result.findings).toHaveLength(0);
    expect(result.recommendation).toBe("looks_good");
  });

  it("preserves observations, filesReviewed, and other metadata", async () => {
    const review: ReviewResult = {
      ...makeReviewResult([makeFinding()]),
      observations: [
        { file: "b.ts", line: 10, severity: "suggestion", category: "style", message: "naming" },
      ],
      filesReviewed: ["src/app.ts", "src/b.ts"],
      modelUsed: "claude-sonnet",
      tokenCount: 500,
    };

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [{ index: 0, confidence: 9, reasoning: "valid" }],
      },
      usage: { totalTokens: 200 },
    });

    const result = await judgeReviewResult(review, DIFF, { enabled: true, threshold: 6 });
    expect(result.observations).toHaveLength(1);
    expect(result.filesReviewed).toEqual(["src/app.ts", "src/b.ts"]);
    expect(result.modelUsed).toBe("claude-sonnet");
    expect(result.tokenCount).toBe(500);
    expect(result.judgeTokenCount).toBe(200);
    expect(result.summary).toBe("test review");
  });
});
