export interface TaskStats {
  totalTasks: number;
  completedCount: number;
  overdueCount: number;
  completionRate: number;
}

export interface MetricCard {
  name: string;
  value: string;
  emoji: string;
}

export interface AnalyticsPanelOptions {
  stats: TaskStats;
  className?: string;
}

export function calculateCompletionRate(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

export function formatMetricValue(value: number, type: 'count' | 'percentage'): string {
  if (type === 'percentage') {
    return `${value}%`;
  }
  return value.toString();
}

export function createMetricCards(stats: TaskStats): MetricCard[] {
  return [
    {
      name: 'Total Tasks',
      value: formatMetricValue(stats.totalTasks, 'count'),
      emoji: '📋'
    },
    {
      name: 'Completed',
      value: formatMetricValue(stats.completedCount, 'count'),
      emoji: '✅'
    },
    {
      name: 'Overdue',
      value: formatMetricValue(stats.overdueCount, 'count'),
      emoji: '⚠️'
    },
    {
      name: 'Completion Rate',
      value: formatMetricValue(stats.completionRate, 'percentage'),
      emoji: '📊'
    }
  ];
}

export function renderMetricCard(card: MetricCard): string {
  return `
    <div class="metric-card">
      <div class="metric-icon">${card.emoji}</div>
      <div class="metric-content">
        <div class="metric-name">${card.name}</div>
        <div class="metric-value">${card.value}</div>
      </div>
    </div>
  `.trim();
}

export function renderAnalyticsPanel(options: AnalyticsPanelOptions): string {
  const { stats, className = 'analytics-panel' } = options;
  const cards = createMetricCards(stats);
  const cardHtml = cards.map(renderMetricCard).join('\n');

  return `
    <div class="${className}">
      <div class="metrics-row">
        ${cardHtml}
      </div>
    </div>
  `.trim();
}

export class AnalyticsPanel {
  private stats: TaskStats;
  private className: string;

  constructor(stats: TaskStats, className = 'analytics-panel') {
    this.stats = stats;
    this.className = className;
  }

  updateStats(newStats: TaskStats): void {
    this.stats = { ...newStats };
    this.stats.completionRate = calculateCompletionRate(
      newStats.completedCount,
      newStats.totalTasks
    );
  }

  getStats(): TaskStats {
    return { ...this.stats };
  }

  render(): string {
    return renderAnalyticsPanel({
      stats: this.stats,
      className: this.className
    });
  }

  getMetricCards(): MetricCard[] {
    return createMetricCards(this.stats);
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '59d32939d50083b6ecf70e500f215a179f42a5ea99a186cb8af2720e3aaa1d74',
  name: 'Analytics Panel',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;