import { describe, it, expect } from "vitest";
import { buildUserMessage } from "../agent/prompts.js";
import { formatSummaryComment } from "../formatter/summary.js";
import type { PRMetadata, ReviewResult } from "../types.js";
import type { OpenGrepFinding, OpenGrepRawOutput } from "../opengrep/types.js";

const prMetadata: PRMetadata = {
  id: "42",
  title: "Add user auth",
  description: "JWT auth flow",
  author: "dev123",
  sourceBranch: "feature/auth",
  targetBranch: "main",
  url: "https://github.com/org/repo/pull/42",
};

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    summary: "Looks good.",
    recommendation: "looks_good",
    findings: [],
    observations: [],
    ticketCompliance: [],
    filesReviewed: [],
    modelUsed: "gpt-4o",
    tokenCount: 1000,
    ...overrides,
  };
}

function makeOpenGrepFinding(overrides: Partial<OpenGrepFinding> = {}): OpenGrepFinding {
  return {
    ruleId: "javascript.express.security.audit.xss.mustache-escape",
    file: "src/auth.ts",
    startLine: 42,
    endLine: 42,
    message: "Potential XSS: unescaped user input",
    severity: "error",
    ...overrides,
  };
}

describe("opengrep prompt integration", () => {
  it("includes opengrep section when findings are provided", () => {
    const findings = [makeOpenGrepFinding()];

    const message = buildUserMessage(
      "diff content",
      prMetadata,
      undefined,
      undefined,
      undefined,
      findings,
    );

    expect(message).toContain("## OpenGrep Pre-scan Findings");
    expect(message).toContain("javascript.express.security.audit.xss.mustache-escape");
    expect(message).toContain("Potential XSS: unescaped user input");
    expect(message).toContain("`src/auth.ts`");
    expect(message).toContain("L42–42");
  });

  it("omits opengrep section when no findings", () => {
    const message = buildUserMessage(
      "diff content",
      prMetadata,
      undefined,
      undefined,
      undefined,
      [],
    );
    expect(message).not.toContain("OpenGrep Pre-scan");
  });

  it("omits opengrep section when undefined", () => {
    const message = buildUserMessage("diff content", prMetadata);
    expect(message).not.toContain("OpenGrep Pre-scan");
  });

  it("renders multiple findings with different severities", () => {
    const findings = [
      makeOpenGrepFinding({ ruleId: "rule-a", severity: "error", file: "a.ts", startLine: 10 }),
      makeOpenGrepFinding({ ruleId: "rule-b", severity: "warning", file: "b.ts", startLine: 20 }),
      makeOpenGrepFinding({ ruleId: "rule-c", severity: "info", file: "c.ts", startLine: 30 }),
    ];

    const message = buildUserMessage("diff", prMetadata, undefined, undefined, undefined, findings);

    expect(message).toContain("rule-a");
    expect(message).toContain("rule-b");
    expect(message).toContain("rule-c");
    expect(message).toContain("`error`");
    expect(message).toContain("`warning`");
    expect(message).toContain("`info`");
  });

  it("includes code snippet when provided", () => {
    const findings = [makeOpenGrepFinding({ snippet: 'const token = "hardcoded-secret";' })];

    const message = buildUserMessage("diff", prMetadata, undefined, undefined, undefined, findings);

    expect(message).toContain('const token = "hardcoded-secret";');
  });

  it("renders opengrep section before diff", () => {
    const findings = [makeOpenGrepFinding()];
    const message = buildUserMessage(
      "the-diff",
      prMetadata,
      undefined,
      undefined,
      undefined,
      findings,
    );

    const openGrepIdx = message.indexOf("## OpenGrep Pre-scan Findings");
    const diffIdx = message.indexOf("## Diff");
    expect(openGrepIdx).toBeLessThan(diffIdx);
  });

  it("includes triage instructions in opengrep section", () => {
    const findings = [makeOpenGrepFinding()];
    const message = buildUserMessage("diff", prMetadata, undefined, undefined, undefined, findings);

    expect(message).toContain("confirm");
    expect(message).toContain("dismiss");
    expect(message).toContain("false positive");
  });
});

