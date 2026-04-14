import type { FilePatch, Hunk } from "../types.js";

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function isFileBoundary(line: string): boolean {
  return line.startsWith("diff --git") || line.startsWith("diff --combined");
}

function isBinaryMarker(line: string): boolean {
  return line.startsWith("Binary files") || line.startsWith("GIT binary patch");
}

function extractPath(header: string, prefix: "---" | "+++"): string | null {
  if (!header.startsWith(prefix)) return null;
  const rest = header.slice(prefix.length).trim();
  if (rest === "/dev/null") return null;
  // strip a/ or b/ prefix
  return rest.replace(/^[ab]\//, "");
}

function extractPathFromDiffLine(line: string): string | null {
  // "diff --git a/foo b/foo" -> "foo"
  const match = /^diff --git a\/(.+?) b\//.exec(line);
  return match ? match[1] : null;
}

function parseFileBlock(lines: string[]): FilePatch | null {
  let path = "";
  let isBinary = false;
  const hunks: Hunk[] = [];
  let additions = 0;
  let deletions = 0;

  let renameTo: string | null = null;

  if (lines.length > 0 && lines[0].startsWith("diff --git")) {
    path = extractPathFromDiffLine(lines[0]) ?? "";
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isBinaryMarker(line)) {
      isBinary = true;
      if (!path) {
        // try to extract from "Binary files a/foo and b/foo differ"
        const match = /Binary files [ab]\/(.+?) and/.exec(line);
        if (match) path = match[1];
      }
      continue;
    }

    if (line.startsWith("rename to ")) {
      renameTo = line.slice("rename to ".length);
      continue;
    }

    if (line.startsWith("rename from ")) {
      continue;
    }

    const minusPath = extractPath(line, "---");
    const plusPath = extractPath(line, "+++");

    if (line.startsWith("--- ")) {
      if (!path && minusPath) path = minusPath;
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (plusPath) path = plusPath;
      continue;
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1], 10);
      const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;

      const contentLines: string[] = [];
      let j = i + 1;
      while (
        j < lines.length &&
        !HUNK_HEADER_RE.test(lines[j]) &&
        !lines[j].startsWith("diff --git")
      ) {
        contentLines.push(lines[j]);
        j++;
      }

      for (const cl of contentLines) {
        if (cl.startsWith("+")) additions++;
        else if (cl.startsWith("-")) deletions++;
      }

      hunks.push({
        oldStart,
        oldLines,
        newStart,
        newLines,
        content: contentLines.join("\n"),
      });

      i = j - 1;
      continue;
    }
  }

  if (renameTo) path = renameTo;

  if (!path) return null;

  return { path, hunks, additions, deletions, isBinary };
}

export function parseDiff(rawDiff: string): FilePatch[] {
  if (!rawDiff.trim()) return [];

  const lines = rawDiff.split("\n");
  const patches: FilePatch[] = [];

  const blockStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isFileBoundary(lines[i])) {
      blockStarts.push(i);
    }
  }

  if (blockStarts.length === 0) return [];

  for (let b = 0; b < blockStarts.length; b++) {
    const start = blockStarts[b];
    const end = b + 1 < blockStarts.length ? blockStarts[b + 1] : lines.length;
    const block = lines.slice(start, end);
    const patch = parseFileBlock(block);
    if (patch) patches.push(patch);
  }

  return patches;
}
