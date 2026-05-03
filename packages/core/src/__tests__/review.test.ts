import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReviewConfig, PRMetadata } from "../types.js";

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
  resolveModelSettings: vi.fn(() => ({})),
  resolveDefaultAgentOptions: vi.fn(() => undefined),
  supportsAnthropicCacheControl: vi.fn(() => false),
  applyModelConstraints: vi.fn((_config, settings) => settings),
}));

const { runReview } = await import("../agent/review.js");

class FakeMastraError extends Error {
  id: string;
  domain: string;
  category: string;
  constructor(id: string, message: string) {
    super(message);
    this.id = id;
    this.domain = "AGENT";
    this.category = "SYSTEM";
    this.name = "MastraError";
  }
}

const prMetadata: PRMetadata = {
  id: "1",
  title: "test",
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

function makeValidResponse() {
  return {
    object: {
      summary: "looks fine",
      recommendation: "looks_good",
      findings: [],
      observations: [],
      ticketCompliance: [],
      missingTests: [],
      filesReviewed: ["a.ts"],
    },
    usage: { totalTokens: 100 },
  };
}

describe("runReview retry on STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED", () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it("retries once when first attempt throws STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED", async () => {
    generateMock
      .mockRejectedValueOnce(
        new FakeMastraError(
          "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED",
          "Structured output validation failed: root: Invalid input: expected object, received undefined",
        ),
      )
      .mockResolvedValueOnce(makeValidResponse());

    const result = await runReview(config, "diff", prMetadata);

    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(result.recommendation).toBe("looks_good");
  });

  it("does not retry on errors that are not structured output validation failures", async () => {
    generateMock.mockRejectedValueOnce(new Error("API rate limit"));

    await expect(runReview(config, "diff", prMetadata)).rejects.toThrow("API rate limit");
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry on a MastraError with a different id", async () => {
    generateMock.mockRejectedValueOnce(new FakeMastraError("AGENT_STREAM_ERROR", "stream died"));

    await expect(runReview(config, "diff", prMetadata)).rejects.toThrow("stream died");
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("throws when both the initial attempt and the retry fail the same way", async () => {
    generateMock.mockRejectedValue(
      new FakeMastraError(
        "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED",
        "Structured output validation failed again",
      ),
    );

    await expect(runReview(config, "diff", prMetadata)).rejects.toThrow(
      "Structured output validation failed again",
    );
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it("retries at most once (caps at 2 attempts, not more)", async () => {
    generateMock.mockRejectedValue(
      new FakeMastraError("STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED", "failure"),
    );

    await expect(runReview(config, "diff", prMetadata)).rejects.toThrow();
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the first attempt without retrying when the model returns a valid object", async () => {
    generateMock.mockResolvedValueOnce(makeValidResponse());

    const result = await runReview(config, "diff", prMetadata);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.recommendation).toBe("looks_good");
  });

  it("propagates the original error unchanged when the retry also fails with a different error", async () => {
    generateMock
      .mockRejectedValueOnce(
        new FakeMastraError(
          "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED",
          "first-attempt-validation-failure",
        ),
      )
      .mockRejectedValueOnce(new Error("provider timeout"));

    await expect(runReview(config, "diff", prMetadata)).rejects.toThrow("provider timeout");
    expect(generateMock).toHaveBeenCalledTimes(2);
  });
});

describe("runReview ranked context", () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it("includes ranked context for deep-review calls", async () => {
    generateMock.mockResolvedValueOnce(makeValidResponse());

    await runReview(config, "diff", prMetadata, undefined, {
      tier: "deep-review",
      rankedContext: "## Graph-ranked Context\n### src/helper.ts",
    });

    expect(generateMock.mock.calls[0][0]).toContain("## Graph-ranked Context");
  });

  it("omits ranked context for skim calls", async () => {
    generateMock.mockResolvedValueOnce({
      object: {
        summary: "looks fine",
        recommendation: "looks_good",
        findings: [],
        observations: [],
        filesReviewed: ["a.ts"],
      },
      usage: { totalTokens: 100 },
    });

    await runReview(config, "diff", prMetadata, undefined, {
      tier: "skim",
      rankedContext: "## Graph-ranked Context\n### src/helper.ts",
    });

    expect(generateMock.mock.calls[0][0]).not.toContain("## Graph-ranked Context");
  });
});

class FakeApiCallError extends Error {
  isRetryable: boolean;
  constructor(message: string, isRetryable: boolean) {
    super(message);
    this.name = "AI_APICallError";
    this.isRetryable = isRetryable;
  }
}

describe("runReview retry on transient LLM errors", () => {
  beforeEach(() => {
    generateMock.mockReset();
    delete process.env.RUSTY_LLM_MAX_RETRIES;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle<T>(promise: Promise<T>): Promise<T> {
    // attach a noop rejection handler so vitest doesn't flag this as
    // an unhandled rejection while the test suite is awaiting timers
    promise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    return promise;
  }

  it("retries when the call throws an isRetryable=true error", async () => {
    generateMock
      .mockRejectedValueOnce(new FakeApiCallError("Headers Timeout Error", true))
      .mockResolvedValueOnce(makeValidResponse());

    const result = await settle(runReview(config, "diff", prMetadata));

    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(result.recommendation).toBe("looks_good");
  });

  it("does not retry an error with isRetryable=false", async () => {
    generateMock.mockRejectedValueOnce(new FakeApiCallError("auth failed", false));

    await expect(settle(runReview(config, "diff", prMetadata))).rejects.toThrow("auth failed");
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry generic errors that lack the isRetryable marker", async () => {
    generateMock.mockRejectedValueOnce(new Error("misc network glitch"));

    await expect(settle(runReview(config, "diff", prMetadata))).rejects.toThrow(
      "misc network glitch",
    );
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("retries up to the default cap (3 attempts total) before giving up", async () => {
    generateMock.mockRejectedValue(new FakeApiCallError("upstream timeout", true));

    await expect(settle(runReview(config, "diff", prMetadata))).rejects.toThrow("upstream timeout");
    expect(generateMock).toHaveBeenCalledTimes(3);
  });

  it("respects RUSTY_LLM_MAX_RETRIES=0 (no retries)", async () => {
    process.env.RUSTY_LLM_MAX_RETRIES = "0";
    generateMock.mockRejectedValueOnce(new FakeApiCallError("upstream timeout", true));

    await expect(settle(runReview(config, "diff", prMetadata))).rejects.toThrow("upstream timeout");
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("clamps RUSTY_LLM_MAX_RETRIES above the built-in backoff schedule", async () => {
    process.env.RUSTY_LLM_MAX_RETRIES = "99";
    generateMock.mockRejectedValue(new FakeApiCallError("upstream timeout", true));

    await expect(settle(runReview(config, "diff", prMetadata))).rejects.toThrow("upstream timeout");
    // built-in schedule has 2 retry slots so total attempts = 1 + 2 = 3
    expect(generateMock).toHaveBeenCalledTimes(3);
  });

  it("ignores a non-numeric RUSTY_LLM_MAX_RETRIES and uses the default", async () => {
    process.env.RUSTY_LLM_MAX_RETRIES = "abc";
    generateMock
      .mockRejectedValueOnce(new FakeApiCallError("upstream timeout", true))
      .mockResolvedValueOnce(makeValidResponse());

    await settle(runReview(config, "diff", prMetadata));
    expect(generateMock).toHaveBeenCalledTimes(2);
  });

  it("treats a transient retry as compatible with the structured-output retry", async () => {
    generateMock
      .mockRejectedValueOnce(new FakeApiCallError("upstream timeout", true))
      .mockRejectedValueOnce(
        new FakeMastraError("STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED", "validation failed once"),
      )
      .mockResolvedValueOnce(makeValidResponse());

    await settle(runReview(config, "diff", prMetadata));
    expect(generateMock).toHaveBeenCalledTimes(3);
  });
});
