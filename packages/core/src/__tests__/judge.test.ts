import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Finding, ReviewResult } from "../types.js";

const generateMock = vi.fn();

vi.mock("@mastra/core/agent", () => ({
  Agent: vi.fn().mockImplementation(function () {
    return { generate: generateMock };
  }),
}));

const resolveJsonPromptInjectionMock = vi.fn(() => false);

const supportsAnthropicCacheControlMock = vi.fn(() => false);

vi.mock("../agent/model.js", () => ({
  resolveModelConfig: vi.fn(() => ({ type: "router", model: "test-model" })),
  resolveModelConfigWithOverride: vi.fn((model: string) => ({ type: "router", model })),
  resolveModel: vi.fn((config: { type: string; model?: string }) =>
    config.type === "router" ? (config.model ?? "test-model") : "test-model",
  ),
  getModelDisplayName: vi.fn((config: { type: string; model?: string }) =>
    config.type === "router" ? (config.model ?? "test-model") : "test-model",
  ),
  resolveModelSettings: vi.fn(() => ({})),
  resolveDefaultAgentOptions: vi.fn(() => undefined),
  resolveJsonPromptInjection: resolveJsonPromptInjectionMock,
  supportsAnthropicCacheControl: supportsAnthropicCacheControlMock,
  applyModelConstraints: vi.fn((_config, settings) => settings),
}));

const { judgeFindings, judgeReviewResult, resolveJudgeConfig, buildJudgeUserMessage } =
  await import("../agent/judge.js");

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

  it("uses an adversarial judge prompt", async () => {
    const { Agent } = await import("@mastra/core/agent");
    const findings = [makeFinding()];

    generateMock.mockResolvedValueOnce({
      object: {
        evaluations: [{ index: 0, confidence: 9, reasoning: "valid" }],
      },
      usage: { totalTokens: 200 },
    });

    await judgeFindings(findings, DIFF, enabledConfig);

    const agentConfig = vi.mocked(Agent).mock.calls.at(-1)?.[0];
    const instructions = agentConfig?.instructions as
      | (() => string | { role: "system"; content: string }[])
      | undefined;
    const result = instructions?.();
    const prompt = typeof result === "string" ? result : (result?.[0]?.content ?? "");
    expect(prompt).toContain("Default to rejection");
    expect(prompt).toContain("missing-test complaints");
    expect(prompt).toContain("severity-inflated findings");
    expect(prompt).toContain("suggested fixes that contain prose");
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

    const agentConfig = vi.mocked(Agent).mock.calls.at(-1)?.[0];
    expect(agentConfig?.model).toEqual(expect.any(Function));
    const resolveAgentModel = agentConfig?.model as (() => unknown) | undefined;
    expect(resolveAgentModel?.()).toBe("anthropic/claude-haiku");
  });

  it("routes override model through provider resolution (azure-openai prefix)", async () => {
    const modelModule = await import("../agent/model.js");
    const resolveWithOverrideSpy = vi.mocked(modelModule.resolveModelConfigWithOverride);
    resolveWithOverrideSpy.mockClear();

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
      model: "azure-openai/gpt-5.4-mini",
    });

    // override must flow through the provider resolution helper, otherwise
    // azure-openai/ strings get handed to the mastra router and fail with
    // "Could not find config for provider azure-openai"
    expect(resolveWithOverrideSpy).toHaveBeenCalledWith("azure-openai/gpt-5.4-mini");
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
        failedPasses: 0,
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
        failedPasses: 0,
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

  it("passes droppedFindings through unchanged when judge runs", async () => {
    const review: ReviewResult = {
      ...makeReviewResult([makeFinding()]),
      droppedFindings: [
        { file: "x.ts", line: 1, severity: "warning", message: "dropped 1", voteCount: 1 },
        { file: "y.ts", line: 2, severity: "critical", message: "dropped 2", voteCount: 1 },
      ],
    };

    generateMock.mockResolvedValueOnce({
      object: { evaluations: [{ index: 0, confidence: 9, reasoning: "valid" }] },
      usage: { totalTokens: 50 },
    });

    const result = await judgeReviewResult(review, DIFF, { enabled: true, threshold: 6 });
    expect(result.droppedFindings).toEqual(review.droppedFindings);
  });
});

describe("judgeFindings jsonPromptInjection forwarding", () => {
  beforeEach(() => {
    generateMock.mockReset();
    resolveJsonPromptInjectionMock.mockReset();
  });

  it("forwards jsonPromptInjection=true into structuredOutput when resolver returns true", async () => {
    resolveJsonPromptInjectionMock.mockReturnValueOnce(true);
    generateMock.mockResolvedValueOnce({
      object: { evaluations: [{ index: 0, confidence: 9, reasoning: "ok" }] },
      usage: { totalTokens: 25 },
    });

    await judgeFindings([makeFinding()], DIFF, { enabled: true, threshold: 6 });

    const callArgs = generateMock.mock.calls[0][1];
    expect(callArgs.structuredOutput.jsonPromptInjection).toBe(true);
  });

  it("forwards jsonPromptInjection=false into structuredOutput when resolver returns false", async () => {
    resolveJsonPromptInjectionMock.mockReturnValueOnce(false);
    generateMock.mockResolvedValueOnce({
      object: { evaluations: [{ index: 0, confidence: 9, reasoning: "ok" }] },
      usage: { totalTokens: 25 },
    });

    await judgeFindings([makeFinding()], DIFF, { enabled: true, threshold: 6 });

    const callArgs = generateMock.mock.calls[0][1];
    expect(callArgs.structuredOutput.jsonPromptInjection).toBe(false);
  });
});

