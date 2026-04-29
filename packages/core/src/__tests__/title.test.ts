import { describe, it, expect } from "vitest";
import { z } from "zod";
import { isConventionalTitle, formatConventionalTitle, MAX_TITLE_LENGTH } from "../title/parse.js";
import { ConventionalTitleOutputSchema } from "../title/schema.js";
import { buildTitleUserMessage } from "../title/prompt.js";
import type { PRMetadata } from "../types.js";

const prMetadata: PRMetadata = {
  id: "42",
  title: "Add user authentication",
  description: "",
  author: "dev123",
  sourceBranch: "feature/auth",
  targetBranch: "main",
  url: "https://github.com/org/repo/pull/42",
};

describe("isConventionalTitle", () => {
  it("accepts simple type + subject", () => {
    expect(isConventionalTitle("feat: add login flow")).toBe(true);
  });

  it("accepts type with scope", () => {
    expect(isConventionalTitle("fix(auth): handle expired tokens")).toBe(true);
  });

  it("accepts breaking change marker", () => {
    expect(isConventionalTitle("feat!: drop node 18 support")).toBe(true);
  });

  it("accepts breaking change with scope", () => {
    expect(isConventionalTitle("refactor(api)!: rename /v1 endpoints")).toBe(true);
  });

  it("accepts every supported type", () => {
    const types = [
      "feat",
      "fix",
      "docs",
      "style",
      "refactor",
      "perf",
      "test",
      "build",
      "ci",
      "chore",
      "revert",
    ];
    for (const t of types) {
      expect(isConventionalTitle(`${t}: do something`)).toBe(true);
    }
  });

  it("is case-insensitive on the type", () => {
    expect(isConventionalTitle("Fix: use bcrypt")).toBe(true);
    expect(isConventionalTitle("FEAT: add OAuth")).toBe(true);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(isConventionalTitle("  feat: trimmed  ")).toBe(true);
  });

  it("rejects unknown types", () => {
    expect(isConventionalTitle("wip: something")).toBe(false);
    expect(isConventionalTitle("update: something")).toBe(false);
  });

  it("rejects missing colon", () => {
    expect(isConventionalTitle("feat add login flow")).toBe(false);
  });

  it("rejects missing space after colon", () => {
    expect(isConventionalTitle("feat:add login flow")).toBe(false);
  });

  it("rejects missing subject after colon", () => {
    expect(isConventionalTitle("feat: ")).toBe(false);
    expect(isConventionalTitle("feat:")).toBe(false);
  });

  it("rejects empty scope", () => {
    expect(isConventionalTitle("feat(): add login")).toBe(false);
  });

  it("rejects type that only starts with a conventional prefix", () => {
    expect(isConventionalTitle("feature: add login")).toBe(false);
    expect(isConventionalTitle("fixes: a thing")).toBe(false);
  });

  it("rejects plain prose", () => {
    expect(isConventionalTitle("Add user authentication")).toBe(false);
    expect(isConventionalTitle("Bump dependencies")).toBe(false);
  });
});

describe("formatConventionalTitle", () => {
  it("formats type + subject", () => {
    expect(
      formatConventionalTitle({
        type: "feat",
        scope: null,
        subject: "add login flow",
        isBreaking: false,
      }),
    ).toBe("feat: add login flow");
  });

  it("formats type + scope + subject", () => {
    expect(
      formatConventionalTitle({
        type: "fix",
        scope: "auth",
        subject: "handle expired tokens",
        isBreaking: false,
      }),
    ).toBe("fix(auth): handle expired tokens");
  });

  it("appends breaking change marker without scope", () => {
    expect(
      formatConventionalTitle({
        type: "feat",
        scope: null,
        subject: "drop node 18",
        isBreaking: true,
      }),
    ).toBe("feat!: drop node 18");
  });

  it("appends breaking change marker with scope", () => {
    expect(
      formatConventionalTitle({
        type: "refactor",
        scope: "api",
        subject: "rename /v1",
        isBreaking: true,
      }),
    ).toBe("refactor(api)!: rename /v1");
  });

  it("treats blank scope as no scope", () => {
    expect(
      formatConventionalTitle({
        type: "chore",
        scope: "   ",
        subject: "bump deps",
        isBreaking: false,
      }),
    ).toBe("chore: bump deps");
  });

  it("strips trailing period from subject", () => {
    expect(
      formatConventionalTitle({
        type: "docs",
        scope: null,
        subject: "update changelog.",
        isBreaking: false,
      }),
    ).toBe("docs: update changelog");
  });

  it("trims surrounding whitespace from subject and scope", () => {
    expect(
      formatConventionalTitle({
        type: "fix",
        scope: "  cli  ",
        subject: "  handle empty args  ",
        isBreaking: false,
      }),
    ).toBe("fix(cli): handle empty args");
  });

  it("produces output that round-trips through isConventionalTitle", () => {
    const output = formatConventionalTitle({
      type: "feat",
      scope: "auth",
      subject: "add OAuth flow",
      isBreaking: true,
    });
    expect(isConventionalTitle(output)).toBe(true);
  });

  it("leaves a title that fits within the limit unchanged", () => {
    const subject = "a".repeat(200);
    const result = formatConventionalTitle({
      type: "feat",
      scope: "auth",
      subject,
      isBreaking: false,
    });
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result).toBe(`feat(auth): ${subject}`);
  });

  it("drops the scope when including it would exceed the title limit", () => {
    const scope = "a".repeat(50);
    const subject = "b".repeat(MAX_TITLE_LENGTH - 10);
    const result = formatConventionalTitle({
      type: "feat",
      scope,
      subject,
      isBreaking: false,
    });
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result).not.toContain("(");
    expect(result).toBe(`feat: ${subject}`);
  });

  it("truncates the subject when it alone overflows the title limit", () => {
    const subject = "a".repeat(MAX_TITLE_LENGTH + 100);
    const result = formatConventionalTitle({
      type: "feat",
      scope: null,
      subject,
      isBreaking: false,
    });
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result.startsWith("feat: ")).toBe(true);
    expect(result.endsWith("…")).toBe(true);
    expect(isConventionalTitle(result)).toBe(true);
  });

  it("preserves the breaking marker after truncation", () => {
    const subject = "a".repeat(MAX_TITLE_LENGTH + 50);
    const result = formatConventionalTitle({
      type: "refactor",
      scope: "api",
      subject,
      isBreaking: true,
    });
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result.startsWith("refactor!: ")).toBe(true);
    expect(isConventionalTitle(result)).toBe(true);
  });

  it("drops the scope and then truncates when both are needed", () => {
    const scope = "a".repeat(50);
    const subject = "b".repeat(MAX_TITLE_LENGTH + 100);
    const result = formatConventionalTitle({
      type: "feat",
      scope,
      subject,
      isBreaking: false,
    });
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result).not.toContain("(");
    expect(result.startsWith("feat: ")).toBe(true);
    expect(result.endsWith("…")).toBe(true);
    expect(isConventionalTitle(result)).toBe(true);
  });
});

