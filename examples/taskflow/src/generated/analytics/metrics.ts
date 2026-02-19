export interface TaskRecord {
  id: string;
  createdAt: Date;
  completedAt?: Date;
  dueDate?: Date;
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
}

export interface MetricsSnapshot {
  totalTasksCreated: number;
  totalTasksCompleted: number;
  totalTasksOverdue: number;
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

  updateTask(taskId: string, updates: Partial<TaskRecord>): void {
    const index = this.tasks.findIndex(task => task.id === taskId);
    if (index >= 0) {
      this.tasks[index] = { ...this.tasks[index], ...updates };
    }
  }

  removeTask(taskId: string): void {
    this.tasks = this.tasks.filter(task => task.id !== taskId);
  }

  getTotalTasksCreated(): number {
    return this.tasks.length;
  }

  getTotalTasksCompleted(): number {
    return this.tasks.filter(task => task.status === 'completed').length;
  }

  getTotalTasksOverdue(): number {
    const now = new Date();
    return this.tasks.filter(task => {
      return task.status !== 'completed' && 
             task.status !== 'cancelled' && 
             task.dueDate && 
             task.dueDate < now;
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
      const createdTime = task.createdAt.getTime();
      const completedTime = task.completedAt!.getTime();
      const durationMs = completedTime - createdTime;
      const durationHours = durationMs / (1000 * 60 * 60);
      return sum + durationHours;
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
      totalTasksCreated: this.getTotalTasksCreated(),
      totalTasksCompleted: this.getTotalTasksCompleted(),
      totalTasksOverdue: this.getTotalTasksOverdue(),
      averageCompletionTimeHours: this.getAverageCompletionTimeHours(),
      throughputTasksPerDay: this.getThroughputTasksPerDay(),
      calculatedAt: new Date()
    };
  }

  static fromTaskRecords(tasks: TaskRecord[]): Metrics {
    return new Metrics(tasks);
  }

  static calculateMetrics(tasks: TaskRecord[]): MetricsSnapshot {
    const metrics = new Metrics(tasks);
    return metrics.getSnapshot();
  }
}

export function calculateMetricsFromTasks(tasks: TaskRecord[]): MetricsSnapshot {
  return Metrics.calculateMetrics(tasks);
}

export function isTaskOverdue(task: TaskRecord, referenceDate: Date = new Date()): boolean {
  return task.status !== 'completed' && 
         task.status !== 'cancelled' && 
         task.dueDate !== undefined && 
         task.dueDate < referenceDate;
}

export function getTaskCompletionTimeHours(task: TaskRecord): number {
  if (task.status !== 'completed' || !task.completedAt) {
    return 0;
  }
  
  const createdTime = task.createdAt.getTime();
  const completedTime = task.completedAt.getTime();
  const durationMs = completedTime - createdTime;
  return durationMs / (1000 * 60 * 60);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'c6a76ccf723cbaf85f990a1b7260b82c8063e5b48c1ef23fcbcc42161e235cbd',
  name: 'Metrics',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;