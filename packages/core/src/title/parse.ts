import { CONVENTIONAL_COMMIT_TYPES, type ConventionalTitleOutput } from "./schema.js";

const TYPE_PATTERN = CONVENTIONAL_COMMIT_TYPES.join("|");
const CONVENTIONAL_TITLE_REGEX = new RegExp(
  `^(?:${TYPE_PATTERN})(?:\\([^)\\s][^)]*\\))?!?: \\S.*$`,
  "i",
);

export function isConventionalTitle(title: string): boolean {
  return CONVENTIONAL_TITLE_REGEX.test(title.trim());
}

export function formatConventionalTitle(output: ConventionalTitleOutput): string {
  const scope = output.scope?.trim();
  const scopePart = scope ? `(${scope})` : "";
  const breakingMarker = output.isBreaking ? "!" : "";
  const subject = output.subject.trim().replace(/\.$/, "");
  return `${output.type}${scopePart}${breakingMarker}: ${subject}`;
}
