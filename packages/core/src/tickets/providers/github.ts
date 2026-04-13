import type { TicketInfo, TicketProvider } from "../../types.js";

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

    const data = (await res.json()) as Record<string, unknown>;

    return {
      id: String(data.number),
      title: (data.title as string) ?? "",
      description: ((data.body as string) ?? "").slice(0, MAX_DESC_LENGTH),
      labels: ((data.labels as Array<{ name?: string }>) ?? []).map(
        (l) => l.name ?? "",
      ),
      source: "github",
    };
  }
}
