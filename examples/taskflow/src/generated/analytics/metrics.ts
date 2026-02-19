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

  updateTasks(tasks: TaskRecord[]): void {
    this.tasks = [...tasks];
  }

  addTask(task: TaskRecord): void {
    this.tasks.push(task);
  }

  removeTask(taskId: string): void {
    this.tasks = this.tasks.filter(task => task.id !== taskId);
  }

  getSnapshot(): MetricsSnapshot {
    const now = new Date();
    
    return {
      totalTasksCreated: this.calculateTotalTasksCreated(),
      totalTasksCompleted: this.calculateTotalTasksCompleted(),
      totalTasksOverdue: this.calculateTotalTasksOverdue(now),
      averageCompletionTimeHours: this.calculateAverageCompletionTime(),
      throughputTasksPerDay: this.calculateThroughput(now),
      calculatedAt: now
    };
  }

  private calculateTotalTasksCreated(): number {
    return this.tasks.length;
  }

  private calculateTotalTasksCompleted(): number {
    return this.tasks.filter(task => task.status === 'completed').length;
  }

  private calculateTotalTasksOverdue(now: Date): number {
    return this.tasks.filter(task => {
      if (task.status === 'completed' || task.status === 'cancelled') {
        return false;
      }
      return task.dueDate && task.dueDate < now;
    }).length;
  }

  private calculateAverageCompletionTime(): number {
    const completedTasks = this.tasks.filter(task => 
      task.status === 'completed' && task.completedAt
    );

    if (completedTasks.length === 0) {
      return 0;
    }

    const totalCompletionTimeMs = completedTasks.reduce((sum, task) => {
      const completionTime = task.completedAt!.getTime() - task.createdAt.getTime();
      return sum + completionTime;
    }, 0);

    const averageCompletionTimeMs = totalCompletionTimeMs / completedTasks.length;
    return averageCompletionTimeMs / (1000 * 60 * 60); // Convert to hours
  }

  private calculateThroughput(now: Date): number {
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    const completedInWindow = this.tasks.filter(task => {
      if (task.status !== 'completed' || !task.completedAt) {
        return false;
      }
      return task.completedAt >= sevenDaysAgo && task.completedAt <= now;
    });

    return completedInWindow.length / 7;
  }
}

export function calculateMetrics(tasks: TaskRecord[]): MetricsSnapshot {
  const metrics = new Metrics(tasks);
  return metrics.getSnapshot();
}

export function isTaskOverdue(task: TaskRecord, referenceDate: Date = new Date()): boolean {
  if (task.status === 'completed' || task.status === 'cancelled') {
    return false;
  }
  return task.dueDate ? task.dueDate < referenceDate : false;
}

export function getCompletionTimeHours(task: TaskRecord): number | null {
  if (task.status !== 'completed' || !task.completedAt) {
    return null;
  }
  
  const completionTimeMs = task.completedAt.getTime() - task.createdAt.getTime();
  return completionTimeMs / (1000 * 60 * 60);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'c6a76ccf723cbaf85f990a1b7260b82c8063e5b48c1ef23fcbcc42161e235cbd',
  name: 'Metrics',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;