export interface TaskRecord {
  id: string;
  createdAt: Date;
  completedAt?: Date;
  dueDate?: Date;
  status: 'pending' | 'completed' | 'overdue';
}

export interface MetricsSnapshot {
  totalCreated: number;
  totalCompleted: number;
  totalOverdue: number;
  averageCompletionTimeHours: number;
  throughputTasksPerDay: number;
  calculatedAt: Date;
}

export class Metrics {
  private tasks: TaskRecord[] = [];

  constructor(initialTasks: TaskRecord[] = []) {
    this.tasks = [...initialTasks];
  }

  addTask(task: TaskRecord): void {
    this.tasks.push({ ...task });
  }

  addTasks(tasks: TaskRecord[]): void {
    this.tasks.push(...tasks.map(task => ({ ...task })));
  }

  updateTask(taskId: string, updates: Partial<TaskRecord>): boolean {
    const taskIndex = this.tasks.findIndex(task => task.id === taskId);
    if (taskIndex === -1) {
      return false;
    }
    
    this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updates };
    return true;
  }

  getTotalCreated(): number {
    return this.tasks.length;
  }

  getTotalCompleted(): number {
    return this.tasks.filter(task => task.status === 'completed').length;
  }

  getTotalOverdue(): number {
    const now = new Date();
    return this.tasks.filter(task => {
      if (task.status === 'completed' || !task.dueDate) {
        return false;
      }
      return task.dueDate < now;
    }).length;
  }

  getAverageCompletionTimeHours(): number {
    const completedTasks = this.tasks.filter(task => 
      task.status === 'completed' && task.completedAt
    );

    if (completedTasks.length === 0) {
      return 0;
    }

    const totalHours = completedTasks.reduce((sum, task) => {
      const completionTime = task.completedAt!.getTime() - task.createdAt.getTime();
      return sum + (completionTime / (1000 * 60 * 60)); // Convert ms to hours
    }, 0);

    return totalHours / completedTasks.length;
  }

  getThroughputTasksPerDay(): number {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

    const completedInWindow = this.tasks.filter(task => 
      task.status === 'completed' && 
      task.completedAt && 
      task.completedAt >= sevenDaysAgo && 
      task.completedAt <= now
    );

    return completedInWindow.length / 7;
  }

  getSnapshot(): MetricsSnapshot {
    return {
      totalCreated: this.getTotalCreated(),
      totalCompleted: this.getTotalCompleted(),
      totalOverdue: this.getTotalOverdue(),
      averageCompletionTimeHours: this.getAverageCompletionTimeHours(),
      throughputTasksPerDay: this.getThroughputTasksPerDay(),
      calculatedAt: new Date()
    };
  }

  reset(): void {
    this.tasks = [];
  }

  getAllTasks(): TaskRecord[] {
    return this.tasks.map(task => ({ ...task }));
  }
}

export function calculateMetricsFromTasks(tasks: TaskRecord[]): MetricsSnapshot {
  const metrics = new Metrics(tasks);
  return metrics.getSnapshot();
}

export function isTaskOverdue(task: TaskRecord, referenceDate: Date = new Date()): boolean {
  if (task.status === 'completed' || !task.dueDate) {
    return false;
  }
  return task.dueDate < referenceDate;
}

export function getCompletionTimeHours(task: TaskRecord): number | null {
  if (task.status !== 'completed' || !task.completedAt) {
    return null;
  }
  
  const completionTime = task.completedAt.getTime() - task.createdAt.getTime();
  return completionTime / (1000 * 60 * 60);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '91cdb7e04a917c132c5de2e90731694b755d911d82ab03eb8b67e2232d3aa0b4',
  name: 'Metrics',
  risk_tier: 'medium',
  canon_ids: [4 as const],
} as const;