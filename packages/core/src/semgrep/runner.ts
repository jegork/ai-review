import { execFile } from "node:child_process";
import { writeFile, unlink, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../logger.js";
import type { FilePatch } from "../types.js";
import type { SemgrepFinding, SemgrepRawOutput, SemgrepResult } from "./types.js";

const log = logger.child({ module: "semgrep" });

const SEMGREP_TIMEOUT_MS = 120_000;

function normalizeSeverity(raw: string): SemgrepFinding["severity"] {
  const lower = raw.toLowerCase();
  if (lower === "error") return "error";
  if (lower === "warning") return "warning";
  return "info";
}

function parseRawOutput(json: string): SemgrepFinding[] {
  const raw = JSON.parse(json) as SemgrepRawOutput;

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
        // semgrep exits 1 when findings exist, which is still valid
        if (err && proc.exitCode === null) {
          reject(err as Error);
          return;
        }

        resolve({ stdout, stderr, exitCode: proc.exitCode ?? 0 });
      },
    );
  });
}

async function isSemgrepAvailable(): Promise<boolean> {
  try {
    await runCommand("semgrep", ["--version"], 10_000);
    return true;
  } catch {
    return false;
  }
}

export interface RunSemgrepOptions {
  /** semgrep config string, defaults to "auto" */
  config?: string;
  /** timeout in ms, defaults to 120_000 */
  timeoutMs?: number;
  /** working directory where changed files live */
  workDir?: string;
}

// swallow errors on cleanup calls where failure is expected (e.g. already deleted)
function swallowCleanupError(_err: unknown): void {
  // intentionally ignored
}

export async function runSemgrep(
  changedFiles: string[],
  options?: RunSemgrepOptions,
): Promise<SemgrepResult> {
  if (changedFiles.length === 0) {
    return { findings: [], rawCount: 0, available: true };
  }

  const available = await isSemgrepAvailable();
  if (!available) {
    log.info("semgrep not found in PATH, skipping pre-scan");
    return { findings: [], rawCount: 0, available: false, error: "semgrep not installed" };
  }

  const config = options?.config ?? "auto";
  const timeout = options?.timeoutMs ?? SEMGREP_TIMEOUT_MS;
  const workDir = options?.workDir ?? process.cwd();

  // write file list to a temp file so we don't blow arg length limits
  let tmpDir: string | undefined;
  let targetListPath: string | undefined;

  try {
    tmpDir = await mkdtemp(join(tmpdir(), "semgrep-"));
    targetListPath = join(tmpDir, "targets.txt");
    await writeFile(targetListPath, changedFiles.join("\n"), "utf-8");

    const args = ["scan", "--config", config, "--json", "--quiet", "--target-list", targetListPath];

    log.info({ config, fileCount: changedFiles.length }, "running semgrep pre-scan");

    const { stdout, stderr, exitCode } = await runCommand("semgrep", args, timeout, workDir);

    if (exitCode > 1) {
      log.warn({ exitCode, stderr: stderr.slice(0, 500) }, "semgrep exited with error");
      return {
        findings: [],
        rawCount: 0,
        available: true,
        error: `semgrep exited with code ${exitCode}: ${stderr.slice(0, 200)}`,
      };
    }

    if (!stdout.trim()) {
      return { findings: [], rawCount: 0, available: true };
    }

    const findings = parseRawOutput(stdout);
    log.info({ findingCount: findings.length }, "semgrep pre-scan complete");

    return { findings, rawCount: findings.length, available: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err: message }, "semgrep pre-scan failed, continuing without it");
    return { findings: [], rawCount: 0, available: true, error: message };
  } finally {
    if (targetListPath) {
      await unlink(targetListPath).catch(swallowCleanupError);
    }
    if (tmpDir) {
      await rmdir(tmpDir).catch(swallowCleanupError);
    }
  }
}

export function extractChangedFilePaths(patches: FilePatch[]): string[] {
  return patches.filter((p) => !p.isBinary).map((p) => p.path);
}
