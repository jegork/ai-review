import picomatch from "picomatch";
import type { FilePatch, Hunk } from "../types.js";

const DEFAULT_IGNORE = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];

function hunkHasAdditions(hunk: Hunk): boolean {
  return hunk.content.split("\n").some((line) => line.startsWith("+"));
}

export function stripDeletionOnlyHunks(patches: FilePatch[]): FilePatch[] {
  return patches
    .map((patch) => {
      const kept = patch.hunks.filter(hunkHasAdditions);
      if (kept.length === patch.hunks.length) return patch;
      const additions = kept.reduce(
        (sum, h) => sum + h.content.split("\n").filter((l) => l.startsWith("+")).length,
        0,
      );
      return { ...patch, hunks: kept, additions };
    })
    .filter((patch) => patch.hunks.length > 0);
}

export function filterFiles(patches: FilePatch[], ignorePatterns: string[] = []): FilePatch[] {
  const allPatterns = [...DEFAULT_IGNORE, ...ignorePatterns];
  const isIgnored = picomatch(allPatterns);

  return patches.filter((p) => {
    if (p.isBinary) return false;
    return !isIgnored(p.path);
  });
}
