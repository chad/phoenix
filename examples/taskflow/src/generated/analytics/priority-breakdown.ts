export interface Task {
  id: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'todo' | 'in-progress' | 'review' | 'done' | 'blocked';
}

export interface PriorityBreakdownItem {
  priority: string;
  count: number;
  percentage: number;
}

export interface StatusBreakdownItem {
  status: string;
  count: number;
  percentage: number;
}

export interface BreakdownReport {
  priorityBreakdown: PriorityBreakdownItem[];
  statusBreakdown: StatusBreakdownItem[];
  totalTasks: number;
}

export class PriorityBreakdown {
  private tasks: Task[] = [];

  addTask(task: Task): void {
    this.tasks.push(task);
  }

  addTasks(tasks: Task[]): void {
    this.tasks.push(...tasks);
  }

  removeTask(taskId: string): boolean {
    const initialLength = this.tasks.length;
    this.tasks = this.tasks.filter(task => task.id !== taskId);
    return this.tasks.length < initialLength;
  }

  updateTask(taskId: string, updates: Partial<Pick<Task, 'priority' | 'status'>>): boolean {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return false;

    if (updates.priority) task.priority = updates.priority;
    if (updates.status) task.status = updates.status;
    return true;
  }

  clearTasks(): void {
    this.tasks = [];
  }

  generateReport(): BreakdownReport {
    const totalTasks = this.tasks.length;

    const priorityCounts = new Map<string, number>();
    const statusCounts = new Map<string, number>();

    for (const task of this.tasks) {
      priorityCounts.set(task.priority, (priorityCounts.get(task.priority) || 0) + 1);
      statusCounts.set(task.status, (statusCounts.get(task.status) || 0) + 1);
    }

    const priorityBreakdown: PriorityBreakdownItem[] = [];
    for (const [priority, count] of priorityCounts) {
      priorityBreakdown.push({
        priority,
        count,
        percentage: totalTasks > 0 ? Math.round((count / totalTasks) * 100 * 100) / 100 : 0
      });
    }

    const statusBreakdown: StatusBreakdownItem[] = [];
    for (const [status, count] of statusCounts) {
      statusBreakdown.push({
        status,
        count,
        percentage: totalTasks > 0 ? Math.round((count / totalTasks) * 100 * 100) / 100 : 0
      });
    }

    // Sort by priority order and status order
    const priorityOrder = ['critical', 'high', 'medium', 'low'];
    const statusOrder = ['todo', 'in-progress', 'review', 'blocked', 'done'];

    priorityBreakdown.sort((a, b) => {
      const aIndex = priorityOrder.indexOf(a.priority);
      const bIndex = priorityOrder.indexOf(b.priority);
      return aIndex - bIndex;
    });

    statusBreakdown.sort((a, b) => {
      const aIndex = statusOrder.indexOf(a.status);
      const bIndex = statusOrder.indexOf(b.status);
      return aIndex - bIndex;
    });

    return {
      priorityBreakdown,
      statusBreakdown,
      totalTasks
    };
  }

  getPriorityBreakdown(): PriorityBreakdownItem[] {
    return this.generateReport().priorityBreakdown;
  }

  getStatusBreakdown(): StatusBreakdownItem[] {
    return this.generateReport().statusBreakdown;
  }

  getTotalTasks(): number {
    return this.tasks.length;
  }
}

export function createPriorityBreakdown(initialTasks: Task[] = []): PriorityBreakdown {
  const breakdown = new PriorityBreakdown();
  if (initialTasks.length > 0) {
    breakdown.addTasks(initialTasks);
  }
  return breakdown;
}

export function generateBreakdownFromTasks(tasks: Task[]): BreakdownReport {
  const breakdown = createPriorityBreakdown(tasks);
  return breakdown.generateReport();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '0e8c6fd7f3c15acb3e984fe7b4acac3476c2cb0abade85705720eaf362f1cca9',
  name: 'Priority Breakdown',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;