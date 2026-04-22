import { Octokit } from "octokit";
import type { FocusArea, ReviewConfig, TicketProvider, TicketRef } from "@rusty-bot/core";
import {
  ReviewStyleSchema,
  filterFiles,
  stripDeletionOnlyHunks,
  expandContext,
  summarizeLanguages,
  extractTicketRefs,
  resolveTicketsWithStatus,
  fetchConventionFile,
  GitHubTicketProvider,
  JiraTicketProvider,
  LinearTicketProvider,
  runMultiCallReview,
  runCascadeReview,
  formatSummaryComment,
  loadMcpServerConfigsFromEnv,
  logger,
  flushLogger,
  isCascadeEnabled,
  runTriage,
  splitByClassification,
  runOpenGrep,
  extractChangedFilePaths,
  generatePRDescription,
  shouldGenerateDescription,
  parseDiff,
} from "@rusty-bot/core";
import { GitHubProvider, createOctokitIssueFetcher } from "@rusty-bot/github";
import {
  readEventPayload,
  parseOwnerRepo,
  extractPullNumber,
  shouldSkipEvent,
  type PullRequestEvent,
} from "./event.js";

const log = logger.child({ package: "github-action" });

const MAX_TOKENS = 60_000;
const ALL_FOCUS_AREAS: FocusArea[] = ["security", "performance", "bugs", "style", "tests", "docs"];

export interface ActionConfig {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
  token: string;
  review: ReviewConfig;
  failOnCritical: boolean;
  generateDescription: boolean;
}

interface ParseConfigOptions {
  event: PullRequestEvent;
  env?: NodeJS.ProcessEnv;
}

const PROVIDER_API_KEY_ENV: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  "azure-openai": "AZURE_OPENAI_API_KEY",
};

function assertLlmCredentials(env: NodeJS.ProcessEnv): void {
  if (env.RUSTY_LLM_BASE_URL || env.RUSTY_AZURE_RESOURCE_NAME) {
    return;
  }

  const model = env.RUSTY_LLM_MODEL ?? "anthropic/claude-sonnet-4-20250514";
  const provider = model.split("/")[0]?.toLowerCase();
  if (!provider) return;

  const requiredKey = PROVIDER_API_KEY_ENV[provider];
  if (!requiredKey || env[requiredKey]) return;

  throw new Error(
    `RUSTY_LLM_MODEL is set to "${model}" but ${requiredKey} is missing. Provide the matching API key, or set RUSTY_LLM_BASE_URL / RUSTY_AZURE_RESOURCE_NAME for alternative providers.`,
  );
}

export function parseConfig({ event, env = process.env }: ParseConfigOptions): ActionConfig {
  const token = env.GITHUB_TOKEN ?? env.INPUT_GITHUB_TOKEN;
  const repository = env.GITHUB_REPOSITORY;

  if (!token || !repository) {
    const missing: string[] = [];
    if (!token) missing.push("GITHUB_TOKEN");
    if (!repository) missing.push("GITHUB_REPOSITORY");
    throw new Error(`missing required env vars: ${missing.join(", ")}`);
  }

  assertLlmCredentials(env);

  const { owner, repo } = parseOwnerRepo(repository);

  const pullNumber = extractPullNumber(event);
  if (pullNumber == null) {
    throw new Error(
      "could not determine pull request number from event payload — is this a pull_request event?",
    );
  }

  const reviewStyle = env.RUSTY_REVIEW_STYLE ?? "balanced";
  const parsedStyle = ReviewStyleSchema.safeParse(reviewStyle);
  if (!parsedStyle.success) {
    throw new Error(`invalid review style: ${reviewStyle}`);
  }

  const focusAreas = (env.RUSTY_FOCUS_AREAS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? []) as FocusArea[];
  const ignorePatterns =
    env.RUSTY_IGNORE_PATTERNS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const failOnCritical = env.RUSTY_FAIL_ON_CRITICAL !== "false";
  const generateDescription = env.RUSTY_GENERATE_DESCRIPTION === "true";

  const octokit = new Octokit({ auth: token });

  return {
    octokit,
    owner,
    repo,
    pullNumber,
    token,
    review: {
      style: parsedStyle.data,
      focusAreas: focusAreas.length > 0 ? focusAreas : ALL_FOCUS_AREAS,
      ignorePatterns,
    },
    failOnCritical,
    generateDescription,
  };
}

