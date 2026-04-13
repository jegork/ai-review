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
          severity: "critical",
          category: "security",
          message: "SQL injection risk",
          suggestedFix: "use parameterized queries",
        },
        {
          file: "src/utils.ts",
          line: 25,
          severity: "suggestion",
          category: "style",
          message: "prefer const",
        },
      ];

      await provider.postInlineComments(findings);

      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const firstBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(firstBody.threadContext.filePath).toBe("/src/index.ts");
      expect(firstBody.threadContext.rightFileStart).toEqual({ line: 10, offset: 1 });
      expect(firstBody.threadContext.rightFileEnd).toEqual({ line: 10, offset: 1 });
      expect(firstBody.comments[0].content).toContain("<!-- rusty-bot-review -->");
      expect(firstBody.comments[0].content).toContain("SQL injection risk");
      expect(firstBody.comments[0].content).toContain("**Suggested fix:**");

      const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(secondBody.threadContext.filePath).toBe("/src/utils.ts");
      expect(secondBody.threadContext.rightFileStart.line).toBe(25);
      expect(secondBody.comments[0].content).not.toContain("**Suggested fix:**");
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
          severity: "warning",
          category: "bugs",
          message: "bug",
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
