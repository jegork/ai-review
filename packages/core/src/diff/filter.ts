import picomatch from "picomatch";
import type { FilePatch } from "../types.js";

const DEFAULT_IGNORE = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

export function filterFiles(
  patches: FilePatch[],
  ignorePatterns: string[] = [],
): FilePatch[] {
  const allPatterns = [...DEFAULT_IGNORE, ...ignorePatterns];
  const isIgnored = picomatch(allPatterns);

  return patches.filter((p) => {
    if (p.isBinary) return false;
    return !isIgnored(p.path);
  });
}
