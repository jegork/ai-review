import { describe, it, expect } from "vitest";
import { filterAnchorableFindings } from "../diff/anchor.js";
import type { Finding, FilePatch } from "../types.js";

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    file: "src/foo.ts",
    line: 10,
    endLine: null,
    severity: "warning",
    category: "bugs",
    message: "msg",
    suggestedFix: null,
    ...overrides,
  };
}

function makePatch(path: string, hunks: { newStart: number; newLines: number }[]): FilePatch {
  return {
    path,
    hunks: hunks.map((h) => ({
      oldStart: h.newStart,
      oldLines: h.newLines,
      newStart: h.newStart,
      newLines: h.newLines,
      content: "",
    })),
    additions: 0,
    deletions: 0,
    isBinary: false,
  };
}

describe("filterAnchorableFindings", () => {
  it("keeps a finding within a hunk's new line range", () => {
    const patches = [makePatch("src/foo.ts", [{ newStart: 10, newLines: 5 }])];
    const finding = makeFinding({ file: "src/foo.ts", line: 12 });

    const { anchored, dropped } = filterAnchorableFindings([finding], patches);

    expect(anchored).toEqual([finding]);
    expect(dropped).toEqual([]);
  });

  it("drops a finding whose file is not in the diff", () => {
    const patches = [makePatch("src/foo.ts", [{ newStart: 10, newLines: 5 }])];
    const finding = makeFinding({ file: "src/missing.ts", line: 12 });

    const { anchored, dropped } = filterAnchorableFindings([finding], patches);

    expect(anchored).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe("unknown-file");
  });

  it("drops a finding with a wrong file extension (parse.js vs parse.ts)", () => {
    const patches = [makePatch("src/title/parse.ts", [{ newStart: 1, newLines: 20 }])];
    const finding = makeFinding({ file: "src/title/parse.js", line: 1 });

    const { anchored, dropped } = filterAnchorableFindings([finding], patches);

    expect(anchored).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe("unknown-file");
  });

  it("drops a finding outside any hunk in a known file", () => {
    const patches = [makePatch("src/foo.ts", [{ newStart: 10, newLines: 5 }])];
    const finding = makeFinding({ file: "src/foo.ts", line: 1 });

    const { anchored, dropped } = filterAnchorableFindings([finding], patches);

    expect(anchored).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe("outside-hunk");
  });

  it("anchors at the first and last lines of a hunk inclusively", () => {
    const patches = [makePatch("src/foo.ts", [{ newStart: 10, newLines: 5 }])];
    const start = makeFinding({ file: "src/foo.ts", line: 10 });
    const end = makeFinding({ file: "src/foo.ts", line: 14 });
    const justPastEnd = makeFinding({ file: "src/foo.ts", line: 15 });

    const { anchored, dropped } = filterAnchorableFindings([start, end, justPastEnd], patches);

    expect(anchored).toContain(start);
    expect(anchored).toContain(end);
    expect(anchored).not.toContain(justPastEnd);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe("outside-hunk");
  });

  it("requires a multi-line range to fit entirely inside a single hunk", () => {
    const patches = [
      makePatch("src/foo.ts", [
        { newStart: 10, newLines: 5 },
        { newStart: 30, newLines: 5 },
      ]),
    ];
    const insideOne = makeFinding({ file: "src/foo.ts", line: 11, endLine: 13 });
    const acrossHunks = makeFinding({ file: "src/foo.ts", line: 12, endLine: 31 });

    const { anchored, dropped } = filterAnchorableFindings([insideOne, acrossHunks], patches);

    expect(anchored).toEqual([insideOne]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe("outside-hunk");
  });

  it("drops a deletion-only hunk (newLines=0) for any inline anchor", () => {
    const patches = [makePatch("src/foo.ts", [{ newStart: 10, newLines: 0 }])];
    const finding = makeFinding({ file: "src/foo.ts", line: 10 });

    const { anchored, dropped } = filterAnchorableFindings([finding], patches);

    expect(anchored).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe("outside-hunk");
  });

  it("ignores binary files even when paths match", () => {
    const patches: FilePatch[] = [
      {
        path: "img/logo.png",
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: true,
      },
    ];
    const finding = makeFinding({ file: "img/logo.png", line: 1 });

    const { anchored, dropped } = filterAnchorableFindings([finding], patches);

    expect(anchored).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe("unknown-file");
  });

  it("returns empty arrays for empty input", () => {
    const { anchored, dropped } = filterAnchorableFindings([], []);
    expect(anchored).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it("rejects an inverted range (endLine < line)", () => {
    const patches = [makePatch("src/foo.ts", [{ newStart: 10, newLines: 5 }])];
    const finding = makeFinding({ file: "src/foo.ts", line: 13, endLine: 11 });

    const { anchored, dropped } = filterAnchorableFindings([finding], patches);

    expect(anchored).toEqual([]);
    expect(dropped[0].reason).toBe("outside-hunk");
  });
});
