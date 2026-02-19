export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  deadline?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeadlineWarning {
  taskId: string;
  message: string;
  timestamp: Date;
}

export interface OverdueTask {
  task: Task;
  daysPastDeadline: number;
}

export class DeadlineManager {
  private tasks = new Map<string, Task>();
  private warnings: DeadlineWarning[] = [];

  setTaskDeadline(taskId: string, deadline: Date): DeadlineWarning | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task with id ${taskId} not found`);
    }

    const now = new Date();
    let warning: DeadlineWarning | null = null;

    if (deadline < now) {
      warning = {
        taskId,
        message: `Warning: Deadline set in the past (${deadline.toISOString()})`,
        timestamp: now
      };
      this.warnings.push(warning);
    }

    task.deadline = deadline;
    task.updatedAt = now;

    return warning;
  }

  addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const now = new Date();
    const newTask: Task = {
      ...task,
      id: this.generateId(),
      createdAt: now,
      updatedAt: now
    };

    if (newTask.deadline && newTask.deadline < now) {
      const warning: DeadlineWarning = {
        taskId: newTask.id,
        message: `Warning: Task created with deadline in the past (${newTask.deadline.toISOString()})`,
        timestamp: now
      };
      this.warnings.push(warning);
    }

    this.tasks.set(newTask.id, newTask);
    return newTask;
  }

  updateTask(taskId: string, updates: Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task with id ${taskId} not found`);
    }

    const now = new Date();
    const updatedTask: Task = {
      ...task,
      ...updates,
      updatedAt: now
    };

    if (updates.deadline && updates.deadline < now && !task.completed) {
      const warning: DeadlineWarning = {
        taskId,
        message: `Warning: Deadline updated to past date (${updates.deadline.toISOString()})`,
        timestamp: now
      };
      this.warnings.push(warning);
    }

    this.tasks.set(taskId, updatedTask);
    return updatedTask;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getOverdueTasks(): OverdueTask[] {
    const now = new Date();
    const overdueTasks: OverdueTask[] = [];

    for (const task of this.tasks.values()) {
      if (task.deadline && !task.completed && task.deadline < now) {
        const daysPastDeadline = Math.floor(
          (now.getTime() - task.deadline.getTime()) / (1000 * 60 * 60 * 24)
        );
        overdueTasks.push({
          task,
          daysPastDeadline
        });
      }
    }

    return overdueTasks.sort((a, b) => b.daysPastDeadline - a.daysPastDeadline);
  }

  isTaskOverdue(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || !task.deadline || task.completed) {
      return false;
    }
    return task.deadline < new Date();
  }

  getWarnings(): DeadlineWarning[] {
    return [...this.warnings];
  }

  clearWarnings(): void {
    this.warnings = [];
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

export function createDeadlineManager(): DeadlineManager {
  return new DeadlineManager();
}

export function calculateDaysUntilDeadline(deadline: Date): number {
  const now = new Date();
  const diffTime = deadline.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function formatDeadlineStatus(task: Task): string {
  if (!task.deadline) {
    return 'No deadline';
  }

  if (task.completed) {
    return 'Completed';
  }

  const daysUntil = calculateDaysUntilDeadline(task.deadline);
  
  if (daysUntil < 0) {
    return `Overdue by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'}`;
  } else if (daysUntil === 0) {
    return 'Due today';
  } else if (daysUntil === 1) {
    return 'Due tomorrow';
  } else {
    return `Due in ${daysUntil} days`;
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '8e0191994ba2a364acf2753ba76a9c63e725dd7b9a4993792ccf1d62806eb460',
  name: 'Deadline Management',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;