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
    GITHUB_REPOSITORY: "jegork/ai-review",
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
    expect(config.repo).toBe("ai-review");
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
});