describe("ConventionalTitleOutputSchema", () => {
  it("validates a well-formed output", () => {
    const valid = {
      type: "feat",
      scope: "auth",
      subject: "add OAuth login",
      isBreaking: false,
    };
    expect(ConventionalTitleOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("validates output with null scope", () => {
    const valid = {
      type: "chore",
      scope: null,
      subject: "bump deps",
      isBreaking: false,
    };
    expect(ConventionalTitleOutputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown type", () => {
    const invalid = {
      type: "wip",
      scope: null,
      subject: "something",
      isBreaking: false,
    };
    expect(ConventionalTitleOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(ConventionalTitleOutputSchema.safeParse({ type: "feat" }).success).toBe(false);
  });

  it("rejects empty subject", () => {
    const invalid = {
      type: "feat",
      scope: null,
      subject: "",
      isBreaking: false,
    };
    expect(ConventionalTitleOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects empty scope (must be null instead)", () => {
    const invalid = {
      type: "feat",
      scope: "",
      subject: "do thing",
      isBreaking: false,
    };
    expect(ConventionalTitleOutputSchema.safeParse(invalid).success).toBe(false);
  });

  it("passes openai strict mode — all properties in required", () => {
    interface JsonSchemaObject {
      properties?: Record<string, JsonSchemaObject>;
      required?: string[];
      items?: JsonSchemaObject;
      additionalProperties?: boolean;
      anyOf?: JsonSchemaObject[];
    }

    function collectViolations(schema: JsonSchemaObject, path = ""): string[] {
      const violations: string[] = [];
      if (schema.properties) {
        const propKeys = Object.keys(schema.properties);
        const required = new Set(schema.required ?? []);
        for (const key of propKeys) {
          if (!required.has(key)) {
            violations.push(`${path}.${key} missing from required`);
          }
        }
        if (schema.additionalProperties !== false) {
          violations.push(`${path} must set additionalProperties to false`);
        }
        for (const [key, value] of Object.entries(schema.properties)) {
          violations.push(...collectViolations(value, `${path}.${key}`));
        }
      }
      if (schema.items) violations.push(...collectViolations(schema.items, `${path}[]`));
      for (const branch of schema.anyOf ?? []) {
        violations.push(...collectViolations(branch, path));
      }
      return violations;
    }

    const jsonSchema = z.toJSONSchema(ConventionalTitleOutputSchema) as JsonSchemaObject;
    const violations = collectViolations(jsonSchema);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});

describe("buildTitleUserMessage", () => {
  it("includes the current title and branch info", () => {
    const msg = buildTitleUserMessage("diff content", prMetadata);
    expect(msg).toContain("Add user authentication");
    expect(msg).toContain("feature/auth");
    expect(msg).toContain("main");
  });

  it("includes the diff", () => {
    const msg = buildTitleUserMessage("+ new line\n- old line", prMetadata);
    expect(msg).toContain("+ new line");
    expect(msg).toContain("- old line");
  });

  it("includes description when present", () => {
    const msg = buildTitleUserMessage("diff", { ...prMetadata, description: "Adds OAuth" });
    expect(msg).toContain("## Description");
    expect(msg).toContain("Adds OAuth");
  });

  it("omits description section when blank", () => {
    const msg = buildTitleUserMessage("diff", { ...prMetadata, description: "   " });
    expect(msg).not.toContain("## Description");
  });
});
