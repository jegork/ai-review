import { execFile } from "node:child_process";
import { logger } from "../logger.js";
import type { FilePatch } from "../types.js";
import type { OpenGrepFinding, OpenGrepRawOutput, OpenGrepResult } from "./types.js";

const log = logger.child({ module: "opengrep" });

const OPENGREP_TIMEOUT_MS = 120_000;
const STDERR_SLICE_LEN = 4000;
const STDOUT_SLICE_LEN = 2000;

export function formatOpenGrepExecError(exitCode: number, stderr: string, stdout: string): string {
  const parts = [`opengrep exited with code ${exitCode}`];
  const stderrTrimmed = stderr.trim();
  if (stderrTrimmed) {
    parts.push(`stderr: ${stderrTrimmed.slice(0, STDERR_SLICE_LEN)}`);
  }
  const stdoutTrimmed = stdout.trim();
  if (stdoutTrimmed) {
    parts.push(`stdout: ${stdoutTrimmed.slice(0, STDOUT_SLICE_LEN)}`);
  }
  return parts.join(" | ");
}

function normalizeSeverity(raw: string): OpenGrepFinding["severity"] {
  const lower = raw.toLowerCase();
  if (lower === "error") return "error";
  if (lower === "warning") return "warning";
  return "info";
}

function parseRawOutput(json: string): OpenGrepFinding[] {
  const raw = JSON.parse(json) as OpenGrepRawOutput;

  return raw.results.map((r) => ({
    ruleId: r.check_id,
    file: r.path,
    startLine: r.start.line,
    endLine: r.end.line,
    message: r.extra.message,
    severity: normalizeSeverity(r.extra.severity),
    snippet: r.extra.lines ?? undefined,
    metadata: r.extra.metadata ?? undefined,
  }));
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      cmd,
      args,
      { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs, ...(cwd ? { cwd } : {}) },
      (err, stdout, stderr) => {
        // opengrep exits 1 when findings exist, which is still valid
        if (err && proc.exitCode === null) {
          reject(err as Error);
          return;
        }

        resolve({ stdout, stderr, exitCode: proc.exitCode ?? 0 });
      },
    );
  });
}

async function isOpenGrepAvailable(): Promise<boolean> {
  try {
    await runCommand("opengrep", ["--version"], 10_000);
    return true;
  } catch {
    return false;
  }
}

export interface RunOpenGrepOptions {
  /** opengrep config string, defaults to "auto" */
  config?: string;
  /** timeout in ms, defaults to 120_000 */
  timeoutMs?: number;
  /** working directory where changed files live */
  workDir?: string;
}

export async function runOpenGrep(
  changedFiles: string[],
  options?: RunOpenGrepOptions,
): Promise<OpenGrepResult> {
  if (changedFiles.length === 0) {
    return { findings: [], rawCount: 0, available: true };
  }

  const available = await isOpenGrepAvailable();
  if (!available) {
    log.info("opengrep not found in PATH, skipping pre-scan");
    return { findings: [], rawCount: 0, available: false, error: "opengrep not installed" };
  }

  const config = options?.config ?? "auto";
  const timeout = options?.timeoutMs ?? OPENGREP_TIMEOUT_MS;
  const workDir = options?.workDir ?? process.cwd();

  try {
    // targets are positional args after the flags
    const args = ["scan", "--config", config, "--json", "--quiet", ...changedFiles];

    log.info({ config, fileCount: changedFiles.length }, "running opengrep pre-scan");

    const { stdout, stderr, exitCode } = await runCommand("opengrep", args, timeout, workDir);

    if (exitCode > 1) {
      const error = formatOpenGrepExecError(exitCode, stderr, stdout);
      log.warn(
        {
          exitCode,
          stderr: stderr.slice(0, STDERR_SLICE_LEN),
          stdout: stdout.slice(0, STDOUT_SLICE_LEN),
        },
        "opengrep pre-scan failed with non-zero exit code, continuing without findings",
      );
      return {
        findings: [],
        rawCount: 0,
        available: true,
        error,
      };
    }

    if (!stdout.trim()) {
      return { findings: [], rawCount: 0, available: true };
    }

    const findings = parseRawOutput(stdout);
    log.info({ findingCount: findings.length }, "opengrep pre-scan complete");

    return { findings, rawCount: findings.length, available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message }, "opengrep pre-scan threw, continuing without findings");
    return {
      findings: [],
      rawCount: 0,
      available: true,
      error: `opengrep pre-scan threw: ${message}`,
    };
  }
}

export function extractChangedFilePaths(patches: FilePatch[]): string[] {
  return patches.filter((p) => !p.isBinary).map((p) => p.path);
}
