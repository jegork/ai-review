import type { Octokit } from "octokit";
import type {
  GitProvider,
  FilePatch,
  PRMetadata,
  Finding,
  Hunk,
  CodeSearchResult,
  PostSummaryCommentOptions,
} from "@rusty-bot/core";
import { formatInlineComment, logger } from "@rusty-bot/core";

const BOT_MARKER = "<!-- rusty-bot-review -->";
const LAST_SHA_MARKER_RE = /<!--\s*rusty-bot:last-sha:([0-9a-f]{40})\s*-->/i;
const log = logger.child({ package: "github", component: "provider" });

function buildLastShaMarker(sha: string): string {
  return `<!-- rusty-bot:last-sha:${sha} -->`;
}

interface GitHubProviderConfig {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
  if (!match) {
    return { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0 };
  }
  return {
    oldStart: parseInt(match[1], 10),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- capture groups can be undefined at runtime
    oldLines: match[2] != null ? parseInt(match[2], 10) : 1,
    newStart: parseInt(match[3], 10),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- capture groups can be undefined at runtime
    newLines: match[4] != null ? parseInt(match[4], 10) : 1,
  };
}

function parseDiff(rawDiff: string): FilePatch[] {
  const patches: FilePatch[] = [];
  const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");

    const pathMatch = /^--- a\/(.+)\n\+\+\+ b\/(.+)/m.exec(section);
    const binaryMatch = section.includes("Binary files");

    if (binaryMatch) {
      const headerMatch = /a\/(.+?) b\/(.+)/.exec(lines[0]);
      const path = headerMatch?.[2] ?? "unknown";
      patches.push({
        path,
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: true,
      });
      continue;
    }

    if (!pathMatch) continue;

    const path = pathMatch[2];
    const hunks: Hunk[] = [];
    let additions = 0;
    let deletions = 0;

    let currentHunk: { header: ReturnType<typeof parseHunkHeader>; lines: string[] } | null = null;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        if (currentHunk) {
          hunks.push({
            ...currentHunk.header,
            content: currentHunk.lines.join("\n"),
          });
        }
        currentHunk = { header: parseHunkHeader(line), lines: [line] };
      } else if (currentHunk) {
        currentHunk.lines.push(line);
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }

    if (currentHunk) {
      hunks.push({
        ...currentHunk.header,
        content: currentHunk.lines.join("\n"),
      });
    }

    patches.push({ path, hunks, additions, deletions, isBinary: false });
  }

  return patches;
}

export class GitHubProvider implements GitProvider {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly pullNumber: number;

  constructor(config: GitHubProviderConfig) {
    this.octokit = config.octokit;
    this.owner = config.owner;
    this.repo = config.repo;
    this.pullNumber = config.pullNumber;
  }

