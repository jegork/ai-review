import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AzureDevOpsProvider } from "../provider.js";
import type { Finding } from "@rusty-bot/core";

const ORG_URL = "https://dev.azure.com/test-org";
const PROJECT = "test-project";
const REPO_NAME = "test-repo";
const PULL_REQUEST_ID = 42;
const ACCESS_TOKEN = "test-token";

const BASE_URL = `${ORG_URL}/${PROJECT}/_apis/git/repositories/${REPO_NAME}`;
const API_VERSION = "api-version=7.0";

function createProvider(): AzureDevOpsProvider {
  return new AzureDevOpsProvider({
    orgUrl: ORG_URL,
    project: PROJECT,
    repoName: REPO_NAME,
    pullRequestId: PULL_REQUEST_ID,
    accessToken: ACCESS_TOKEN,
  });
}

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Bad Request",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as Response;
}

describe("AzureDevOpsProvider", () => {
  let provider: AzureDevOpsProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = createProvider();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getPRMetadata", () => {
    it("maps ado response to PRMetadata", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          pullRequestId: 42,
          title: "feat: add widget",
          description: "adds a new widget component",
          createdBy: { displayName: "Test User", uniqueName: "test@example.com" },
          sourceRefName: "refs/heads/feature/widget",
          targetRefName: "refs/heads/main",
          url: "https://dev.azure.com/test-org/_apis/git/repositories/test-repo/pullRequests/42",
          repository: { webUrl: "https://dev.azure.com/test-org/test-project/_git/test-repo" },
        }),
      );

      const metadata = await provider.getPRMetadata();

      expect(metadata).toEqual({
        id: "42",
        title: "feat: add widget",
        description: "adds a new widget component",
        author: "test@example.com",
        sourceBranch: "feature/widget",
        targetBranch: "main",
        url: `${ORG_URL}/${PROJECT}/_git/${REPO_NAME}/pullrequest/${PULL_REQUEST_ID}`,
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE_URL}/pullRequests/${PULL_REQUEST_ID}?${API_VERSION}`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          }),
        }),
      );
    });

    it("handles null description", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          pullRequestId: 1,
          title: "pr",
          description: null,
          createdBy: { displayName: "User", uniqueName: "u@e.com" },
          sourceRefName: "refs/heads/src",
          targetRefName: "refs/heads/dst",
          url: "",
          repository: { webUrl: "" },
        }),
      );

      const metadata = await provider.getPRMetadata();
      expect(metadata.description).toBe("");
    });

    it("falls back to displayName when uniqueName is missing", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          pullRequestId: 1,
          title: "pr",
          description: "",
          createdBy: { displayName: "Some User" },
          sourceRefName: "refs/heads/src",
          targetRefName: "refs/heads/dst",
          url: "",
          repository: { webUrl: "" },
        }),
      );

      const metadata = await provider.getPRMetadata();
      expect(metadata.author).toBe("Some User");
    });

    it("handles missing createdBy entirely", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          pullRequestId: 1,
          title: "pr",
          description: "",
          createdBy: null,
          sourceRefName: "refs/heads/src",
          targetRefName: "refs/heads/dst",
          url: "",
          repository: { webUrl: "" },
        }),
      );

      const metadata = await provider.getPRMetadata();
      expect(metadata.author).toBe("");
    });

    it("throws on API error", async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ message: "not found" }, false, 404));

      await expect(provider.getPRMetadata()).rejects.toThrow("Azure DevOps API error 404");
    });
  });

  describe("postSummaryComment", () => {
    it("sends correct payload with bot marker", async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}));

      await provider.postSummaryComment("## Review\nLooks good!");

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE_URL}/pullRequests/${PULL_REQUEST_ID}/threads?${API_VERSION}`,
        expect.objectContaining({
          method: "POST",
        }),
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.comments[0].content).toBe("<!-- rusty-bot-review -->\n## Review\nLooks good!");
      expect(body.comments[0].parentCommentId).toBe(0);
      expect(body.comments[0].commentType).toBe(1);
      expect(body.status).toBe(1);
    });

    it("handles empty markdown", async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({}));

      await provider.postSummaryComment("");

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.comments[0].content).toBe("<!-- rusty-bot-review -->\n");
    });
  });

  describe("postInlineComments", () => {
    it("creates threads with correct threadContext for each finding", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse({}));

      const findings: Finding[] = [
        {
          file: "src/index.ts",
          line: 10,
          endLine: null,
          severity: "critical",
          category: "security",
          message: "SQL injection risk",
          suggestedFix: "use parameterized queries",
        },
        {
          file: "src/utils.ts",
          line: 25,
          endLine: null,
          severity: "suggestion",
          category: "style",
          message: "prefer const",
          suggestedFix: null,
        },
      ];

      await provider.postInlineComments(findings);

      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const firstBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(firstBody.threadContext.filePath).toBe("/src/index.ts");
      expect(firstBody.threadContext.rightFileStart).toEqual({ line: 10, offset: 1 });
      expect(firstBody.threadContext.rightFileEnd).toEqual({ line: 11, offset: 1 });
      expect(firstBody.comments[0].content).toContain("<!-- rusty-bot-review -->");
      expect(firstBody.comments[0].content).toContain("SQL injection risk");
      expect(firstBody.comments[0].content).toContain("```suggestion");

      const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(secondBody.threadContext.filePath).toBe("/src/utils.ts");
      expect(secondBody.threadContext.rightFileStart.line).toBe(25);
      expect(secondBody.comments[0].content).not.toContain("```suggestion");
    });

    it("uses endLine for rightFileEnd when finding spans multiple lines", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse({}));

      const findings: Finding[] = [
        {
          file: "src/config.ts",
          line: 5,
          endLine: 12,
          severity: "warning",
          category: "bugs",
          message: "duplicate entries",
          suggestedFix: "const plugins = [\n  'react',\n  'vitest',\n];",
        },
      ];

      await provider.postInlineComments(findings);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.threadContext.rightFileStart).toEqual({ line: 5, offset: 1 });
      expect(body.threadContext.rightFileEnd).toEqual({ line: 13, offset: 1 });
    });

    it("falls back to line when endLine is null", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse({}));

      const findings: Finding[] = [
        {
          file: "src/index.ts",
          line: 42,
          endLine: null,
          severity: "warning",
          category: "bugs",
          message: "issue",
          suggestedFix: null,
        },
      ];

      await provider.postInlineComments(findings);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.threadContext.rightFileStart).toEqual({ line: 42, offset: 1 });
      expect(body.threadContext.rightFileEnd).toEqual({ line: 43, offset: 1 });
    });

    it("anchors single-line suggestion so the full line is replaced, not inserted", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse({}));

      await provider.postInlineComments([
        {
          file: "pyproject.toml",
          line: 58,
          endLine: null,
          severity: "warning",
          category: "security",
          message: "wildcard version pinning",
          suggestedFix: 'cryptography = "^43.0.3"',
        },
      ]);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const { rightFileStart, rightFileEnd } = body.threadContext;
      // a zero-width range (start == end) makes ado insert the suggestion at col 1
      // instead of replacing the line, concatenating the fix with the original content
      expect(rightFileStart).not.toEqual(rightFileEnd);
      expect(rightFileEnd.line).toBeGreaterThan(rightFileStart.line);
    });

    it("skips API call when findings array is empty", async () => {
      await provider.postInlineComments([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("prepends leading slash to file paths", async () => {
      fetchSpy.mockResolvedValue(mockFetchResponse({}));

      await provider.postInlineComments([
        {
          file: "deep/nested/file.ts",
          line: 1,
          endLine: null,
          severity: "warning",
          category: "bugs",
          message: "bug",
          suggestedFix: null,
        },
      ]);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.threadContext.filePath).toBe("/deep/nested/file.ts");
    });
  });

  describe("deleteExistingBotComments", () => {
    it("closes only threads containing the bot marker", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          value: [
            {
              id: 1,
              comments: [{ id: 1, content: "<!-- rusty-bot-review -->\nold review" }],
              status: 1,
            },
            { id: 2, comments: [{ id: 2, content: "human comment" }], status: 1 },
            {
              id: 3,
              comments: [{ id: 3, content: "another <!-- rusty-bot-review --> comment" }],
              status: 1,
            },
          ],
        }),
      );

      // patch responses
      fetchSpy.mockResolvedValue(mockFetchResponse({}));

      await provider.deleteExistingBotComments();

      const patchCalls = fetchSpy.mock.calls.filter(
        (args: unknown[]) => (args[1] as RequestInit)?.method === "PATCH",
      );

      expect(patchCalls).toHaveLength(2);
      expect(patchCalls[0][0]).toContain("/threads/1?");
      expect(patchCalls[1][0]).toContain("/threads/3?");

      const patchBody = JSON.parse(patchCalls[0][1].body);
      expect(patchBody.status).toBe(4);
    });

    it("does nothing when there are no bot threads", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          value: [{ id: 1, comments: [{ id: 1, content: "normal comment" }], status: 1 }],
        }),
      );

      await provider.deleteExistingBotComments();

      const patchCalls = fetchSpy.mock.calls.filter(
        (args: unknown[]) => (args[1] as RequestInit)?.method === "PATCH",
      );
      expect(patchCalls).toHaveLength(0);
    });

    it("handles threads with empty comments array", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          value: [
            { id: 1, comments: [], status: 1 },
            {
              id: 2,
              comments: [{ id: 1, content: "<!-- rusty-bot-review -->\nreview" }],
              status: 1,
            },
          ],
        }),
      );

      fetchSpy.mockResolvedValue(mockFetchResponse({}));

      await provider.deleteExistingBotComments();

      const patchCalls = fetchSpy.mock.calls.filter(
        (args: unknown[]) => (args[1] as RequestInit)?.method === "PATCH",
      );
      expect(patchCalls).toHaveLength(1);
      expect(patchCalls[0][0]).toContain("/threads/2?");
    });

    it("handles empty thread list", async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ value: [] }));

      await provider.deleteExistingBotComments();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("handles threads with missing status field", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          value: [
            {
              id: 1,
              comments: [{ id: 1, content: "<!-- rusty-bot-review -->\nold" }],
            },
            { id: 2, comments: [{ id: 2, content: "system thread" }] },
          ],
        }),
      );

      fetchSpy.mockResolvedValue(mockFetchResponse({}));

      await provider.deleteExistingBotComments();

      const patchCalls = fetchSpy.mock.calls.filter(
        (args: unknown[]) => (args[1] as RequestInit)?.method === "PATCH",
      );
      expect(patchCalls).toHaveLength(1);
      expect(patchCalls[0][0]).toContain("/threads/1?");
    });
  });

  describe("getLinkedWorkItemIds", () => {
    it("returns work item ids from the PR work items endpoint", async () => {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          value: [
            { id: "9952", url: "https://dev.azure.com/org/proj/_apis/wit/workItems/9952" },
            { id: "1001", url: "https://dev.azure.com/org/proj/_apis/wit/workItems/1001" },
          ],
        }),
      );

      const ids = await provider.getLinkedWorkItemIds();

      expect(ids).toEqual(["9952", "1001"]);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE_URL}/pullRequests/${PULL_REQUEST_ID}/workitems?${API_VERSION}`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          }),
        }),
      );
    });

    it("returns empty array when no work items are linked", async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ value: [] }));

      const ids = await provider.getLinkedWorkItemIds();
      expect(ids).toEqual([]);
    });

    it("throws on API error", async () => {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ message: "forbidden" }, false, 403));

      await expect(provider.getLinkedWorkItemIds()).rejects.toThrow("Azure DevOps API error 403");
    });
  });

  describe("getDiff", () => {
    function mockPRAndIterations() {
      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          pullRequestId: 42,
          title: "feat: stuff",
          description: "",
          createdBy: { displayName: "User", uniqueName: "u@e.com" },
          sourceRefName: "refs/heads/feature",
          targetRefName: "refs/heads/main",
          repository: { webUrl: "" },
        }),
      );
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ value: [{ id: 1 }] }));
    }

    it("skips change entries where item.path is null", async () => {
      mockPRAndIterations();

      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          changeEntries: [
            { changeType: "edit", item: { path: "/src/real.ts", gitObjectType: "blob" } },
            { changeType: "edit", item: { path: null, gitObjectType: "blob" } },
          ],
        }),
      );

      // file content fetches for the one valid entry
      fetchSpy.mockResolvedValueOnce(mockFetchResponse("const a = 1;", true));
      fetchSpy.mockResolvedValueOnce(mockFetchResponse("const a = 2;", true));

      const patches = await provider.getDiff();

      const paths = patches.map((p) => p.path);
      expect(paths).not.toContain(null);
      expect(paths).toContain("src/real.ts");
    });

    it("handles response where all entries have null paths", async () => {
      mockPRAndIterations();

      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          changeEntries: [
            { changeType: "edit", item: { path: null } },
            { changeType: "add", item: { path: null } },
          ],
        }),
      );

      const patches = await provider.getDiff();
      expect(patches).toEqual([]);
    });

    it("skips entries where item itself is null", async () => {
      mockPRAndIterations();

      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          changeEntries: [
            { changeType: "sourceRename", item: null },
            { changeType: "edit", item: { path: "/src/valid.ts", gitObjectType: "blob" } },
          ],
        }),
      );

      fetchSpy.mockResolvedValueOnce(mockFetchResponse("new", true));
      fetchSpy.mockResolvedValueOnce(mockFetchResponse("old", true));

      const patches = await provider.getDiff();
      expect(patches).toHaveLength(1);
      expect(patches[0].path).toBe("src/valid.ts");
    });

    it("skips sourceRename entries", async () => {
      mockPRAndIterations();

      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          changeEntries: [
            { changeType: "sourceRename", item: { path: "/old/name.ts", gitObjectType: "blob" } },
            {
              changeType: "rename",
              item: { path: "/new/name.ts", gitObjectType: "blob" },
              originalPath: "/old/name.ts",
            },
          ],
        }),
      );

      // rename entry fetches: new content at new path, old content at original path
      fetchSpy.mockResolvedValueOnce(mockFetchResponse("renamed content", true));
      fetchSpy.mockResolvedValueOnce(mockFetchResponse("original content", true));

      const patches = await provider.getDiff();
      expect(patches).toHaveLength(1);
      expect(patches[0].path).toBe("new/name.ts");
    });

    it("fetches old content from originalPath for renames", async () => {
      mockPRAndIterations();

      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          changeEntries: [
            {
              changeType: "rename, edit",
              item: { path: "/src/renamed.ts", gitObjectType: "blob" },
              originalPath: "/src/original.ts",
            },
          ],
        }),
      );

      fetchSpy.mockResolvedValueOnce(mockFetchResponse("new code", true));
      fetchSpy.mockResolvedValueOnce(mockFetchResponse("old code", true));

      await provider.getDiff();

      // 3rd fetch = changes, 4th = new content at new path, 5th = old content at original path
      const oldContentUrl = decodeURIComponent(fetchSpy.mock.calls[4][0] as string);
      expect(oldContentUrl).toContain("src/original.ts");
      expect(oldContentUrl).not.toContain("src/renamed.ts");
    });
  });

  describe("constructor", () => {
    it("strips trailing slash from orgUrl", async () => {
      const p = new AzureDevOpsProvider({
        orgUrl: "https://dev.azure.com/org/",
        project: PROJECT,
        repoName: REPO_NAME,
        pullRequestId: PULL_REQUEST_ID,
        accessToken: ACCESS_TOKEN,
      });

      fetchSpy.mockResolvedValueOnce(
        mockFetchResponse({
          value: [],
        }),
      );

      await p.deleteExistingBotComments();

      expect(
        (fetchSpy.mock.calls[0][0] as string).startsWith("https://dev.azure.com/org/test-project"),
      ).toBe(true);
    });
  });
});

describe("CLI config parsing", () => {
  const REQUIRED_ENV = {
    SYSTEM_PULLREQUEST_PULLREQUESTID: "42",
    SYSTEM_TEAMFOUNDATIONCOLLECTIONURI: "https://dev.azure.com/org",
    SYSTEM_TEAMPROJECT: "proj",
    BUILD_REPOSITORY_NAME: "repo",
    SYSTEM_ACCESSTOKEN: "token",
  };

  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function importParseConfig() {
    // re-import to get the function fresh
    const mod = await import("../cli.js");
    return mod.parseConfig;
  }

  it("throws when required env vars are missing", async () => {
    process.env = { ...originalEnv };
    delete process.env.SYSTEM_PULLREQUEST_PULLREQUESTID;
    delete process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI;
    delete process.env.SYSTEM_TEAMPROJECT;
    delete process.env.BUILD_REPOSITORY_NAME;
    delete process.env.SYSTEM_ACCESSTOKEN;

    const parseConfig = await importParseConfig();
    expect(() => parseConfig()).toThrow("missing required env vars");
  });

  it("throws when a single required env var is missing", async () => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    delete process.env.SYSTEM_ACCESSTOKEN;

    const parseConfig = await importParseConfig();
    expect(() => parseConfig()).toThrow("SYSTEM_ACCESSTOKEN");
  });

  it("parses valid config from env vars", async () => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
      RUSTY_REVIEW_STYLE: "strict",
      RUSTY_FOCUS_AREAS: "security,performance",
      RUSTY_IGNORE_PATTERNS: "*.lock,dist/**",
    };

    const parseConfig = await importParseConfig();
    const { config, failOnCritical } = parseConfig();

    expect(config.style).toBe("strict");
    expect(config.focusAreas).toEqual(["security", "performance"]);
    expect(config.ignorePatterns).toEqual(["*.lock", "dist/**"]);
    expect(failOnCritical).toBe(true);
  });

  it("uses defaults when optional env vars are absent", async () => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };

    const parseConfig = await importParseConfig();
    const { config, failOnCritical } = parseConfig();

    expect(config.style).toBe("balanced");
    expect(config.focusAreas).toEqual([]);
    expect(config.ignorePatterns).toEqual([]);
    expect(failOnCritical).toBe(true);
  });

  it("respects RUSTY_FAIL_ON_CRITICAL=false", async () => {
    process.env = { ...originalEnv, ...REQUIRED_ENV, RUSTY_FAIL_ON_CRITICAL: "false" };

    const parseConfig = await importParseConfig();
    const { failOnCritical } = parseConfig();

    expect(failOnCritical).toBe(false);
  });

  it("treats any non-false value of RUSTY_FAIL_ON_CRITICAL as true", async () => {
    process.env = { ...originalEnv, ...REQUIRED_ENV, RUSTY_FAIL_ON_CRITICAL: "no" };

    const parseConfig = await importParseConfig();
    const { failOnCritical } = parseConfig();

    expect(failOnCritical).toBe(true);
  });

  it("throws on invalid review style", async () => {
    process.env = { ...originalEnv, ...REQUIRED_ENV, RUSTY_REVIEW_STYLE: "invalid" };

    const parseConfig = await importParseConfig();
    expect(() => parseConfig()).toThrow("invalid review style: invalid");
  });

  it("filters empty strings from comma-separated lists", async () => {
    process.env = {
      ...originalEnv,
      ...REQUIRED_ENV,
      RUSTY_FOCUS_AREAS: "security,,performance,",
      RUSTY_IGNORE_PATTERNS: ",*.lock,,",
    };

    const parseConfig = await importParseConfig();
    const { config } = parseConfig();

    expect(config.focusAreas).toEqual(["security", "performance"]);
    expect(config.ignorePatterns).toEqual(["*.lock"]);
  });
});
