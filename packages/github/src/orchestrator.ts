import type { Octokit } from "octokit";
import type { FocusArea, TicketProvider } from "@rusty-bot/core";
import {
  parseDiff,
  filterFiles,
  stripDeletionOnlyHunks,
  expandContext,
  summarizeLanguages,
  extractTicketRefs,
  resolveTicketsWithStatus,
  runMultiCallReview,
  formatSummaryComment,
  fetchConventionFile,
  GitHubTicketProvider,
  JiraTicketProvider,
  LinearTicketProvider,
  loadMcpServerConfigsFromEnv,
  logger,
} from "@rusty-bot/core";
import { GitHubProvider } from "./provider.js";
import { getRepoConfig, saveReview, getSetting, type ReviewRecord } from "./storage.js";

const log = logger.child({ package: "github" });
const MAX_DIFF_TOKENS = 60_000;
const ALL_FOCUS_AREAS: FocusArea[] = ["security", "performance", "bugs", "style", "tests", "docs"];

async function buildTicketProviders(
  owner: string,
  repo: string,
): Promise<Map<string, TicketProvider>> {
  const providers = new Map<string, TicketProvider>();

  const ghToken = await getSetting("github_token");
  if (ghToken) {
    providers.set("github", new GitHubTicketProvider({ token: ghToken, owner, repo }));
  }

  const jiraUrl = await getSetting("jira_base_url");
  const jiraEmail = await getSetting("jira_email");
  const jiraToken = await getSetting("jira_api_token");
  if (jiraUrl && jiraEmail && jiraToken) {
    providers.set(
      "jira",
      new JiraTicketProvider({ baseUrl: jiraUrl, email: jiraEmail, apiToken: jiraToken }),
    );
  }

  const linearKey = await getSetting("linear_api_key");
  if (linearKey) {
    providers.set("linear", new LinearTicketProvider({ apiKey: linearKey }));
  }

  return providers;
}

export async function orchestrateReview(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
  installationId: number;
}): Promise<void> {
  const { octokit, owner, repo, pullNumber } = params;

  try {
    const repoConfig = await getRepoConfig(owner, repo);

    const provider = new GitHubProvider({ octokit, owner, repo, pullNumber });

    await provider.deleteExistingBotComments();

    const [metadata, rawDiff] = await Promise.all([
      provider.getPRMetadata(),
      provider.getRawDiff(),
    ]);

    const conventionFile = await fetchConventionFile(
      (path, ref) => provider.getFileContent(path, ref),
      metadata.targetBranch,
    );

    const config = {
      style: repoConfig?.style ?? ("balanced" as const),
      focusAreas: repoConfig?.focusAreas ?? ALL_FOCUS_AREAS,
      ignorePatterns: repoConfig?.ignorePatterns ?? [],
      ...(conventionFile ? { conventionFile } : {}),
    };

    const patches = parseDiff(rawDiff);
    const filtered = filterFiles(patches, config.ignorePatterns);
    const reviewable = stripDeletionOnlyHunks(filtered);
    const expanded = await expandContext(reviewable, (path) =>
      provider.getFileContent(path, metadata.sourceBranch),
    );

    const ticketRefs = extractTicketRefs(metadata.description, metadata.sourceBranch);
    const ticketProviders = await buildTicketProviders(owner, repo);
    const { tickets, status: ticketResolution } = await resolveTicketsWithStatus(
      ticketRefs,
      ticketProviders,
    );

    const languageSummary = summarizeLanguages(reviewable);
    const mcpServers = await loadMcpServerConfigsFromEnv();

    const result = await runMultiCallReview(expanded, config, metadata, tickets, {
      provider,
      sourceRef: metadata.sourceBranch,
      languageSummary,
      mcpServers,
      maxTokens: MAX_DIFF_TOKENS,
    });

    const summary = formatSummaryComment(result, { ticketResolution });
    await provider.postSummaryComment(summary);

    const inlineFindings = result.findings.filter((f) => f.line > 0);
    if (inlineFindings.length > 0) {
      await provider.postInlineComments(inlineFindings);
    }

    const review: ReviewRecord = {
      id: `${owner}-${repo}-${pullNumber}-${Date.now()}`,
      owner,
      repo,
      prNumber: pullNumber,
      timestamp: new Date().toISOString(),
      findingsCount: result.findings.length,
      criticalCount: result.findings.filter((f) => f.severity === "critical").length,
      warningCount: result.findings.filter((f) => f.severity === "warning").length,
      suggestionCount: result.findings.filter((f) => f.severity === "suggestion").length,
      modelUsed: result.modelUsed,
      tokenCount: result.tokenCount,
      recommendation: result.recommendation,
      prUrl: metadata.url,
    };

    await saveReview(review);

    log.info({ owner, repo, pullNumber }, "review completed");
  } catch (err) {
    log.error({ owner, repo, pullNumber, err }, "review failed");
  }
}
