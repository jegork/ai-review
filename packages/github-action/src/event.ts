import { readFile } from "node:fs/promises";
import { z } from "zod";

export const PullRequestEventSchema = z.object({
  action: z.string().optional(),
  number: z.number().optional(),
  pull_request: z
    .object({
      number: z.number(),
      draft: z.boolean().optional(),
      head: z.object({ ref: z.string(), sha: z.string() }).optional(),
      base: z.object({ ref: z.string(), sha: z.string() }).optional(),
    })
    .optional(),
  repository: z
    .object({
      name: z.string(),
      owner: z.object({ login: z.string() }),
    })
    .optional(),
});

export type PullRequestEvent = z.infer<typeof PullRequestEventSchema>;

export async function readEventPayload(eventPath: string): Promise<PullRequestEvent> {
  const raw = await readFile(eventPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return PullRequestEventSchema.parse(parsed);
}

export function parseOwnerRepo(githubRepository: string): { owner: string; repo: string } {
  const parts = githubRepository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `GITHUB_REPOSITORY must be in the form "owner/repo", got "${githubRepository}"`,
    );
  }
  return { owner: parts[0], repo: parts[1] };
}

export function extractPullNumber(event: PullRequestEvent): number | null {
  return event.pull_request?.number ?? event.number ?? null;
}

const SKIPPED_PR_ACTIONS = new Set(["closed", "labeled", "unlabeled", "assigned", "unassigned"]);

export function shouldSkipEvent(event: PullRequestEvent): {
  skip: boolean;
  reason?: string;
} {
  if (event.action && SKIPPED_PR_ACTIONS.has(event.action)) {
    return { skip: true, reason: `action "${event.action}" is not reviewed` };
  }
  if (event.pull_request?.draft === true && process.env.RUSTY_REVIEW_DRAFTS !== "true") {
    return { skip: true, reason: "PR is a draft (set RUSTY_REVIEW_DRAFTS=true to review drafts)" };
  }
  return { skip: false };
}
