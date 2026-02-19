export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  deadline?: string;
  createdAt: string;
}

export interface TaskFormData {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  deadline?: string;
}

export interface DashboardState {
  tasks: Task[];
  taskCount: number;
}

export class DashboardPage {
  private tasks: Task[] = [];

  public addTask(formData: TaskFormData): Task {
    this.validateTaskForm(formData);
    
    const task: Task = {
      id: this.generateId(),
      title: formData.title.trim(),
      description: formData.description.trim(),
      priority: formData.priority,
      deadline: formData.deadline || undefined,
      createdAt: new Date().toISOString(),
    };

    this.tasks.push(task);
    return task;
  }

  public getTasks(): Task[] {
    return [...this.tasks];
  }

  public getTaskCount(): number {
    return this.tasks.length;
  }

  public renderHTML(): string {
    const taskCount = this.getTaskCount();
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TaskFlow Dashboard</title>
    <style>
        :root {
            --primary: #2563eb;
            --danger: #dc2626;
            --success: #16a34a;
            --warning: #d97706;
            --primary-light: #dbeafe;
            --gray-50: #f9fafb;
            --gray-100: #f3f4f6;
            --gray-200: #e5e7eb;
            --gray-300: #d1d5db;
            --gray-600: #4b5563;
            --gray-800: #1f2937;
            --gray-900: #111827;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: var(--gray-50);
            color: var(--gray-900);
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 1rem;
        }

        .header {
            background: white;
            border-bottom: 1px solid var(--gray-200);
            padding: 1rem 0;
            margin-bottom: 2rem;
        }

        .header-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .logo {
            font-size: 1.75rem;
            font-weight: 700;
            color: var(--primary);
        }

        .task-summary {
            background: var(--primary-light);
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-weight: 600;
            color: var(--primary);
        }

        .main-content {
            display: grid;
            grid-template-columns: 1fr 2fr;
            gap: 2rem;
            margin-bottom: 2rem;
        }

        .card {
            background: white;
            border-radius: 0.75rem;
            padding: 1.5rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .card-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
            color: var(--gray-800);
        }

        .form-group {
            margin-bottom: 1rem;
        }

        .form-label {
            display: block;
            font-weight: 500;
            margin-bottom: 0.5rem;
            color: var(--gray-700);
        }

        .form-input,
        .form-select,
        .form-textarea {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid var(--gray-300);
            border-radius: 0.5rem;
            font-size: 0.875rem;
            transition: border-color 0.2s;
        }

        .form-input:focus,
        .form-select:focus,
        .form-textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .form-textarea {
            resize: vertical;
            min-height: 80px;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: 0.5rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
        }

        .btn-primary {
            background: var(--primary);
            color: white;
        }

        .btn-primary:hover {
            background: #1d4ed8;
        }

        .btn-primary:disabled {
            background: var(--gray-300);
            cursor: not-allowed;
        }

        .error-message {
            color: var(--danger);
            font-size: 0.875rem;
            margin-top: 0.25rem;
            display: none;
        }

        .error-message.show {
            display: block;
        }

        .priority-badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 0.25rem;
            font-size: 0.75rem;
            font-weight: 500;
            text-transform: uppercase;
        }

        .priority-low {
            background: var(--success);
            color: white;
        }

        .priority-medium {
            background: var(--warning);
            color: white;
        }

        .priority-high {
            background: var(--danger);
            color: white;
        }

        .task-list {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .task-item {
            padding: 1rem;
            border: 1px solid var(--gray-200);
            border-radius: 0.5rem;
            background: var(--gray-50);
        }

        .task-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 0.5rem;
        }

        .task-title {
            font-weight: 600;
            color: var(--gray-800);
        }

        .task-description {
            color: var(--gray-600);
            margin-bottom: 0.5rem;
        }

