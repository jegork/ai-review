import type { TicketInfo, TicketProvider } from "../../types.js";
import { GitLabIssueSchema } from "../schemas.js";

const MAX_DESC_LENGTH = 10_000;

export interface GitLabTicketProviderConfig {
  /** API base URL, e.g. https://gitlab.com/api/v4 */
  baseUrl: string;
  /** Personal access token, project access token, or CI_JOB_TOKEN */
  token: string;
  /** When true, send token via JOB-TOKEN header (CI job token); else PRIVATE-TOKEN */
  isJobToken?: boolean;
  /** Default project path (e.g. "group/sub/project") used when a ref is bare numeric */
  defaultProjectPath?: string;
}

/**
 * Fetches issue details from GitLab. Refs may be:
 *   "group/sub/project#123"  → fetches from that project
 *   "123"                    → uses defaultProjectPath
 */
export class GitLabTicketProvider implements TicketProvider {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly tokenHeader: string;
  private readonly defaultProjectPath?: string;

  constructor(config: GitLabTicketProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.tokenHeader = config.isJobToken ? "JOB-TOKEN" : "PRIVATE-TOKEN";
    if (config.defaultProjectPath) {
      this.defaultProjectPath = config.defaultProjectPath;
    }
  }

  async fetchTicket(ref: string): Promise<TicketInfo | null> {
    const { projectPath, iid } = parseRef(ref, this.defaultProjectPath);
    if (!projectPath || !iid) return null;

    const url = `${this.baseUrl}/projects/${encodeURIComponent(projectPath)}/issues/${iid}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          [this.tokenHeader]: this.token,
          Accept: "application/json",
        },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      return null;
    }

    const parsed = GitLabIssueSchema.safeParse(raw);
    if (!parsed.success) return null;

    const data = parsed.data;
    return {
      id: String(data.iid),
      title: data.title,
      description: (data.description ?? "").slice(0, MAX_DESC_LENGTH),
      labels: data.labels ?? [],
      source: "gitlab",
    };
  }
}

function parseRef(
  ref: string,
  defaultProjectPath: string | undefined,
): { projectPath: string | undefined; iid: number | undefined } {
  if (ref.includes("#")) {
    const idx = ref.lastIndexOf("#");
    const projectPath = ref.slice(0, idx);
    const iid = Number(ref.slice(idx + 1));
    return {
      projectPath,
      iid: Number.isInteger(iid) && iid > 0 ? iid : undefined,
    };
  }
  const iid = Number(ref);
  return {
    projectPath: defaultProjectPath,
    iid: Number.isInteger(iid) && iid > 0 ? iid : undefined,
  };
}
