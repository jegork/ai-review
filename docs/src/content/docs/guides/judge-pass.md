---
title: Judge / filter pass
description: Add a self-reflection stage that scores and drops low-confidence findings before they reach developers.
---

By default, every finding the LLM produces is posted directly to the PR. The judge pass adds a second agent that scores each finding 0–10 for confidence and drops anything below a configurable threshold. The judge is intentionally adversarial: it defaults to rejecting weak findings unless they are grounded in the diff, actionable, and worth surfacing to a developer. This catches hallucinated findings, speculative claims, severity inflation, and low-value noise before they reach developers.

## Enabling it

```bash
RUSTY_JUDGE_ENABLED=true
RUSTY_JUDGE_THRESHOLD=7
RUSTY_JUDGE_MODEL=anthropic/claude-3-5-haiku-20241022
```

`RUSTY_JUDGE_MODEL` is optional — defaults to the same model as `RUSTY_LLM_MODEL`. Using a cheaper model is recommended to keep costs low.

## How it works

1. The reviewer generates findings as normal
2. The judge agent receives the diff and all findings, then scores each one 0–10
3. Findings below the threshold are filtered out and logged at `debug` level
4. The merge recommendation is recalculated based on the surviving findings
5. The summary footer shows token usage for review and judge separately, plus how many findings were filtered

## Tuning the threshold

| Threshold | Behaviour |
| --- | --- |
| 3–4 | Permissive — only drops clearly hallucinated findings |
| 5–6 | Balanced — removes speculative and low-confidence noise |
| 7–8 | Strict — only high-confidence, evidence-backed findings survive; recommended for low-noise review |
| 9–10 | Very strict — likely over-filters; use only in low-noise environments |

The default remains `6` for compatibility. Set `RUSTY_JUDGE_THRESHOLD=7` when you want the judge to act as a stricter false-positive filter.

## Cost

The judge uses a single structured-output call with no tools. Using a cheap model like `claude-3-5-haiku` adds roughly 1–3% to total cost. Using the same model as the reviewer adds roughly 30–50%.
