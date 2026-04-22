import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEventPayload, parseOwnerRepo, extractPullNumber, shouldSkipEvent } from "../event.js";

describe("parseOwnerRepo", () => {
  it("splits a valid owner/repo string", () => {
    expect(parseOwnerRepo("jegork/ai-review")).toEqual({ owner: "jegork", repo: "ai-review" });
  });

  it("throws on missing slash", () => {
    expect(() => parseOwnerRepo("oops")).toThrow(
      'GITHUB_REPOSITORY must be in the form "owner/repo"',
    );
  });

  it("throws on empty halves", () => {
    expect(() => parseOwnerRepo("/repo")).toThrow();
    expect(() => parseOwnerRepo("owner/")).toThrow();
  });

  it("throws on more than one slash", () => {
    expect(() => parseOwnerRepo("a/b/c")).toThrow();
  });
});

describe("extractPullNumber", () => {
  it("prefers pull_request.number over top-level number", () => {
    expect(
      extractPullNumber({
        action: "opened",
        number: 99,
        pull_request: { number: 42 },
      }),
    ).toBe(42);
  });

  it("falls back to top-level number", () => {
    expect(extractPullNumber({ action: "opened", number: 7 })).toBe(7);
  });

  it("returns null when neither is present", () => {
    expect(extractPullNumber({ action: "synchronize" })).toBeNull();
  });
});

describe("shouldSkipEvent", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("skips closed PRs", () => {
    const result = shouldSkipEvent({ action: "closed", pull_request: { number: 1 } });
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("closed");
  });

  it("skips label-only changes", () => {
    expect(shouldSkipEvent({ action: "labeled", pull_request: { number: 1 } }).skip).toBe(true);
    expect(shouldSkipEvent({ action: "unlabeled", pull_request: { number: 1 } }).skip).toBe(true);
  });

  it("skips draft PRs by default", () => {
    delete process.env.RUSTY_REVIEW_DRAFTS;
    const result = shouldSkipEvent({
      action: "opened",
      pull_request: { number: 1, draft: true },
    });
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("draft");
  });

  it("reviews draft PRs when RUSTY_REVIEW_DRAFTS=true", () => {
    process.env.RUSTY_REVIEW_DRAFTS = "true";
    const result = shouldSkipEvent({
      action: "opened",
      pull_request: { number: 1, draft: true },
    });
    expect(result.skip).toBe(false);
  });

  it("does not skip on opened/synchronize/reopened for non-draft PRs", () => {
    for (const action of ["opened", "synchronize", "reopened"]) {
      expect(shouldSkipEvent({ action, pull_request: { number: 1, draft: false } }).skip).toBe(
        false,
      );
    }
  });

  it("does not skip when draft flag is missing", () => {
    expect(shouldSkipEvent({ action: "opened", pull_request: { number: 1 } }).skip).toBe(false);
  });
});

describe("readEventPayload", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "github-action-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads and parses a pull_request event payload", async () => {
    const path = join(dir, "event.json");
    await writeFile(
      path,
      JSON.stringify({
        action: "opened",
        number: 42,
        pull_request: {
          number: 42,
          draft: false,
          head: { ref: "feat", sha: "abc" },
          base: { ref: "main", sha: "def" },
        },
        repository: { name: "ai-review", owner: { login: "jegork" } },
      }),
    );

    const event = await readEventPayload(path);
    expect(event.pull_request?.number).toBe(42);
    expect(event.repository?.owner.login).toBe("jegork");
  });

  it("tolerates unknown extra fields (forward-compat)", async () => {
    const path = join(dir, "event.json");
    await writeFile(
      path,
      JSON.stringify({
        action: "opened",
        pull_request: { number: 1, _new_field_we_dont_know: "hi" },
        some_new_top_level: true,
      }),
    );

    const event = await readEventPayload(path);
    expect(event.pull_request?.number).toBe(1);
  });

  it("throws when JSON is malformed", async () => {
    const path = join(dir, "event.json");
    await writeFile(path, "{not json");
    await expect(readEventPayload(path)).rejects.toThrow(SyntaxError);
  });

  it("throws when required shape is violated (pull_request.number as string)", async () => {
    const path = join(dir, "event.json");
    await writeFile(path, JSON.stringify({ pull_request: { number: "42" } }));
    await expect(readEventPayload(path)).rejects.toThrow();
  });

  it("throws when file does not exist", async () => {
    await expect(readEventPayload(join(dir, "missing.json"))).rejects.toThrow();
  });
});
