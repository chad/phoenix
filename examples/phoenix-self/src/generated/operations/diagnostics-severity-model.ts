export type Severity = 'error' | 'warning' | 'info';

export type Category = 
  | 'bootstrap'
  | 'compaction'
  | 'repository'
  | 'network'
  | 'filesystem'
  | 'configuration'
  | 'validation'
  | 'performance'
  | 'security';

export interface RecommendedAction {
  description: string;
  command?: string;
  automated: boolean;
}

export interface StatusItem {
  severity: Severity;
  category: Category;
  subject: string;
  message: string;
  recommended_actions: RecommendedAction[];
  timestamp: Date;
  id: string;
}

export interface GroupedStatus {
  error: StatusItem[];
  warning: StatusItem[];
  info: StatusItem[];
}

export class DiagnosticsModel {
  private items: Map<string, StatusItem> = new Map();
  private nextId = 1;

  addStatus(
    severity: Severity,
    category: Category,
    subject: string,
    message: string,
    recommendedActions: RecommendedAction[]
  ): string {
    if (!severity || !category || !subject || !message) {
      throw new Error('All status fields (severity, category, subject, message) are required');
    }

    if (!recommendedActions || recommendedActions.length === 0) {
      throw new Error('At least one recommended action must be provided');
    }

    const id = `diag_${this.nextId++}`;
    const item: StatusItem = {
      severity,
      category,
      subject,
      message,
      recommended_actions: recommendedActions,
      timestamp: new Date(),
      id
    };

    this.items.set(id, item);
    return id;
  }

  removeStatus(id: string): boolean {
    return this.items.delete(id);
  }

  getStatus(id: string): StatusItem | undefined {
    return this.items.get(id);
  }

  getAllStatus(): StatusItem[] {
    return Array.from(this.items.values()).sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  getGroupedStatus(): GroupedStatus {
    const grouped: GroupedStatus = {
      error: [],
      warning: [],
      info: []
    };

    for (const item of this.items.values()) {
      grouped[item.severity].push(item);
    }

    // Sort each group by timestamp (newest first)
    grouped.error.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    grouped.warning.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    grouped.info.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return grouped;
  }

  getStatusByCategory(category: Category): StatusItem[] {
    return Array.from(this.items.values())
      .filter(item => item.category === category)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getStatusBySeverity(severity: Severity): StatusItem[] {
    return Array.from(this.items.values())
      .filter(item => item.severity === severity)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  hasErrors(): boolean {
    return Array.from(this.items.values()).some(item => item.severity === 'error');
  }

  hasWarnings(): boolean {
    return Array.from(this.items.values()).some(item => item.severity === 'warning');
  }

  clear(): void {
    this.items.clear();
  }

  getStatusSummary(): { errors: number; warnings: number; info: number } {
    const summary = { errors: 0, warnings: 0, info: 0 };
    
    for (const item of this.items.values()) {
      switch (item.severity) {
        case 'error':
          summary.errors++;
          break;
        case 'warning':
          summary.warnings++;
          break;
        case 'info':
          summary.info++;
          break;
      }
    }

    return summary;
  }
}

export function createRecommendedAction(
  description: string,
  command?: string,
  automated = false
): RecommendedAction {
  if (!description.trim()) {
    throw new Error('Recommended action description cannot be empty');
  }

  return {
    description: description.trim(),
    command: command?.trim(),
    automated
  };
}

export function formatStatusMessage(item: StatusItem): string {
  const timestamp = item.timestamp.toISOString();
  const actions = item.recommended_actions
    .map(action => `  • ${action.description}${action.command ? ` (${action.command})` : ''}`)
    .join('\n');

  return `[${timestamp}] ${item.severity.toUpperCase()}: ${item.subject}
${item.message}

Recommended actions:
${actions}`;
}

export function validateStatusItem(item: Partial<StatusItem>): string[] {
  const errors: string[] = [];

  if (!item.severity) {
    errors.push('Severity is required');
  } else if (!['error', 'warning', 'info'].includes(item.severity)) {
    errors.push('Severity must be one of: error, warning, info');
  }

  if (!item.category) {
    errors.push('Category is required');
  }

  if (!item.subject || !item.subject.trim()) {
    errors.push('Subject is required and cannot be empty');
  }

  if (!item.message || !item.message.trim()) {
    errors.push('Message is required and cannot be empty');
  }

  if (!item.recommended_actions || item.recommended_actions.length === 0) {
    errors.push('At least one recommended action is required');
  } else {
    item.recommended_actions.forEach((action, index) => {
      if (!action.description || !action.description.trim()) {
        errors.push(`Recommended action ${index + 1} must have a description`);
      }
    });
  }

  return errors;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'ed8435022da1cbee28f5566b8c2e41d7878f3f18d8fcb3fee1afcd03d3615386',
  name: 'Diagnostics & Severity Model',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;