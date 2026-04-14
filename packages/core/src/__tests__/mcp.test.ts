import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { loadMcpServerConfigs, connectMcpServers } from "../mcp/client.js";

const TMP_DIR = join(import.meta.dirname, ".tmp-mcp-test");

describe("loadMcpServerConfigs", () => {
  it("returns empty object when file does not exist", async () => {
    const result = await loadMcpServerConfigs("/nonexistent/path/mcp-servers.json");
    expect(result).toEqual({});
  });

  it("parses valid config file", async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const filePath = join(TMP_DIR, "valid.json");
    const config = {
      docs: { command: "npx", args: ["-y", "@my/mcp-docs"] },
      sentry: { url: "https://mcp.sentry.io/sse" },
    };
    await writeFile(filePath, JSON.stringify(config));

    const result = await loadMcpServerConfigs(filePath);
    expect(result).toEqual(config);

    await rm(TMP_DIR, { recursive: true });
  });

  it("throws on invalid JSON", async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const filePath = join(TMP_DIR, "invalid.json");
    await writeFile(filePath, "not json {{{");

    await expect(loadMcpServerConfigs(filePath)).rejects.toThrow();

    await rm(TMP_DIR, { recursive: true });
  });

  it("throws when file contains a JSON array", async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const filePath = join(TMP_DIR, "array.json");
    await writeFile(filePath, "[]");

    await expect(loadMcpServerConfigs(filePath)).rejects.toThrow("must be a JSON object");

    await rm(TMP_DIR, { recursive: true });
  });

  it("throws when file contains a non-object value", async () => {
    await mkdir(TMP_DIR, { recursive: true });
    const filePath = join(TMP_DIR, "string.json");
    await writeFile(filePath, '"hello"');

    await expect(loadMcpServerConfigs(filePath)).rejects.toThrow("must be a JSON object");

    await rm(TMP_DIR, { recursive: true });
  });
});

describe("connectMcpServers", () => {
  it("returns empty tools and a noop disconnect for empty config", async () => {
    const result = await connectMcpServers({});
    expect(result.tools).toEqual({});
    expect(typeof result.disconnect).toBe("function");
    await result.disconnect(); // should not throw
  });
});
