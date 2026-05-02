import { z } from "zod";

export const GitLabUserSchema = z.object({
  id: z.number().optional(),
  username: z.string().optional(),
  name: z.string().optional(),
});

export const GitLabDiffRefsSchema = z.object({
  base_sha: z.string().nullable().optional(),
  start_sha: z.string().nullable().optional(),
  head_sha: z.string().nullable().optional(),
});

export const GitLabMergeRequestSchema = z.object({
  iid: z.number(),
  id: z.number().optional(),
  project_id: z.number().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  state: z.string().optional(),
  draft: z.boolean().optional(),
  work_in_progress: z.boolean().optional(),
  source_branch: z.string(),
  target_branch: z.string(),
  sha: z.string().nullable().optional(),
  web_url: z.string().optional(),
  author: GitLabUserSchema.nullable().optional(),
  diff_refs: GitLabDiffRefsSchema.nullable().optional(),
});

export const GitLabMergeRequestChangeSchema = z.object({
  old_path: z.string(),
  new_path: z.string(),
  a_mode: z.string().optional(),
  b_mode: z.string().optional(),
  new_file: z.boolean().optional(),
  renamed_file: z.boolean().optional(),
  deleted_file: z.boolean().optional(),
  diff: z.string(),
});

export const GitLabMergeRequestChangesSchema = z.object({
  changes: z.array(GitLabMergeRequestChangeSchema),
  diff_refs: GitLabDiffRefsSchema.nullable().optional(),
});

export const GitLabNoteSchema = z.object({
  id: z.number(),
  body: z.string().nullable().optional(),
  system: z.boolean().optional(),
  author: GitLabUserSchema.nullable().optional(),
});

export const GitLabNotesSchema = z.array(GitLabNoteSchema);

export const GitLabDiscussionSchema = z.object({
  id: z.string(),
  individual_note: z.boolean().optional(),
  notes: z.array(GitLabNoteSchema),
});

export const GitLabDiscussionsSchema = z.array(GitLabDiscussionSchema);

export const GitLabIssueRefSchema = z.object({
  iid: z.number(),
  project_id: z.number().optional(),
  references: z
    .object({
      full: z.string().optional(),
    })
    .optional(),
});

export const GitLabClosesIssuesSchema = z.array(GitLabIssueRefSchema);

export const GitLabSearchResultSchema = z.array(
  z.object({
    path: z.string().optional(),
    filename: z.string().optional(),
    startline: z.number().optional(),
    data: z.string().optional(),
  }),
);
