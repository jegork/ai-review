import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MCPClient } from "@mastra/mcp";
import type { ToolsInput } from "@mastra/core/agent";
import type { McpServerConfig } from "./types.js";
import { McpServerConfigSchema } from "./types.js";
import { logger } from "../logger.js";

const DEFAULT_CONFIG_FILE = "mcp-servers.json";

/**
 * Connects to the configured MCP servers, discovers their tools, and returns
 * Mastra-compatible tools plus a cleanup function to disconnect.
 *
 * Each server is connected independently — if one server fails, the rest
 * still contribute their tools.
 */
export async function connectMcpServers(
  servers: McpServerConfig,
): Promise<{ tools: ToolsInput; disconnect: () => Promise<void> }> {
  const names = Object.keys(servers);
  if (names.length === 0) {
    return { tools: {}, disconnect: async () => {} };
  }

  const allTools: ToolsInput = {};
  const connectedClients: MCPClient[] = [];

  for (const name of names) {
    const client = new MCPClient({ servers: { [name]: servers[name] } });
    try {
      const tools = await client.listTools();
      Object.assign(allTools, tools);
      connectedClients.push(client);
    } catch (err) {
      logger.warn({ err, server: name }, "failed to connect MCP server; skipping");
      try {
        await client.disconnect();
      } catch {
        // ignore cleanup errors for failed connections
      }
    }
  }

  const disconnect = async () => {
    await Promise.allSettled(connectedClients.map((c) => c.disconnect()));
  };

  return { tools: allTools, disconnect };
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${filePath}: invalid JSON in MCP servers config file`);
  }

  const result = McpServerConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`${filePath}: invalid MCP servers config:\n${issues}`);
  }

  return result.data as McpServerConfig;
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
