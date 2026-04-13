import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubProvider } from "../provider.js";
import type { Octokit } from "octokit";
import type { Finding } from "@rusty-bot/core";

function createMockOctokit() {
  return {
    request: vi.fn(),
  } as unknown as Octokit & { request: ReturnType<typeof vi.fn> };
}

const OWNER = "test-owner";
const REPO = "test-repo";
const PULL_NUMBER = 42;

describe("GitHubProvider", () => {
  let octokit: ReturnType<typeof createMockOctokit>;
  let provider: GitHubProvider;

  beforeEach(() => {
    octokit = createMockOctokit();
    provider = new GitHubProvider({
      octokit,
      owner: OWNER,
      repo: REPO,
      pullNumber: PULL_NUMBER,
    });
  });

  describe("getPRMetadata", () => {
    it("maps github response to PRMetadata", async () => {
      octokit.request.mockResolvedValueOnce({
        data: {
          number: 42,
          title: "feat: add feature",
          body: "some description",
          user: { login: "octocat" },
          head: { ref: "feature-branch" },
          base: { ref: "main" },
          html_url: "https://github.com/test-owner/test-repo/pull/42",
        },
      });

      const metadata = await provider.getPRMetadata();

      expect(metadata).toEqual({
        id: "42",
        title: "feat: add feature",
        description: "some description",
        author: "octocat",
        sourceBranch: "feature-branch",
        targetBranch: "main",
        url: "https://github.com/test-owner/test-repo/pull/42",
      });

      expect(octokit.request).toHaveBeenCalledWith(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        expect.objectContaining({
          owner: OWNER,
          repo: REPO,
          pull_number: PULL_NUMBER,
        }),
      );
    });

    it("handles null body and missing user", async () => {
      octokit.request.mockResolvedValueOnce({
        data: {
          number: 1,
          title: "pr",
          body: null,
          user: null,
          head: { ref: "src" },
          base: { ref: "dst" },
          html_url: "https://example.com",
        },
      });

      const metadata = await provider.getPRMetadata();

      expect(metadata.description).toBe("");
      expect(metadata.author).toBe("");
    });
  });

  describe("postSummaryComment", () => {
    it("posts comment with bot marker prepended", async () => {
      octokit.request.mockResolvedValueOnce({ data: {} });

      await provider.postSummaryComment("## Review\nLooks good!");

      expect(octokit.request).toHaveBeenCalledWith(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        expect.objectContaining({
          owner: OWNER,
          repo: REPO,
          issue_number: PULL_NUMBER,
          body: "<!-- rusty-bot-review -->\n## Review\nLooks good!",
        }),
      );
    });
  });

  describe("deleteExistingBotComments", () => {
    it("deletes only comments containing the bot marker", async () => {
      octokit.request.mockImplementation(async (route: string) => {
        if (route.startsWith("GET")) {
          return {
            data: [
              { id: 1, body: "<!-- rusty-bot-review -->\nold review" },
              { id: 2, body: "human comment" },
              { id: 3, body: "another <!-- rusty-bot-review --> comment" },
            ],
          };
        }
        return { data: {} };
      });

      await provider.deleteExistingBotComments();

      const deleteCalls = octokit.request.mock.calls.filter(
        (args: unknown[]) => typeof args[0] === "string" && args[0].startsWith("DELETE"),
      );

      expect(deleteCalls).toHaveLength(2);
      expect(deleteCalls[0][1]).toMatchObject({ comment_id: 1 });
      expect(deleteCalls[1][1]).toMatchObject({ comment_id: 3 });
    });

    it("does nothing when there are no bot comments", async () => {
      octokit.request.mockResolvedValueOnce({
        data: [{ id: 1, body: "normal comment" }],
      });

      await provider.deleteExistingBotComments();

      const deleteCalls = octokit.request.mock.calls.filter(
        (args: unknown[]) => typeof args[0] === "string" && args[0].startsWith("DELETE"),
      );
      expect(deleteCalls).toHaveLength(0);
    });

    it("handles comments with undefined body", async () => {
      octokit.request.mockResolvedValueOnce({
        data: [
          { id: 1, body: undefined },
          { id: 2, body: "<!-- rusty-bot-review -->\nreview" },
        ],
      });

      await provider.deleteExistingBotComments();

      const deleteCalls = octokit.request.mock.calls.filter(
        (args: unknown[]) => typeof args[0] === "string" && args[0].startsWith("DELETE"),
      );
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][1]).toMatchObject({ comment_id: 2 });
    });
  });

  describe("postInlineComments", () => {
    it("creates a review with mapped comments", async () => {
      octokit.request.mockResolvedValueOnce({ data: {} });

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

      expect(octokit.request).toHaveBeenCalledWith(
        "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
        expect.objectContaining({
          owner: OWNER,
          repo: REPO,
          pull_number: PULL_NUMBER,
          event: "COMMENT",
          body: "",
          comments: expect.arrayContaining([
            expect.objectContaining({
              path: "src/index.ts",
              line: 10,
              side: "RIGHT",
            }),
            expect.objectContaining({
              path: "src/utils.ts",
              line: 25,
              side: "RIGHT",
            }),
          ]),
        }),
      );

      const call = octokit.request.mock.calls[0][1];
      expect(call.comments[0].body).toContain("SQL injection risk");
      expect(call.comments[0].body).toContain("**Suggested fix:**");
      expect(call.comments[1].body).not.toContain("**Suggested fix:**");
    });

    it("skips API call when findings array is empty", async () => {
      await provider.postInlineComments([]);

      expect(octokit.request).not.toHaveBeenCalled();
    });
  });

  describe("getDiff", () => {
    it("parses a unified diff into FilePatch objects", async () => {
      const rawDiff = [
        "diff --git a/file.ts b/file.ts",
        "index abc..def 100644",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -1,3 +1,4 @@",
        " line1",
        "-old line",
        "+new line",
        "+added line",
        " line3",
      ].join("\n");

      octokit.request.mockResolvedValueOnce({ data: rawDiff });

      const patches = await provider.getDiff();

      expect(patches).toHaveLength(1);
      expect(patches[0].path).toBe("file.ts");
      expect(patches[0].additions).toBe(2);
      expect(patches[0].deletions).toBe(1);
      expect(patches[0].isBinary).toBe(false);
      expect(patches[0].hunks).toHaveLength(1);
      expect(patches[0].hunks[0].oldStart).toBe(1);
      expect(patches[0].hunks[0].newStart).toBe(1);
      expect(patches[0].hunks[0].newLines).toBe(4);
    });

    it("handles multiple files in a single diff", async () => {
      const rawDiff = [
        "diff --git a/a.ts b/a.ts",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "diff --git a/b.ts b/b.ts",
        "--- a/b.ts",
        "+++ b/b.ts",
        "@@ -1 +1,2 @@",
        " keep",
        "+added",
      ].join("\n");

      octokit.request.mockResolvedValueOnce({ data: rawDiff });

      const patches = await provider.getDiff();

      expect(patches).toHaveLength(2);
      expect(patches[0].path).toBe("a.ts");
      expect(patches[1].path).toBe("b.ts");
      expect(patches[1].additions).toBe(1);
      expect(patches[1].deletions).toBe(0);
    });

    it("marks binary files correctly", async () => {
      const rawDiff = [
        "diff --git a/image.png b/image.png",
        "Binary files /dev/null and b/image.png differ",
      ].join("\n");

      octokit.request.mockResolvedValueOnce({ data: rawDiff });

      const patches = await provider.getDiff();

      expect(patches).toHaveLength(1);
      expect(patches[0].isBinary).toBe(true);
      expect(patches[0].hunks).toHaveLength(0);
    });

    it("handles multiple hunks in one file", async () => {
      const rawDiff = [
        "diff --git a/file.ts b/file.ts",
        "--- a/file.ts",
        "+++ b/file.ts",
        "@@ -1,3 +1,3 @@",
        " a",
        "-b",
        "+c",
        " d",
        "@@ -10,3 +10,4 @@",
        " x",
        " y",
        "+z",
        " w",
      ].join("\n");

      octokit.request.mockResolvedValueOnce({ data: rawDiff });

      const patches = await provider.getDiff();

      expect(patches).toHaveLength(1);
      expect(patches[0].hunks).toHaveLength(2);
      expect(patches[0].hunks[0].oldStart).toBe(1);
      expect(patches[0].hunks[1].oldStart).toBe(10);
      expect(patches[0].hunks[1].newLines).toBe(4);
    });

    it("returns empty array for empty diff", async () => {
      octokit.request.mockResolvedValueOnce({ data: "" });

      const patches = await provider.getDiff();

      expect(patches).toHaveLength(0);
    });
  });
});
