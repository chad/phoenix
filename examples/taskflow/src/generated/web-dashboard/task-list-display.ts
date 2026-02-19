export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'review' | 'done';
  assignee: string;
  deadline: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskFilter {
  status?: Task['status'][];
  priority?: Task['priority'][];
  assignee?: string[];
}

export interface TaskListDisplayOptions {
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
  onTaskClick?: (task: Task) => void;
}

export class TaskListDisplay {
  private tasks: Task[] = [];
  private filter: TaskFilter = {};
  private options: TaskListDisplayOptions;

  constructor(options: TaskListDisplayOptions = {}) {
    this.options = options;
  }

  setTasks(tasks: Task[]): void {
    this.tasks = tasks;
  }

  setFilter(filter: TaskFilter): void {
    this.filter = filter;
  }

  private getFilteredTasks(): Task[] {
    return this.tasks.filter(task => {
      if (this.filter.status && !this.filter.status.includes(task.status)) {
        return false;
      }
      if (this.filter.priority && !this.filter.priority.includes(task.priority)) {
        return false;
      }
      if (this.filter.assignee && !this.filter.assignee.includes(task.assignee)) {
        return false;
      }
      return true;
    });
  }

  private isOverdue(task: Task): boolean {
    return new Date() > task.deadline && task.status !== 'done';
  }

  private getPriorityBadgeColor(priority: Task['priority']): string {
    const colors = {
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#ca8a04',
      low: '#16a34a'
    };
    return colors[priority];
  }

  private getStatusBadgeColor(status: Task['status']): string {
    const colors = {
      open: '#6b7280',
      in_progress: '#2563eb',
      review: '#7c3aed',
      done: '#16a34a'
    };
    return colors[status];
  }

  private getStatusTransitions(currentStatus: Task['status']): Task['status'][] {
    const transitions: Record<Task['status'], Task['status'][]> = {
      open: ['in_progress'],
      in_progress: ['review', 'open'],
      review: ['done', 'in_progress'],
      done: ['open']
    };
    return transitions[currentStatus];
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  private generateTaskCard(task: Task): string {
    const isTaskOverdue = this.isOverdue(task);
    const priorityColor = this.getPriorityBadgeColor(task.priority);
    const statusColor = this.getStatusBadgeColor(task.status);
    const transitions = this.getStatusTransitions(task.status);

    const overdueIndicator = isTaskOverdue 
      ? '<div class="overdue-indicator">OVERDUE</div>' 
      : '';

    const transitionButtons = transitions.map(status => 
      `<button class="status-transition-btn" data-task-id="${task.id}" data-new-status="${status}">
        ${status.replace('_', ' ').toUpperCase()}
      </button>`
    ).join('');

    return `
      <div class="task-card ${isTaskOverdue ? 'overdue' : ''}" data-task-id="${task.id}">
        ${overdueIndicator}
        <div class="task-header">
          <h3 class="task-title">${this.escapeHtml(task.title)}</h3>
          <div class="task-badges">
            <span class="priority-badge" style="background-color: ${priorityColor}">
              ${task.priority.toUpperCase()}
            </span>
            <span class="status-badge" style="background-color: ${statusColor}">
              ${task.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>
        <div class="task-description">
          ${this.escapeHtml(task.description)}
        </div>
        <div class="task-meta">
          <div class="task-assignee">
            <strong>Assignee:</strong> ${this.escapeHtml(task.assignee)}
          </div>
          <div class="task-deadline">
            <strong>Deadline:</strong> ${this.formatDate(task.deadline)}
          </div>
        </div>
        <div class="task-actions">
          ${transitionButtons}
        </div>
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    const div = { innerHTML: '' } as any;
    div.textContent = text;
    return div.innerHTML || text.replace(/[&<>"']/g, (match: string) => {
      const escapeMap: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return escapeMap[match];
    });
  }

  render(): string {
    const filteredTasks = this.getFilteredTasks();
    
    if (filteredTasks.length === 0) {
      return `
        <div class="task-list-empty">
          <p>No tasks match the current filters.</p>
        </div>
      `;
    }

    const taskCards = filteredTasks.map(task => this.generateTaskCard(task)).join('');

    return `
      <div class="task-list-display">
        <style>
          .task-list-display {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 1rem;
            padding: 1rem;
          }
          
          .task-card {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 1rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            transition: box-shadow 0.2s;
          }
          
          .task-card:hover {
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          
          .task-card.overdue {
            border-color: #dc2626;
            border-width: 2px;
          }
          
          .overdue-indicator {
            background: #dc2626;
            color: white;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
            display: inline-block;
          }
          
          .task-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 0.75rem;
          }
          
          .task-title {
            margin: 0;
            font-size: 1.125rem;
            font-weight: 600;
            color: #111827;
            flex: 1;
            margin-right: 0.5rem;
          }
          
          .task-badges {
            display: flex;
            gap: 0.5rem;
            flex-shrink: 0;
          }
          
          .priority-badge,
          .status-badge {
            color: white;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
            text-transform: uppercase;
          }
          
          .task-description {
            color: #6b7280;
            margin-bottom: 1rem;
            line-height: 1.5;
          }
          
          .task-meta {
            margin-bottom: 1rem;
            font-size: 0.875rem;
          }
          
          .task-assignee,
          .task-deadline {
            margin-bottom: 0.25rem;
          }
          
          .task-actions {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
          }
          
          .status-transition-btn {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 0.5rem 0.75rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
          }
          
          .status-transition-btn:hover {
            background: #2563eb;
          }
          
          .task-list-empty {
            grid-column: 1 / -1;
            text-align: center;
            padding: 2rem;
            color: #6b7280;
          }
          
          @media (max-width: 768px) {
            .task-list-display {
              grid-template-columns: 1fr;
              padding: 0.5rem;
            }
            
            .task-header {
              flex-direction: column;
              align-items: flex-start;
            }
            
            .task-badges {
              margin-top: 0.5rem;
            }
          }
        </style>
        ${taskCards}
      </div>
    `;
  }

  attachEventListeners(container: HTMLElement): void {
    container.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      
      if (target.classList.contains('status-transition-btn')) {
        const taskId = target.getAttribute('data-task-id');
        const newStatus = target.getAttribute('data-new-status') as Task['status'];
        
        if (taskId && newStatus && this.options.onStatusChange) {
          this.options.onStatusChange(taskId, newStatus);
        }
      } else if (target.closest('.task-card')) {
        const taskCard = target.closest('.task-card') as HTMLElement;
        const taskId = taskCard.getAttribute('data-task-id');
        const task = this.tasks.find(t => t.id === taskId);
        
        if (task && this.options.onTaskClick) {
          this.options.onTaskClick(task);
        }
      }
    });
  }
}

export function createTaskListDisplay(options?: TaskListDisplayOptions): TaskListDisplay {
  return new TaskListDisplay(options);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'a6550cdc3ef254c13571c1134a3f1ad230c942e0325c50f89ae97502a302fd01',
  name: 'Task List Display',
  risk_tier: 'medium',
  canon_ids: [7 as const],
} as const;