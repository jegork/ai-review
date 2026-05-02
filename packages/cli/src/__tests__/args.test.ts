import { describe, it, expect } from "vitest";
import { parseArgs } from "../args.js";

describe("parseArgs", () => {
  it("returns defaults when no args are provided", () => {
    const args = parseArgs([]);
    expect(args.baseRef).toBe("main");
    expect(args.headRef).toBe("HEAD");
    expect(args.style).toBe("balanced");
    expect(args.format).toBe("markdown");
    expect(args.failOnCritical).toBe(false);
    expect(args.focusAreas).toEqual(["security", "performance", "bugs", "style", "tests", "docs"]);
    expect(args.ignorePatterns).toEqual([]);
  });

  it("parses repo, base, head, and style", () => {
    const args = parseArgs([
      "--repo",
      "/tmp/repo",
      "--base",
      "develop",
      "--head",
      "feature-branch",
      "--style",
      "strict",
    ]);
    expect(args.repoPath).toBe("/tmp/repo");
    expect(args.baseRef).toBe("develop");
    expect(args.headRef).toBe("feature-branch");
    expect(args.style).toBe("strict");
  });

  it("parses focus areas as a comma list", () => {
    const args = parseArgs(["--focus", "security,bugs"]);
    expect(args.focusAreas).toEqual(["security", "bugs"]);
  });

  it("rejects unknown focus areas", () => {
    expect(() => parseArgs(["--focus", "security,wat"])).toThrow(/unknown focus area/);
  });

  it("rejects unknown options", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown option/);
  });

  it("rejects invalid style", () => {
    expect(() => parseArgs(["--style", "ferocious"])).toThrow(/invalid review style/);
  });

  it("rejects invalid format", () => {
    expect(() => parseArgs(["--format", "yaml"])).toThrow(/invalid format/);
  });

  it("requires a value after a flag that takes one", () => {
    expect(() => parseArgs(["--base"])).toThrow(/requires a value/);
    expect(() => parseArgs(["--base", "--head", "x"])).toThrow(/requires a value/);
  });

  it("supports --fail-on-critical and --help", () => {
    const args = parseArgs(["--fail-on-critical", "--help"]);
    expect(args.failOnCritical).toBe(true);
    expect(args.help).toBe(true);
  });

  it("parses ignore patterns", () => {
    const args = parseArgs(["--ignore", "dist/**,*.lock"]);
    expect(args.ignorePatterns).toEqual(["dist/**", "*.lock"]);
  });
});
