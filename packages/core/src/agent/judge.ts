import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  resolveModelConfig,
  resolveModel,
  getModelDisplayName,
  resolveModelSettings,
} from "./model.js";
import type { Finding, ReviewResult } from "../types.js";
import { logger } from "../logger.js";

const log = logger.child({ module: "judge" });

export interface JudgeConfig {
  enabled: boolean;
  /** minimum confidence score (0–10) to keep a finding. defaults to 6 */
  threshold: number;
  /** override model for the judge (e.g. a cheaper one). falls back to RUSTY_LLM_MODEL */
  model?: string;
}

interface JudgeEvaluation {
  index: number;
  confidence: number;
  reasoning: string;
}

const EvaluationSchema = z.object({
  index: z.number().describe("zero-based index of the finding being evaluated"),
  confidence: z
    .number()
    .min(0)
    .max(10)
    .describe(
      "confidence that this finding is a real, actionable issue (0 = certainly wrong, 10 = certainly correct)",
    ),
  reasoning: z.string().describe("one sentence explaining the confidence score"),
});

const JudgeOutputSchema = z.object({
  evaluations: z
    .array(EvaluationSchema)
    .describe("one evaluation per finding, in the same order as the input"),
});

const JUDGE_SYSTEM_PROMPT = `You are a code review quality judge. Your job is to evaluate whether each finding from a code review is a real, actionable issue or a false positive.

For each finding you receive, rate your confidence from 0 to 10 that the finding is correct and worth surfacing to a developer:

- 10: obviously correct, verified by the code
- 7-9: very likely correct, strong evidence in the diff
- 4-6: plausible but uncertain, may be a false positive
- 1-3: likely wrong, speculative, or nitpicking
- 0: clearly hallucinated or factually incorrect

Common false positive patterns to penalize:
- claiming something is unused/missing without evidence
- flagging standard patterns as bugs (e.g. intentional fallthrough, optional chaining on purpose)
- suggesting changes that would break the code
- duplicating another finding with different wording
- nitpicking style when the review didn't ask for style feedback
- hallucinated line numbers or code references that don't match the diff

You MUST return exactly one evaluation per finding, in the same order they were provided.`;

function formatFindingsForJudge(findings: readonly Finding[], diff: string): string {
  const parts: string[] = [];

  parts.push("## Diff under review\n");
  parts.push(diff);
  parts.push("\n## Findings to evaluate\n");

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const lineRange = f.endLine ? `${f.line}-${f.endLine}` : `${f.line}`;
    parts.push(`### Finding ${i}`);
    parts.push(`- **File:** ${f.file}`);
    parts.push(`- **Line:** ${lineRange}`);
    parts.push(`- **Severity:** ${f.severity}`);
    parts.push(`- **Category:** ${f.category}`);
    parts.push(`- **Message:** ${f.message}`);
    if (f.suggestedFix) {
      parts.push(`- **Suggested fix:**\n\`\`\`\n${f.suggestedFix}\n\`\`\``);
    }
    parts.push("");
  }

  return parts.join("\n");
}

function resolveJudgeModel(judgeModelOverride?: string) {
  if (judgeModelOverride) {
    return { model: judgeModelOverride, displayName: judgeModelOverride };
  }

  const config = resolveModelConfig();
  return { model: resolveModel(config), displayName: getModelDisplayName(config) };
}

export function resolveJudgeConfig(): JudgeConfig {
  const enabled = process.env.RUSTY_JUDGE_ENABLED;
  const threshold = process.env.RUSTY_JUDGE_THRESHOLD;
  const model = process.env.RUSTY_JUDGE_MODEL;

  return {
    enabled: enabled === "true" || enabled === "1",
    threshold: threshold && !Number.isNaN(Number(threshold)) ? Number(threshold) : 6,
    model: model || undefined,
  };
}

