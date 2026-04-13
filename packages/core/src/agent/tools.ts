import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { GitProvider } from "../types.js";

export function createSearchCodeTool(provider: GitProvider) {
  return createTool({
    id: "search-code",
    description:
      "Search the codebase for references to a symbol, function name, import, or string. " +
      "Use this to verify whether removed or renamed exports are still used elsewhere " +
      "before reporting them as issues. Returns matching files and snippets.",
    inputSchema: z.object({
      query: z.string().describe("symbol name, function name, or search term to find usages of"),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          file: z.string(),
          line: z.number(),
          content: z.string(),
        }),
      ),
      count: z.number(),
    }),
    execute: async ({ query }) => {
      const results = await provider.searchCode(query);
      return { results, count: results.length };
    },
  });
}

export function createGetFileContextTool(provider: GitProvider, ref: string) {
  return createTool({
    id: "get-file-context",
    description:
      "Fetch the full content of a file from the repository. " +
      "Use this when you need to see more context around a change " +
      "than what the diff provides.",
    inputSchema: z.object({
      path: z.string().describe("file path relative to repo root"),
    }),
    outputSchema: z.object({
      content: z.string().nullable(),
    }),
    execute: async ({ path }) => {
      const content = await provider.getFileContent(path, ref);
      return { content };
    },
  });
}
