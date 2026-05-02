import path from "node:path";
import type { FilePatch, PRMetadata } from "../types.js";
import { countTokens } from "./compress.js";
import type { FileContentFetcher } from "./context.js";

const DEFAULT_TOKEN_BUDGET = 2_000;
const DEFAULT_MAX_CANDIDATES = 8;
const JS_TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "src",
  "test",
  "tests",
  "true",
  "false",
  "null",
  "undefined",
  "return",
  "import",
  "export",
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "type",
]);

export interface GraphContextConfig {
  enabled: boolean;
  tokenBudget: number;
  maxCandidates: number;
}

interface Candidate {
  path: string;
  content: string;
  importedBy: Set<string>;
  keywords: Set<string>;
  symbols: Set<string>;
  score: number;
  reasons: string[];
}

export interface GraphContextSelection {
  path: string;
  score: number;
  tokens: number;
  mode: "full" | "signatures";
  reasons: string[];
}

export interface GraphRankedContextResult {
  renderedContext: string;
  selections: GraphContextSelection[];
  tokenCount: number;
}

export function resolveGraphContextConfig(): GraphContextConfig {
  const enabled =
    process.env.RUSTY_GRAPH_CONTEXT === "true" || process.env.RUSTY_GRAPH_CONTEXT === "1";
  const tokenBudget = readPositiveInt(
    process.env.RUSTY_GRAPH_CONTEXT_TOKEN_BUDGET,
    DEFAULT_TOKEN_BUDGET,
  );
  const maxCandidates = readPositiveInt(
    process.env.RUSTY_GRAPH_CONTEXT_MAX_CANDIDATES,
    DEFAULT_MAX_CANDIDATES,
  );

  return { enabled, tokenBudget, maxCandidates };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function isJsTsPath(filePath: string): boolean {
  return JS_TS_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    const token = raw.toLowerCase();
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

function extractSymbols(content: string): Set<string> {
  const symbols = new Set<string>();
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\binterface\s+([A-Za-z_$][\w$]*)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      symbols.add(match[1].toLowerCase());
    }
  }
  return symbols;
}

function extractImportSpecifiers(content: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?[^'"]+?\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      specs.push(match[1]);
    }
  }
  return specs;
}

function diffTextForPatch(patch: FilePatch): string {
  return patch.hunks.map((h) => h.content).join("\n");
}

function changedKeywordSet(patches: FilePatch[], prMetadata: PRMetadata): Set<string> {
  return tokenize(
    [
      prMetadata.title,
      prMetadata.description,
      ...patches.flatMap((patch) => [patch.path, diffTextForPatch(patch)]),
    ].join("\n"),
  );
}

function changedSymbolsSet(contents: string[]): Set<string> {
  const symbols = new Set<string>();
  for (const content of contents) {
    for (const symbol of extractSymbols(content)) {
      symbols.add(symbol);
    }
  }
  return symbols;
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const value of a) {
    if (b.has(value)) overlap++;
  }
  return overlap / Math.min(a.size, b.size);
}

function pathOverlapScore(candidatePath: string, changedPaths: string[]): number {
  const candidateParts = candidatePath.split("/");
  let best = 0;

  for (const changedPath of changedPaths) {
    const changedParts = changedPath.split("/");
    const shared = candidateParts.filter((part) => changedParts.includes(part)).length;
    best = Math.max(best, shared / Math.max(candidateParts.length, changedParts.length));
  }

  return best;
}

