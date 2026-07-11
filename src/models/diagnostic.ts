/**
 * Diagnostic model — every status item in phoenix status.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCategory =
  | 'dependency_violation'
  | 'side_channel_violation'
  | 'drift'
  | 'boundary'
  | 'd-rate'
  | 'canon'
  | 'constraint'
  | 'obligation'
  | 'evidence'
  | 'regen'
  | 'build';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  subject: string;
  message: string;
  iu_id?: string;
  source_file?: string;
  source_line?: number;
  recommended_actions: string[];
}
