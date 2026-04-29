export type {
  Severity,
  FocusArea,
  ReviewStyle,
  Recommendation,
  TicketComplianceStatus,
  Finding,
  Observation,
  TicketComplianceItem,
  MissingTestItem,
  ReviewOutput,
} from "./agent/schema.js";

import type {
  Finding,
  Observation,
  FocusArea,
  ReviewStyle,
  Recommendation,
  Severity,
  ReviewOutput,
} from "./agent/schema.js";

export interface DroppedFinding {
  file: string;
  line: number;
  severity: Severity;
  message: string;
  voteCount: number;
}

export interface ConsensusMetadata {
  passes: number;
  threshold: number;
  agreementRate: number;
  recommendationElevated: boolean;
  passRecommendations: Recommendation[];
  /** number of consensus passes that threw before producing a result */
  failedPasses: number;
}

export type TriageClassification = "skip" | "skim" | "deep-review";

export interface TriageFileResult {
  path: string;
  classification: TriageClassification;
  reason: string;
}

export interface TriageResult {
  files: TriageFileResult[];
  modelUsed: string;
  tokenCount: number;
}

export interface TriageStats {
  filesSkipped: number;
  filesSkimmed: number;
  filesDeepReviewed: number;
  triageModelUsed: string;
  triageTokenCount: number;
}

export interface OpenGrepStats {
  /** whether opengrep was available to run */
  available: boolean;
  /** total findings from opengrep pre-scan */
  findingCount: number;
  /** error message if opengrep failed */
  error?: string;
}

export interface ReviewResult extends ReviewOutput {
  findings: Finding[];
  observations: Observation[];
  modelUsed: string;
  tokenCount: number;
  triageStats?: TriageStats;
  /** number of findings removed by the judge pass */
  filteredCount?: number;
  /** tokens consumed by the judge pass */
  judgeTokenCount?: number;
  consensusMetadata?: ConsensusMetadata;
  droppedFindings?: DroppedFinding[];
  openGrepStats?: OpenGrepStats;
}

export interface ReviewConfig {
  style: ReviewStyle;
  focusAreas: FocusArea[];
  ignorePatterns: string[];
  conventionFile?: string;
  consensusPasses?: number;
  consensusThreshold?: number | null;
  generateDescription?: boolean;
}

export interface PRMetadata {
  id: string;
  title: string;
  description: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

export interface FilePatch {
  path: string;
  hunks: Hunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface TicketInfo {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria?: string;
  labels: string[];
  source: string;
}

export interface TicketResolutionStatus {
  /** Total linked ticket references detected before any cap is applied. */
  totalRefsFound: number;
  /** Number of refs actually considered for resolution after the MAX_TICKETS cap. */
  refsConsidered: number;
  /** Number of refs dropped because they exceeded the MAX_TICKETS cap. */
  refsSkippedByLimit: number;
  /** Number of considered refs successfully fetched into TicketInfo objects. */
  fetched: number;
  /** Number of considered refs skipped because no provider was configured for their source. */
  consideredMissingProvider: number;
  /** Number of considered refs where the provider was available but the fetch still failed. */
  consideredFetchFailed: number;
}

export type TicketSource = "github" | "jira" | "linear" | "azure-devops";

export interface TicketRef {
  id: string;
  source: TicketSource;
  url?: string;
}

export interface CodeSearchResult {
  file: string;
  line: number;
  content: string;
}

export interface GitProvider {
  getDiff(): Promise<FilePatch[]>;
  getPRMetadata(): Promise<PRMetadata>;
  getFileContent(path: string, ref: string): Promise<string | null>;
  searchCode(query: string): Promise<CodeSearchResult[]>;
  postSummaryComment(markdown: string): Promise<void>;
  postInlineComments(findings: Finding[]): Promise<void>;
  deleteExistingBotComments(): Promise<void>;
  updatePRDescription(description: string): Promise<void>;
  updatePRTitle(title: string): Promise<void>;
}

export interface TicketProvider {
  fetchTicket(ref: string): Promise<TicketInfo | null>;
}
