import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FilePatch, TriageFileResult } from "../types.js";
import { TriageOutputSchema } from "../triage/schema.js";
import { buildTriageSystemPrompt, buildTriageUserMessage } from "../triage/prompt.js";
import { splitByClassification, isCascadeEnabled } from "../triage/triage.js";

function makePatch(path: string, additions = 10): FilePatch {
  const lines = Array.from({ length: additions }, (_, i) => `+line ${i}`).join("\n");
  return {
    path,
    additions,
    deletions: 0,
    isBinary: false,
    hunks: [
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: additions,
        content: lines,
      },
    ],
  };
}

describe("TriageOutputSchema", () => {
  it("accepts valid triage output", () => {
    const input = {
      files: [
        { path: "src/index.ts", classification: "deep-review", reason: "new logic" },
        { path: "README.md", classification: "skim", reason: "docs only" },
        { path: "pnpm-lock.yaml", classification: "skip", reason: "lock file" },
      ],
    };
    const result = TriageOutputSchema.parse(input);
    expect(result.files).toHaveLength(3);
  });

  it("rejects invalid classification values", () => {
    const input = {
      files: [{ path: "x.ts", classification: "maybe", reason: "unsure" }],
    };
    expect(() => TriageOutputSchema.parse(input)).toThrow();
  });

  it("rejects missing path field", () => {
    const input = {
      files: [{ classification: "skip", reason: "no path" }],
    };
    expect(() => TriageOutputSchema.parse(input)).toThrow();
  });

  it("rejects missing reason field", () => {
    const input = {
      files: [{ path: "x.ts", classification: "skip" }],
    };
    expect(() => TriageOutputSchema.parse(input)).toThrow();
  });

  it("rejects empty files array schema is still valid", () => {
    const input = { files: [] };
    const result = TriageOutputSchema.parse(input);
    expect(result.files).toHaveLength(0);
  });

  it("rejects when files field is missing", () => {
    expect(() => TriageOutputSchema.parse({})).toThrow();
  });
});

describe("buildTriageSystemPrompt", () => {
  it("includes classification instructions", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("skip");
    expect(prompt).toContain("skim");
    expect(prompt).toContain("deep-review");
  });

  it("mentions lock files in rules", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toContain("lock files");
  });

  it("mentions security-relevant changes", () => {
    const prompt = buildTriageSystemPrompt();
    expect(prompt).toMatch(/security|auth|crypto/i);
  });
});

describe("buildTriageUserMessage", () => {
  it("includes file paths", () => {
    const patches = [makePatch("src/auth.ts"), makePatch("README.md")];
    const msg = buildTriageUserMessage(patches);
    expect(msg).toContain("src/auth.ts");
    expect(msg).toContain("README.md");
  });

  it("includes file count", () => {
    const patches = [makePatch("a.ts"), makePatch("b.ts"), makePatch("c.ts")];
    const msg = buildTriageUserMessage(patches);
    expect(msg).toContain("3 files");
  });

  it("truncates large patches", () => {
    const largePatch = makePatch("big.ts", 5000);
    const msg = buildTriageUserMessage([largePatch]);
    expect(msg).toContain("truncated");
  });

  it("handles empty patches array", () => {
    const msg = buildTriageUserMessage([]);
    expect(msg).toContain("0 files");
  });
});

describe("splitByClassification", () => {
  const patches = [
    makePatch("src/index.ts"),
    makePatch("README.md"),
    makePatch("package-lock.json"),
    makePatch("src/auth.ts"),
    makePatch("docs/guide.md"),
  ];

  it("splits files correctly into three groups", () => {
    const triageFiles: TriageFileResult[] = [
      { path: "src/index.ts", classification: "deep-review", reason: "logic" },
      { path: "README.md", classification: "skim", reason: "docs" },
      { path: "package-lock.json", classification: "skip", reason: "lock" },
      { path: "src/auth.ts", classification: "deep-review", reason: "security" },
      { path: "docs/guide.md", classification: "skim", reason: "docs" },
    ];

    const { skip, skim, deepReview } = splitByClassification(patches, triageFiles);
    expect(skip.map((p) => p.path)).toEqual(["package-lock.json"]);
    expect(skim.map((p) => p.path)).toEqual(["README.md", "docs/guide.md"]);
    expect(deepReview.map((p) => p.path)).toEqual(["src/index.ts", "src/auth.ts"]);
  });

  it("defaults unclassified files to deep-review", () => {
    const triageFiles: TriageFileResult[] = [
      { path: "src/index.ts", classification: "skim", reason: "simple" },
    ];

    const { skip, skim, deepReview } = splitByClassification(patches, triageFiles);
    expect(skip).toHaveLength(0);
    expect(skim).toHaveLength(1);
    expect(deepReview).toHaveLength(4);
  });

  it("handles empty triage results by deep-reviewing everything", () => {
    const { skip, skim, deepReview } = splitByClassification(patches, []);
    expect(skip).toHaveLength(0);
    expect(skim).toHaveLength(0);
    expect(deepReview).toHaveLength(5);
  });

  it("handles all files being skipped", () => {
    const triageFiles: TriageFileResult[] = patches.map((p) => ({
      path: p.path,
      classification: "skip" as const,
      reason: "trivial",
    }));

    const { skip, skim, deepReview } = splitByClassification(patches, triageFiles);
    expect(skip).toHaveLength(5);
    expect(skim).toHaveLength(0);
    expect(deepReview).toHaveLength(0);
  });
});

describe("isCascadeEnabled", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.RUSTY_CASCADE_ENABLED;
    delete process.env.RUSTY_LLM_TRIAGE_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns false when no triage model is set", () => {
    expect(isCascadeEnabled()).toBe(false);
  });

  it("returns true when triage model is set", () => {
    process.env.RUSTY_LLM_TRIAGE_MODEL = "anthropic/claude-haiku-3";
    expect(isCascadeEnabled()).toBe(true);
  });

  it("returns false when explicitly disabled despite triage model", () => {
    process.env.RUSTY_LLM_TRIAGE_MODEL = "anthropic/claude-haiku-3";
    process.env.RUSTY_CASCADE_ENABLED = "false";
    expect(isCascadeEnabled()).toBe(false);
  });

  it("returns true when explicitly enabled without triage model", () => {
    process.env.RUSTY_CASCADE_ENABLED = "true";
    expect(isCascadeEnabled()).toBe(true);
  });
});
