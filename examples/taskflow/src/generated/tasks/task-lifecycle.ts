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

export type NotificationCallback = (task: Task, event: string, details?: any) => void;

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['in_progress'],
  in_progress: ['review', 'open'],
  review: ['done', 'in_progress'],
  done: []
};

export class TaskLifecycleManager {
  private tasks = new Map<string, Task>();
  private notificationCallbacks: NotificationCallback[] = [];

  addNotificationCallback(callback: NotificationCallback): void {
    this.notificationCallbacks.push(callback);
  }

  removeNotificationCallback(callback: NotificationCallback): void {
    const index = this.notificationCallbacks.indexOf(callback);
    if (index >= 0) {
      this.notificationCallbacks.splice(index, 1);
    }
  }

  private notify(task: Task, event: string, details?: any): void {
    for (const callback of this.notificationCallbacks) {
      try {
        callback(task, event, details);
      } catch (error) {
        // Ignore notification callback errors
      }
    }
  }

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
    this.notify(task, 'created');
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  updateTask(id: string, input: TaskUpdateInput): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task with ID ${id} not found`);
    }

    const updatedTask: Task = {
      ...task,
      ...input,
      updated_at: new Date()
    };

    this.tasks.set(id, updatedTask);
    this.notify(updatedTask, 'updated', { changes: input });
    return updatedTask;
  }

  transitionStatus(id: string, newStatus: TaskStatus): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task with ID ${id} not found`);
    }

    if (task.status === newStatus) {
      return task; // No change needed
    }

    const validTransitions = VALID_TRANSITIONS[task.status];
    if (!validTransitions.includes(newStatus)) {
      throw new Error(
        `Invalid status transition from '${task.status}' to '${newStatus}'. ` +
        `Valid transitions are: ${validTransitions.join(', ')}`
      );
    }

    const now = new Date();
    const updatedTask: Task = {
      ...task,
      status: newStatus,
      updated_at: now
    };

    // Handle completion
    if (newStatus === 'done' && task.status !== 'done') {
      updatedTask.completed_at = now;
      updatedTask.duration_ms = now.getTime() - task.created_at.getTime();
    }

    // Clear completion data if moving away from done
    if (task.status === 'done' && newStatus !== 'done') {
      updatedTask.completed_at = undefined;
      updatedTask.duration_ms = undefined;
    }

    this.tasks.set(id, updatedTask);
    this.notify(updatedTask, 'status_changed', { 
      from: task.status, 
      to: newStatus 
    });

    if (newStatus === 'done') {
      this.notify(updatedTask, 'completed', {
        duration_ms: updatedTask.duration_ms
      });
    }

    return updatedTask;
  }

  deleteTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) {
      return false;
    }

    this.tasks.delete(id);
    this.notify(task, 'deleted');
    return true;
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter(task => task.status === status);
  }

  getTasksByPriority(priority: TaskPriority): Task[] {
    return Array.from(this.tasks.values()).filter(task => task.priority === priority);
  }

  getCompletedTasks(): Task[] {
    return this.getTasksByStatus('done');
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

export function createTaskLifecycleManager(): TaskLifecycleManager {
  return new TaskLifecycleManager();
}

export function validateTaskPriority(priority: string): priority is TaskPriority {
  return ['low', 'medium', 'high', 'critical'].includes(priority);
}

export function validateTaskStatus(status: string): status is TaskStatus {
  return ['open', 'in_progress', 'review', 'done'].includes(status);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'aa5572d4c3285803b48ca24b2d436cc3f2ad7489a5bf1e933067932d6d7c8264',
  name: 'Task Lifecycle',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;