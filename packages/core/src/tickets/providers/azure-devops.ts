import type { TicketInfo, TicketProvider } from "../../types.js";

const MAX_DESC_LENGTH = 10_000;

interface AzureDevOpsTicketProviderConfig {
  orgUrl: string;
  project: string;
  pat: string;
}

export class AzureDevOpsTicketProvider implements TicketProvider {
  private config: AzureDevOpsTicketProviderConfig;

  constructor(config: AzureDevOpsTicketProviderConfig) {
    this.config = config;
  }

  async fetchTicket(ref: string): Promise<TicketInfo | null> {
    const url = `${this.config.orgUrl}/${this.config.project}/_apis/wit/workitems/${ref}?api-version=7.0`;
    const auth = btoa(`:${this.config.pat}`);

    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const fields = (data.fields as Record<string, unknown>) ?? {};

    const tags = fields["System.Tags"];
    const labels =
      typeof tags === "string"
        ? tags
            .split(";")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [];

    return {
      id: String((data.id as number) ?? ref),
      title: (fields["System.Title"] as string) ?? "",
      description: ((fields["System.Description"] as string) ?? "").slice(
        0,
        MAX_DESC_LENGTH,
      ),
      labels,
      source: "azure-devops",
    };
  }
}
