import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ToolsInput } from "@mastra/core/agent";
import type { McpServerConfig } from "./types.js";

interface ConnectedServer {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  name: string;
}

function createTransport(
  config: McpServerConfig,
): StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport {
  switch (config.transport) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
    case "sse":
      return new SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    case "streamable-http":
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
  }
}

/**
 * Converts a JSON Schema properties object to a Zod schema.
 * Handles basic types; falls back to z.unknown() for unsupported types.
 */
function jsonSchemaToZod(schema: {
  type?: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
}): z.ZodType {
  if (schema.type !== "object" || !schema.properties) {
    return z.record(z.string(), z.unknown());
  }

  const shape: Record<string, z.ZodType> = {};
  const required = new Set(schema.required ?? []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    let field: z.ZodType;

    switch (prop.type) {
      case "string":
        field = z.string();
        break;
      case "number":
      case "integer":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "array":
        field = z.array(z.unknown());
        break;
      default:
        field = z.unknown();
    }

    if (prop.description) {
      field = field.describe(prop.description);
    }

    if (!required.has(key)) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return z.object(shape);
}

/**
 * Connects to a set of MCP servers, discovers their tools, and returns
 * Mastra-compatible tools plus a cleanup function to disconnect.
 */
export async function connectMcpServers(
  configs: McpServerConfig[],
): Promise<{ tools: ToolsInput; disconnect: () => Promise<void> }> {
  const connected: ConnectedServer[] = [];
  const tools: ToolsInput = {};

  for (const config of configs) {
    const transport = createTransport(config);
    const client = new Client(
      { name: `rusty-bot-${config.name}`, version: "0.1.0" },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
      connected.push({ client, transport, name: config.name });

      const { tools: mcpTools } = await client.listTools();

      for (const mcpTool of mcpTools) {
        const toolKey = `mcp_${config.name}_${mcpTool.name}`;
        const inputSchema = jsonSchemaToZod(
          mcpTool.inputSchema as {
            type?: string;
            properties?: Record<string, { type?: string; description?: string }>;
            required?: string[];
          },
        );

        // Capture for closure
        const serverClient = client;
        const remoteName = mcpTool.name;

        tools[toolKey] = createTool({
          id: toolKey,
          description:
            mcpTool.description ?? `Tool "${mcpTool.name}" from MCP server "${config.name}"`,
          inputSchema: inputSchema as z.ZodObject<Record<string, z.ZodType>>,
          outputSchema: z.object({ content: z.unknown() }),
          execute: async (args: Record<string, unknown>) => {
            const result = await serverClient.callTool({ name: remoteName, arguments: args });
            if ("content" in result) {
              const textParts = (result.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === "text")
                .map((c) => c.text ?? "");
              return { content: textParts.join("\n") };
            }
            return { content: result };
          },
        });
      }

      console.log(`[mcp] connected to "${config.name}": ${mcpTools.length} tool(s) available`);
    } catch (err) {
      console.error(`[mcp] failed to connect to "${config.name}":`, err);
      // Clean up this failed connection but continue with others
      try {
        await client.close();
      } catch {
        // ignore close errors
      }
    }
  }

  const disconnect = async () => {
    for (const { client, name } of connected) {
      try {
        await client.close();
      } catch (err) {
        console.error(`[mcp] error disconnecting from "${name}":`, err);
      }
    }
  };

  return { tools, disconnect };
}

/**
 * Parses MCP server configurations from a JSON string.
 * Expected format: array of McpServerConfig objects.
 *
 * @example
 * ```json
 * [
 *   { "name": "docs", "transport": "stdio", "command": "npx", "args": ["-y", "@my/mcp-docs-server"] },
 *   { "name": "sentry", "transport": "sse", "url": "https://mcp.sentry.io/sse" }
 * ]
 * ```
 */
export function parseMcpServersEnv(json: string): McpServerConfig[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("RUSTY_MCP_SERVERS must be a JSON array");
  }

  for (const entry of parsed) {
    if (!entry.name || typeof entry.name !== "string") {
      throw new Error("each MCP server config must have a 'name' string");
    }
    if (!entry.transport || !["stdio", "sse", "streamable-http"].includes(entry.transport)) {
      throw new Error(
        `MCP server "${entry.name}": transport must be "stdio", "sse", or "streamable-http"`,
      );
    }
    if (entry.transport === "stdio" && !entry.command) {
      throw new Error(`MCP server "${entry.name}": stdio transport requires a 'command'`);
    }
    if ((entry.transport === "sse" || entry.transport === "streamable-http") && !entry.url) {
      throw new Error(`MCP server "${entry.name}": ${entry.transport} transport requires a 'url'`);
    }
  }

  return parsed as McpServerConfig[];
}
