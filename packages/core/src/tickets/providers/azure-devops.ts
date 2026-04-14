import type { TicketInfo, TicketProvider } from "../../types.js";
import { AdoWorkItemSchema } from "../schemas.js";

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

    const parsed = AdoWorkItemSchema.safeParse(await res.json());
    if (!parsed.success) return null;

    const { id, fields } = parsed.data;
    const title = typeof fields?.["System.Title"] === "string" ? fields["System.Title"] : "";
    const description =
      typeof fields?.["System.Description"] === "string" ? fields["System.Description"] : "";
    const tags = typeof fields?.["System.Tags"] === "string" ? fields["System.Tags"] : "";
    const labels = tags
      ? tags
          .split(";")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    return {
      id: String(id ?? ref),
      title,
      description: description.slice(0, MAX_DESC_LENGTH),
      labels,
      source: "azure-devops",
    };
  }
}
