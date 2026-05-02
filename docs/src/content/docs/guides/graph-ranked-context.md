---
title: Graph-ranked context
description: Add a small GraphSift-inspired dependency context package to deep reviews.
---

Graph-ranked context is an opt-in context selector inspired by [GraphSift](https://github.com/maheshmakvana/graphsift). Rusty Bot does not depend on the Python package. Instead, it builds a small TypeScript-native context package from directly resolvable JavaScript and TypeScript relative imports around deep-review files.

When enabled, Rusty Bot:

1. Reads deep-review files only
2. Resolves directly imported relative JS/TS modules
3. Scores candidates by graph proximity, path overlap, keyword overlap, and symbol overlap
4. Greedily selects context under a hard token budget
5. Injects the selected context before the diff with instructions to keep findings anchored to changed code

```bash
RUSTY_GRAPH_CONTEXT=true
RUSTY_GRAPH_CONTEXT_TOKEN_BUDGET=2000
RUSTY_GRAPH_CONTEXT_MAX_CANDIDATES=8
```

High-scoring files may be included as fuller context. Lower-scoring or large files are rendered as signatures/API surface only. If nothing fits the budget, no context section is added.

This first version is intentionally narrow: no Python runtime, no embeddings, no vector database, no 14-language parity, and no repo-wide importer discovery. It is meant to reduce wasted context for deep reviews while keeping the behavior easy to measure and disable.
