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

  private getPriorityColor(priority: Task['priority']): string {
    switch (priority) {
      case 'critical': return '#dc2626';
      case 'high': return '#ea580c';
      case 'medium': return '#ca8a04';
      case 'low': return '#16a34a';
    }
  }

  private getStatusColor(status: Task['status']): string {
    switch (status) {
      case 'open': return '#6b7280';
      case 'in_progress': return '#2563eb';
      case 'review': return '#7c3aed';
      case 'done': return '#16a34a';
    }
  }

  private getStatusTransitions(currentStatus: Task['status']): Task['status'][] {
    switch (currentStatus) {
      case 'open': return ['in_progress'];
      case 'in_progress': return ['review', 'open'];
      case 'review': return ['done', 'in_progress'];
      case 'done': return ['open'];
    }
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  private renderTaskCard(task: Task): string {
    const isOverdue = this.isOverdue(task);
    const priorityColor = this.getPriorityColor(task.priority);
    const statusColor = this.getStatusColor(task.status);
    const transitions = this.getStatusTransitions(task.status);

    const cardStyle = `
      border: 2px solid ${isOverdue ? '#dc2626' : '#e5e7eb'};
      border-radius: 8px;
      padding: 16px;
      background: white;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
      cursor: pointer;
      transition: box-shadow 0.2s;
    `;

    const titleStyle = `
      font-size: 18px;
      font-weight: 600;
      color: #111827;
      margin: 0;
      line-height: 1.4;
    `;

    const descriptionStyle = `
      color: #6b7280;
      font-size: 14px;
      line-height: 1.5;
      margin: 0;
    `;

    const badgeStyle = `
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      color: white;
    `;

    const buttonStyle = `
      padding: 6px 12px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      background: white;
      color: #374151;
      font-size: 12px;
      cursor: pointer;
      transition: background-color 0.2s;
    `;

    const overdueIndicator = isOverdue ? `
      <div style="
        position: absolute;
        top: 8px;
        right: 8px;
        background: #dc2626;
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
      ">OVERDUE</div>
    ` : '';

    const transitionButtons = transitions.map(status => `
      <button 
        style="${buttonStyle}"
        onclick="window.taskListDisplay?.handleStatusChange('${task.id}', '${status}')"
        onmouseover="this.style.backgroundColor='#f3f4f6'"
        onmouseout="this.style.backgroundColor='white'"
      >
        ${status.replace('_', ' ').toUpperCase()}
      </button>
    `).join('');

    return `
      <div 
        style="${cardStyle}"
        onclick="window.taskListDisplay?.handleTaskClick('${task.id}')"
        onmouseover="this.style.boxShadow='0 4px 6px rgba(0, 0, 0, 0.1)'"
        onmouseout="this.style.boxShadow='0 1px 3px rgba(0, 0, 0, 0.1)'"
      >
        ${overdueIndicator}
        
        <h3 style="${titleStyle}">${this.escapeHtml(task.title)}</h3>
        
        <p style="${descriptionStyle}">${this.escapeHtml(task.description)}</p>
        
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <span style="${badgeStyle}; background-color: ${priorityColor};">
            ${task.priority}
          </span>
          <span style="${badgeStyle}; background-color: ${statusColor};">
            ${task.status.replace('_', ' ')}
          </span>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; color: #6b7280;">
          <span>Assigned to: ${this.escapeHtml(task.assignee)}</span>
          <span>Due: ${this.formatDate(task.deadline)}</span>
        </div>
        
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
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

    const gridStyle = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 20px;
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    `;

    const emptyStateStyle = `
      text-align: center;
      padding: 40px;
      color: #6b7280;
      font-size: 16px;
    `;

    if (filteredTasks.length === 0) {
      return `
        <div style="${emptyStateStyle}">
          No tasks match the current filters.
        </div>
      `;
    }

    const taskCards = filteredTasks.map(task => this.renderTaskCard(task)).join('');

    return `
      <div style="${gridStyle}">
        ${taskCards}
      </div>
      <script>
        window.taskListDisplay = {
          handleStatusChange: (taskId, newStatus) => {
            if (window.taskListDisplayInstance?.options.onStatusChange) {
              window.taskListDisplayInstance.options.onStatusChange(taskId, newStatus);
            }
          },
          handleTaskClick: (taskId) => {
            if (window.taskListDisplayInstance?.options.onTaskClick) {
              const task = window.taskListDisplayInstance.tasks.find(t => t.id === taskId);
              if (task) {
                window.taskListDisplayInstance.options.onTaskClick(task);
              }
            }
          }
        };
      </script>
    `;
  }

  attachToGlobal(): void {
    (globalThis as any).taskListDisplayInstance = this;
  }
}