describe("buildJudgeUserMessage", () => {
  it("returns a plain string when anthropicCacheControl is false", () => {
    const result = buildJudgeUserMessage([makeFinding()], DIFF, { anthropicCacheControl: false });
    expect(typeof result).toBe("string");
    expect(result).toContain("## Diff under review");
    expect(result).toContain("## Findings to evaluate");
    expect(result).toContain(DIFF);
  });

  it("returns a multi-part user message when anthropicCacheControl is true", () => {
    const result = buildJudgeUserMessage([makeFinding()], DIFF, { anthropicCacheControl: true });
    expect(typeof result).toBe("object");
    if (typeof result === "string") return;
    expect(result.role).toBe("user");
    expect(result.content).toHaveLength(2);
  });

  it("places cacheControl on the diff block, not the findings block", () => {
    const result = buildJudgeUserMessage([makeFinding()], DIFF, { anthropicCacheControl: true });
    if (typeof result === "string") throw new Error("expected multi-part");
    const [diffPart, findingsPart] = result.content;
    expect(diffPart.text).toContain("## Diff under review");
    expect(diffPart.text).toContain(DIFF);
    expect(diffPart.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    expect(findingsPart.text).toContain("## Findings to evaluate");
    expect(findingsPart.providerOptions).toBeUndefined();
  });

  it("includes the same finding metadata in both modes (cached and non-cached)", () => {
    const finding = makeFinding({ message: "specific issue text", line: 42 });
    const stringForm = buildJudgeUserMessage([finding], DIFF, { anthropicCacheControl: false });
    const partsForm = buildJudgeUserMessage([finding], DIFF, { anthropicCacheControl: true });
    if (typeof partsForm === "string") throw new Error("expected multi-part");

    const partsCombined = partsForm.content.map((p) => p.text).join("\n");
    expect(stringForm).toContain("specific issue text");
    expect(partsCombined).toContain("specific issue text");
    expect(stringForm).toContain("**Line:** 42");
    expect(partsCombined).toContain("**Line:** 42");
  });
});

describe("judgeFindings cache wiring", () => {
  beforeEach(() => {
    generateMock.mockReset();
    supportsAnthropicCacheControlMock.mockReset();
  });

  it("passes a multi-part user message to agent.generate when supportsAnthropicCacheControl is true", async () => {
    supportsAnthropicCacheControlMock.mockReturnValue(true);
    generateMock.mockResolvedValueOnce({
      object: { evaluations: [{ index: 0, confidence: 9, reasoning: "ok" }] },
      usage: { totalTokens: 25 },
    });

    await judgeFindings([makeFinding()], DIFF, { enabled: true, threshold: 6 });

    const messages = generateMock.mock.calls[0][0] as {
      role: string;
      content: { providerOptions?: unknown }[];
    }[];
    expect(Array.isArray(messages)).toBe(true);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("passes a plain string user message when supportsAnthropicCacheControl is false", async () => {
    supportsAnthropicCacheControlMock.mockReturnValue(false);
    generateMock.mockResolvedValueOnce({
      object: { evaluations: [{ index: 0, confidence: 9, reasoning: "ok" }] },
      usage: { totalTokens: 25 },
    });

    await judgeFindings([makeFinding()], DIFF, { enabled: true, threshold: 6 });

    const userMessage = generateMock.mock.calls[0][0];
    expect(typeof userMessage).toBe("string");
  });

  it("wraps system prompt with anthropic cacheControl when supported", async () => {
    supportsAnthropicCacheControlMock.mockReturnValue(true);
    generateMock.mockResolvedValueOnce({
      object: { evaluations: [{ index: 0, confidence: 9, reasoning: "ok" }] },
      usage: { totalTokens: 25 },
    });

    await judgeFindings([makeFinding()], DIFF, { enabled: true, threshold: 6 });

    const { Agent } = await import("@mastra/core/agent");
    const agentConfig = vi.mocked(Agent).mock.calls.at(-1)?.[0];
    const instructions = agentConfig?.instructions as
      | (() => string | { role: "system"; content: string; providerOptions?: unknown }[])
      | undefined;
    const result = instructions?.();
    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    expect(result[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("returns a plain system prompt when anthropic cacheControl is not supported", async () => {
    supportsAnthropicCacheControlMock.mockReturnValue(false);
    generateMock.mockResolvedValueOnce({
      object: { evaluations: [{ index: 0, confidence: 9, reasoning: "ok" }] },
      usage: { totalTokens: 25 },
    });

    await judgeFindings([makeFinding()], DIFF, { enabled: true, threshold: 6 });

    const { Agent } = await import("@mastra/core/agent");
    const agentConfig = vi.mocked(Agent).mock.calls.at(-1)?.[0];
    const instructions = agentConfig?.instructions as
      | (() => string | { role: "system"; content: string; providerOptions?: unknown }[])
      | undefined;
    const result = instructions?.();
    if (Array.isArray(result)) {
      expect(result[0].providerOptions).toBeUndefined();
    }
  });
});