        .task-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.875rem;
            color: var(--gray-500);
        }

        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
            }
            
            .header-content {
                flex-direction: column;
                gap: 1rem;
            }
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="container">
            <div class="header-content">
                <h1 class="logo">TaskFlow</h1>
                <div class="task-summary">
                    <span id="task-count">${taskCount}</span> tasks
                </div>
            </div>
        </div>
    </header>

    <div class="container">
        <div class="main-content">
            <div class="card">
                <h2 class="card-title">Create New Task</h2>
                <form id="task-form">
                    <div class="form-group">
                        <label class="form-label" for="title">Title *</label>
                        <input type="text" id="title" name="title" class="form-input" required>
                        <div class="error-message" id="title-error">Title is required</div>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="description">Description</label>
                        <textarea id="description" name="description" class="form-textarea" rows="3"></textarea>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="priority">Priority</label>
                        <select id="priority" name="priority" class="form-select">
                            <option value="low">Low</option>
                            <option value="medium" selected>Medium</option>
                            <option value="high">High</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="deadline">Deadline (Optional)</label>
                        <input type="date" id="deadline" name="deadline" class="form-input">
                    </div>

                    <button type="submit" class="btn btn-primary">Create Task</button>
                </form>
            </div>

            <div class="card">
                <h2 class="card-title">Recent Tasks</h2>
                <div class="task-list" id="task-list">
                    ${this.renderTaskList()}
                </div>
            </div>
        </div>
    </div>

    <script>
        (function() {
            const form = document.getElementById('task-form');
            const titleInput = document.getElementById('title');
            const titleError = document.getElementById('title-error');
            const taskCountEl = document.getElementById('task-count');
            const taskList = document.getElementById('task-list');

            function validateTitle() {
                const title = titleInput.value.trim();
                if (!title) {
                    titleError.classList.add('show');
                    titleInput.style.borderColor = 'var(--danger)';
                    return false;
                } else {
                    titleError.classList.remove('show');
                    titleInput.style.borderColor = '';
                    return true;
                }
            }

            function formatDate(dateString) {
                if (!dateString) return '';
                return new Date(dateString).toLocaleDateString();
            }

            function createTaskElement(task) {
                return \`
                    <div class="task-item">
                        <div class="task-header">
                            <h3 class="task-title">\${task.title}</h3>
                            <span class="priority-badge priority-\${task.priority}">\${task.priority}</span>
                        </div>
                        \${task.description ? \`<p class="task-description">\${task.description}</p>\` : ''}
                        <div class="task-meta">
                            <span>Created: \${formatDate(task.createdAt)}</span>
                            \${task.deadline ? \`<span>Due: \${formatDate(task.deadline)}</span>\` : ''}
                        </div>
                    </div>
                \`;
            }

            titleInput.addEventListener('blur', validateTitle);
            titleInput.addEventListener('input', function() {
                if (titleError.classList.contains('show')) {
                    validateTitle();
                }
            });

            form.addEventListener('submit', function(e) {
                e.preventDefault();
                
                if (!validateTitle()) {
                    return;
                }

                const formData = new FormData(form);
                const task = {
                    id: Date.now().toString(),
                    title: formData.get('title').trim(),
                    description: formData.get('description').trim(),
                    priority: formData.get('priority'),
                    deadline: formData.get('deadline') || null,
                    createdAt: new Date().toISOString()
                };

                // Add task to list
                const taskElement = createTaskElement(task);
                if (taskList.children.length === 0 || taskList.textContent.includes('No tasks yet')) {
                    taskList.innerHTML = taskElement;
                } else {
                    taskList.insertAdjacentHTML('afterbegin', taskElement);
                }

                // Update task count
                const currentCount = parseInt(taskCountEl.textContent);
                taskCountEl.textContent = currentCount + 1;

                // Reset form
                form.reset();
                document.getElementById('priority').value = 'medium';
            });
        })();
    </script>
</body>
</html>`;
  }

  private validateTaskForm(formData: TaskFormData): void {
    if (!formData.title || formData.title.trim().length === 0) {
      throw new Error('Title is required');
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private renderTaskList(): string {
    if (this.tasks.length === 0) {
      return '<p style="color: var(--gray-500); text-align: center; padding: 2rem;">No tasks yet. Create your first task!</p>';
    }

    return this.tasks
      .slice(-5) // Show last 5 tasks
      .reverse()
      .map(task => `
        <div class="task-item">
          <div class="task-header">
            <h3 class="task-title">${this.escapeHtml(task.title)}</h3>
            <span class="priority-badge priority-${task.priority}">${task.priority}</span>
          </div>
          ${task.description ? `<p class="task-description">${this.escapeHtml(task.description)}</p>` : ''}
          <div class="task-meta">
            <span>Created: ${this.formatDate(task.createdAt)}</span>
            ${task.deadline ? `<span>Due: ${this.formatDate(task.deadline)}</span>` : ''}
          </div>
        </div>
      `).join('');
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

  private formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
}

export function createDashboard(): DashboardPage {
  return new DashboardPage();
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'ec4737a7671a24d2c859604470556a65e34e7a700615fa11f18bf5e3d4e5ea88',
  name: 'Dashboard Page',
  risk_tier: 'high',
  canon_ids: [7 as const],
} as const;