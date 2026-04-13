import type { TicketInfo, TicketProvider } from "../../types.js";

const MAX_DESC_LENGTH = 10_000;
const LINEAR_API = "https://api.linear.app/graphql";

interface LinearTicketProviderConfig {
  apiKey: string;
}

export class LinearTicketProvider implements TicketProvider {
  private config: LinearTicketProviderConfig;

  constructor(config: LinearTicketProviderConfig) {
    this.config = config;
  }

  async fetchTicket(ref: string): Promise<TicketInfo | null> {
    // if ref looks like TEAM-123, use issueByIdentifier; otherwise use issue(id:)
    const isIdentifier = /^[A-Z]{2,10}-\d+$/.test(ref);

    const query = isIdentifier
      ? `query { issueByIdentifier(id: "${ref}") { identifier title description labels { nodes { name } } } }`
      : `query { issue(id: "${ref}") { identifier title description labels { nodes { name } } } }`;

    const res = await fetch(LINEAR_API, {
      method: "POST",
      headers: {
        Authorization: this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as Record<string, Record<string, unknown>>;
    const issue = isIdentifier
      ? json.data?.issueByIdentifier
      : json.data?.issue;

    if (!issue || typeof issue !== "object") return null;

    const data = issue as Record<string, unknown>;
    const labels = data.labels as { nodes?: Array<{ name?: string }> } | undefined;

    return {
      id: (data.identifier as string) ?? ref,
      title: (data.title as string) ?? "",
      description: ((data.description as string) ?? "").slice(0, MAX_DESC_LENGTH),
      labels: (labels?.nodes ?? []).map((l) => l.name ?? ""),
      source: "linear",
    };
  }
}
