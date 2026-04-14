import type { TicketInfo, TicketProvider } from "../../types.js";
import { GitHubIssueSchema } from "../schemas.js";

const MAX_DESC_LENGTH = 10_000;

interface GitHubTicketProviderConfig {
  token: string;
  owner: string;
  repo: string;
}

export class GitHubTicketProvider implements TicketProvider {
  private config: GitHubTicketProviderConfig;

  constructor(config: GitHubTicketProviderConfig) {
    this.config = config;
  }

  async fetchTicket(ref: string): Promise<TicketInfo | null> {
    const number = ref.includes("#") ? ref.split("#").pop() : ref;
    const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues/${number}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) return null;

    const parsed = GitHubIssueSchema.safeParse(await res.json());
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
