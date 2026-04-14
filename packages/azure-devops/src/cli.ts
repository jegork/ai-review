import type { FocusArea, ReviewConfig, ReviewStyle } from "@rusty-bot/core";
import {
  filterFiles,
  stripDeletionOnlyHunks,
  expandContext,
  summarizeLanguages,
  extractTicketRefs,
  resolveTicketsWithStatus,
  AzureDevOpsTicketProvider,
  runMultiCallReview,
  formatSummaryComment,
  loadMcpServerConfigsFromEnv,
  logger,
  flushLogger,
} from "@rusty-bot/core";
import { AzureDevOpsProvider } from "./provider.js";

const log = logger.child({ package: "azure-devops" });

const VALID_STYLES = new Set(["strict", "balanced", "lenient", "roast"]);
const MAX_TOKENS = 120_000;

export function parseConfig(): {
  provider: AzureDevOpsProvider;
  config: ReviewConfig;
  failOnCritical: boolean;
  env: { orgUrl: string; project: string; accessToken: string };
} {
  const pullRequestId = process.env.SYSTEM_PULLREQUEST_PULLREQUESTID;
  const orgUrl = process.env.SYSTEM_TEAMFOUNDATIONCOLLECTIONURI;
  const project = process.env.SYSTEM_TEAMPROJECT;
  const repoName = process.env.BUILD_REPOSITORY_NAME;
  const accessToken = process.env.SYSTEM_ACCESSTOKEN;

  if (!pullRequestId || !orgUrl || !project || !repoName || !accessToken) {
    const missing: string[] = [];
    if (!pullRequestId) missing.push("SYSTEM_PULLREQUEST_PULLREQUESTID");
    if (!orgUrl) missing.push("SYSTEM_TEAMFOUNDATIONCOLLECTIONURI");
    if (!project) missing.push("SYSTEM_TEAMPROJECT");
    if (!repoName) missing.push("BUILD_REPOSITORY_NAME");
    if (!accessToken) missing.push("SYSTEM_ACCESSTOKEN");
    throw new Error(`missing required env vars: ${missing.join(", ")}`);
  }

  const reviewStyle = process.env.RUSTY_REVIEW_STYLE ?? "balanced";
  if (!VALID_STYLES.has(reviewStyle)) {
    throw new Error(`invalid review style: ${reviewStyle}`);
  }

  const focusAreas = (process.env.RUSTY_FOCUS_AREAS?.split(",").filter(Boolean) ??
    []) as FocusArea[];
  const ignorePatterns = process.env.RUSTY_IGNORE_PATTERNS?.split(",").filter(Boolean) ?? [];
  const customInstructions = process.env.RUSTY_CUSTOM_INSTRUCTIONS;
  const failOnCritical = process.env.RUSTY_FAIL_ON_CRITICAL !== "false";

  return {
    provider: new AzureDevOpsProvider({
      orgUrl,
      project,
      repoName,
      pullRequestId: parseInt(pullRequestId, 10),
      accessToken,
    }),
    config: {
      style: reviewStyle as ReviewStyle,
      focusAreas,
      ignorePatterns,
      ...(customInstructions ? { customInstructions } : {}),
    },
    failOnCritical,
    env: { orgUrl, project, accessToken },
  };
}

async function main(): Promise<void> {
  const { provider, config, failOnCritical, env } = parseConfig();

  const metadata = await provider.getPRMetadata();
  log.info(
    { prId: metadata.id, source: metadata.sourceBranch, target: metadata.targetBranch },
    "reviewing PR",
  );

  await provider.deleteExistingBotComments();

  const rawPatches = await provider.getDiff();
  const filtered = filterFiles(rawPatches, config.ignorePatterns);
  const reviewable = stripDeletionOnlyHunks(filtered);
  const expanded = await expandContext(reviewable, (path) =>
    provider.getFileContent(path, metadata.sourceBranch),
  );
  const skippedCount = rawPatches.length - expanded.length;
  log.info(
    { total: rawPatches.length, reviewed: expanded.length, skipped: skippedCount },
    "files changed",
  );

  const ticketRefs = extractTicketRefs(metadata.title, metadata.description);
  const ticketProviders = new Map<string, AzureDevOpsTicketProvider>();

  if (ticketRefs.some((r) => r.source === "azure-devops")) {
    ticketProviders.set(
      "azure-devops",
      new AzureDevOpsTicketProvider({
        orgUrl: env.orgUrl,
        project: env.project,
        pat: env.accessToken,
      }),
    );
  }

  const { tickets, status: ticketResolution } = await resolveTicketsWithStatus(
    ticketRefs,
    ticketProviders,
  );

  const languageSummary = summarizeLanguages(expanded);
  const mcpServers = await loadMcpServerConfigsFromEnv();

  const review = await runMultiCallReview(
    expanded,
    config,
    metadata,
    tickets.length > 0 ? tickets : undefined,
    {
      provider,
      sourceRef: metadata.sourceBranch,
      languageSummary,
      mcpServers,
      maxTokens: MAX_TOKENS,
    },
  );

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
  await provider.postInlineComments(review.findings);

  log.info({ inlineComments: review.findings.length }, "posted summary and inline comments");

  if (failOnCritical && criticalCount > 0) {
    log.warn({ criticalCount }, "failing pipeline due to critical issues");
    process.exit(1);
  }
}

// only run when invoked directly, not when imported in tests
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  main().catch((err: unknown) => {
    log.fatal({ err }, "fatal error");
    flushLogger(() => process.exit(2));
  });
}
