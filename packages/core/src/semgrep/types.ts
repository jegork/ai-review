export interface SemgrepRawFinding {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message: string;
    severity: string;
    metadata?: Record<string, unknown>;
    lines?: string;
  };
}

export interface SemgrepRawOutput {
  results: SemgrepRawFinding[];
  errors: unknown[];
}

export interface SemgrepFinding {
  ruleId: string;
  file: string;
  startLine: number;
  endLine: number;
  message: string;
  severity: "error" | "warning" | "info";
  snippet?: string;
  metadata?: Record<string, unknown>;
}

export interface SemgrepResult {
  findings: SemgrepFinding[];
  /** total number of findings before any dedup */
  rawCount: number;
  /** whether semgrep was available and ran successfully */
  available: boolean;
  /** error message when semgrep failed or was unavailable */
  error?: string;
}
