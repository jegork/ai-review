import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractTicketRefs } from "../tickets/extract.js";
import { resolveTickets, resolveTicketsWithStatus } from "../tickets/resolve.js";
import { logger } from "../logger.js";
import { GitHubTicketProvider } from "../tickets/providers/github.js";
import { JiraTicketProvider, extractAdfText } from "../tickets/providers/jira.js";
import { LinearTicketProvider } from "../tickets/providers/linear.js";
import { AzureDevOpsTicketProvider } from "../tickets/providers/azure-devops.js";
import type { TicketProvider, TicketRef } from "../types.js";

describe("extractTicketRefs", () => {
  describe("github refs", () => {
    it("extracts bare #123", () => {
      const refs = extractTicketRefs("fixes #42", "main");
      expect(refs).toContainEqual({ id: "42", source: "github" });
    });

    it("extracts owner/repo#123", () => {
      const refs = extractTicketRefs("see acme/widgets#99", "main");
      expect(refs).toContainEqual({
        id: "acme/widgets#99",
        source: "github",
      });
    });

    it("extracts full github issue URL", () => {
      const refs = extractTicketRefs("https://github.com/acme/widgets/issues/55", "main");
      expect(refs).toContainEqual(
        expect.objectContaining({
          id: "acme/widgets#55",
          source: "github",
          url: "https://github.com/acme/widgets/issues/55",
        }),
      );
    });

    it("does not double-count github URL and extracted #number", () => {
      const refs = extractTicketRefs("https://github.com/a/b/issues/1", "main");
      const githubRefs = refs.filter((r) => r.source === "github");
      expect(githubRefs).toHaveLength(1);
    });
  });

  describe("jira refs", () => {
    it("extracts PROJ-123 pattern", () => {
      const refs = extractTicketRefs("implements PROJ-123", "main");
      expect(refs).toContainEqual({ id: "PROJ-123", source: "jira" });
    });

    it("extracts jira URL", () => {
      const refs = extractTicketRefs(
        "https://mycompany.atlassian.jira.net/browse/PROJ-456",
        "main",
      );
      expect(refs).toContainEqual(expect.objectContaining({ id: "PROJ-456", source: "jira" }));
    });

    it("handles 2-letter project keys", () => {
      const refs = extractTicketRefs("AB-1", "main");
      expect(refs).toContainEqual({ id: "AB-1", source: "jira" });
    });

    it("handles 10-letter project keys", () => {
      const refs = extractTicketRefs("ABCDEFGHIJ-999", "main");
      expect(refs).toContainEqual({ id: "ABCDEFGHIJ-999", source: "jira" });
    });

    it("rejects 1-letter project keys", () => {
      const refs = extractTicketRefs("A-1", "main");
      expect(refs.find((r) => r.id === "A-1")).toBeUndefined();
    });

    it("rejects 11-letter project keys", () => {
      const refs = extractTicketRefs("ABCDEFGHIJK-1", "main");
      expect(refs.find((r) => r.id === "ABCDEFGHIJK-1")).toBeUndefined();
    });
  });

  describe("linear refs", () => {
    it("extracts linear URL and marks as linear", () => {
      const refs = extractTicketRefs(
        "https://linear.app/myteam/issue/TEAM-42 is the ticket",
        "main",
      );
      expect(refs).toContainEqual(expect.objectContaining({ id: "TEAM-42", source: "linear" }));
    });

    it("does not duplicate PROJ-123 when linear URL provides it", () => {
      const refs = extractTicketRefs("https://linear.app/t/issue/ENG-10", "main");
      const engRefs = refs.filter((r) => r.id === "ENG-10");
      expect(engRefs).toHaveLength(1);
      expect(engRefs[0].source).toBe("linear");
    });
  });

  describe("azure devops refs", () => {
    it("extracts AB#123", () => {
      const refs = extractTicketRefs("linked to AB#777", "main");
      expect(refs).toContainEqual({ id: "777", source: "azure-devops" });
    });

    it("extracts azure devops URL", () => {
      const refs = extractTicketRefs(
        "https://dev.azure.com/myorg/myproj/_workitems/edit/321",
        "main",
      );
      expect(refs).toContainEqual(expect.objectContaining({ id: "321", source: "azure-devops" }));
    });
  });

  describe("branch name extraction", () => {
    it("extracts github-style feature/123-desc", () => {
      const refs = extractTicketRefs("", "feature/123-add-login");
      expect(refs).toContainEqual({ id: "123", source: "github" });
    });

    it("extracts jira-style fix/PROJ-123-title", () => {
      const refs = extractTicketRefs("", "fix/PROJ-123-title");
      expect(refs).toContainEqual({ id: "PROJ-123", source: "jira" });
    });

    it("extracts azure-devops AB#123 from branch", () => {
      const refs = extractTicketRefs("", "bugfix/AB#123");
      expect(refs).toContainEqual({ id: "123", source: "azure-devops" });
    });

    it("does not extract from branch if no pattern matches", () => {
      const refs = extractTicketRefs("", "main");
      expect(refs).toHaveLength(0);
    });
  });

  describe("multiple and mixed refs", () => {
    it("extracts multiple refs from one description", () => {
      const refs = extractTicketRefs("fixes #1, #2, and PROJ-99", "main");
      expect(refs.length).toBeGreaterThanOrEqual(3);
    });

    it("handles mixed sources", () => {
      const refs = extractTicketRefs("see #10 and AB#20 and PROJ-30", "main");
      const sources = new Set(refs.map((r) => r.source));
      expect(sources).toContain("github");
      expect(sources).toContain("azure-devops");
      expect(sources).toContain("jira");
    });
  });

  describe("no refs", () => {
    it("returns empty for plain text", () => {
      expect(extractTicketRefs("just a normal description", "main")).toEqual([]);
    });

    it("returns empty for empty inputs", () => {
      expect(extractTicketRefs("", "")).toEqual([]);
    });
  });

  describe("deduplication", () => {
    it("deduplicates same ref from description and branch", () => {
      const refs = extractTicketRefs("PROJ-123", "fix/PROJ-123-stuff");
      const projRefs = refs.filter((r) => r.id === "PROJ-123");
      expect(projRefs).toHaveLength(1);
    });

    it("deduplicates same github ref appearing twice", () => {
      const refs = extractTicketRefs("#5 and also #5", "main");
      const fiveRefs = refs.filter((r) => r.id === "5" && r.source === "github");
      expect(fiveRefs).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("extracts refs inside markdown links", () => {
      const refs = extractTicketRefs("[ticket](#123)", "main");
      expect(refs).toContainEqual({ id: "123", source: "github" });
    });

    it("extracts refs in code blocks", () => {
      const refs = extractTicketRefs("```\nfixes PROJ-1\n```", "main");
      expect(refs).toContainEqual({ id: "PROJ-1", source: "jira" });
    });

    it("handles refs at start and end of string", () => {
      const refs = extractTicketRefs("#1 at start and AB#2", "main");
      expect(refs).toContainEqual({ id: "1", source: "github" });
      expect(refs).toContainEqual({ id: "2", source: "azure-devops" });
    });

    it("does not match html entities like &#123;", () => {
      const refs = extractTicketRefs("use &#123; for braces", "main");
      expect(refs.find((r) => r.id === "123" && r.source === "github")).toBeUndefined();
    });
  });
});

describe("resolveTickets", () => {
  it("fetches up to 3 tickets", async () => {
    const mockProvider: TicketProvider = {
      fetchTicket: vi.fn().mockResolvedValue({
        id: "1",
        title: "test",
        description: "",
        labels: [],
        source: "github",
      }),
    };
    const providers = new Map([["github", mockProvider]]);
    const refs: TicketRef[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      source: "github" as const,
    }));

    const result = await resolveTickets(refs, providers);
    expect(result).toHaveLength(3);
    expect(mockProvider.fetchTicket).toHaveBeenCalledTimes(3);
  });

  it("skips refs with no matching provider", async () => {
    const providers = new Map<string, TicketProvider>();
    const refs: TicketRef[] = [{ id: "1", source: "jira" }];

    const result = await resolveTickets(refs, providers);
    expect(result).toHaveLength(0);
  });

  it("catches errors and continues", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(vi.fn());
    const mockProvider: TicketProvider = {
      fetchTicket: vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValueOnce({
        id: "2",
        title: "ok",
        description: "",
        labels: [],
        source: "github",
      }),
    };
    const providers = new Map([["github", mockProvider]]);
    const refs: TicketRef[] = [
      { id: "1", source: "github" },
      { id: "2", source: "github" },
    ];

    const result = await resolveTickets(refs, providers);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips null results from provider", async () => {
    const mockProvider: TicketProvider = {
      fetchTicket: vi.fn().mockResolvedValue(null),
    };
    const providers = new Map([["github", mockProvider]]);
    const refs: TicketRef[] = [{ id: "1", source: "github" }];

    const result = await resolveTickets(refs, providers);
    expect(result).toHaveLength(0);
  });

  it("returns fetch status metadata alongside resolved tickets", async () => {
    const mockProvider: TicketProvider = {
      fetchTicket: vi
        .fn()
        .mockResolvedValueOnce({
          id: "1",
          title: "ok",
          description: "",
          labels: [],
          source: "github",
        })
        .mockResolvedValueOnce(null),
    };
    const providers = new Map([["github", mockProvider]]);
    const refs: TicketRef[] = [
      { id: "1", source: "github" },
      { id: "2", source: "github" },
      { id: "3", source: "jira" },
    ];

    const result = await resolveTicketsWithStatus(refs, providers);

    expect(result.tickets).toHaveLength(1);
    expect(result.status).toEqual({
      totalRefsFound: 3,
      refsConsidered: 3,
      refsSkippedByLimit: 0,
      fetched: 1,
      consideredMissingProvider: 1,
      consideredFetchFailed: 1,
    });
  });

  it("reports refsSkippedByLimit when refs exceed MAX_TICKETS", async () => {
    const mockProvider: TicketProvider = {
      fetchTicket: vi.fn().mockResolvedValue({
        id: "1",
        title: "ok",
        description: "",
        labels: [],
        source: "github",
      }),
    };
    const providers = new Map([["github", mockProvider]]);
    const refs: TicketRef[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      source: "github" as const,
    }));

    const result = await resolveTicketsWithStatus(refs, providers);

    expect(result.status.totalRefsFound).toBe(5);
    expect(result.status.refsConsidered).toBe(3);
    expect(result.status.refsSkippedByLimit).toBe(2);
    expect(result.status.fetched).toBe(3);
  });
});

