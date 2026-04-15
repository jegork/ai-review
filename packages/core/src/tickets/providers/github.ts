import type { TicketInfo, TicketProvider } from "../../types.js";
import { GitHubIssueSchema } from "../schemas.js";

const MAX_DESC_LENGTH = 10_000;

export type IssueFetcher = (owner: string, repo: string, issueNumber: number) => Promise<unknown>;

export type GitHubTicketProviderConfig = {
  owner: string;
  repo: string;
} & ({ token: string } | { issueFetcher: IssueFetcher });

export class GitHubTicketProvider implements TicketProvider {
  private readonly owner: string;
  private readonly repo: string;
  private readonly fetcher: IssueFetcher;

  constructor(config: GitHubTicketProviderConfig) {
    this.owner = config.owner;
    this.repo = config.repo;

    if ("issueFetcher" in config) {
      this.fetcher = config.issueFetcher;
    } else {
      const token = config.token;
      this.fetcher = async (owner, repo, issueNumber) => {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        });
        if (!res.ok) return null;
        return res.json();
      };
    }
  }

  async fetchTicket(ref: string): Promise<TicketInfo | null> {
    const number = ref.includes("#") ? ref.split("#").pop() : ref;

    let raw: unknown;
    try {
      raw = await this.fetcher(this.owner, this.repo, Number(number));
    } catch {
      return null;
    }
    if (raw == null) return null;

    const parsed = GitHubIssueSchema.safeParse(raw);
    if (!parsed.success) return null;

    const data = parsed.data;
    return {
      id: String(data.number),
      title: data.title,
      description: (data.body ?? "").slice(0, MAX_DESC_LENGTH),
      labels: data.labels.map((l) => l.name ?? ""),
      source: "github",
    };
  }
}
