const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface RepoConfig {
  owner: string;
  repo: string;
  style: "strict" | "balanced" | "lenient" | "roast";
  focusAreas: string[];
  ignorePatterns: string[];
  customInstructions: string;
}

export interface Settings {
  llmModel: string;
  jiraToken: string;
  linearToken: string;
  adoToken: string;
  [key: string]: string;
}

export interface Review {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  timestamp: string;
  findingsCount: number;
  criticalCount: number;
  warningCount: number;
  suggestionCount: number;
  modelUsed: string;
  tokenCount: number;
  recommendation: string;
  prUrl: string;
}

export interface PaginatedReviews {
  items: Review[];
  total: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  getRepos: () => request<RepoConfig[]>("/api/config/repos"),

  getRepo: (owner: string, repo: string) =>
    request<RepoConfig>(`/api/config/repos/${owner}/${repo}`),

  updateRepo: (
    owner: string,
    repo: string,
    body: Pick<RepoConfig, "style" | "focusAreas" | "ignorePatterns" | "customInstructions">,
  ) =>
    request<RepoConfig>(`/api/config/repos/${owner}/${repo}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getSettings: () => request<Settings>("/api/config/settings"),

  updateSettings: (body: Settings) =>
    request<Settings>("/api/config/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getReviews: (limit = 20, offset = 0) =>
    request<PaginatedReviews>(`/api/reviews?limit=${limit}&offset=${offset}`),

  getReview: (id: string) => request<Review>(`/api/reviews/${id}`),
};
