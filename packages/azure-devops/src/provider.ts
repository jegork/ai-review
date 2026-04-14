import type {
  GitProvider,
  FilePatch,
  PRMetadata,
  Finding,
  Hunk,
  CodeSearchResult,
} from "@rusty-bot/core";
import { formatInlineComment } from "@rusty-bot/core";

const BOT_MARKER = "<!-- rusty-bot-review -->";
const API_VERSION = "api-version=7.0";

interface AzureDevOpsProviderConfig {
  orgUrl: string;
  project: string;
  repoName: string;
  pullRequestId: number;
  accessToken: string;
}

interface AdoThread {
  id: number;
  comments: { id: number; content?: string }[];
  status: number;
}

interface AdoIteration {
  id: number;
}

interface AdoChangeEntry {
  changeType: string;
  item: {
    path: string;
    gitObjectType?: string;
  };
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
    oldLines: match[2] ? parseInt(match[2], 10) : 1,
    newStart: parseInt(match[3], 10),
    newLines: match[4] ? parseInt(match[4], 10) : 1,
  };
}

function parseDiffText(rawDiff: string): FilePatch[] {
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

    let currentHunk: {
      header: ReturnType<typeof parseHunkHeader>;
      lines: string[];
    } | null = null;

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

export class AzureDevOpsProvider implements GitProvider {
  private readonly orgUrl: string;
  private readonly project: string;
  private readonly repoName: string;
  private readonly pullRequestId: number;
  private readonly accessToken: string;

  constructor(config: AzureDevOpsProviderConfig) {
    this.orgUrl = config.orgUrl.replace(/\/$/, "");
    this.project = config.project;
    this.repoName = config.repoName;
    this.pullRequestId = config.pullRequestId;
    this.accessToken = config.accessToken;
  }

  private get baseUrl(): string {
    return `${this.orgUrl}/${this.project}/_apis/git/repositories/${this.repoName}`;
  }

  private async request<T>(url: string, options?: RequestInit): Promise<T> {
    const { headers: extraHeaders, ...restOptions } = options ?? {};
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
    if (extraHeaders) {
      new Headers(extraHeaders).forEach((v, k) => {
        headers[k] = v;
      });
    }
    const response = await fetch(url, { ...restOptions, headers });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Azure DevOps API error ${response.status}: ${response.statusText} - ${body}`,
      );
    }

    return response.json() as Promise<T>;
  }

  async getDiff(): Promise<FilePatch[]> {
    const pr = await this.request<{
      sourceRefName: string;
      targetRefName: string;
    }>(`${this.baseUrl}/pullRequests/${this.pullRequestId}?${API_VERSION}`);

    const sourceRef = pr.sourceRefName.replace("refs/heads/", "");
    const targetRef = pr.targetRefName.replace("refs/heads/", "");

    const iterations = await this.request<{ value: AdoIteration[] }>(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}/iterations?${API_VERSION}`,
    );

    if (iterations.value.length === 0) return [];
    const lastIteration = iterations.value[iterations.value.length - 1];

    const changes = await this.request<{ changeEntries: AdoChangeEntry[] }>(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}/iterations/${lastIteration.id}/changes?${API_VERSION}`,
    );

    const patches: FilePatch[] = [];

    for (const entry of changes.changeEntries) {
      if (entry.item.gitObjectType === "tree") continue;

      const filePath = entry.item.path.replace(/^\//, "");

      if (entry.changeType === "delete") {
        continue;
      }

      try {
        // fetch the unified diff for each file by comparing commits
        const diffUrl =
          `${this.baseUrl}/diffs/commits?` +
          `baseVersion=${encodeURIComponent(targetRef)}&` +
          `targetVersion=${encodeURIComponent(sourceRef)}&` +
          `diffCommonCommit=true&${API_VERSION}`;

        const diffResponse = await fetch(diffUrl, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: "text/plain",
          },
        });

        if (diffResponse.ok) {
          const rawDiff = await diffResponse.text();
          const parsed = parseDiffText(rawDiff);
          // only include the file we're looking at
          const match = parsed.find((p) => p.path === filePath);
          if (match) {
            patches.push(match);
            continue;
          }
        }
      } catch {
        // fall through to constructing a minimal patch
      }

      patches.push({
        path: filePath,
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: false,
      });
    }

    return patches;
  }

  async getPRMetadata(): Promise<PRMetadata> {
    const data = await this.request<{
      pullRequestId: number;
      title: string;
      description?: string;
      createdBy: { displayName: string; uniqueName?: string } | null;
      sourceRefName: string;
      targetRefName: string;
      url: string;
      repository: { webUrl: string };
    }>(`${this.baseUrl}/pullRequests/${this.pullRequestId}?${API_VERSION}`);

    return {
      id: String(data.pullRequestId),
      title: data.title,
      description: data.description ?? "",
      author: data.createdBy?.uniqueName ?? data.createdBy?.displayName ?? "",
      sourceBranch: data.sourceRefName.replace("refs/heads/", ""),
      targetBranch: data.targetRefName.replace("refs/heads/", ""),
      url: `${this.orgUrl}/${this.project}/_git/${this.repoName}/pullrequest/${this.pullRequestId}`,
    };
  }

  async getFileContent(path: string, ref: string): Promise<string | null> {
    try {
      const url =
        `${this.baseUrl}/items?path=${encodeURIComponent(path)}` +
        `&versionDescriptor.version=${encodeURIComponent(ref)}` +
        `&versionDescriptor.versionType=branch&${API_VERSION}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "text/plain",
        },
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }

  async searchCode(query: string): Promise<CodeSearchResult[]> {
    try {
      // azure devops code search API uses the almsearch endpoint
      const searchUrl = `${this.orgUrl}/${this.project}/_apis/search/codesearchresults?${API_VERSION}`;
      const response = await fetch(searchUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          searchText: query,
          $top: 20,
          filters: {
            Repository: [this.repoName],
          },
        }),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as {
        results?: {
          fileName: string;
          path?: string;
          matches?: Record<string, { charOffset: number; length: number }[]>;
          contentId?: string;
        }[];
      };
      return (data.results ?? []).map((r) => ({
        file: r.path?.replace(/^\//, "") ?? r.fileName,
        line: 0,
        content: "",
      }));
    } catch {
      return [];
    }
  }

  async postSummaryComment(markdown: string): Promise<void> {
    await this.request(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}/threads?${API_VERSION}`,
      {
        method: "POST",
        body: JSON.stringify({
          comments: [
            {
              parentCommentId: 0,
              content: `${BOT_MARKER}\n${markdown}`,
              commentType: 1,
            },
          ],
          status: 1,
        }),
      },
    );
  }

  async postInlineComments(findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;

    for (const finding of findings) {
      const content = `${BOT_MARKER}\n${formatInlineComment(finding)}`;

      await this.request(
        `${this.baseUrl}/pullRequests/${this.pullRequestId}/threads?${API_VERSION}`,
        {
          method: "POST",
          body: JSON.stringify({
            comments: [
              {
                parentCommentId: 0,
                content,
                commentType: 1,
              },
            ],
            threadContext: {
              filePath: `/${finding.file}`,
              rightFileStart: { line: finding.line, offset: 1 },
              rightFileEnd: { line: finding.line, offset: 1 },
            },
            status: 1,
          }),
        },
      );
    }
  }

  async deleteExistingBotComments(): Promise<void> {
    const threads = await this.request<{ value: AdoThread[] }>(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}/threads?${API_VERSION}`,
    );

    const botThreads = threads.value.filter((thread) =>
      thread.comments.some((c) => c.content?.includes(BOT_MARKER)),
    );

    for (const thread of botThreads) {
      await this.request(
        `${this.baseUrl}/pullRequests/${this.pullRequestId}/threads/${thread.id}?${API_VERSION}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: 4 }),
        },
      );
    }
  }
}