describe("provider normalization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GitHubTicketProvider", () => {
    it("normalizes github API response", async () => {
      const provider = new GitHubTicketProvider({
        token: "tok",
        owner: "o",
        repo: "r",
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 42,
            title: "Bug fix",
            body: "details here",
            labels: [{ name: "bug" }, { name: "urgent" }],
          }),
          { status: 200 },
        ),
      );

      const result = await provider.fetchTicket("42");
      expect(result).toEqual({
        id: "42",
        title: "Bug fix",
        description: "details here",
        labels: ["bug", "urgent"],
        source: "github",
      });
    });

    it("returns null on 404", async () => {
      const provider = new GitHubTicketProvider({
        token: "tok",
        owner: "o",
        repo: "r",
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 404 }));

      expect(await provider.fetchTicket("999")).toBeNull();
    });

    it("truncates long description", async () => {
      const provider = new GitHubTicketProvider({
        token: "t",
        owner: "o",
        repo: "r",
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 1,
            title: "t",
            body: "x".repeat(20_000),
            labels: [],
          }),
          { status: 200 },
        ),
      );

      const result = await provider.fetchTicket("1");
      expect(result!.description.length).toBe(10_000);
    });
  });

  describe("JiraTicketProvider", () => {
    it("normalizes jira response with string description", async () => {
      const provider = new JiraTicketProvider({
        baseUrl: "https://j.example.com",
        email: "a@b.com",
        apiToken: "tok",
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            key: "PROJ-1",
            fields: {
              summary: "Fix login",
              description: "plain text desc",
              labels: ["backend"],
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.fetchTicket("PROJ-1");
      expect(result).toEqual({
        id: "PROJ-1",
        title: "Fix login",
        description: "plain text desc",
        labels: ["backend"],
        source: "jira",
      });
    });

    it("extracts text from ADF description", async () => {
      const provider = new JiraTicketProvider({
        baseUrl: "https://j.example.com",
        email: "a@b.com",
        apiToken: "tok",
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            key: "PROJ-2",
            fields: {
              summary: "ADF test",
              description: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "hello " },
                      { type: "text", text: "world" },
                    ],
                  },
                ],
              },
              labels: [],
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.fetchTicket("PROJ-2");
      expect(result!.description).toBe("hello world");
    });
  });

  describe("extractAdfText", () => {
    it("handles null/undefined", () => {
      expect(extractAdfText(null)).toBe("");
      expect(extractAdfText(undefined)).toBe("");
    });

    it("handles deeply nested content", () => {
      const adf = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "deep" }],
              },
            ],
          },
        ],
      };
      expect(extractAdfText(adf)).toBe("deep");
    });
  });

  describe("LinearTicketProvider", () => {
    it("uses issueByIdentifier for TEAM-123 refs", async () => {
      const provider = new LinearTicketProvider({ apiKey: "key" });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              issueByIdentifier: {
                identifier: "ENG-5",
                title: "Linear issue",
                description: "desc",
                labels: { nodes: [{ name: "feature" }] },
              },
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.fetchTicket("ENG-5");
      expect(result).toEqual({
        id: "ENG-5",
        title: "Linear issue",
        description: "desc",
        labels: ["feature"],
        source: "linear",
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.query).toContain("issueByIdentifier");
    });

    it("uses issue(id:) for UUID-style refs", async () => {
      const provider = new LinearTicketProvider({ apiKey: "key" });

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              issue: {
                identifier: "ENG-5",
                title: "t",
                description: "",
                labels: { nodes: [] },
              },
            },
          }),
          { status: 200 },
        ),
      );

      await provider.fetchTicket("some-uuid");
      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.query).toContain("issue(id:");
    });
  });

  describe("AzureDevOpsTicketProvider", () => {
    it("normalizes azure devops response with tags", async () => {
      const provider = new AzureDevOpsTicketProvider({
        orgUrl: "https://dev.azure.com/org",
        project: "proj",
        pat: "pat",
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 100,
            fields: {
              "System.Title": "ADO item",
              "System.Description": "<p>html desc</p>",
              "System.Tags": "backend; frontend; urgent",
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.fetchTicket("100");
      expect(result).toEqual({
        id: "100",
        title: "ADO item",
        description: "<p>html desc</p>",
        labels: ["backend", "frontend", "urgent"],
        source: "azure-devops",
      });
    });

    it("handles missing tags gracefully", async () => {
      const provider = new AzureDevOpsTicketProvider({
        orgUrl: "https://dev.azure.com/org",
        project: "proj",
        pat: "pat",
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 101,
            fields: {
              "System.Title": "No tags",
              "System.Description": "",
            },
          }),
          { status: 200 },
        ),
      );

      const result = await provider.fetchTicket("101");
      expect(result!.labels).toEqual([]);
    });
  });
});
