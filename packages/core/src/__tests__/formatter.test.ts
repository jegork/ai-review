import { describe, it, expect } from "vitest";
import { formatSummaryComment } from "../formatter/summary.js";
import { formatInlineComment } from "../formatter/inline.js";
import type { ReviewResult, Finding } from "../types.js";

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    summary: "Overall the code looks solid.",
    recommendation: "address_before_merge",
    findings: [],
    observations: [],
    filesReviewed: [],
    modelUsed: "gpt-4o",
    tokenCount: 12345,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/index.ts",
    line: 10,
    severity: "warning",
    category: "bugs",
    message: "Possible null dereference",
    ...overrides,
  };
}

describe("formatSummaryComment", () => {
  it("renders a full summary with all severity levels", () => {
    const review = makeReview({
      findings: [
        makeFinding({ severity: "critical", file: "src/auth.ts", line: 42, message: "SQL injection risk" }),
        makeFinding({ severity: "warning", file: "src/utils.ts", line: 15, message: "Unused variable" }),
        makeFinding({ severity: "suggestion", file: "src/helpers.ts", line: 88, message: "Consider extracting method" }),
      ],
      observations: [
        { file: "src/legacy.ts", line: 125, severity: "warning", category: "security", message: "Hardcoded secret" },
      ],
      filesReviewed: ["src/auth.ts", "src/utils.ts", "src/helpers.ts"],
      modelUsed: "claude-opus-4-20250514",
      tokenCount: 50000,
    });

    const result = formatSummaryComment(review);

    expect(result).toContain("# Code Review Summary");
    expect(result).toContain("**Status:** 3 Issues Found");
    expect(result).toContain("**Recommendation:** Address before merge");
    expect(result).toContain("| CRITICAL | 1 |");
    expect(result).toContain("| WARNING | 1 |");
    expect(result).toContain("| SUGGESTION | 1 |");
    expect(result).toContain("| `src/auth.ts` | 42 | SQL injection risk |");
    expect(result).toContain("| `src/utils.ts` | 15 | Unused variable |");
    expect(result).toContain("Other Observations (not in diff)");
    expect(result).toContain("| `src/legacy.ts` | 125 | Hardcoded secret |");
    expect(result).toContain("Files Reviewed (3 files)");
    expect(result).toContain("- `src/auth.ts` - 1 issues");
    expect(result).toContain("Overall the code looks solid.");
    expect(result).toContain("Reviewed by claude-opus-4-20250514 · 50000 tokens");
  });

  it("renders a clean review with zero findings", () => {
    const review = makeReview({
      recommendation: "looks_good",
      findings: [],
      observations: [],
      filesReviewed: ["src/app.ts"],
    });

    const result = formatSummaryComment(review);

    expect(result).toContain("**Status:** 0 Issues Found");
    expect(result).toContain("**Recommendation:** Looks good!");
    expect(result).toContain("| CRITICAL | 0 |");
    expect(result).toContain("| WARNING | 0 |");
    expect(result).toContain("| SUGGESTION | 0 |");
    expect(result).toContain("No issues found.");
    expect(result).not.toContain("Other Observations");
    expect(result).toContain("- `src/app.ts` - 0 issues");
  });

  it("renders only one severity level when others are empty", () => {
    const review = makeReview({
      recommendation: "critical_issues",
      findings: [
        makeFinding({ severity: "critical", message: "Memory leak" }),
        makeFinding({ severity: "critical", file: "src/db.ts", line: 99, message: "Connection not closed" }),
      ],
      filesReviewed: ["src/index.ts", "src/db.ts"],
    });

    const result = formatSummaryComment(review);

    expect(result).toContain("**Recommendation:** Critical issues found");
    expect(result).toContain("CRITICAL");
    expect(result).toContain("| CRITICAL | 2 |");
    // warning/suggestion tables should be omitted from Issue Details
    const detailsSection = result.split("Issue Details")[1].split("</details>")[0];
    expect(detailsSection).not.toMatch(/^WARNING$/m);
    expect(detailsSection).not.toMatch(/^SUGGESTION$/m);
  });

  it("includes observations section when observations exist", () => {
    const review = makeReview({
      observations: [
        { file: "src/old.ts", line: 200, severity: "suggestion", category: "style", message: "Dead code" },
      ],
      filesReviewed: ["src/main.ts"],
    });

    const result = formatSummaryComment(review);

    expect(result).toContain("Other Observations (not in diff)");
    expect(result).toContain("Issues found in unchanged code that cannot receive inline comments:");
    expect(result).toContain("| `src/old.ts` | 200 | Dead code |");
  });

  it("omits observations section when no observations", () => {
    const review = makeReview({ observations: [] });
    const result = formatSummaryComment(review);
    expect(result).not.toContain("Other Observations");
  });

  it("handles a single file reviewed", () => {
    const review = makeReview({
      filesReviewed: ["single-file.ts"],
      findings: [makeFinding({ file: "single-file.ts" })],
    });

    const result = formatSummaryComment(review);

    expect(result).toContain("Files Reviewed (1 files)");
    expect(result).toContain("- `single-file.ts` - 1 issues");
  });

  it("handles very long file paths", () => {
    const longPath = "src/modules/deeply/nested/folder/structure/that/goes/on/and/on/component.tsx";
    const review = makeReview({
      findings: [makeFinding({ file: longPath, line: 1, message: "issue here" })],
      filesReviewed: [longPath],
    });

    const result = formatSummaryComment(review);

    expect(result).toContain(`\`${longPath}\``);
    expect(result).toContain(`- \`${longPath}\` - 1 issues`);
  });

  it("counts issues per file correctly when multiple findings in same file", () => {
    const review = makeReview({
      findings: [
        makeFinding({ file: "a.ts", line: 1, severity: "warning" }),
        makeFinding({ file: "a.ts", line: 5, severity: "critical" }),
        makeFinding({ file: "b.ts", line: 10, severity: "suggestion" }),
      ],
      filesReviewed: ["a.ts", "b.ts", "c.ts"],
    });

    const result = formatSummaryComment(review);

    expect(result).toContain("- `a.ts` - 2 issues");
    expect(result).toContain("- `b.ts` - 1 issues");
    expect(result).toContain("- `c.ts` - 0 issues");
  });
});

