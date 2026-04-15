import { describe, it, expect } from "vitest";
import { buildUserMessage } from "../agent/prompts.js";
import { formatSummaryComment } from "../formatter/summary.js";
import type { PRMetadata, ReviewResult } from "../types.js";
import type { SemgrepFinding, SemgrepRawOutput } from "../semgrep/types.js";

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

function makeSemgrepFinding(overrides: Partial<SemgrepFinding> = {}): SemgrepFinding {
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

describe("semgrep prompt integration", () => {
  it("includes semgrep section when findings are provided", () => {
    const findings = [makeSemgrepFinding()];

    const message = buildUserMessage(
      "diff content",
      prMetadata,
      undefined,
      undefined,
      undefined,
      findings,
    );

    expect(message).toContain("## Semgrep Pre-scan Findings");
    expect(message).toContain("javascript.express.security.audit.xss.mustache-escape");
    expect(message).toContain("Potential XSS: unescaped user input");
    expect(message).toContain("`src/auth.ts`");
    expect(message).toContain("L42–42");
  });

  it("omits semgrep section when no findings", () => {
    const message = buildUserMessage(
      "diff content",
      prMetadata,
      undefined,
      undefined,
      undefined,
      [],
    );
    expect(message).not.toContain("Semgrep Pre-scan");
  });

  it("omits semgrep section when undefined", () => {
    const message = buildUserMessage("diff content", prMetadata);
    expect(message).not.toContain("Semgrep Pre-scan");
  });

  it("renders multiple findings with different severities", () => {
    const findings = [
      makeSemgrepFinding({ ruleId: "rule-a", severity: "error", file: "a.ts", startLine: 10 }),
      makeSemgrepFinding({ ruleId: "rule-b", severity: "warning", file: "b.ts", startLine: 20 }),
      makeSemgrepFinding({ ruleId: "rule-c", severity: "info", file: "c.ts", startLine: 30 }),
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
    const findings = [makeSemgrepFinding({ snippet: 'const token = "hardcoded-secret";' })];

    const message = buildUserMessage("diff", prMetadata, undefined, undefined, undefined, findings);

    expect(message).toContain('const token = "hardcoded-secret";');
  });

  it("renders semgrep section before diff", () => {
    const findings = [makeSemgrepFinding()];
    const message = buildUserMessage(
      "the-diff",
      prMetadata,
      undefined,
      undefined,
      undefined,
      findings,
    );

    const semgrepIdx = message.indexOf("## Semgrep Pre-scan Findings");
    const diffIdx = message.indexOf("## Diff");
    expect(semgrepIdx).toBeLessThan(diffIdx);
  });

  it("includes triage instructions in semgrep section", () => {
    const findings = [makeSemgrepFinding()];
    const message = buildUserMessage("diff", prMetadata, undefined, undefined, undefined, findings);

    expect(message).toContain("confirm");
    expect(message).toContain("dismiss");
    expect(message).toContain("false positive");
  });
});

describe("semgrep stats in summary formatter", () => {
  it("shows semgrep finding count when available and has findings", () => {
    const review = makeReview({
      semgrepStats: { available: true, findingCount: 5 },
    });

    const summary = formatSummaryComment(review);

    expect(summary).toContain("Semgrep pre-scan");
    expect(summary).toContain("5 finding(s) fed to LLM for triage");
  });

  it("shows clean message when semgrep found nothing", () => {
    const review = makeReview({
      semgrepStats: { available: true, findingCount: 0 },
    });

    const summary = formatSummaryComment(review);
    expect(summary).toContain("clean — no findings");
  });

  it("shows not-available message when semgrep is missing", () => {
    const review = makeReview({
      semgrepStats: { available: false, findingCount: 0, error: "semgrep not installed" },
    });

    const summary = formatSummaryComment(review);
    expect(summary).toContain("not available");
    expect(summary).toContain("install `semgrep`");
  });

  it("shows error detail when semgrep failed", () => {
    const review = makeReview({
      semgrepStats: { available: true, findingCount: 0, error: "config parse error" },
    });

    const summary = formatSummaryComment(review);
    expect(summary).toContain("config parse error");
  });

  it("includes semgrep count in footer stats", () => {
    const review = makeReview({
      semgrepStats: { available: true, findingCount: 3 },
    });

    const summary = formatSummaryComment(review);
    expect(summary).toContain("semgrep: 3 pre-scan findings");
  });

  it("omits semgrep from footer when no findings", () => {
    const review = makeReview({
      semgrepStats: { available: true, findingCount: 0 },
    });

    const summary = formatSummaryComment(review);
    // footer line should not mention semgrep count
    const footerLine = summary.split("\n").find((l) => l.includes("Reviewed by"));
    expect(footerLine).not.toContain("semgrep");
  });

  it("does not render semgrep section when stats are absent", () => {
    const review = makeReview();

    const summary = formatSummaryComment(review);
    expect(summary).not.toContain("Semgrep");
    expect(summary).not.toContain("semgrep");
  });
});

describe("semgrep runner types", () => {
  it("SemgrepRawOutput shape is parseable", () => {
    const raw: SemgrepRawOutput = {
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
    const { extractChangedFilePaths } = await import("../semgrep/runner.js");
    const patches = [
      { path: "src/a.ts", hunks: [], additions: 5, deletions: 0, isBinary: false },
      { path: "image.png", hunks: [], additions: 0, deletions: 0, isBinary: true },
      { path: "src/b.ts", hunks: [], additions: 3, deletions: 1, isBinary: false },
    ];

    const files = extractChangedFilePaths(patches);
    expect(files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("extractChangedFilePaths returns empty for empty patches", async () => {
    const { extractChangedFilePaths } = await import("../semgrep/runner.js");
    expect(extractChangedFilePaths([])).toEqual([]);
  });
});

describe("semgrep runner - runSemgrep", () => {
  it("returns empty result for empty file list", async () => {
    const { runSemgrep } = await import("../semgrep/runner.js");
    const result = await runSemgrep([]);

    expect(result.findings).toEqual([]);
    expect(result.rawCount).toBe(0);
    expect(result.available).toBe(true);
  });

  it("gracefully handles semgrep not being installed", async () => {
    // this test relies on semgrep not being in PATH in the test environment
    // if semgrep IS installed, the test still passes because we just check the shape
    const { runSemgrep } = await import("../semgrep/runner.js");
    const result = await runSemgrep(["nonexistent-file.ts"]);

    expect(result).toHaveProperty("findings");
    expect(result).toHaveProperty("rawCount");
    expect(result).toHaveProperty("available");
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
