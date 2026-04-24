---
title: Tree-sitter context expansion
description: Diff hunks automatically expand to enclosing function or class boundaries for better review accuracy.
---

Automatic, no configuration needed. When the LLM reviews a diff hunk, the surrounding context is expanded to the enclosing function, method, or class boundary using [tree-sitter](https://tree-sitter.github.io/tree-sitter/) AST parsing. This means the model sees complete semantic units — full functions instead of fragments cut mid-logic.

## Supported languages

TypeScript, TSX, JavaScript, Python, Go, Java, Rust.

## How it works

1. Each changed file is parsed with a WASM-based tree-sitter grammar (no native compilation needed)
2. For each changed line range, the smallest enclosing scope (function, method, class) is found in the AST
3. The hunk expands to include the full enclosing scope
4. Collapsed signatures of sibling functions/methods are prepended for orientation (e.g. `// ... export function otherFn()`)
5. The expanded context replaces the raw hunk in the prompt

## Fallback

If the enclosing scope exceeds 200 lines, or if the language is unsupported (CSS, JSON, YAML, etc.), the bot falls back to a fixed ±10 line expansion with zero overhead.