describe("formatInlineComment", () => {
  it("renders an inline comment with suggested fix", () => {
    const finding = makeFinding({
      severity: "critical",
      category: "security",
      message: "Unsanitized user input",
      suggestedFix: "const safe = sanitize(input);",
    });

    const result = formatInlineComment(finding);

    expect(result).toContain("**CRITICAL** (security)");
    expect(result).toContain("Unsanitized user input");
    expect(result).toContain("```suggestion");
    expect(result).toContain("const safe = sanitize(input);");
    expect(result).toContain("```");
  });

  it("renders an inline comment without suggested fix", () => {
    const finding = makeFinding({
      severity: "suggestion",
      category: "style",
      message: "Consider using const instead of let",
    });

    const result = formatInlineComment(finding);

    expect(result).toContain("**SUGGESTION** (style)");
    expect(result).toContain("Consider using const instead of let");
    expect(result).not.toContain("```suggestion");
  });

  it("renders warning severity correctly", () => {
    const finding = makeFinding({
      severity: "warning",
      category: "performance",
      message: "O(n^2) complexity in loop",
    });

    const result = formatInlineComment(finding);

    expect(result).toContain("**WARNING** (performance)");
    expect(result).toContain("O(n^2) complexity in loop");
  });

  it("handles multiline suggested fix", () => {
    const finding = makeFinding({
      suggestedFix: "const a = 1;\nconst b = 2;\nreturn a + b;",
    });

    const result = formatInlineComment(finding);

    expect(result).toContain("```suggestion\nconst a = 1;\nconst b = 2;\nreturn a + b;\n```");
  });
});
