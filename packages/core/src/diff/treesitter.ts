import { Parser, Language, type Node } from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SCOPE_NODE_TYPES: Record<string, string[]> = {
  typescript: [
    "function_declaration",
    "method_definition",
    "arrow_function",
    "class_declaration",
    "interface_declaration",
  ],
  tsx: [
    "function_declaration",
    "method_definition",
    "arrow_function",
    "class_declaration",
    "interface_declaration",
  ],
  javascript: ["function_declaration", "method_definition", "arrow_function", "class_declaration"],
  python: ["function_definition", "class_definition"],
  go: ["function_declaration", "method_declaration", "type_declaration"],
  java: [
    "method_declaration",
    "class_declaration",
    "constructor_declaration",
    "interface_declaration",
  ],
  rust: ["function_item", "impl_item", "struct_item", "enum_item", "trait_item"],
};

const EXTENSION_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rs": "rust",
};

const GRAMMAR_TO_PACKAGE: Record<string, { pkg: string; wasm: string }> = {
  typescript: { pkg: "tree-sitter-typescript", wasm: "tree-sitter-typescript.wasm" },
  tsx: { pkg: "tree-sitter-typescript", wasm: "tree-sitter-tsx.wasm" },
  javascript: { pkg: "tree-sitter-javascript", wasm: "tree-sitter-javascript.wasm" },
  python: { pkg: "tree-sitter-python", wasm: "tree-sitter-python.wasm" },
  go: { pkg: "tree-sitter-go", wasm: "tree-sitter-go.wasm" },
  java: { pkg: "tree-sitter-java", wasm: "tree-sitter-java.wasm" },
  rust: { pkg: "tree-sitter-rust", wasm: "tree-sitter-rust.wasm" },
};

const DEFAULT_MAX_SCOPE_LINES = 200;

let parserInitialized = false;
const languageCache = new Map<string, Language>();

export interface ExpandedScope {
  /** 1-based start line of the enclosing scope */
  startLine: number;
  /** 1-based end line of the enclosing scope */
  endLine: number;
}

export interface TreeSitterExpansion {
  scopes: ExpandedScope[];
  /** collapsed signature lines from sibling scopes for orientation */
  siblingSignatures: { line: number; text: string }[];
}

async function ensureInit(): Promise<void> {
  if (parserInitialized) return;
  await Parser.init();
  parserInitialized = true;
}

async function loadLanguage(grammar: string): Promise<Language | null> {
  const cached = languageCache.get(grammar);
  if (cached) return cached;

  const info = GRAMMAR_TO_PACKAGE[grammar];

  try {
    const pkgDir = require.resolve(`${info.pkg}/package.json`);
    const wasmPath = pkgDir.replace("package.json", info.wasm);
    const wasmBytes = await readFile(wasmPath);
    const lang = await Language.load(wasmBytes);
    languageCache.set(grammar, lang);
    return lang;
  } catch {
    return null;
  }
}

export function getGrammarForFile(filePath: string): string | null {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return null;

  if (filePath.endsWith(".d.ts")) return "typescript";

  const ext = filePath.slice(lastDot).toLowerCase();
  return EXTENSION_TO_GRAMMAR[ext] ?? null;
}

function findSmallestEnclosingScope(
  node: Node,
  startRow: number,
  endRow: number,
  scopeTypes: string[],
): Node | null {
  let best: Node | null = null;

  if (node.startPosition.row <= startRow && node.endPosition.row >= endRow) {
    if (scopeTypes.includes(node.type)) {
      best = node;
    }

    for (const child of node.children) {
      const childResult = findSmallestEnclosingScope(child, startRow, endRow, scopeTypes);
      if (childResult) {
        best = childResult;
      }
    }
  }

  return best;
}

function getSignatureLine(node: Node, fileLines: string[]): string {
  const row = node.startPosition.row;
  if (row < fileLines.length) {
    return fileLines[row].trimEnd();
  }
  return "";
}

// collect scope-type nodes from a parent, peeking one level deeper
// to see through wrappers like export_statement
function findScopeChildren(node: Node, scopeTypes: string[]): Node[] {
  const results: Node[] = [];
  for (const child of node.namedChildren) {
    if (scopeTypes.includes(child.type)) {
      results.push(child);
    } else {
      for (const grandchild of child.namedChildren) {
        if (scopeTypes.includes(grandchild.type)) {
          results.push(grandchild);
        }
      }
    }
  }
  return results;
}

function collectSiblingSignatures(
  scopeNode: Node,
  scopeTypes: string[],
  fileLines: string[],
): { line: number; text: string }[] {
  // walk up until we find a parent whose scope children include siblings
  let parent = scopeNode.parent;
  while (parent) {
    const scopeChildren = findScopeChildren(parent, scopeTypes);
    if (scopeChildren.some((n) => n.id !== scopeNode.id)) {
      const signatures: { line: number; text: string }[] = [];
      for (const sibling of scopeChildren) {
        if (sibling.id === scopeNode.id) continue;
        const text = getSignatureLine(sibling, fileLines);
        if (text) {
          signatures.push({ line: sibling.startPosition.row + 1, text });
        }
      }
      return signatures;
    }
    parent = parent.parent;
  }

  return [];
}

/**
 * Try to expand changed line ranges to enclosing function/class boundaries
 * using tree-sitter. Returns null if tree-sitter can't handle this file
 * (unsupported language, parse failure, scope too large).
 */
export async function expandToScopeBoundaries(
  fileContent: string,
  changedRanges: { startLine: number; endLine: number }[],
  filePath: string,
  maxScopeLines: number = DEFAULT_MAX_SCOPE_LINES,
): Promise<TreeSitterExpansion | null> {
  const grammar = getGrammarForFile(filePath);
  if (!grammar) return null;

  const scopeTypes = SCOPE_NODE_TYPES[grammar];

  try {
    await ensureInit();
    const language = await loadLanguage(grammar);
    if (!language) return null;

    const parser = new Parser();
    parser.setLanguage(language);

    const tree = parser.parse(fileContent);
    if (!tree) return null;

    const fileLines = fileContent.split("\n");
    const scopes: ExpandedScope[] = [];
    const allSiblingSignatures: { line: number; text: string }[] = [];
    const seenScopeIds = new Set<number>();
    const seenSignatureLines = new Set<number>();

    for (const range of changedRanges) {
      const startRow = range.startLine - 1;
      const endRow = range.endLine - 1;

      const scopeNode = findSmallestEnclosingScope(tree.rootNode, startRow, endRow, scopeTypes);

      if (!scopeNode) return null;

      const scopeLines = scopeNode.endPosition.row - scopeNode.startPosition.row + 1;
      if (scopeLines > maxScopeLines) return null;

      if (seenScopeIds.has(scopeNode.id)) continue;
      seenScopeIds.add(scopeNode.id);

      scopes.push({
        startLine: scopeNode.startPosition.row + 1,
        endLine: scopeNode.endPosition.row + 1,
      });

      for (const sig of collectSiblingSignatures(scopeNode, scopeTypes, fileLines)) {
        if (!seenSignatureLines.has(sig.line)) {
          seenSignatureLines.add(sig.line);
          allSiblingSignatures.push(sig);
        }
      }
    }

    tree.delete();
    parser.delete();

    if (scopes.length === 0) return null;

    allSiblingSignatures.sort((a, b) => a.line - b.line);
    return { scopes, siblingSignatures: allSiblingSignatures };
  } catch {
    return null;
  }
}