describe("opengrep stats in summary formatter", () => {
  it("shows opengrep finding count when available and has findings", () => {
    const review = makeReview({
      openGrepStats: { available: true, findingCount: 5 },
    });

    const summary = formatSummaryComment(review);

    expect(summary).toContain("OpenGrep pre-scan");
    expect(summary).toContain("5 finding(s) fed to LLM for triage");
  });

  it("shows clean message when opengrep found nothing", () => {
    const review = makeReview({
      openGrepStats: { available: true, findingCount: 0 },
    });

    const summary = formatSummaryComment(review);
    expect(summary).toContain("clean — no findings");
  });

  it("shows not-available message when opengrep is missing", () => {
    const review = makeReview({
      openGrepStats: { available: false, findingCount: 0, error: "opengrep not installed" },
    });

    const summary = formatSummaryComment(review);
    expect(summary).toContain("not available");
    expect(summary).toContain("install `opengrep`");
  });

  it("shows error detail when opengrep failed and does not say clean", () => {
    const review = makeReview({
      openGrepStats: { available: true, findingCount: 0, error: "config parse error" },
    });

    const summary = formatSummaryComment(review);
    expect(summary).toContain("config parse error");
    expect(summary).not.toContain("clean");
  });

  it("includes opengrep count in footer stats", () => {
    const review = makeReview({
      openGrepStats: { available: true, findingCount: 3 },
    });

    const summary = formatSummaryComment(review);
    expect(summary).toContain("opengrep: 3 pre-scan findings");
  });

  it("omits opengrep from footer when no findings", () => {
    const review = makeReview({
      openGrepStats: { available: true, findingCount: 0 },
    });

    const summary = formatSummaryComment(review);
    const footerLine = summary.split("\n").find((l) => l.includes("Reviewed by"));
    expect(footerLine).not.toContain("opengrep");
  });

  it("does not render opengrep section when stats are absent", () => {
    const review = makeReview();

    const summary = formatSummaryComment(review);
    expect(summary).not.toContain("OpenGrep");
    expect(summary).not.toContain("opengrep");
  });
});

describe("opengrep runner types", () => {
  it("OpenGrepRawOutput shape is parseable", () => {
    const raw: OpenGrepRawOutput = {
      results: [
        {
          check_id: "rule-1",
          path: "src/index.ts",
          start: { line: 1, col: 1 },
          end: { line: 1, col: 20 },
          extra: {
            message: "test",
            severity: "WARNING",
          },
        },
      ],
      errors: [],
    };

    expect(raw.results).toHaveLength(1);
    expect(raw.results[0].check_id).toBe("rule-1");
  });

  it("extractChangedFilePaths filters binary files", async () => {
    const { extractChangedFilePaths } = await import("../opengrep/runner.js");
    const patches = [
      { path: "src/a.ts", hunks: [], additions: 5, deletions: 0, isBinary: false },
      { path: "image.png", hunks: [], additions: 0, deletions: 0, isBinary: true },
      { path: "src/b.ts", hunks: [], additions: 3, deletions: 1, isBinary: false },
    ];

    const files = extractChangedFilePaths(patches);
    expect(files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("extractChangedFilePaths returns empty for empty patches", async () => {
    const { extractChangedFilePaths } = await import("../opengrep/runner.js");
    expect(extractChangedFilePaths([])).toEqual([]);
  });
});

describe("opengrep runner - runOpenGrep", () => {
  it("returns empty result for empty file list", async () => {
    const { runOpenGrep } = await import("../opengrep/runner.js");
    const result = await runOpenGrep([]);

    expect(result.findings).toEqual([]);
    expect(result.rawCount).toBe(0);
    expect(result.available).toBe(true);
  });

  it("gracefully handles opengrep not being installed", async () => {
    // this test relies on opengrep not being in PATH in the test environment
    // if opengrep IS installed, the test still passes because we just check the shape
    const { runOpenGrep } = await import("../opengrep/runner.js");
    const result = await runOpenGrep(["nonexistent-file.ts"]);

    expect(result).toHaveProperty("findings");
    expect(result).toHaveProperty("rawCount");
    expect(result).toHaveProperty("available");
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
