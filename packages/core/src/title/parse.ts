import { CONVENTIONAL_COMMIT_TYPES, type ConventionalTitleOutput } from "./schema.js";

const TYPE_PATTERN = CONVENTIONAL_COMMIT_TYPES.join("|");
const CONVENTIONAL_TITLE_REGEX = new RegExp(
  `^(?:${TYPE_PATTERN})(?:\\([^)\\s][^)]*\\))?!?: \\S.*$`,
  "i",
);

// github caps PR titles at 256, ado at 400. cap at the tighter limit so the same
// rewritten title is safe to push to either provider.
export const MAX_TITLE_LENGTH = 256;

export function isConventionalTitle(title: string): boolean {
  return CONVENTIONAL_TITLE_REGEX.test(title.trim());
}

function buildTitle(
  type: string,
  scope: string | undefined,
  breakingMarker: string,
  subject: string,
): string {
  const scopePart = scope ? `(${scope})` : "";
  return `${type}${scopePart}${breakingMarker}: ${subject}`;
}

export function formatConventionalTitle(output: ConventionalTitleOutput): string {
  const scope = output.scope?.trim() || undefined;
  const breakingMarker = output.isBreaking ? "!" : "";
  const subject = output.subject.trim().replace(/\.$/, "");

  const full = buildTitle(output.type, scope, breakingMarker, subject);
  if (full.length <= MAX_TITLE_LENGTH) return full;

  const withoutScope = buildTitle(output.type, undefined, breakingMarker, subject);
  if (withoutScope.length <= MAX_TITLE_LENGTH) return withoutScope;

  const prefixLen = `${output.type}${breakingMarker}: `.length;
  const room = MAX_TITLE_LENGTH - prefixLen - 1;
  const truncatedSubject = room > 0 ? `${subject.slice(0, room).trimEnd()}…` : "…";
  return buildTitle(output.type, undefined, breakingMarker, truncatedSubject);
}
