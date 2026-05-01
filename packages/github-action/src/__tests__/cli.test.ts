import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseConfig } from "../cli.js";
import type { PullRequestEvent } from "../event.js";

const BASE_EVENT: PullRequestEvent = {
  action: "opened",
  pull_request: { number: 42, draft: false },
};

function makeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const defaults: Record<string, string> = {
    GITHUB_TOKEN: "ghs_abc123",
    GITHUB_REPOSITORY: "jegork/rusty-bot",
    ANTHROPIC_API_KEY: "sk-ant-test",
  };
  const merged: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in overrides)) merged[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

describe("parseConfig", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("parses a minimal valid config", () => {
    const config = parseConfig({ event: BASE_EVENT, env: makeEnv() });
    expect(config.owner).toBe("jegork");
    expect(config.repo).toBe("rusty-bot");
    expect(config.pullNumber).toBe(42);
    expect(config.token).toBe("ghs_abc123");
    expect(config.review.style).toBe("balanced");
    expect(config.review.focusAreas).toEqual([
      "security",
      "performance",
      "bugs",
      "style",
      "tests",
      "docs",
    ]);
    expect(config.failOnCritical).toBe(true);
    expect(config.generateDescription).toBe(false);
    expect(config.renameTitleToConventional).toBe(false);
    expect(config.incrementalReview).toBe(true);
  });

  it("throws when GITHUB_TOKEN is missing", () => {
    expect(() =>
      parseConfig({ event: BASE_EVENT, env: makeEnv({ GITHUB_TOKEN: undefined }) }),
    ).toThrow("GITHUB_TOKEN");
  });

  it("throws when GITHUB_REPOSITORY is missing", () => {
    expect(() =>
      parseConfig({ event: BASE_EVENT, env: makeEnv({ GITHUB_REPOSITORY: undefined }) }),
    ).toThrow("GITHUB_REPOSITORY");
  });

  it("lists all missing vars when both are absent", () => {
    expect(() =>
      parseConfig({
        event: BASE_EVENT,
        env: makeEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }),
      }),
    ).toThrow(/GITHUB_TOKEN, GITHUB_REPOSITORY/);
  });

  it("falls back to INPUT_GITHUB_TOKEN when GITHUB_TOKEN is not set", () => {
    const config = parseConfig({
      event: BASE_EVENT,
      env: makeEnv({ GITHUB_TOKEN: undefined, INPUT_GITHUB_TOKEN: "ghp_fallback" }),
    });
    expect(config.token).toBe("ghp_fallback");
  });

  it("throws when GITHUB_REPOSITORY is malformed", () => {
    expect(() =>
      parseConfig({ event: BASE_EVENT, env: makeEnv({ GITHUB_REPOSITORY: "no-slash" }) }),
    ).toThrow('must be in the form "owner/repo"');
  });

  it("throws when the pull request number cannot be determined", () => {
    expect(() => parseConfig({ event: { action: "synchronize" }, env: makeEnv() })).toThrow(
      "could not determine pull request number",
    );
  });

  it("uses top-level event.number when pull_request is absent", () => {
    const config = parseConfig({ event: { action: "opened", number: 7 }, env: makeEnv() });
    expect(config.pullNumber).toBe(7);
  });

  it("parses review style and rejects invalid values", () => {
    expect(
      parseConfig({ event: BASE_EVENT, env: makeEnv({ RUSTY_REVIEW_STYLE: "strict" }) }).review
        .style,
    ).toBe("strict");

    expect(() =>
      parseConfig({ event: BASE_EVENT, env: makeEnv({ RUSTY_REVIEW_STYLE: "bogus" }) }),
    ).toThrow("invalid review style: bogus");
  });

  it("parses focus areas and filters empties / whitespace", () => {
    const config = parseConfig({
      event: BASE_EVENT,
      env: makeEnv({ RUSTY_FOCUS_AREAS: "security, , performance ," }),
    });
    expect(config.review.focusAreas).toEqual(["security", "performance"]);
  });

  it("defaults focus areas to all six when RUSTY_FOCUS_AREAS is absent or empty", () => {
    const defaulted = parseConfig({ event: BASE_EVENT, env: makeEnv() }).review.focusAreas;
    expect(defaulted).toHaveLength(6);

    const emptyString = parseConfig({
      event: BASE_EVENT,
      env: makeEnv({ RUSTY_FOCUS_AREAS: "" }),
    }).review.focusAreas;
    expect(emptyString).toHaveLength(6);

    const onlyCommas = parseConfig({
      event: BASE_EVENT,
      env: makeEnv({ RUSTY_FOCUS_AREAS: ",,," }),
    }).review.focusAreas;
    expect(onlyCommas).toHaveLength(6);
  });

  it("filters unknown focus area values out and keeps the valid ones", () => {
    const config = parseConfig({
      event: BASE_EVENT,
      env: makeEnv({ RUSTY_FOCUS_AREAS: "security,bogus,bugs,YOLO" }),
    });
    expect(config.review.focusAreas).toEqual(["security", "bugs"]);
  });

  it("falls back to all focus areas when every provided value is invalid", () => {
    const config = parseConfig({
      event: BASE_EVENT,
      env: makeEnv({ RUSTY_FOCUS_AREAS: "bogus,YOLO" }),
    });
    expect(config.review.focusAreas).toHaveLength(6);
  });

  it("parses ignore patterns", () => {
    const config = parseConfig({
      event: BASE_EVENT,
      env: makeEnv({ RUSTY_IGNORE_PATTERNS: "*.lock,dist/**" }),
    });
    expect(config.review.ignorePatterns).toEqual(["*.lock", "dist/**"]);
  });

  it("respects RUSTY_FAIL_ON_CRITICAL=false", () => {
    const config = parseConfig({
      event: BASE_EVENT,
      env: makeEnv({ RUSTY_FAIL_ON_CRITICAL: "false" }),
    });
    expect(config.failOnCritical).toBe(false);
  });

  it("treats any non-false RUSTY_FAIL_ON_CRITICAL as true", () => {
    for (const value of ["true", "1", "yes", "anything"]) {
      const config = parseConfig({
        event: BASE_EVENT,
        env: makeEnv({ RUSTY_FAIL_ON_CRITICAL: value }),
      });
      expect(config.failOnCritical).toBe(true);
    }
  });

  describe("LLM credential validation", () => {
    it("throws when the model provider's API key env var is missing", () => {
      expect(() =>
        parseConfig({ event: BASE_EVENT, env: makeEnv({ ANTHROPIC_API_KEY: undefined }) }),
      ).toThrow(/ANTHROPIC_API_KEY is missing/);
    });

    it("validates against the provider prefix of RUSTY_LLM_MODEL, not the default", () => {
      expect(() =>
        parseConfig({
          event: BASE_EVENT,
          env: makeEnv({
            ANTHROPIC_API_KEY: undefined,
            RUSTY_LLM_MODEL: "openai/gpt-4o",
          }),
        }),
      ).toThrow(/OPENAI_API_KEY is missing/);

      expect(() =>
        parseConfig({
          event: BASE_EVENT,
          env: makeEnv({
            ANTHROPIC_API_KEY: undefined,
            RUSTY_LLM_MODEL: "openai/gpt-4o",
            OPENAI_API_KEY: "sk-openai",
          }),
        }),
      ).not.toThrow();
    });

    it("skips key validation when RUSTY_LLM_BASE_URL is set (custom endpoint)", () => {
      expect(() =>
        parseConfig({
          event: BASE_EVENT,
          env: makeEnv({
            ANTHROPIC_API_KEY: undefined,
            RUSTY_LLM_BASE_URL: "http://localhost:4000/v1",
          }),
        }),
      ).not.toThrow();
    });

    it("skips key validation for Azure managed identity", () => {
      expect(() =>
        parseConfig({
          event: BASE_EVENT,
          env: makeEnv({
            ANTHROPIC_API_KEY: undefined,
            RUSTY_AZURE_RESOURCE_NAME: "my-resource",
          }),
        }),
      ).not.toThrow();
    });

    it("skips key validation for unknown provider prefixes (router-handled)", () => {
      expect(() =>
        parseConfig({
          event: BASE_EVENT,
          env: makeEnv({
            ANTHROPIC_API_KEY: undefined,
            RUSTY_LLM_MODEL: "requesty/google/gemini-3.1-flash-lite-preview",
          }),
        }),
      ).not.toThrow();
    });
  });

  it("enables description generation only on exact 'true'", () => {
    expect(
      parseConfig({
        event: BASE_EVENT,
        env: makeEnv({ RUSTY_GENERATE_DESCRIPTION: "true" }),
      }).generateDescription,
    ).toBe(true);

    expect(
      parseConfig({
        event: BASE_EVENT,
        env: makeEnv({ RUSTY_GENERATE_DESCRIPTION: "1" }),
      }).generateDescription,
    ).toBe(false);

    expect(parseConfig({ event: BASE_EVENT, env: makeEnv() }).generateDescription).toBe(false);
  });

  it("enables incremental review by default and disables only on explicit 'false'", () => {
    expect(parseConfig({ event: BASE_EVENT, env: makeEnv() }).incrementalReview).toBe(true);

    expect(
      parseConfig({
        event: BASE_EVENT,
        env: makeEnv({ RUSTY_INCREMENTAL_REVIEW: "false" }),
      }).incrementalReview,
    ).toBe(false);

    for (const value of ["true", "1", "yes", ""]) {
      const config = parseConfig({
        event: BASE_EVENT,
        env: makeEnv({ RUSTY_INCREMENTAL_REVIEW: value }),
      });
      expect(config.incrementalReview).toBe(true);
    }
  });

  it("enables conventional title rename only on exact 'true'", () => {
    expect(
      parseConfig({
        event: BASE_EVENT,
        env: makeEnv({ RUSTY_RENAME_TITLE_TO_CONVENTIONAL: "true" }),
      }).renameTitleToConventional,
    ).toBe(true);

    expect(
      parseConfig({
        event: BASE_EVENT,
        env: makeEnv({ RUSTY_RENAME_TITLE_TO_CONVENTIONAL: "1" }),
      }).renameTitleToConventional,
    ).toBe(false);

    expect(parseConfig({ event: BASE_EVENT, env: makeEnv() }).renameTitleToConventional).toBe(
      false,
    );
  });
});
