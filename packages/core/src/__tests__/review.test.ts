import { describe, it, expect, vi, beforeEach } from "vitest";
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
