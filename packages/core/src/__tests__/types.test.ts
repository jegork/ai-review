import { describe, it, expect } from "vitest";
import type { Finding, ReviewResult, ReviewConfig, TicketComplianceItem } from "../types.js";

describe("types", () => {
  it("ReviewConfig accepts valid config", () => {
    const config: ReviewConfig = {
      style: "roast",
      focusAreas: ["security", "bugs"],
      ignorePatterns: ["*.lock"],
    };
    expect(config.style).toBe("roast");
    expect(config.focusAreas).toHaveLength(2);
  });

  it("Finding has all required fields", () => {
    const finding: Finding = {
      file: "src/index.ts",
      line: 42,
      endLine: null,
      severity: "critical",
      category: "security",
      message: "SQL injection vulnerability",
      suggestedFix: null,
    };
    expect(finding.suggestedFix).toBeNull();
  });

  it("ReviewResult has correct structure", () => {
    const result: ReviewResult = {
      summary: "Found issues",
      recommendation: "address_before_merge",
      findings: [],
      observations: [],
      ticketCompliance: [],
      missingTests: [],
      filesReviewed: ["src/index.ts"],
      modelUsed: "anthropic/claude-sonnet-4-20250514",
      tokenCount: 1500,
    };
    expect(result.findings).toHaveLength(0);
    expect(result.filesReviewed).toHaveLength(1);
  });

  it("TicketComplianceItem supports structured checklist entries", () => {
    const item: TicketComplianceItem = {
      ticketId: "AUTH-42",
      requirement: "Login returns JWT",
      status: "addressed",
      evidence: "login.ts signs a token before responding",
    };
    expect(item.status).toBe("addressed");
  });
});
