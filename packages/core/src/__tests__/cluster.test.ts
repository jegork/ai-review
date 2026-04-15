import { describe, it, expect } from "vitest";
import type { Finding, Observation } from "../types.js";
import {
  tokenize,
  jaccardSimilarity,
  clusterFindings,
  clusterObservations,
} from "../agent/cluster.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: "src/index.ts",
    line: 10,
    endLine: null,
    severity: "warning",
    category: "bugs",
    message: "potential null reference in handler function",
    suggestedFix: "",
    ...overrides,
  };
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    file: "src/index.ts",
    line: 10,
    severity: "warning",
    category: "bugs",
    message: "potential null reference in handler function",
    ...overrides,
  };
}

describe("tokenize", () => {
  it("lowercases and splits on whitespace and punctuation", () => {
    const tokens = tokenize("Hello, World! Foo-Bar");
    expect(tokens).toEqual(new Set(["hello", "world", "foo", "bar"]));
  });

  it("returns empty set for empty string", () => {
    expect(tokenize("")).toEqual(new Set());
  });

  it("returns empty set for only punctuation", () => {
    expect(tokenize("...---!!!")).toEqual(new Set());
  });
});

describe("jaccardSimilarity", () => {
  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("returns 1 for identical sets", () => {
    const s = new Set(["a", "b", "c"]);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["c", "d"]))).toBe(0);
  });

  it("computes correctly for partial overlap", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    // intersection=2, union=4
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });
});

