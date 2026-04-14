import type { TicketRef, TicketSource } from "../types.js";

function dedup(refs: TicketRef[]): TicketRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.source}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractFromDescription(text: string): TicketRef[] {
  const refs: TicketRef[] = [];

  // github full URL: https://github.com/owner/repo/issues/123
  for (const m of text.matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/g)) {
    refs.push({
      id: `${m[1]}/${m[2]}#${m[3]}`,
      source: "github",
      url: m[0],
    });
  }

  // azure devops URL: https://dev.azure.com/org/project/_workitems/edit/123
  for (const m of text.matchAll(
    /https:\/\/dev\.azure\.com\/([\w.-]+)\/([\w.-]+)\/_workitems\/edit\/(\d+)/g,
  )) {
    refs.push({ id: m[3], source: "azure-devops", url: m[0] });
  }

  // linear URL: contains linear.app with identifier
  for (const m of text.matchAll(/https:\/\/linear\.app\/[\w.-]+\/issue\/([A-Z]{2,10}-\d+)/g)) {
    refs.push({ id: m[1], source: "linear", url: m[0] });
  }

  // jira URL: .../browse/PROJ-123 or .../jira.../browse/PROJ-123
  for (const m of text.matchAll(/(https:\/\/[^\s]*jira[^\s]*\/browse\/([A-Z]{2,10}-\d+))/g)) {
    refs.push({ id: m[2], source: "jira", url: m[1] });
  }

  // AB#123 (azure devops inline)
  for (const m of text.matchAll(/\bAB#(\d+)\b/g)) {
    refs.push({ id: m[1], source: "azure-devops" });
  }

  // owner/repo#123 (github cross-repo ref) - avoid matching URLs already captured
  for (const m of text.matchAll(/(?<![/\w])([\w.-]+)\/([\w.-]+)#(\d+)(?!\d)/g)) {
    // skip if this looks like it's part of a URL we already matched
    if (m[1] === "github.com" || m[1] === "dev.azure.com") continue;
    refs.push({ id: `${m[1]}/${m[2]}#${m[3]}`, source: "github" });
  }

  // bare #123 (github) - must not be preceded by letters (to avoid PROJ-123 matches)
  for (const m of text.matchAll(/(?<![&\w/])#(\d+)\b/g)) {
    refs.push({ id: m[1], source: "github" });
  }

  const linearIds = new Set(refs.filter((r) => r.source === "linear").map((r) => r.id));

  // PROJ-123 style (jira by default, linear if URL already found for that id)
  for (const m of text.matchAll(/\b([A-Z]{2,10}-\d+)\b/g)) {
    const id = m[0];
    // skip if already captured via URL-based extraction
    if (refs.some((r) => r.id === id)) continue;
    const source: TicketSource = linearIds.has(id) ? "linear" : "jira";
    refs.push({ id, source });
  }

  return refs;
}

function extractFromBranch(branch: string): TicketRef[] {
  const refs: TicketRef[] = [];

  // AB#123 in branch
  const abMatch = /AB#(\d+)/.exec(branch);
  if (abMatch) {
    refs.push({ id: abMatch[1], source: "azure-devops" });
    return refs;
  }

  // PROJ-123 style in branch
  const projMatch = /([A-Z]{2,10}-\d+)/.exec(branch);
  if (projMatch) {
    refs.push({ id: projMatch[1], source: "jira" });
    return refs;
  }

  // feature/123-desc style (bare number after slash)
  const numMatch = /\/(\d+)(?:-|$)/.exec(branch);
  if (numMatch) {
    refs.push({ id: numMatch[1], source: "github" });
    return refs;
  }

  return refs;
}

export function extractTicketRefs(description: string, branchName: string): TicketRef[] {
  const descRefs = extractFromDescription(description);
  const branchRefs = extractFromBranch(branchName);
  return dedup([...descRefs, ...branchRefs]);
}
