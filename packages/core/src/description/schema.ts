import { z } from "zod";

export const FileChangeSchema = z.object({
  path: z.string().describe("file path that was modified"),
  description: z.string().describe("concise summary of what changed in this file and why"),
});

export const PRDescriptionOutputSchema = z.object({
  summary: z
    .string()
    .describe("2-4 sentence overview of what this PR does and why, written for a reviewer"),
  fileChanges: z
    .array(FileChangeSchema)
    .describe("list of changed files with a description of what changed in each"),
  breakingChanges: z
    .array(z.string())
    .describe("list of breaking changes introduced by this PR; empty array if none"),
  migrationNotes: z
    .string()
    .nullable()
    .describe(
      "migration instructions for consumers (schema changes, API changes, config changes); null if not applicable",
    ),
});

export type PRDescriptionOutput = z.infer<typeof PRDescriptionOutputSchema>;