export interface JudgeResult {
  accepted: Finding[];
  rejected: Finding[];
  evaluations: JudgeEvaluation[];
  tokenCount: number;
}

export async function judgeFindings(
  findings: readonly Finding[],
  diff: string,
  config: JudgeConfig,
): Promise<JudgeResult> {
  if (!config.enabled || findings.length === 0) {
    return { accepted: [...findings], rejected: [], evaluations: [], tokenCount: 0 };
  }

  const { model, displayName } = resolveJudgeModel(config.model);

  log.info(
    { findingCount: findings.length, model: displayName, threshold: config.threshold },
    "running judge pass",
  );

  const agent = new Agent({
    id: "review-judge",
    name: "Rusty Bot Judge",
    instructions: JUDGE_SYSTEM_PROMPT,
    model,
  });

  const userMessage = formatFindingsForJudge(findings, diff);

  let evaluations: JudgeEvaluation[];
  let tokenCount = 0;
  try {
    const modelSettings = resolveModelSettings("judge");
    const response = await agent.generate(userMessage, {
      structuredOutput: { schema: JudgeOutputSchema },
      ...(Object.keys(modelSettings).length > 0 && { modelSettings }),
    });
    evaluations = response.object.evaluations;
    tokenCount = response.usage.totalTokens ?? 0;
  } catch (err) {
    log.warn({ err }, "judge pass failed, keeping all findings");
    return { accepted: [...findings], rejected: [], evaluations: [], tokenCount: 0 };
  }

  // build a lookup so we handle models returning fewer or out-of-order evaluations
  const evalByIndex = new Map(evaluations.map((e) => [e.index, e]));
  const accepted: Finding[] = [];
  const rejected: Finding[] = [];
  const rejectedWithEval: { finding: Finding; evaluation: JudgeEvaluation }[] = [];
  const resolvedEvaluations: JudgeEvaluation[] = [];

  for (let i = 0; i < findings.length; i++) {
    const evaluation = evalByIndex.get(i);
    const resolved: JudgeEvaluation = evaluation ?? {
      index: i,
      confidence: config.threshold,
      reasoning: "no evaluation returned",
    };
    resolvedEvaluations.push(resolved);

    if (resolved.confidence >= config.threshold) {
      accepted.push(findings[i]);
    } else {
      rejected.push(findings[i]);
      rejectedWithEval.push({ finding: findings[i], evaluation: resolved });
    }
  }

  for (const { finding, evaluation } of rejectedWithEval) {
    log.debug(
      {
        file: finding.file,
        line: finding.line,
        severity: finding.severity,
        confidence: evaluation.confidence,
        reasoning: evaluation.reasoning,
      },
      "finding filtered by judge",
    );
  }

  log.info(
    { accepted: accepted.length, rejected: rejected.length, total: findings.length, tokenCount },
    "judge pass complete",
  );

  return { accepted, rejected, evaluations: resolvedEvaluations, tokenCount };
}

export async function judgeReviewResult(
  result: ReviewResult,
  diff: string,
  config: JudgeConfig,
): Promise<ReviewResult> {
  if (!config.enabled) {
    return result;
  }

  const { accepted, rejected, tokenCount } = await judgeFindings(result.findings, diff, config);

  // when consensus elevated the recommendation based on pass votes (not findings),
  // and there are no findings for the judge to evaluate, preserve it
  const shouldPreserveElevated =
    accepted.length === 0 && result.consensusMetadata?.recommendationElevated === true;

  const criticalCount = accepted.filter((f) => f.severity === "critical").length;
  const recommendation = shouldPreserveElevated
    ? result.recommendation
    : criticalCount > 0
      ? ("critical_issues" as const)
      : accepted.length > 0
        ? ("address_before_merge" as const)
        : ("looks_good" as const);

  return {
    ...result,
    findings: accepted,
    recommendation,
    filteredCount: rejected.length,
    judgeTokenCount: tokenCount,
  };
}
