import { describe, expect, it } from "vitest";
import { shufflePatches } from "../diff/shuffle.js";
import type { FilePatch } from "../types.js";

function makePatch(path: string, hunkCount: number): FilePatch {
  return {
    path,
    additions: hunkCount,
    deletions: 0,
    isBinary: false,
    hunks: Array.from({ length: hunkCount }, (_, i) => ({
      oldStart: i * 10 + 1,
      oldLines: 5,
      newStart: i * 10 + 1,
      newLines: 5,
      content: `+line ${i}`,
    })),
  };
}

describe("shufflePatches", () => {
  it("returns empty array for empty input", () => {
    expect(shufflePatches([], 42)).toEqual([]);
  });

  it("returns structurally equal result for single file with single hunk", () => {
    const input = [makePatch("only.ts", 1)];
    const result = shufflePatches(input, 99);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("only.ts");
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].content).toBe(input[0].hunks[0].content);
  });

  it("produces identical output for the same seed", () => {
    const input = [makePatch("a.ts", 8), makePatch("b.ts", 8), makePatch("c.ts", 8)];
    const a = shufflePatches(input, 12345);
    const b = shufflePatches(input, 12345);
    expect(a).toEqual(b);
  });

  it("produces different output for different seeds", () => {
    const input = [
      makePatch("a.ts", 10),
      makePatch("b.ts", 10),
      makePatch("c.ts", 10),
      makePatch("d.ts", 10),
      makePatch("e.ts", 10),
    ];
    const a = shufflePatches(input, 1);
    const b = shufflePatches(input, 2);
    const pathsA = a.map((p) => p.path);
    const pathsB = b.map((p) => p.path);
    const hunksA = a.flatMap((p) => p.hunks.map((h) => h.oldStart));
    const hunksB = b.flatMap((p) => p.hunks.map((h) => h.oldStart));
    // at least file order or hunk order should differ
    const filesMatch = pathsA.every((p, i) => p === pathsB[i]);
    const hunksMatch = hunksA.every((h, i) => h === hunksB[i]);
    expect(filesMatch && hunksMatch).toBe(false);
  });

  it("preserves all patches — same files, same hunk counts, same content", () => {
    const input = [makePatch("x.ts", 4), makePatch("y.ts", 3), makePatch("z.ts", 5)];
    const result = shufflePatches(input, 777);

    expect(result).toHaveLength(input.length);

    const sortedInput = [...input].sort((a, b) => a.path.localeCompare(b.path));
    const sortedResult = [...result].sort((a, b) => a.path.localeCompare(b.path));

    for (let i = 0; i < sortedInput.length; i++) {
      expect(sortedResult[i].path).toBe(sortedInput[i].path);
      expect(sortedResult[i].additions).toBe(sortedInput[i].additions);
      expect(sortedResult[i].deletions).toBe(sortedInput[i].deletions);
      expect(sortedResult[i].isBinary).toBe(sortedInput[i].isBinary);
      expect(sortedResult[i].hunks).toHaveLength(sortedInput[i].hunks.length);

      const sortedInputHunks = [...sortedInput[i].hunks].sort((a, b) => a.oldStart - b.oldStart);
      const sortedResultHunks = [...sortedResult[i].hunks].sort((a, b) => a.oldStart - b.oldStart);
      expect(sortedResultHunks).toEqual(sortedInputHunks);
    }
  });

  it("shuffles hunks within files", () => {
    // 20 hunks — probability of staying in original order is 1/20! ≈ 4e-19
    const input = [makePatch("big.ts", 20)];
    const result = shufflePatches(input, 42);
    const originalOrder = input[0].hunks.map((h) => h.oldStart);
    const resultOrder = result[0].hunks.map((h) => h.oldStart);
    expect(resultOrder).not.toEqual(originalOrder);
  });

  it("does not mutate the input array", () => {
    const input = [makePatch("a.ts", 5), makePatch("b.ts", 5)];
    const pathsBefore = input.map((p) => p.path);
    const hunksBefore = input.map((p) => p.hunks.map((h) => h.oldStart));
    shufflePatches(input, 42);
    expect(input.map((p) => p.path)).toEqual(pathsBefore);
    expect(input.map((p) => p.hunks.map((h) => h.oldStart))).toEqual(hunksBefore);
  });
});
