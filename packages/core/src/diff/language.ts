import type { FilePatch } from "../types.js";

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript (React)",
  ".js": "JavaScript",
  ".jsx": "JavaScript (React)",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".rb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".scala": "Scala",
  ".cs": "C#",
  ".fs": "F#",
  ".swift": "Swift",
  ".m": "Objective-C",
  ".mm": "Objective-C++",
  ".cpp": "C++",
  ".cc": "C++",
  ".cxx": "C++",
  ".c": "C",
  ".h": "C/C++ Header",
  ".hpp": "C++ Header",
  ".php": "PHP",
  ".dart": "Dart",
  ".lua": "Lua",
  ".r": "R",
  ".sql": "SQL",
  ".sh": "Shell",
  ".bash": "Shell",
  ".zsh": "Shell",
  ".ps1": "PowerShell",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".less": "Less",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".proto": "Protocol Buffers",
  ".graphql": "GraphQL",
  ".gql": "GraphQL",
  ".tf": "Terraform",
  ".hcl": "HCL",
  ".dockerfile": "Dockerfile",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".erl": "Erlang",
  ".zig": "Zig",
  ".nim": "Nim",
  ".clj": "Clojure",
  ".ml": "OCaml",
  ".hs": "Haskell",
};

function getExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";

  // handle .d.ts
  if (path.endsWith(".d.ts")) return ".d.ts";

  return path.slice(lastDot).toLowerCase();
}

export function detectLanguage(path: string): string | null {
  const basename = path.split("/").pop() ?? "";
  if (basename === "Dockerfile" || basename.startsWith("Dockerfile.")) return "Dockerfile";
  if (basename === "Makefile") return "Makefile";

  const ext = getExtension(path);
  if (ext === ".d.ts") return "TypeScript (declarations)";

  return EXTENSION_MAP[ext] ?? null;
}

export function summarizeLanguages(patches: FilePatch[]): string {
  const counts = new Map<string, number>();

  for (const patch of patches) {
    const lang = detectLanguage(patch.path);
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + patch.additions + patch.deletions);
  }

  if (counts.size === 0) return "";

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, n]) => sum + n, 0);

  const parts = sorted.map(([lang, n]) => {
    const pct = Math.round((n / total) * 100);
    return `${lang} (${pct}%)`;
  });

  return `This PR primarily contains ${parts.join(", ")}.`;
}
