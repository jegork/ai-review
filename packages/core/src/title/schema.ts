import { z } from "zod";

export const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

export const ConventionalCommitTypeSchema = z.enum(CONVENTIONAL_COMMIT_TYPES);

export const ConventionalTitleOutputSchema = z.object({
  type: ConventionalCommitTypeSchema.describe(
    "the conventional commit type that best matches the change",
  ),
  scope: z
    .string()
    .nullable()
    .describe(
      "optional short scope describing the area of the codebase affected (lowercase, no spaces); null when no clear scope applies",
    ),
  subject: z
    .string()
    .describe(
      "concise imperative-mood subject line, lowercase first letter, no trailing period, no type prefix",
    ),
  isBreaking: z
    .boolean()
    .describe("true when the change introduces a breaking API/contract/schema change"),
});

export type ConventionalTitleOutput = z.infer<typeof ConventionalTitleOutputSchema>;
