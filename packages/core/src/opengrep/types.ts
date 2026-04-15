export interface OpenGrepRawFinding {
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

export interface OpenGrepRawOutput {
  results: OpenGrepRawFinding[];
  errors: unknown[];
}

export interface OpenGrepFinding {
  ruleId: string;
  file: string;
  startLine: number;
  endLine: number;
  message: string;
  severity: "error" | "warning" | "info";
  snippet?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenGrepResult {
  findings: OpenGrepFinding[];
  /** total number of findings before any dedup */
  rawCount: number;
  /** whether opengrep was available and ran successfully */
  available: boolean;
  /** error message when opengrep failed or was unavailable */
  error?: string;
}
