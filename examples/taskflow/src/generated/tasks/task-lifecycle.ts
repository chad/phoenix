import { randomUUID } from 'node:crypto';

export type TaskStatus = 'open' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
  duration_ms?: number;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  priority: TaskPriority;
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
}

export class TaskLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskLifecycleError';
  }
}

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress'],
  in_progress: ['review', 'open'],
  review: ['done', 'in_progress'],
  done: []
};

export class TaskLifecycle {
  private tasks = new Map<string, Task>();

  createTask(input: TaskCreateInput): Task {
    const now = new Date();
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      status: 'open',
      priority: input.priority,
      created_at: now,
      updated_at: now
    };

    this.tasks.set(task.id, task);
    return { ...task };
  }

  getTask(id: string): Task | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).map(task => ({ ...task }));
  }

  updateTask(id: string, input: TaskUpdateInput): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskLifecycleError(`Task with id ${id} not found`);
    }

    const updatedTask: Task = {
      ...task,
      ...input,
      updated_at: new Date()
    };

    this.tasks.set(id, updatedTask);
    return { ...updatedTask };
  }

  transitionStatus(id: string, newStatus: TaskStatus): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskLifecycleError(`Task with id ${id} not found`);
    }

    const validTransitions = VALID_TRANSITIONS[task.status];
    if (!validTransitions.includes(newStatus)) {
      throw new TaskLifecycleError(
        `Invalid status transition from ${task.status} to ${newStatus}. Valid transitions: ${validTransitions.join(', ')}`
      );
    }

    const now = new Date();
    const updatedTask: Task = {
      ...task,
      status: newStatus,
      updated_at: now
    };

    if (newStatus === 'done') {
      updatedTask.completed_at = now;
      updatedTask.duration_ms = now.getTime() - task.created_at.getTime();
    }

    this.tasks.set(id, updatedTask);
    return { ...updatedTask };
  }

  deleteTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values())
      .filter(task => task.status === status)
      .map(task => ({ ...task }));
  }

  getTasksByPriority(priority: TaskPriority): Task[] {
    return Array.from(this.tasks.values())
      .filter(task => task.priority === priority)
      .map(task => ({ ...task }));
  }

  getCompletedTasks(): Task[] {
    return Array.from(this.tasks.values())
      .filter(task => task.status === 'done' && task.completed_at)
      .map(task => ({ ...task }));
  }

  getTaskDuration(id: string): number | undefined {
    const task = this.tasks.get(id);
    return task?.duration_ms;
  }

  isValidTransition(currentStatus: TaskStatus, newStatus: TaskStatus): boolean {
    return VALID_TRANSITIONS[currentStatus].includes(newStatus);
  }

  getValidTransitions(status: TaskStatus): TaskStatus[] {
    return [...VALID_TRANSITIONS[status]];
  }
}

export function createTaskLifecycle(): TaskLifecycle {
  return new TaskLifecycle();
}

export function validateTaskStatus(status: string): status is TaskStatus {
  return ['open', 'in_progress', 'review', 'done'].includes(status);
}

export function validateTaskPriority(priority: string): priority is TaskPriority {
  return ['low', 'medium', 'high', 'critical'].includes(priority);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'aa5572d4c3285803b48ca24b2d436cc3f2ad7489a5bf1e933067932d6d7c8264',
  name: 'Task Lifecycle',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;