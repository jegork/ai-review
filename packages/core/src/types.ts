export type ReviewStyle = "strict" | "balanced" | "lenient" | "roast";

export type FocusArea = "security" | "performance" | "bugs" | "style" | "tests" | "docs";

export type Severity = "critical" | "warning" | "suggestion";

export type Recommendation = "looks_good" | "address_before_merge" | "critical_issues";

export type TicketComplianceStatus =
  | "addressed"
  | "partially_addressed"
  | "not_addressed"
  | "unclear";

export interface Finding {
  file: string;
  line: number;
  endLine: number | null;
  severity: Severity;
  category: FocusArea;
  message: string;
  suggestedFix?: string;
  /** number of consensus passes that flagged this finding */
  voteCount?: number;
}

export interface Observation {
  file: string;
  line: number;
  severity: Severity;
  category: FocusArea;
  message: string;
  /** number of consensus passes that flagged this observation */
  voteCount?: number;
}

export interface ReviewResult {
  summary: string;
  recommendation: Recommendation;
  findings: Finding[];
  observations: Observation[];
  ticketCompliance: TicketComplianceItem[];
  filesReviewed: string[];
  modelUsed: string;
  tokenCount: number;
  /** number of findings removed by the judge pass */
  filteredCount?: number;
  /** tokens consumed by the judge pass */
  judgeTokenCount?: number;
  consensusMetadata?: { passes: number; threshold: number };
}

export interface ReviewConfig {
  style: ReviewStyle;
  focusAreas: FocusArea[];
  ignorePatterns: string[];
  customInstructions?: string;
  consensusPasses?: number;
  consensusThreshold?: number | null;
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

export interface TicketComplianceItem {
  ticketId?: string | null;
  requirement: string;
  status: TicketComplianceStatus;
  evidence?: string | null;
}

export interface TicketResolutionStatus {
  /** Total linked ticket references detected before any cap is applied. */
  refsFound: number;
  /** Number of refs actually considered for resolution after caps such as MAX_TICKETS. */
  refsConsidered: number;
  /** Number of considered refs that were successfully fetched into TicketInfo objects. */
  fetched: number;
  /** Number of considered refs skipped because no provider was configured for their source. */
  missingProvider: number;
  /** Number of considered refs that had a provider but still failed to resolve. */
  fetchFailed: number;
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
}

export interface TicketProvider {
  fetchTicket(ref: string): Promise<TicketInfo | null>;
}
