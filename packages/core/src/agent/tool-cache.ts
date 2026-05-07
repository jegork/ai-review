import type { GitProvider } from "../types.js";

export class ToolCache {
  private searchCache = new Map<
    string,
    Promise<{ results: { file: string; line: number; content: string }[]; count: number }>
  >();
  private fileCache = new Map<string, Promise<{ content: string | null }>>();

  constructor(
    private provider: GitProvider,
    private ref: string,
  ) {}

  searchCode(query: string) {
    const existing = this.searchCache.get(query);
    if (existing) return existing;
    const p = this.provider
      .searchCode(query)
      .then((results) => ({ results, count: results.length }));
    this.searchCache.set(query, p);
    return p;
  }

  getFileContent(path: string) {
    const existing = this.fileCache.get(path);
    if (existing) return existing;
    const p = this.provider.getFileContent(path, this.ref).then((content) => ({ content }));
    this.fileCache.set(path, p);
    return p;
  }
}
