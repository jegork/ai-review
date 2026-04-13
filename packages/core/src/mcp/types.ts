export interface McpStdioServerConfig {
  /** Unique name used to namespace tools from this server. */
  name: string;
  transport: "stdio";
  /** The executable command to spawn (e.g. "npx", "node", "python"). */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Environment variables for the spawned process. */
  env?: Record<string, string>;
}

export interface McpSseServerConfig {
  /** Unique name used to namespace tools from this server. */
  name: string;
  transport: "sse";
  /** The URL of the SSE MCP server endpoint. */
  url: string;
  /** Optional headers (e.g. for authentication). */
  headers?: Record<string, string>;
}

export interface McpStreamableHttpServerConfig {
  /** Unique name used to namespace tools from this server. */
  name: string;
  transport: "streamable-http";
  /** The URL of the Streamable HTTP MCP server endpoint. */
  url: string;
  /** Optional headers (e.g. for authentication). */
  headers?: Record<string, string>;
}

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSseServerConfig
  | McpStreamableHttpServerConfig;
