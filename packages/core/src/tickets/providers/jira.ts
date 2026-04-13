import type { TicketInfo, TicketProvider } from "../../types.js";

const MAX_DESC_LENGTH = 10_000;

interface JiraTicketProviderConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

// adf (atlassian document format) can be deeply nested; extract plain text recursively
function extractAdfText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";

  const obj = node as Record<string, unknown>;
  if (obj.type === "text" && typeof obj.text === "string") return obj.text;

  if (Array.isArray(obj.content)) {
    return (obj.content as unknown[]).map(extractAdfText).join("");
  }

  return "";
}

export class JiraTicketProvider implements TicketProvider {
  private config: JiraTicketProviderConfig;

  constructor(config: JiraTicketProviderConfig) {
    this.config = config;
  }

  async fetchTicket(ref: string): Promise<TicketInfo | null> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${ref}`;
    const auth = btoa(`${this.config.email}:${this.config.apiToken}`);

    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const fields = (data.fields as Record<string, unknown>) ?? {};

    let description = "";
    if (typeof fields.description === "string") {
      description = fields.description;
    } else if (fields.description) {
      description = extractAdfText(fields.description);
    }

    return {
      id: (data.key as string) ?? ref,
      title: (fields.summary as string) ?? "",
      description: description.slice(0, MAX_DESC_LENGTH),
      labels: Array.isArray(fields.labels) ? fields.labels : [],
      source: "jira",
    };
  }
}

export { extractAdfText };