  async getRawDiff(): Promise<string> {
    const response = await this.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pullNumber,
      headers: {
        accept: "application/vnd.github.v3.diff",
      },
    });

    return response.data as unknown as string;
  }

  async getDiff(): Promise<FilePatch[]> {
    const raw = await this.getRawDiff();
    return parseDiff(raw);
  }

  async getDiffSinceSha(sinceSha: string, headSha: string): Promise<FilePatch[] | null> {
    if (sinceSha === headSha) return [];
    try {
      const response = await this.octokit.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        owner: this.owner,
        repo: this.repo,
        basehead: `${sinceSha}...${headSha}`,
        headers: {
          accept: "application/vnd.github.v3.diff",
        },
      });
      return parseDiff(response.data as unknown as string);
    } catch (err) {
      log.warn(
        { err, sinceSha, headSha },
        "could not fetch incremental diff (sha unreachable, force-push, or rebase)",
      );
      return null;
    }
  }

  async getLastReviewedSha(): Promise<string | null> {
    const { data: comments } = await this.octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: this.owner,
        repo: this.repo,
        issue_number: this.pullNumber,
      },
    );

    // walk newest-first so a fresher marker wins if multiple bot comments survive
    for (let i = comments.length - 1; i >= 0; i--) {
      const body = comments[i].body;
      if (!body?.includes(BOT_MARKER)) continue;
      const match = LAST_SHA_MARKER_RE.exec(body);
      if (match) return match[1].toLowerCase();
    }
    return null;
  }

  async getPRMetadata(): Promise<PRMetadata> {
    const { data } = await this.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pullNumber,
    });

    return {
      id: String(data.number),
      title: data.title,
      description: data.body ?? "",
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- user can be null for deleted accounts despite Octokit types
      author: data.user?.login ?? "",
      sourceBranch: data.head.ref,
      targetBranch: data.base.ref,
      url: data.html_url,
      headSha: data.head.sha,
    };
  }

  async getFileContent(path: string, ref: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
        headers: { accept: "application/vnd.github.v3.raw" },
      });
      return data as unknown as string;
    } catch {
      return null;
    }
  }

  async searchCode(query: string): Promise<CodeSearchResult[]> {
    try {
      const { data } = await this.octokit.request("GET /search/code", {
        q: `${query} repo:${this.owner}/${this.repo}`,
        per_page: 20,
        headers: { accept: "application/vnd.github.text-match+json" },
      });
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- items may be absent on rate-limited or error responses
      return (data.items ?? []).map((item) => ({
        file: item.path,
        line: 0,
        content: item.text_matches?.[0]?.fragment ?? "",
      }));
    } catch {
      return [];
    }
  }

  async postSummaryComment(markdown: string, options?: PostSummaryCommentOptions): Promise<void> {
    const header = options?.lastReviewedSha
      ? `${BOT_MARKER}\n${buildLastShaMarker(options.lastReviewedSha)}`
      : BOT_MARKER;
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: this.owner,
      repo: this.repo,
      issue_number: this.pullNumber,
      body: `${header}\n${markdown}`,
    });
  }

  async postInlineComments(findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;

    const comments = findings.map((finding) => {
      const isMultiLine = finding.endLine && finding.endLine !== finding.line;
      return {
        path: finding.file,
        line: finding.endLine ?? finding.line,
        side: "RIGHT" as const,
        body: formatInlineComment(finding),
        ...(isMultiLine && {
          start_line: finding.line,
          start_side: "RIGHT" as const,
        }),
      };
    });

    await this.octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pullNumber,
      event: "COMMENT",
      body: "",
      comments,
    });
  }

  async getLinkedIssueNumbers(): Promise<number[]> {
    const data = await this.octokit.graphql<{
      repository?: {
        pullRequest?: {
          closingIssuesReferences?: {
            nodes?: { number: number }[];
          };
        } | null;
      } | null;
    }>(
      `query ($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            closingIssuesReferences(first: 50) {
              nodes { number }
            }
          }
        }
      }`,
      { owner: this.owner, repo: this.repo, pr: this.pullNumber },
    );
    const nodes = data.repository?.pullRequest?.closingIssuesReferences?.nodes;
    return nodes?.map((n) => n.number) ?? [];
  }

  async deleteExistingBotComments(): Promise<void> {
    const { data: comments } = await this.octokit.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: this.owner,
        repo: this.repo,
        issue_number: this.pullNumber,
      },
    );

    const botComments = comments.filter((c: { body?: string }) => c.body?.includes(BOT_MARKER));

    await Promise.all(
      botComments.map((c: { id: number }) =>
        this.octokit.request("DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}", {
          owner: this.owner,
          repo: this.repo,
          comment_id: c.id,
        }),
      ),
    );
  }

  async updatePRDescription(description: string): Promise<void> {
    await this.octokit.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pullNumber,
      body: description,
    });
  }

  async updatePRTitle(title: string): Promise<void> {
    await this.octokit.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pullNumber,
      title,
    });
  }
}
