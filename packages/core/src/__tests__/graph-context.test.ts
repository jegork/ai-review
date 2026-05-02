import { describe, expect, it, afterEach } from "vitest";
import { buildGraphRankedContext, resolveGraphContextConfig } from "../diff/graph-context.js";
import type { FilePatch, PRMetadata } from "../types.js";

const metadata: PRMetadata = {
  id: "1",
  title: "Refactor auth token validation",
  description: "Tightens login session handling",
  author: "dev",
  sourceBranch: "feature/auth",
  targetBranch: "main",
  url: "https://example.com/pr/1",
};

function patch(path: string, content: string): FilePatch {
  return {
    path,
    additions: 1,
    deletions: 0,
    isBinary: false,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content }],
  };
}

describe("resolveGraphContextConfig", () => {
  afterEach(() => {
    delete process.env.RUSTY_GRAPH_CONTEXT;
    delete process.env.RUSTY_GRAPH_CONTEXT_TOKEN_BUDGET;
    delete process.env.RUSTY_GRAPH_CONTEXT_MAX_CANDIDATES;
  });

  it("defaults to disabled", () => {
    expect(resolveGraphContextConfig()).toEqual({
      enabled: false,
      tokenBudget: 2000,
      maxCandidates: 8,
    });
  });

  it("parses opt-in settings", () => {
    process.env.RUSTY_GRAPH_CONTEXT = "true";
    process.env.RUSTY_GRAPH_CONTEXT_TOKEN_BUDGET = "120";
    process.env.RUSTY_GRAPH_CONTEXT_MAX_CANDIDATES = "2";

    expect(resolveGraphContextConfig()).toEqual({
      enabled: true,
      tokenBudget: 120,
      maxCandidates: 2,
    });
  });
});

describe("buildGraphRankedContext", () => {
  it("selects directly imported relative context under budget", async () => {
    const files = new Map([
      [
        "src/auth/login.ts",
        [
          'import { validateToken } from "./token";',
          'import { auditLogin } from "../audit";',
          "",
          "export function login(token: string) {",
          "  return validateToken(token);",
          "}",
        ].join("\n"),
      ],
      [
        "src/auth/token.ts",
        [
          "export interface TokenPayload { userId: string }",
          "export function validateToken(token: string): TokenPayload {",
          "  return { userId: token };",
          "}",
        ].join("\n"),
      ],
      [
        "src/audit.ts",
        ["export function auditLogin(userId: string) {", "  return userId;", "}"].join("\n"),
      ],
    ]);

    const result = await buildGraphRankedContext(
      [patch("src/auth/login.ts", "+  return validateToken(token);")],
      async (filePath) => files.get(filePath) ?? null,
      metadata,
      { enabled: true, tokenBudget: 500, maxCandidates: 8 },
    );

    expect(result.selections.map((s) => s.path)).toEqual(["src/auth/token.ts", "src/audit.ts"]);
    expect(result.tokenCount).toBeLessThanOrEqual(500);
    expect(result.renderedContext).toContain("## Graph-ranked Context");
    expect(result.renderedContext).toContain("validateToken");
  });

  it("falls back from full content to signatures when the budget is tight", async () => {
    const files = new Map([
      ["src/service.ts", 'import { expensiveHelper } from "./helper";\nexport const value = 1;'],
      [
        "src/helper.ts",
        [
          "export function expensiveHelper() {",
          ...Array.from({ length: 200 }, (_, i) => `  const value${i} = ${i};`),
          "  return true;",
          "}",
        ].join("\n"),
      ],
    ]);

    const result = await buildGraphRankedContext(
      [patch("src/service.ts", "+export const value = expensiveHelper();")],
      async (filePath) => files.get(filePath) ?? null,
      metadata,
      { enabled: true, tokenBudget: 600, maxCandidates: 8 },
    );

    expect(result.selections).toHaveLength(1);
    expect(result.selections[0].mode).toBe("signatures");
    expect(result.renderedContext).toContain("export function expensiveHelper()");
    expect(result.renderedContext).not.toContain("const value199");
  });

  it("returns no context when disabled", async () => {
    const result = await buildGraphRankedContext(
      [patch("src/service.ts", '+import "./helper";')],
      async () => "export const helper = true;",
      metadata,
      { enabled: false, tokenBudget: 500, maxCandidates: 8 },
    );

    expect(result).toEqual({ renderedContext: "", selections: [], tokenCount: 0 });
  });
});
