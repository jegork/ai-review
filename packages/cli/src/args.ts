import { ReviewStyleSchema, type FocusArea, type ReviewStyle } from "@rusty-bot/core";

const ALL_FOCUS_AREAS: FocusArea[] = ["security", "performance", "bugs", "style", "tests", "docs"];

export type OutputFormat = "markdown" | "json";

export interface CliArgs {
  repoPath: string;
  baseRef: string;
  headRef: string;
  style: ReviewStyle;
  focusAreas: FocusArea[];
  ignorePatterns: string[];
  format: OutputFormat;
  failOnCritical: boolean;
  help: boolean;
}

export const HELP_TEXT = `Usage: rusty-bot [options]

Run a rusty-bot code review against a local git diff and print the result.

Options:
  --repo <path>          path to the git repo (default: cwd)
  --base <ref>           base ref to diff against (default: main)
  --head <ref>           head ref to review (default: HEAD)
  --style <style>        review style: strict | balanced | lenient | roast | thorough
                         (default: balanced)
  --focus <list>         comma-separated focus areas: ${ALL_FOCUS_AREAS.join(",")}
                         (default: all)
  --ignore <list>        comma-separated glob patterns to exclude
  --format <fmt>         output format: markdown | json (default: markdown)
  --fail-on-critical     exit non-zero when critical findings are present
  -h, --help             show this help

Environment:
  RUSTY_LLM_MODEL        e.g. anthropic/claude-sonnet-4-20250514
  ANTHROPIC_API_KEY      (or the matching key for the chosen provider)
`;

function takeValue(name: string, argv: string[], i: number): string {
  if (i + 1 >= argv.length || argv[i + 1].startsWith("-")) {
    throw new Error(`option ${name} requires a value`);
  }
  return argv[i + 1];
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    repoPath: process.cwd(),
    baseRef: "main",
    headRef: "HEAD",
    style: "balanced",
    focusAreas: ALL_FOCUS_AREAS,
    ignorePatterns: [],
    format: "markdown",
    failOnCritical: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--repo":
        args.repoPath = takeValue(arg, argv, i++);
        break;
      case "--base":
        args.baseRef = takeValue(arg, argv, i++);
        break;
      case "--head":
        args.headRef = takeValue(arg, argv, i++);
        break;
      case "--style": {
        const raw = takeValue(arg, argv, i++);
        const parsed = ReviewStyleSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(`invalid review style: ${raw}`);
        }
        args.style = parsed.data;
        break;
      }
      case "--focus": {
        const raw = takeValue(arg, argv, i++);
        const requested = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const valid = requested.filter((a): a is FocusArea =>
          (ALL_FOCUS_AREAS as string[]).includes(a),
        );
        const invalid = requested.filter((a) => !valid.includes(a as FocusArea));
        if (invalid.length > 0) {
          throw new Error(
            `unknown focus area(s): ${invalid.join(", ")}. allowed: ${ALL_FOCUS_AREAS.join(", ")}`,
          );
        }
        args.focusAreas = valid.length > 0 ? valid : ALL_FOCUS_AREAS;
        break;
      }
      case "--ignore": {
        const raw = takeValue(arg, argv, i++);
        args.ignorePatterns = raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      }
      case "--format": {
        const raw = takeValue(arg, argv, i++);
        if (raw !== "markdown" && raw !== "json") {
          throw new Error(`invalid format: ${raw} (expected markdown or json)`);
        }
        args.format = raw;
        break;
      }
      case "--fail-on-critical":
        args.failOnCritical = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return args;
}
