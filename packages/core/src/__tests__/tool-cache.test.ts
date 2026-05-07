import { describe, it, expect, vi } from "vitest";
import { ToolCache } from "../agent/tool-cache.js";

function makeProvider() {
  return {
    searchCode: vi.fn(async (query: string) => [
      { file: `${query}.ts`, line: 1, content: `const ${query} = 1` },
    ]),
    getFileContent: vi.fn(async (path: string) => `content of ${path}`),
  };
}

describe("ToolCache", () => {
  it("deduplicates concurrent searchCode calls with the same query", async () => {
    const provider = makeProvider();
    const cache = new ToolCache(provider as any, "main");

    const [a, b] = await Promise.all([cache.searchCode("foo"), cache.searchCode("foo")]);

    expect(a).toEqual(b);
    expect(provider.searchCode).toHaveBeenCalledTimes(1);
    expect(provider.searchCode).toHaveBeenCalledWith("foo");
  });

  it("deduplicates sequential searchCode calls with the same query", async () => {
    const provider = makeProvider();
    const cache = new ToolCache(provider as any, "main");

    const a = await cache.searchCode("foo");
    const b = await cache.searchCode("foo");

    expect(a).toEqual(b);
    expect(provider.searchCode).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate different searchCode queries", async () => {
    const provider = makeProvider();
    const cache = new ToolCache(provider as any, "main");

    await Promise.all([cache.searchCode("foo"), cache.searchCode("bar")]);

    expect(provider.searchCode).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent getFileContent calls with the same path", async () => {
    const provider = makeProvider();
    const cache = new ToolCache(provider as any, "main");

    const [a, b] = await Promise.all([
      cache.getFileContent("src/index.ts"),
      cache.getFileContent("src/index.ts"),
    ]);

    expect(a).toEqual(b);
    expect(provider.getFileContent).toHaveBeenCalledTimes(1);
    expect(provider.getFileContent).toHaveBeenCalledWith("src/index.ts", "main");
  });

  it("does not deduplicate different getFileContent paths", async () => {
    const provider = makeProvider();
    const cache = new ToolCache(provider as any, "main");

    await Promise.all([cache.getFileContent("src/a.ts"), cache.getFileContent("src/b.ts")]);

    expect(provider.getFileContent).toHaveBeenCalledTimes(2);
  });

  it("caches search and file calls independently", async () => {
    const provider = makeProvider();
    const cache = new ToolCache(provider as any, "main");

    await cache.searchCode("query");
    await cache.getFileContent("path");

    expect(provider.searchCode).toHaveBeenCalledTimes(1);
    expect(provider.getFileContent).toHaveBeenCalledTimes(1);
  });
});
