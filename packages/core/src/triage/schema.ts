import { z } from "zod";

export const TriageFileSchema = z.object({
  path: z.string(),
  classification: z.enum(["skip", "skim", "deep-review"]),
  reason: z.string().describe("brief reason for the classification"),
});

export const TriageOutputSchema = z.object({
  files: z.array(TriageFileSchema).describe("classification for each file in the PR"),
});
