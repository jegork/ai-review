import type { FilePatch } from "../types.js";

export function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatHunks(patch: FilePatch): string {
  const parts: string[] = [`## ${patch.path}`];

  for (const hunk of patch.hunks) {
    const lines = hunk.content.split("\n");
    const oldLines: string[] = [];
    const newLines: string[] = [];
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const line of lines) {
      if (line.startsWith("-")) {
        oldLines.push(`${oldLine} ${line}`);
        oldLine++;
      } else if (line.startsWith("+")) {
        newLines.push(`${newLine} ${line}`);
        newLine++;
      } else if (line.startsWith("\\")) {
        // no-newline marker, keep in whichever section was last
        continue;
      } else {
        oldLines.push(`${oldLine} ${line}`);
        newLines.push(`${newLine} ${line}`);
        oldLine++;
        newLine++;
      }
    }

    if (oldLines.length > 0) {
      parts.push("__old hunk__");
      parts.push(...oldLines);
    }
    if (newLines.length > 0) {
      parts.push("__new hunk__");
      parts.push(...newLines);
    }
  }

  return parts.join("\n");
}

export function compressDiff(
  patches: FilePatch[],
  maxTokens: number,
): { compressed: string; skippedFiles: string[] } {
  if (patches.length === 0) return { compressed: "", skippedFiles: [] };

  const formatted = patches.map((p) => ({
    path: p.path,
    text: formatHunks(p),
    tokens: 0,
  }));

  for (const f of formatted) {
    f.tokens = countTokens(f.text);
  }

  // sort by token cost descending so largest files come first
  formatted.sort((a, b) => b.tokens - a.tokens);

  const included: string[] = [];
  const skippedFiles: string[] = [];
  let remaining = maxTokens;

  for (const f of formatted) {
    if (f.tokens <= remaining) {
      included.push(f.text);
      remaining -= f.tokens;
    } else if (remaining > 0) {
      // try to include partial hunks
      const lines = f.text.split("\n");
      const clipped: string[] = [];
      let usedTokens = 0;

      for (const line of lines) {
        const lineTokens = countTokens(line + "\n");
        if (usedTokens + lineTokens > remaining) break;
        clipped.push(line);
        usedTokens += lineTokens;
      }

      if (clipped.length > 1) {
        included.push(clipped.join("\n"));
        remaining -= usedTokens;
      } else {
        skippedFiles.push(f.path);
      }
    } else {
      skippedFiles.push(f.path);
    }
  }

  return { compressed: included.join("\n\n"), skippedFiles };
}