function buildTicketProviders(
  octokit: Octokit,
  owner: string,
  repo: string,
  env: NodeJS.ProcessEnv,
): Map<string, TicketProvider> {
  const providers = new Map<string, TicketProvider>();

  providers.set(
    "github",
    new GitHubTicketProvider({
      owner,
      repo,
      issueFetcher: createOctokitIssueFetcher(octokit),
    }),
  );

  const jiraUrl = env.RUSTY_JIRA_BASE_URL;
  const jiraEmail = env.RUSTY_JIRA_EMAIL;
  const jiraToken = env.RUSTY_JIRA_API_TOKEN;
  if (jiraUrl && jiraEmail && jiraToken) {
    providers.set(
      "jira",
      new JiraTicketProvider({ baseUrl: jiraUrl, email: jiraEmail, apiToken: jiraToken }),
    );
  }

  const linearKey = env.RUSTY_LINEAR_API_KEY;
  if (linearKey) {
    providers.set("linear", new LinearTicketProvider({ apiKey: linearKey }));
  }

  return providers;
}

export async function runAction(config: ActionConfig): Promise<number> {
  const { octokit, owner, repo, pullNumber, review: reviewConfig, failOnCritical } = config;

  const provider = new GitHubProvider({ octokit, owner, repo, pullNumber });

  const metadata = await provider.getPRMetadata();
  log.info(
    {
      owner,
      repo,
      prId: metadata.id,
      source: metadata.sourceBranch,
      target: metadata.targetBranch,
    },
    "reviewing PR",
  );

  const conventionFile = await fetchConventionFile(
    (path, ref) => provider.getFileContent(path, ref),
    metadata.targetBranch,
  );
  if (conventionFile) {
    reviewConfig.conventionFile = conventionFile;
  }

  await provider.deleteExistingBotComments();

  const rawDiff = await provider.getRawDiff();
  const rawPatches = parseDiff(rawDiff);
  const filtered = filterFiles(rawPatches, reviewConfig.ignorePatterns);
  const reviewable = stripDeletionOnlyHunks(filtered);
  const skippedCount = rawPatches.length - reviewable.length;
  log.info(
    { total: rawPatches.length, reviewed: reviewable.length, skipped: skippedCount },
    "files changed",
  );

  if (config.generateDescription) {
    try {
      if (shouldGenerateDescription(metadata.description)) {
        const descResult = await generatePRDescription(reviewable, metadata, metadata.description);
        await provider.updatePRDescription(descResult.markdown);
        metadata.description = descResult.markdown;
        log.info(
          { model: descResult.modelUsed, tokens: descResult.tokenCount },
          "generated PR description",
        );
      }
    } catch (err) {
      log.warn({ err }, "failed to generate PR description, continuing with review");
    }
  }

  const ticketRefs = extractTicketRefs(metadata.description, metadata.sourceBranch);

  let linkedRefs: TicketRef[] = [];
  try {
    const linkedNumbers = await provider.getLinkedIssueNumbers();
    const existingIds = new Set(ticketRefs.filter((r) => r.source === "github").map((r) => r.id));
    linkedRefs = linkedNumbers
      .filter((n) => !existingIds.has(String(n)))
      .map((n) => ({ id: String(n), source: "github" }));
  } catch (err) {
    log.warn({ err }, "failed to fetch linked issues from github, continuing with extracted refs");
  }
  const allRefs = [...ticketRefs, ...linkedRefs];

  const ticketProviders = buildTicketProviders(octokit, owner, repo, process.env);
  const { tickets, status: ticketResolution } = await resolveTicketsWithStatus(
    allRefs,
    ticketProviders,
  );

  const languageSummary = summarizeLanguages(reviewable);
  const mcpServers = await loadMcpServerConfigsFromEnv();

  const openGrepResult = await runOpenGrep(extractChangedFilePaths(reviewable), {
    config: process.env.RUSTY_OPENGREP_RULES ?? "auto",
  });
  const openGrepFindings = openGrepResult.findings.length > 0 ? openGrepResult.findings : undefined;
  if (openGrepResult.available) {
    log.info({ findingCount: openGrepResult.findings.length }, "opengrep pre-scan complete");
  }

  let review;

  if (isCascadeEnabled()) {
    log.info({ fileCount: reviewable.length }, "cascade enabled, running triage");

    let triageResult;
    try {
      triageResult = await runTriage(reviewable);
    } catch (err) {
      log.warn({ err }, "triage failed, falling back to full review");
    }

    if (triageResult) {
      const { skip, skim, deepReview } = splitByClassification(reviewable, triageResult.files);
      log.info(
        { skipped: skip.length, skimmed: skim.length, deepReview: deepReview.length },
        "triage classification",
      );

      const expandedDeep = await expandContext(deepReview, (path) =>
        provider.getFileContent(path, metadata.sourceBranch),
      );

      review = await runCascadeReview(
        skim,
        expandedDeep,
        reviewConfig,
        metadata,
        tickets.length > 0 ? tickets : undefined,
        {
          provider,
          sourceRef: metadata.sourceBranch,
          languageSummary,
          mcpServers,
          maxTokens: MAX_TOKENS,
          openGrepFindings,
        },
      );

      review.triageStats = {
        filesSkipped: skip.length,
        filesSkimmed: skim.length,
        filesDeepReviewed: deepReview.length,
        triageModelUsed: triageResult.modelUsed,
        triageTokenCount: triageResult.tokenCount,
      };
    }
  }

  if (!review) {
    const expanded = await expandContext(reviewable, (path) =>
      provider.getFileContent(path, metadata.sourceBranch),
    );

    review = await runMultiCallReview(
      expanded,
      reviewConfig,
      metadata,
      tickets.length > 0 ? tickets : undefined,
      {
        provider,
        sourceRef: metadata.sourceBranch,
        languageSummary,
        mcpServers,
        maxTokens: MAX_TOKENS,
        openGrepFindings,
      },
    );
  }

  review.openGrepStats = {
    available: openGrepResult.available,
    findingCount: openGrepResult.rawCount,
    ...(openGrepResult.error ? { error: openGrepResult.error } : {}),
  };

  const criticalCount = review.findings.filter((f) => f.severity === "critical").length;
  const warningCount = review.findings.filter((f) => f.severity === "warning").length;
  log.info(
    {
      findings: review.findings.length,
      critical: criticalCount,
      warnings: warningCount,
      recommendation: review.recommendation,
    },
    "review complete",
  );

  const summaryMarkdown = formatSummaryComment(review, { ticketResolution });
  await provider.postSummaryComment(summaryMarkdown);

  const inlineFindings = review.findings.filter((f) => f.line > 0);
  if (inlineFindings.length > 0) {
    await provider.postInlineComments(inlineFindings);
  }

  log.info({ inlineComments: inlineFindings.length }, "posted summary and inline comments");

  if (failOnCritical && criticalCount > 0) {
    log.warn({ criticalCount }, "failing action due to critical issues");
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set — this CLI must run inside a GitHub Action");
  }

  const event = await readEventPayload(eventPath);

  const skip = shouldSkipEvent(event);
  if (skip.skip) {
    log.info({ reason: skip.reason }, "skipping review");
    return;
  }

  const config = parseConfig({ event });
  const exitCode = await runAction(config);
  if (exitCode !== 0) {
    flushLogger(() => process.exit(exitCode));
    // keep the event loop alive until the logger drains
    await new Promise(() => undefined);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  main().catch((err: unknown) => {
    log.fatal({ err }, "fatal error");
    flushLogger(() => process.exit(2));
  });
}
