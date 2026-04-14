import type { TicketInfo, TicketProvider } from "../../types.js";
import { LinearResponseSchema } from "../schemas.js";

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

    const parsed = LinearResponseSchema.safeParse(await res.json());
    if (!parsed.success) return null;

    const issue = isIdentifier ? parsed.data.data?.issueByIdentifier : parsed.data.data?.issue;

    if (!issue) return null;

    return {
      id: issue.identifier ?? ref,
      title: issue.title ?? "",
      description: (issue.description ?? "").slice(0, MAX_DESC_LENGTH),
      labels: (issue.labels?.nodes ?? []).map((l) => l.name ?? ""),
      source: "linear",
    };
  }
}
