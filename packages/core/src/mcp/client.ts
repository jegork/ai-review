import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MCPClient } from "@mastra/mcp";
import type { ToolsInput } from "@mastra/core/agent";
import type { McpServerConfig } from "./types.js";

const DEFAULT_CONFIG_FILE = "mcp-servers.json";

/**
 * Connects to the configured MCP servers, discovers their tools, and returns
 * Mastra-compatible tools plus a cleanup function to disconnect.
 */
export async function connectMcpServers(
  servers: McpServerConfig,
): Promise<{ tools: ToolsInput; disconnect: () => Promise<void> }> {
  if (Object.keys(servers).length === 0) {
    return { tools: {}, disconnect: async () => {} };
  }

  const mcp = new MCPClient({ servers });

  const tools = await mcp.listTools();

  return {
    tools,
    disconnect: () => mcp.disconnect(),
  };
}

/**
 * Loads MCP server configurations from a JSON file.
 * Returns an empty object if the file does not exist.
 *
 * The file should contain a JSON object keyed by server name:
 * ```json
 * {
 *   "docs": { "command": "npx", "args": ["-y", "@my/mcp-docs-server"] },
 *   "sentry": { "url": "https://mcp.sentry.io/sse" }
 * }
 * ```
 */
export async function loadMcpServerConfigs(filePath: string): Promise<McpServerConfig> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }

  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("MCP servers config must be a JSON object keyed by server name");
  }

  for (const [name, entry] of Object.entries(parsed)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`MCP server "${name}": value must be an object`);
    }
    const def = entry as Record<string, unknown>;
    if (!def.command && !def.url) {
      throw new Error(`MCP server "${name}": must have either "command" (stdio) or "url" (http)`);
    }
  }

  return parsed as McpServerConfig;
}

/**
 * Convenience wrapper that resolves the config file path from the
 * RUSTY_MCP_CONFIG env var (falling back to ./mcp-servers.json) and
 * loads the config. Returns an empty object when no file is found.
 */
export async function loadMcpServerConfigsFromEnv(): Promise<McpServerConfig> {
  const filePath = process.env.RUSTY_MCP_CONFIG ?? join(process.cwd(), DEFAULT_CONFIG_FILE);
  return loadMcpServerConfigs(filePath);
}
