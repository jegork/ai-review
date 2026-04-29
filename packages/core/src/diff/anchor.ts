import type { Finding, FilePatch } from "../types.js";

export interface DroppedAnchor {
  finding: Finding;
  reason: "unknown-file" | "outside-hunk";
}

export interface AnchorFilterResult {
  anchored: Finding[];
  dropped: DroppedAnchor[];
}

function buildHunkIndex(patches: FilePatch[]): Map<string, { start: number; end: number }[]> {
  const index = new Map<string, { start: number; end: number }[]>();
  for (const patch of patches) {
    if (patch.isBinary) continue;
    const ranges = patch.hunks.map((h) => ({
      start: h.newStart,
      // a hunk with newLines=0 represents a pure deletion at newStart, no addressable lines
      end: h.newLines > 0 ? h.newStart + h.newLines - 1 : h.newStart - 1,
    }));
    if (ranges.length > 0) index.set(patch.path, ranges);
  }
  return index;
}

function isLineAnchorable(
  line: number,
  endLine: number | null | undefined,
  ranges: { start: number; end: number }[],
): boolean {
  const lo = line;
  const hi = endLine ?? line;
  if (hi < lo) return false;
  return ranges.some((r) => lo >= r.start && hi <= r.end);
}

export function filterAnchorableFindings(
  findings: Finding[],
  patches: FilePatch[],
): AnchorFilterResult {
  const index = buildHunkIndex(patches);
  const anchored: Finding[] = [];
  const dropped: DroppedAnchor[] = [];

  for (const finding of findings) {
    const ranges = index.get(finding.file);
    if (!ranges) {
      dropped.push({ finding, reason: "unknown-file" });
      continue;
    }
    if (!isLineAnchorable(finding.line, finding.endLine, ranges)) {
      dropped.push({ finding, reason: "outside-hunk" });
      continue;
    }
    anchored.push(finding);
  }

  return { anchored, dropped };
}
