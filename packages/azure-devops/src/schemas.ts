import { z } from "zod";

export const AdoPullRequestSchema = z.object({
  pullRequestId: z.number(),
  title: z.string(),
  description: z.string().nullable().optional(),
  createdBy: z
    .object({
      displayName: z.string().optional(),
      uniqueName: z.string().optional(),
    })
    .nullable()
    .optional(),
  sourceRefName: z.string(),
  targetRefName: z.string(),
  repository: z
    .object({
      webUrl: z.string().optional(),
    })
    .optional(),
});

export const AdoIterationsSchema = z.object({
  value: z.array(z.object({ id: z.number() })),
});

export const AdoChangeEntrySchema = z.object({
  changeType: z.string(),
  item: z.object({
    path: z.string(),
    gitObjectType: z.string().optional(),
  }),
});

export const AdoChangesSchema = z.object({
  changeEntries: z.array(AdoChangeEntrySchema),
});

export const AdoThreadSchema = z.object({
  id: z.number(),
  comments: z.array(
    z.object({
      id: z.number(),
      content: z.string(),
    }),
  ),
  status: z.number(),
});

export const AdoThreadsSchema = z.object({
  value: z.array(AdoThreadSchema),
});

export const AdoSearchResultSchema = z.object({
  results: z
    .array(
      z.object({
        fileName: z.string().optional(),
        path: z.string().optional(),
      }),
    )
    .optional(),
});