describe("clusterFindings", () => {
  it("returns empty array for empty input", () => {
    expect(clusterFindings([])).toEqual([]);
  });

  it("returns empty array for empty passes", () => {
    expect(clusterFindings([[], []])).toEqual([]);
  });

  it("clusters exact duplicates across passes", () => {
    const f = makeFinding();
    const result = clusterFindings([[f], [f], [f]]);
    expect(result).toHaveLength(1);
    expect(result[0].voteCount).toBe(3);
    expect(result[0].variants).toHaveLength(3);
  });

  it("clusters findings on same file with nearby lines and similar messages", () => {
    const f1 = makeFinding({ line: 10 });
    const f2 = makeFinding({ line: 13, message: "potential null reference in handler" });
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(1);
    expect(result[0].voteCount).toBe(2);
  });

  it("does not cluster findings with same file, nearby lines, but very different messages", () => {
    const f1 = makeFinding({
      line: 10,
      message: "potential null reference in handler function",
    });
    const f2 = makeFinding({
      line: 12,
      message: "unused import should be removed from module",
    });
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(2);
  });

  it("never clusters findings from different files even with identical messages", () => {
    const f1 = makeFinding({ file: "src/a.ts" });
    const f2 = makeFinding({ file: "src/b.ts" });
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(2);
  });

  it("does not cluster findings with distant lines even on same file", () => {
    const f1 = makeFinding({ line: 10 });
    const f2 = makeFinding({ line: 20 });
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(2);
  });

  it("respects jaccard threshold boundary - just above 0.3", () => {
    // 3 shared tokens out of 7 union = 0.4286 > 0.3 -> cluster
    const f1 = makeFinding({ message: "alpha beta gamma delta" });
    const f2 = makeFinding({ message: "alpha beta gamma zeta epsilon" });
    const sim = jaccardSimilarity(tokenize(f1.message), tokenize(f2.message));
    expect(sim).toBeGreaterThanOrEqual(0.3);
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(1);
  });

  it("respects jaccard threshold boundary - just below 0.3", () => {
    // 1 shared token out of 7 union = 0.143 < 0.3 -> separate
    const f1 = makeFinding({ message: "alpha beta gamma delta" });
    const f2 = makeFinding({ message: "alpha zeta epsilon theta" });
    const sim = jaccardSimilarity(tokenize(f1.message), tokenize(f2.message));
    expect(sim).toBeLessThan(0.3);
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(2);
  });

  it("applies category bonus - same category clusters at lower similarity", () => {
    // 2 shared out of 8 union = 0.25, above 0.2 bonus threshold but below 0.3
    const f1 = makeFinding({
      category: "security",
      message: "alpha beta gamma delta",
    });
    const f2 = makeFinding({
      category: "security",
      message: "alpha beta epsilon zeta theta kappa",
    });
    const sim = jaccardSimilarity(tokenize(f1.message), tokenize(f2.message));
    expect(sim).toBeGreaterThanOrEqual(0.2);
    expect(sim).toBeLessThan(0.3);
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(1);
  });

  it("does not apply category bonus across different categories", () => {
    const f1 = makeFinding({
      category: "security",
      message: "alpha beta gamma delta",
    });
    const f2 = makeFinding({
      category: "performance",
      message: "alpha beta epsilon zeta theta kappa",
    });
    const sim = jaccardSimilarity(tokenize(f1.message), tokenize(f2.message));
    expect(sim).toBeLessThan(0.3);
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(2);
  });

  it("counts vote as distinct passes, not total findings", () => {
    const f1 = makeFinding({ line: 10 });
    const f2 = makeFinding({ line: 11 });
    const f3 = makeFinding({ line: 12 });
    // pass 0 has two duplicates, pass 1 has one, pass 2 has none matching
    const result = clusterFindings([[f1, f2], [f3], []]);
    expect(result).toHaveLength(1);
    expect(result[0].voteCount).toBe(2);
    expect(result[0].variants).toHaveLength(3);
  });

  it("selects representative with highest severity", () => {
    const f1 = makeFinding({ severity: "suggestion" });
    const f2 = makeFinding({ severity: "critical" });
    const f3 = makeFinding({ severity: "warning" });
    const result = clusterFindings([[f1], [f2], [f3]]);
    expect(result).toHaveLength(1);
    expect(result[0].representative.severity).toBe("critical");
  });

  it("breaks severity tie by longest message", () => {
    const f1 = makeFinding({
      severity: "warning",
      message: "potential null reference in handler",
    });
    const f2 = makeFinding({
      severity: "warning",
      message: "potential null reference in handler function that processes user input",
    });
    const result = clusterFindings([[f1], [f2]]);
    expect(result).toHaveLength(1);
    expect(result[0].representative.message).toBe(f2.message);
  });

  it("gives voteCount=1 for single pass input", () => {
    const f1 = makeFinding({ line: 10 });
    const f2 = makeFinding({ line: 50, message: "completely different issue" });
    const result = clusterFindings([[f1, f2]]);
    expect(result).toHaveLength(2);
    expect(result[0].voteCount).toBe(1);
    expect(result[1].voteCount).toBe(1);
  });

  it("does not over-cluster unrelated findings in the same file", () => {
    const f1 = makeFinding({
      line: 10,
      category: "bugs",
      message: "potential null reference in handler function",
    });
    const f2 = makeFinding({
      line: 100,
      category: "performance",
      message: "inefficient loop should use map instead of forEach",
    });
    const f3 = makeFinding({
      line: 200,
      category: "security",
      message: "user input not sanitized before database query",
    });
    const result = clusterFindings([
      [f1, f2, f3],
      [f1, f2, f3],
    ]);
    expect(result).toHaveLength(3);
    result.forEach((c) => expect(c.voteCount).toBe(2));
  });

  it("does not dilute similarity when multiple variants join a cluster", () => {
    const f1 = makeFinding({
      message: "potential null pointer dereference in the request handler",
    });
    const f2 = makeFinding({
      message: "possible null pointer dereference in request handler function",
    });
    const f3 = makeFinding({
      message: "null pointer dereference risk in the request handler",
    });
    const result = clusterFindings([[f1], [f2], [f3]]);
    expect(result).toHaveLength(1);
    expect(result[0].voteCount).toBe(3);
  });

  it("handles findings at line proximity boundary (exactly ±5)", () => {
    const f1 = makeFinding({ line: 10 });
    const f2 = makeFinding({ line: 15 });
    const f3 = makeFinding({ line: 16 });

    const withinWindow = clusterFindings([[f1], [f2]]);
    expect(withinWindow).toHaveLength(1);

    const outsideWindow = clusterFindings([[f1], [f3]]);
    expect(outsideWindow).toHaveLength(2);
  });
});

describe("clusterObservations", () => {
  it("clusters observations the same way as findings", () => {
    const o1 = makeObservation({ line: 10 });
    const o2 = makeObservation({ line: 12 });
    const o3 = makeObservation({
      line: 50,
      message: "completely unrelated observation about code style",
    });

    const result = clusterObservations([[o1, o3], [o2]]);
    expect(result).toHaveLength(2);

    const clusteredObs = result.find((c) => c.voteCount === 2);
    expect(clusteredObs).toBeDefined();
    expect(clusteredObs!.variants).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(clusterObservations([])).toEqual([]);
  });

  it("picks highest severity representative for observations", () => {
    const o1 = makeObservation({ severity: "suggestion" });
    const o2 = makeObservation({ severity: "critical" });
    const result = clusterObservations([[o1], [o2]]);
    expect(result).toHaveLength(1);
    expect(result[0].representative.severity).toBe("critical");
  });
});