function normalizeRepoPath(filePath: string): string {
  return path.posix.normalize(filePath).replace(/^\.\//, "");
}

function importCandidates(fromPath: string, specifier: string): string[] {
  if (!specifier.startsWith(".")) return [];

  const dir = path.posix.dirname(fromPath);
  const base = normalizeRepoPath(path.posix.join(dir, specifier));
  const ext = path.posix.extname(base);
  if (ext) return [base];

  return [
    ...JS_TS_EXTENSIONS.map((candidateExt) => `${base}${candidateExt}`),
    ...JS_TS_EXTENSIONS.map((candidateExt) => `${base}/index${candidateExt}`),
  ];
}

async function resolveImportPath(
  fromPath: string,
  specifier: string,
  fetchContent: FileContentFetcher,
): Promise<{ path: string; content: string } | null> {
  for (const candidate of importCandidates(fromPath, specifier)) {
    const content = await fetchContent(candidate);
    if (content !== null) {
      return { path: candidate, content };
    }
  }
  return null;
}

function renderSignatures(content: string): string {
  const lines = content.split("\n");
  const signatures = lines
    .map((line) => line.trimEnd())
    .filter((line) =>
      /^(import\s|export\s|(?:export\s+)?(?:async\s+)?function\s|(?:export\s+)?class\s|(?:export\s+)?interface\s|(?:export\s+)?type\s|(?:export\s+)?const\s)/.test(
        line.trimStart(),
      ),
    );

  return signatures.slice(0, 80).join("\n");
}

function renderCandidate(candidate: Candidate, mode: "full" | "signatures"): string {
  const body =
    mode === "full" ? candidate.content.trim() : renderSignatures(candidate.content).trim();
  if (!body) return "";

  return [
    `### ${candidate.path}`,
    `Score: ${candidate.score.toFixed(2)} | Mode: ${mode} | Reasons: ${candidate.reasons.join(", ")}`,
    "```ts",
    body,
    "```",
  ].join("\n");
}

function scoreCandidate(
  candidate: Candidate,
  changedPaths: string[],
  changedKeywords: Set<string>,
  changedSymbols: Set<string>,
): void {
  const graphScore = Math.min(1, candidate.importedBy.size) * 0.55;
  const pathScore = pathOverlapScore(candidate.path, changedPaths) * 0.15;
  const keywordScore = overlapRatio(candidate.keywords, changedKeywords) * 0.15;
  const symbolScore = overlapRatio(candidate.symbols, changedSymbols) * 0.15;
  candidate.score = Math.min(1, graphScore + pathScore + keywordScore + symbolScore);

  candidate.reasons = [
    `imported by ${candidate.importedBy.size} changed file${candidate.importedBy.size === 1 ? "" : "s"}`,
  ];
  if (pathScore > 0) candidate.reasons.push("path overlap");
  if (keywordScore > 0) candidate.reasons.push("keyword overlap");
  if (symbolScore > 0) candidate.reasons.push("symbol overlap");
}

export async function buildGraphRankedContext(
  patches: FilePatch[],
  fetchContent: FileContentFetcher,
  prMetadata: PRMetadata,
  config: GraphContextConfig = resolveGraphContextConfig(),
): Promise<GraphRankedContextResult> {
  if (!config.enabled || config.tokenBudget <= 0 || patches.length === 0) {
    return { renderedContext: "", selections: [], tokenCount: 0 };
  }

  const changedPaths = patches.map((p) => p.path).filter(isJsTsPath);
  if (changedPaths.length === 0) {
    return { renderedContext: "", selections: [], tokenCount: 0 };
  }

  const changedPathSet = new Set(changedPaths);
  const changedContents: string[] = [];
  const candidates = new Map<string, Candidate>();

  for (const changedPath of changedPaths) {
    const content = await fetchContent(changedPath);
    if (!content) continue;
    changedContents.push(content);

    for (const specifier of extractImportSpecifiers(content)) {
      const resolved = await resolveImportPath(changedPath, specifier, fetchContent);
      if (!resolved || changedPathSet.has(resolved.path) || !isJsTsPath(resolved.path)) continue;

      const existing = candidates.get(resolved.path);
      if (existing) {
        existing.importedBy.add(changedPath);
        continue;
      }

      candidates.set(resolved.path, {
        path: resolved.path,
        content: resolved.content,
        importedBy: new Set([changedPath]),
        keywords: tokenize(`${resolved.path}\n${resolved.content}`),
        symbols: extractSymbols(resolved.content),
        score: 0,
        reasons: [],
      });
    }
  }

  const changedKeywords = changedKeywordSet(patches, prMetadata);
  const changedSymbols = changedSymbolsSet(changedContents);
  for (const candidate of candidates.values()) {
    scoreCandidate(candidate, changedPaths, changedKeywords, changedSymbols);
  }

  const header = [
    "## Graph-ranked Context",
    "The following related files were selected under a token budget for orientation. Use them to understand dependencies and API contracts, but anchor findings to the reviewed diff unless the changed code creates the risk.",
  ].join("\n");
  const headerTokens = countTokens(header);
  if (headerTokens >= config.tokenBudget) {
    return { renderedContext: "", selections: [], tokenCount: 0 };
  }

  const selected: string[] = [];
  const selections: GraphContextSelection[] = [];
  let remaining = config.tokenBudget - headerTokens;

  const ranked = [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, config.maxCandidates);

  for (const candidate of ranked) {
    const preferredMode = candidate.score >= 0.75 ? "full" : "signatures";
    const modes: ("full" | "signatures")[] =
      preferredMode === "full" ? ["full", "signatures"] : ["signatures"];

    for (const mode of modes) {
      const rendered = renderCandidate(candidate, mode);
      if (!rendered) continue;

      const tokens = countTokens(rendered);
      if (tokens > remaining) continue;

      selected.push(rendered);
      selections.push({
        path: candidate.path,
        score: Number(candidate.score.toFixed(3)),
        tokens,
        mode,
        reasons: candidate.reasons,
      });
      remaining -= tokens;
      break;
    }
  }

  if (selected.length === 0) {
    return { renderedContext: "", selections: [], tokenCount: 0 };
  }

  const renderedContext = [header, ...selected].join("\n\n");

  return {
    renderedContext,
    selections,
    tokenCount: countTokens(renderedContext),
  };
}
