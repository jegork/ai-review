import type { Octokit } from "octokit";
import type { GitProvider, FilePatch, PRMetadata, Finding, Hunk } from "@rusty-bot/core";

const BOT_MARKER = "<!-- rusty-bot-review -->";

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
  const match = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!match) {
    return { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0 };
  }
  return {
    oldStart: parseInt(match[1], 10),
    oldLines: match[2] !== undefined ? parseInt(match[2], 10) : 1,
    newStart: parseInt(match[3], 10),
    newLines: match[4] !== undefined ? parseInt(match[4], 10) : 1,
  };
}

function parseDiff(rawDiff: string): FilePatch[] {
  const patches: FilePatch[] = [];
  const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");

    const pathMatch = section.match(/^--- a\/(.+)\n\+\+\+ b\/(.+)/m);
    const binaryMatch = section.includes("Binary files");

    if (binaryMatch) {
      const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
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

function formatFindingBody(finding: Finding): string {
  const severityIcon =
    finding.severity === "critical" ? "🔴" : finding.severity === "warning" ? "🟡" : "🔵";

  let body = `${severityIcon} **${finding.severity}** (${finding.category})\n\n${finding.message}`;

  if (finding.suggestedFix) {
    body += `\n\n**Suggested fix:**\n\`\`\`suggestion\n${finding.suggestedFix}\n\`\`\``;
  }

  return body;
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
      author: data.user?.login ?? "",
      sourceBranch: data.head.ref,
      targetBranch: data.base.ref,
      url: data.html_url,
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

  async postSummaryComment(markdown: string): Promise<void> {
    await this.octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: this.owner,
      repo: this.repo,
      issue_number: this.pullNumber,
      body: `${BOT_MARKER}\n${markdown}`,
    });
  }

  async postInlineComments(findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;

    const comments = findings.map((finding) => ({
      path: finding.file,
      line: finding.line,
      side: "RIGHT" as const,
      body: formatFindingBody(finding),
    }));

    await this.octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
      owner: this.owner,
      repo: this.repo,
      pull_number: this.pullNumber,
      event: "COMMENT",
      body: "",
      comments,
    });
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
}
