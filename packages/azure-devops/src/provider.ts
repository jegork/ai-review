import type {
  GitProvider,
  FilePatch,
  PRMetadata,
  Finding,
  CodeSearchResult,
} from "@rusty-bot/core";
import { formatInlineComment } from "@rusty-bot/core";
import { structuredPatch } from "diff";
import type { StructuredPatchHunk } from "diff";
import type { z } from "zod";
import {
  AdoPullRequestSchema,
  AdoIterationsSchema,
  AdoChangesSchema,
  AdoThreadsSchema,
  AdoSearchResultSchema,
  AdoPrWorkItemsSchema,
} from "./schemas.js";

const BOT_MARKER = "<!-- rusty-bot-review -->";
const API_VERSION = "api-version=7.0";

interface AzureDevOpsProviderConfig {
  orgUrl: string;
  project: string;
  repoName: string;
  pullRequestId: number;
  accessToken: string;
}

function buildPatchFromContent(
  path: string,
  oldContent: string | null,
  newContent: string,
): FilePatch {
  const patch = structuredPatch(
    `a/${path}`,
    `b/${path}`,
    oldContent ?? "",
    newContent,
    undefined,
    undefined,
    { context: 3 },
  );

  let additions = 0;
  let deletions = 0;

  const hunks = patch.hunks.map((h: StructuredPatchHunk) => {
    const lines: string[] = [];
    for (const line of h.lines) {
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
      lines.push(line);
    }
    return {
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      content: lines.join("\n"),
    };
  });

  return { path, hunks, additions, deletions, isBinary: false };
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

  private async fetchApi(url: string, options?: RequestInit): Promise<Response> {
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

    return response;
  }

  private async getFileContentByVersion(path: string, version: string): Promise<string | null> {
    try {
      const url =
        `${this.baseUrl}/items?` +
        `path=${encodeURIComponent("/" + path)}&` +
        `versionDescriptor.version=${encodeURIComponent(version)}&` +
        `versionDescriptor.versionType=branch&` +
        `includeContent=true&${API_VERSION}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/octet-stream",
        },
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }

  private async request<T extends z.ZodType>(
    url: string,
    schema: T,
    options?: RequestInit,
  ): Promise<z.infer<T>> {
    const response = await this.fetchApi(url, options);
    const json: unknown = await response.json();
    return schema.parse(json) as z.infer<T>;
  }

  async getDiff(): Promise<FilePatch[]> {
    const pr = await this.request(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}?${API_VERSION}`,
      AdoPullRequestSchema,
    );

    const sourceRef = pr.sourceRefName.replace("refs/heads/", "");
    const targetRef = pr.targetRefName.replace("refs/heads/", "");

    const iterations = await this.request(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}/iterations?${API_VERSION}`,
      AdoIterationsSchema,
    );

    if (iterations.value.length === 0) return [];
    const lastIteration = iterations.value[iterations.value.length - 1];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive guard against schema changes
    if (!lastIteration) return [];

    const changes = await this.request(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}/iterations/${lastIteration.id}/changes?${API_VERSION}`,
      AdoChangesSchema,
    );

    const patches: FilePatch[] = [];

    for (const entry of changes.changeEntries) {
      if (!entry.item?.path) continue;
      if (entry.item.gitObjectType === "tree") continue;

      const filePath = entry.item.path.replace(/^\//, "");

      const isDelete = entry.changeType.includes("delete");
      const isSourceRename = entry.changeType.includes("sourceRename");
      if (isDelete || isSourceRename) continue;

      const isAdd = entry.changeType.includes("add");
      const isRename = entry.changeType.includes("rename");
      const oldPath =
        isRename && entry.originalPath ? entry.originalPath.replace(/^\//, "") : filePath;

      try {
        const [newContent, oldContent] = await Promise.all([
          this.getFileContentByVersion(filePath, sourceRef),
          isAdd ? Promise.resolve(null) : this.getFileContentByVersion(oldPath, targetRef),
        ]);

        if (newContent !== null) {
          const patch = buildPatchFromContent(filePath, oldContent, newContent);
          if (patch.hunks.length > 0) {
            patches.push(patch);
            continue;
          }
        }
      } catch {
        // fall through to empty patch
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
    const data = await this.request(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}?${API_VERSION}`,
      AdoPullRequestSchema,
    );

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
      const parsed = AdoSearchResultSchema.safeParse(await response.json());
      if (!parsed.success) return [];
      return (parsed.data.results ?? []).map((r) => ({
        file: r.path?.replace(/^\//, "") ?? r.fileName ?? "",
        line: 0,
        content: "",
      }));
    } catch {
      return [];
    }
  }

  async postSummaryComment(markdown: string): Promise<void> {
    await this.fetchApi(
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

      await this.fetchApi(
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
    const threads = await this.request(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}/threads?${API_VERSION}`,
      AdoThreadsSchema,
    );

    const botThreads = threads.value.filter((thread) =>
      thread.comments.some((c) => c.content?.includes(BOT_MARKER)),
    );

    for (const thread of botThreads) {
      await this.fetchApi(
        `${this.baseUrl}/pullRequests/${this.pullRequestId}/threads/${thread.id}?${API_VERSION}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: 4 }),
        },
      );
    }
  }

  async getLinkedWorkItemIds(): Promise<string[]> {
    const data = await this.request(
      `${this.baseUrl}/pullRequests/${this.pullRequestId}/workitems?${API_VERSION}`,
      AdoPrWorkItemsSchema,
    );
    return data.value.map((item) => item.id);
  }

  async updatePRDescription(description: string): Promise<void> {
    await this.fetchApi(`${this.baseUrl}/pullRequests/${this.pullRequestId}?${API_VERSION}`, {
      method: "PATCH",
      body: JSON.stringify({ description }),
    });
  }
}
