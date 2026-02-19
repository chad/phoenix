export interface TaskDeadline {
  taskId: string;
  deadline: Date;
  isOverdue: boolean;
  daysOverdue: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled';
  deadline?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeadlineWarning {
  message: string;
  taskId: string;
  deadline: Date;
  currentDate: Date;
}

export class DeadlineManager {
  private tasks = new Map<string, Task>();
  private warningCallbacks: Array<(warning: DeadlineWarning) => void> = [];

  addTask(task: Task): void {
    if (task.deadline && this.isDateInPast(task.deadline)) {
      const warning: DeadlineWarning = {
        message: `Warning: Task "${task.title}" has a deadline in the past (${task.deadline.toISOString()})`,
        taskId: task.id,
        deadline: task.deadline,
        currentDate: new Date()
      };
      this.emitWarning(warning);
    }
    this.tasks.set(task.id, { ...task });
  }

  updateTask(taskId: string, updates: Partial<Task>): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    const updatedTask = { ...task, ...updates, updatedAt: new Date() };

    if (updates.deadline && this.isDateInPast(updates.deadline)) {
      const warning: DeadlineWarning = {
        message: `Warning: Task "${updatedTask.title}" deadline updated to a past date (${updates.deadline.toISOString()})`,
        taskId: taskId,
        deadline: updates.deadline,
        currentDate: new Date()
      };
      this.emitWarning(warning);
    }

    this.tasks.set(taskId, updatedTask);
    return true;
  }

  setDeadline(taskId: string, deadline: Date): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (this.isDateInPast(deadline)) {
      const warning: DeadlineWarning = {
        message: `Warning: Setting deadline in the past for task "${task.title}" (${deadline.toISOString()})`,
        taskId: taskId,
        deadline: deadline,
        currentDate: new Date()
      };
      this.emitWarning(warning);
    }

    const updatedTask = { ...task, deadline, updatedAt: new Date() };
    this.tasks.set(taskId, updatedTask);
    return true;
  }

  removeDeadline(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    const updatedTask = { ...task, deadline: undefined, updatedAt: new Date() };
    this.tasks.set(taskId, updatedTask);
    return true;
  }

  getOverdueTasks(): TaskDeadline[] {
    const now = new Date();
    const overdueTasks: TaskDeadline[] = [];

    for (const task of this.tasks.values()) {
      if (task.deadline && task.status !== 'completed' && task.status !== 'cancelled') {
        const isOverdue = now > task.deadline;
        if (isOverdue) {
          const daysOverdue = Math.ceil((now.getTime() - task.deadline.getTime()) / (1000 * 60 * 60 * 24));
          overdueTasks.push({
            taskId: task.id,
            deadline: task.deadline,
            isOverdue: true,
            daysOverdue
          });
        }
      }
    }

    return overdueTasks.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }

  getTasksWithDeadlines(): TaskDeadline[] {
    const now = new Date();
    const tasksWithDeadlines: TaskDeadline[] = [];

    for (const task of this.tasks.values()) {
      if (task.deadline) {
        const isOverdue = now > task.deadline && task.status !== 'completed' && task.status !== 'cancelled';
        const daysOverdue = isOverdue ? Math.ceil((now.getTime() - task.deadline.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        
        tasksWithDeadlines.push({
          taskId: task.id,
          deadline: task.deadline,
          isOverdue,
          daysOverdue
        });
      }
    }

    return tasksWithDeadlines.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  onWarning(callback: (warning: DeadlineWarning) => void): void {
    this.warningCallbacks.push(callback);
  }

  removeWarningCallback(callback: (warning: DeadlineWarning) => void): void {
    const index = this.warningCallbacks.indexOf(callback);
    if (index > -1) {
      this.warningCallbacks.splice(index, 1);
    }
  }

  private isDateInPast(date: Date): boolean {
    return date < new Date();
  }

  private emitWarning(warning: DeadlineWarning): void {
    for (const callback of this.warningCallbacks) {
      try {
        callback(warning);
      } catch (error) {
        // Silently continue if callback throws
      }
    }
  }
}

export function createDeadlineManager(): DeadlineManager {
  return new DeadlineManager();
}

export function isTaskOverdue(task: Task): boolean {
  if (!task.deadline || task.status === 'completed' || task.status === 'cancelled') {
    return false;
  }
  return new Date() > task.deadline;
}

export function getDaysOverdue(task: Task): number {
  if (!isTaskOverdue(task) || !task.deadline) {
    return 0;
  }
  return Math.ceil((new Date().getTime() - task.deadline.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDeadlineStatus(task: Task): string {
  if (!task.deadline) {
    return 'No deadline';
  }

  if (task.status === 'completed') {
    return 'Completed';
  }

  if (task.status === 'cancelled') {
    return 'Cancelled';
  }

  const now = new Date();
  if (now > task.deadline) {
    const daysOverdue = getDaysOverdue(task);
    return `Overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`;
  }

  const daysUntilDeadline = Math.ceil((task.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntilDeadline === 0) {
    return 'Due today';
  } else if (daysUntilDeadline === 1) {
    return 'Due tomorrow';
  } else {
    return `Due in ${daysUntilDeadline} days`;
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '8e0191994ba2a364acf2753ba76a9c63e725dd7b9a4993792ccf1d62806eb460',
  name: 'Deadline Management',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;