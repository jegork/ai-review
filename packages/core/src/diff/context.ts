import type { FilePatch, Hunk } from "../types.js";

const DEFAULT_CONTEXT_LINES = 10;

export type FileContentFetcher = (path: string) => Promise<string | null>;

function expandHunk(hunk: Hunk, fileLines: string[], extraLines: number): Hunk {
  const hunkContentLines = hunk.content.split("\n");

  // find the range of new-file lines this hunk covers
  const newEnd = hunk.newStart + hunk.newLines - 1;

  // expand the window: extra lines before and after
  const expandedStart = Math.max(1, hunk.newStart - extraLines);
  const expandedEnd = Math.min(fileLines.length, newEnd + extraLines);

  const beforeLines: string[] = [];
  for (let i = expandedStart; i < hunk.newStart; i++) {
    beforeLines.push(` ${fileLines[i - 1]}`);
  }

  const afterLines: string[] = [];
  for (let i = newEnd + 1; i <= expandedEnd; i++) {
    afterLines.push(` ${fileLines[i - 1]}`);
  }

  const expandedContent = [...beforeLines, ...hunkContentLines, ...afterLines].join("\n");

  const addedContextBefore = hunk.newStart - expandedStart;
  const addedContextAfter = expandedEnd - newEnd;

  return {
    oldStart: Math.max(1, hunk.oldStart - addedContextBefore),
    oldLines: hunk.oldLines + addedContextBefore + addedContextAfter,
    newStart: expandedStart,
    newLines: hunk.newLines + addedContextBefore + addedContextAfter,
    content: expandedContent,
  };
}

export async function expandContext(
  patches: FilePatch[],
  fetchContent: FileContentFetcher,
  extraLines: number = DEFAULT_CONTEXT_LINES,
): Promise<FilePatch[]> {
  const results: FilePatch[] = [];

  for (const patch of patches) {
    if (patch.isBinary || patch.hunks.length === 0) {
      results.push(patch);
      continue;
    }

    const content = await fetchContent(patch.path);
    if (!content) {
      // can't expand context without the file — keep original
      results.push(patch);
      continue;
    }

    const fileLines = content.split("\n");
    const expandedHunks = patch.hunks.map((hunk) => expandHunk(hunk, fileLines, extraLines));

    results.push({ ...patch, hunks: expandedHunks });
  }

  return results;
}