export function createTaskListDisplay(options?: TaskListDisplayOptions): TaskListDisplay {
  const display = new TaskListDisplay(options);
  display.attachToGlobal();
  return display;
}

export function renderTaskFilter(
  availableStatuses: Task['status'][],
  availablePriorities: Task['priority'][],
  availableAssignees: string[],
  currentFilter: TaskFilter,
  onFilterChange: (filter: TaskFilter) => void
): string {
  const filterStyle = `
    display: flex;
    gap: 16px;
    padding: 16px;
    background: #f9fafb;
    border-radius: 8px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  `;

  const selectStyle = `
    padding: 8px 12px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    background: white;
    font-size: 14px;
  `;

  const labelStyle = `
    font-weight: 500;
    color: #374151;
    margin-bottom: 4px;
    display: block;
  `;

  return `
    <div style="${filterStyle}">
      <div>
        <label style="${labelStyle}">Status:</label>
        <select 
          style="${selectStyle}" 
          multiple
          onchange="window.updateFilter('status', Array.from(this.selectedOptions).map(o => o.value))"
        >
          ${availableStatuses.map(status => `
            <option value="${status}" ${currentFilter.status?.includes(status) ? 'selected' : ''}>
              ${status.replace('_', ' ').toUpperCase()}
            </option>
          `).join('')}
        </select>
      </div>
      
      <div>
        <label style="${labelStyle}">Priority:</label>
        <select 
          style="${selectStyle}" 
          multiple
          onchange="window.updateFilter('priority', Array.from(this.selectedOptions).map(o => o.value))"
        >
          ${availablePriorities.map(priority => `
            <option value="${priority}" ${currentFilter.priority?.includes(priority) ? 'selected' : ''}>
              ${priority.toUpperCase()}
            </option>
          `).join('')}
        </select>
      </div>
      
      <div>
        <label style="${labelStyle}">Assignee:</label>
        <select 
          style="${selectStyle}" 
          multiple
          onchange="window.updateFilter('assignee', Array.from(this.selectedOptions).map(o => o.value))"
        >
          ${availableAssignees.map(assignee => `
            <option value="${assignee}" ${currentFilter.assignee?.includes(assignee) ? 'selected' : ''}>
              ${assignee}
            </option>
          `).join('')}
        </select>
      </div>
      
      <button 
        style="${selectStyle}; cursor: pointer; background: #ef4444; color: white; border-color: #dc2626;"
        onclick="window.clearFilters()"
      >
        Clear Filters
      </button>
    </div>
    
    <script>
      window.updateFilter = (type, values) => {
        const newFilter = { ...window.currentTaskFilter };
        if (values.length === 0) {
          delete newFilter[type];
        } else {
          newFilter[type] = values;
        }
        window.currentTaskFilter = newFilter;
        if (window.onTaskFilterChange) {
          window.onTaskFilterChange(newFilter);
        }
      };
      
      window.clearFilters = () => {
        window.currentTaskFilter = {};
        if (window.onTaskFilterChange) {
          window.onTaskFilterChange({});
        }
        // Reset all selects
        document.querySelectorAll('select').forEach(select => {
          select.selectedIndex = -1;
        });
      };
      
      window.currentTaskFilter = ${JSON.stringify(currentFilter)};
      window.onTaskFilterChange = ${onFilterChange.toString()};
    </script>
  `;
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'a6550cdc3ef254c13571c1134a3f1ad230c942e0325c50f89ae97502a302fd01',
  name: 'Task List Display',
  risk_tier: 'medium',
  canon_ids: [7 as const],
} as const;