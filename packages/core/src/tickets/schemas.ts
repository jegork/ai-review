import { z } from "zod";

export const GitHubIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable().optional(),
  labels: z.array(z.object({ name: z.string().optional() })),
});

export const JiraIssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string().optional(),
    description: z.unknown().optional(),
    labels: z.array(z.string()).optional(),
  }),
});

export const LinearIssueSchema = z.object({
  identifier: z.string().optional(),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  labels: z
    .object({
      nodes: z.array(z.object({ name: z.string().optional() })).optional(),
    })
    .optional(),
});

export const LinearResponseSchema = z.object({
  data: z
    .object({
      issue: LinearIssueSchema.nullable().optional(),
      issueByIdentifier: LinearIssueSchema.nullable().optional(),
    })
    .optional(),
});

export const AdoWorkItemSchema = z.object({
  id: z.number().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});
