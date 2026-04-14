import { z } from "zod";

export const FindingSchema = z.object({
  file: z.string(),
  line: z.number(),
  endLine: z
    .number()
    .nullable()
    .describe(
      "last line of the range when the fix spans multiple lines; null for single-line fixes",
    ),
  severity: z.enum(["critical", "warning", "suggestion"]),
  category: z.enum(["security", "performance", "bugs", "style", "tests", "docs"]),
  message: z.string(),
  suggestedFix: z
    .string()
    .describe(
      "exact replacement code for the line(s) from `line` to `endLine` — raw code only, no markdown fences, no extra context lines; empty string if no fix",
    ),
});

export const SkimFindingSchema = z.object({
  file: z.string(),
  line: z.number(),
  endLine: z
    .number()
    .nullable()
    .describe(
      "last line of the range when the issue spans multiple lines; null for single-line issues",
    ),
  severity: z.enum(["critical", "warning", "suggestion"]),
  category: z.enum(["security", "performance", "bugs", "style", "tests", "docs"]),
  message: z.string(),
});

export const ObservationSchema = z.object({
  file: z.string(),
  line: z.number(),
  severity: z.enum(["critical", "warning", "suggestion"]),
  category: z.enum(["security", "performance", "bugs", "style", "tests", "docs"]),
  message: z.string(),
});

export const TicketComplianceSchema = z.object({
  ticketId: z
    .string()
    .nullable()
    .describe("linked ticket identifier when available, otherwise null"),
  requirement: z.string().describe("single ticket requirement or acceptance criterion"),
  status: z
    .enum(["addressed", "partially_addressed", "not_addressed", "unclear"])
    .describe("whether the diff addresses the requirement"),
  evidence: z
    .string()
    .nullable()
    .describe("brief evidence from the diff supporting the compliance status, otherwise null"),
});

export const ReviewOutputSchema = z.object({
  summary: z.string().describe("concise summary of the PR and overall assessment"),
  recommendation: z
    .enum(["looks_good", "address_before_merge", "critical_issues"])
    .describe("merge recommendation based on findings"),
  findings: z
    .array(FindingSchema)
    .describe("issues found in the changed code, tied to specific lines in the diff"),
  observations: z
    .array(ObservationSchema)
    .describe("issues found in referenced but unchanged code"),
  ticketCompliance: z
    .array(TicketComplianceSchema)
    .describe(
      "requirement-by-requirement compliance checklist for linked tickets; empty when no linked tickets are available",
    ),
  filesReviewed: z.array(z.string()).describe("list of file paths that were reviewed"),
});

export const SkimReviewOutputSchema = z.object({
  summary: z.string().describe("concise summary of the PR and overall assessment"),
  recommendation: z
    .enum(["looks_good", "address_before_merge", "critical_issues"])
    .describe("merge recommendation based on findings"),
  findings: z
    .array(SkimFindingSchema)
    .describe("issues found in the changed code, tied to specific lines in the diff"),
  observations: z
    .array(ObservationSchema)
    .describe("issues found in referenced but unchanged code"),
  filesReviewed: z.array(z.string()).describe("list of file paths that were reviewed"),
});
