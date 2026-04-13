import { describe, expect, it } from "vitest";
import { parseDiff } from "../diff/parser.js";
import { filterFiles } from "../diff/filter.js";
import { compressDiff, countTokens } from "../diff/compress.js";

const singleFileDiff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from "./foo";
+import { bar } from "./bar";

 export function main() {
`;

const multiFileDiff = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2
diff --git a/file2.ts b/file2.ts
--- a/file2.ts
+++ b/file2.ts
@@ -1,3 +1,2 @@
 line1
-removed
 line3
`;

const binaryDiff = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ
`;

const gitBinaryPatchDiff = `diff --git a/font.woff b/font.woff
index abc123..def456 100644
GIT binary patch
literal 1234
some binary data
`;

const renameDiff = `diff --git a/old-name.ts b/new-name.ts
similarity index 95%
rename from old-name.ts
rename to new-name.ts
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,3 +1,3 @@
-export const name = "old";
+export const name = "new";

 export function run() {}
`;

const noNewlineDiff = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
 hello
-world
\\ No newline at end of file
+world!
\\ No newline at end of file
`;

const modeChangeDiff = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
--- a/script.sh
+++ b/script.sh
@@ -1,2 +1,3 @@
 #!/bin/bash
+set -e
 echo "hello"
`;

const multiHunkDiff = `diff --git a/big.ts b/big.ts
--- a/big.ts
+++ b/big.ts
@@ -1,3 +1,4 @@
 import { a } from "a";
+import { b } from "b";

 function first() {
@@ -20,3 +21,4 @@

 function second() {
+  console.log("added");
   return true;
`;

const newFileDiff = `diff --git a/brand-new.ts b/brand-new.ts
--- /dev/null
+++ b/brand-new.ts
@@ -0,0 +1,3 @@
+export const x = 1;
+export const y = 2;
+export const z = 3;
`;

const deletedFileDiff = `diff --git a/gone.ts b/gone.ts
--- a/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const x = 1;
-export const y = 2;
-export const z = 3;
`;

describe("parseDiff", () => {
  it("parses a single-file diff", () => {
    const patches = parseDiff(singleFileDiff);
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe("src/index.ts");
    expect(patches[0].additions).toBe(1);
    expect(patches[0].deletions).toBe(0);
    expect(patches[0].isBinary).toBe(false);
    expect(patches[0].hunks).toHaveLength(1);
  });

  it("parses a multi-file diff", () => {
    const patches = parseDiff(multiFileDiff);
    expect(patches).toHaveLength(2);
    expect(patches[0].path).toBe("file1.ts");
    expect(patches[0].additions).toBe(1);
    expect(patches[0].deletions).toBe(0);
    expect(patches[1].path).toBe("file2.ts");
    expect(patches[1].additions).toBe(0);
    expect(patches[1].deletions).toBe(1);
  });

  it("detects binary files via Binary files marker", () => {
    const patches = parseDiff(binaryDiff);
    expect(patches).toHaveLength(1);
    expect(patches[0].isBinary).toBe(true);
    expect(patches[0].path).toBe("image.png");
    expect(patches[0].hunks).toHaveLength(0);
  });

  it("detects binary files via GIT binary patch", () => {
    const patches = parseDiff(gitBinaryPatchDiff);
    expect(patches).toHaveLength(1);
    expect(patches[0].isBinary).toBe(true);
    expect(patches[0].path).toBe("font.woff");
  });

  it("parses hunk headers with correct line numbers", () => {
    const patches = parseDiff(multiHunkDiff);
    expect(patches).toHaveLength(1);
    const hunks = patches[0].hunks;
    expect(hunks).toHaveLength(2);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].oldLines).toBe(3);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newLines).toBe(4);
    expect(hunks[1].oldStart).toBe(20);
    expect(hunks[1].newStart).toBe(21);
  });

  it("handles file renames", () => {
    const patches = parseDiff(renameDiff);
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe("new-name.ts");
    expect(patches[0].additions).toBe(1);
    expect(patches[0].deletions).toBe(1);
  });

  it("handles no-newline-at-end-of-file", () => {
    const patches = parseDiff(noNewlineDiff);
    expect(patches).toHaveLength(1);
    expect(patches[0].additions).toBe(1);
    expect(patches[0].deletions).toBe(1);
    expect(patches[0].hunks[0].content).toContain("No newline at end of file");
  });

  it("handles mode changes", () => {
    const patches = parseDiff(modeChangeDiff);
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe("script.sh");
    expect(patches[0].additions).toBe(1);
  });

  it("returns empty array for empty diff", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("  \n  \n  ")).toEqual([]);
  });

  it("handles new file creation (--- /dev/null)", () => {
    const patches = parseDiff(newFileDiff);
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe("brand-new.ts");
    expect(patches[0].additions).toBe(3);
    expect(patches[0].deletions).toBe(0);
  });

  it("handles file deletion (+++ /dev/null)", () => {
    const patches = parseDiff(deletedFileDiff);
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe("gone.ts");
    expect(patches[0].additions).toBe(0);
    expect(patches[0].deletions).toBe(3);
  });

  it("parses hunk with omitted count (defaults to 1)", () => {
    const diff = `diff --git a/one.ts b/one.ts
--- a/one.ts
+++ b/one.ts
@@ -5 +5 @@
-old
+new
`;
    const patches = parseDiff(diff);
    expect(patches[0].hunks[0].oldLines).toBe(1);
    expect(patches[0].hunks[0].newLines).toBe(1);
  });
});

describe("filterFiles", () => {
  it("filters out binary files", () => {
    const patches = parseDiff(binaryDiff + singleFileDiff);
    const result = filterFiles(patches);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/index.ts");
  });

  it("filters default lock files", () => {
    const lockDiff = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1,2 +1,3 @@
 lockfileVersion: 9
+something: true
 specifiers: {}
`;
    const patches = parseDiff(lockDiff + singleFileDiff);
    const result = filterFiles(patches);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/index.ts");
  });

  it("filters files matching custom glob patterns", () => {
    const patches = parseDiff(multiFileDiff);
    const result = filterFiles(patches, ["file1.*"]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("file2.ts");
  });

  it("supports nested glob patterns", () => {
    const result = filterFiles(
      [
        { path: "src/utils/helper.ts", hunks: [], additions: 1, deletions: 0, isBinary: false },
        { path: "src/index.ts", hunks: [], additions: 1, deletions: 0, isBinary: false },
      ],
      ["src/utils/**"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/index.ts");
  });

  it("returns empty array when all files are filtered", () => {
    const patches = parseDiff(binaryDiff);
    expect(filterFiles(patches)).toEqual([]);
  });

  it("filters package-lock.json and yarn.lock by default", () => {
    const result = filterFiles([
      { path: "package-lock.json", hunks: [], additions: 100, deletions: 50, isBinary: false },
      { path: "yarn.lock", hunks: [], additions: 200, deletions: 100, isBinary: false },
      { path: "src/app.ts", hunks: [], additions: 5, deletions: 2, isBinary: false },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/app.ts");
  });
});

describe("countTokens", () => {
  it("estimates 4 chars per token", () => {
    expect(countTokens("abcd")).toBe(1);
    expect(countTokens("abcde")).toBe(2);
    expect(countTokens("12345678")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });
});

describe("compressDiff", () => {
  it("compresses patches into formatted output", () => {
    const patches = parseDiff(singleFileDiff);
    const result = compressDiff(patches, 10000);
    expect(result.compressed).toContain("## src/index.ts");
    expect(result.compressed).toContain("__new hunk__");
    expect(result.compressed).toContain("__old hunk__");
    expect(result.skippedFiles).toEqual([]);
  });

  it("skips files when budget is exhausted", () => {
    const patches = parseDiff(multiFileDiff);
    const result = compressDiff(patches, 10);
    expect(result.skippedFiles.length).toBeGreaterThan(0);
  });

  it("returns empty string for empty patches", () => {
    const result = compressDiff([], 1000);
    expect(result.compressed).toBe("");
    expect(result.skippedFiles).toEqual([]);
  });

  it("clips large files to partial hunks when budget is tight", () => {
    const patches = parseDiff(multiHunkDiff);
    // give enough budget to include some lines but not all
    const fullResult = compressDiff(patches, 10000);
    const tightResult = compressDiff(patches, 20);
    expect(tightResult.compressed.length).toBeLessThan(fullResult.compressed.length);
  });

  it("sorts files by token cost descending", () => {
    const patches = [
      { path: "small.ts", hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, content: "+x" }], additions: 1, deletions: 0, isBinary: false },
      { path: "big.ts", hunks: [{ oldStart: 1, oldLines: 10, newStart: 1, newLines: 20, content: "+a\n+b\n+c\n+d\n+e\n+f\n+g\n+h\n+i\n+j" }], additions: 10, deletions: 0, isBinary: false },
    ];
    const result = compressDiff(patches, 10000);
    // big.ts should appear first since it has more tokens
    const bigIdx = result.compressed.indexOf("## big.ts");
    const smallIdx = result.compressed.indexOf("## small.ts");
    expect(bigIdx).toBeLessThan(smallIdx);
  });

  it("handles zero budget gracefully", () => {
    const patches = parseDiff(singleFileDiff);
    const result = compressDiff(patches, 0);
    expect(result.compressed).toBe("");
    expect(result.skippedFiles).toEqual(["src/index.ts"]);
  });
});
