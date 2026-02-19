export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  deadline?: string;
  createdAt: Date;
}

export interface DashboardState {
  tasks: Task[];
  taskCount: number;
}

export class DashboardPage {
  private tasks: Task[] = [];
  private taskIdCounter = 1;

  public addTask(title: string, description: string, priority: 'low' | 'medium' | 'high', deadline?: string): Task {
    if (!title.trim()) {
      throw new Error('Task title cannot be empty');
    }

    const task: Task = {
      id: `task-${this.taskIdCounter++}`,
      title: title.trim(),
      description: description.trim(),
      priority,
      deadline: deadline || undefined,
      createdAt: new Date()
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
    const tasks = this.getTasks();

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
            font-size: 1.5rem;
            font-weight: bold;
            color: var(--primary);
        }

        .task-summary {
            background: var(--primary);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            font-weight: 500;
        }

        .main-content {
            display: grid;
            grid-template-columns: 1fr 2fr;
            gap: 2rem;
            margin-bottom: 2rem;
        }

        .card {
            background: white;
            border-radius: 0.5rem;
            padding: 1.5rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .card-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: var(--gray-800);
        }

        .form-group {
            margin-bottom: 1rem;
        }

        .form-label {
            display: block;
            font-weight: 500;
            margin-bottom: 0.25rem;
            color: var(--gray-700);
        }

        .form-input,
        .form-textarea,
        .form-select {
            width: 100%;
            padding: 0.5rem;
            border: 1px solid var(--gray-300);
            border-radius: 0.25rem;
            font-size: 0.875rem;
        }

        .form-input:focus,
        .form-textarea:focus,
        .form-select:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .form-textarea {
            resize: vertical;
            min-height: 4rem;
        }

        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 0.25rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
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

        .task-list {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .task-item {
            background: white;
            border-radius: 0.5rem;
            padding: 1rem;
            border-left: 4px solid var(--gray-300);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .task-item.priority-high {
            border-left-color: var(--danger);
        }

        .task-item.priority-medium {
            border-left-color: var(--warning);
        }

        .task-item.priority-low {
            border-left-color: var(--success);
        }

        .task-title {
            font-weight: 600;
            margin-bottom: 0.5rem;
        }

        .task-description {
            color: var(--gray-600);
            margin-bottom: 0.5rem;
        }

        .task-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.75rem;
            color: var(--gray-500);
        }

        .priority-badge {
            padding: 0.125rem 0.5rem;
            border-radius: 0.25rem;
            font-weight: 500;
            text-transform: uppercase;
            font-size: 0.625rem;
        }

        .priority-high {
            background: rgba(220, 38, 38, 0.1);
            color: var(--danger);
        }

        .priority-medium {
            background: rgba(217, 119, 6, 0.1);
            color: var(--warning);
        }

        .priority-low {
            background: rgba(22, 163, 74, 0.1);
            color: var(--success);
        }

        .error-message {
            color: var(--danger);
            font-size: 0.875rem;
            margin-top: 0.25rem;
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
                    Total Tasks: <span id="taskCount">${taskCount}</span>
                </div>
            </div>
        </div>
    </header>

    <main class="container">
        <div class="main-content">
            <div class="card">
                <h2 class="card-title">Create New Task</h2>
                <form id="taskForm">
                    <div class="form-group">
                        <label class="form-label" for="title">Title *</label>
                        <input type="text" id="title" class="form-input" required>
                        <div id="titleError" class="error-message" style="display: none;"></div>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label" for="description">Description</label>
                        <textarea id="description" class="form-textarea"></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label" for="priority">Priority</label>
                        <select id="priority" class="form-select">
                            <option value="low">Low</option>
                            <option value="medium" selected>Medium</option>
                            <option value="high">High</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label" for="deadline">Deadline (Optional)</label>
                        <input type="date" id="deadline" class="form-input">
                    </div>
                    
                    <button type="submit" class="btn btn-primary">Create Task</button>
                </form>
            </div>

            <div class="card">
                <h2 class="card-title">Tasks</h2>
                <div id="taskList" class="task-list">
                    ${tasks.length === 0 ? '<p style="color: var(--gray-600); text-align: center; padding: 2rem;">No tasks yet. Create your first task!</p>' : 
                      tasks.map(task => this.renderTaskItem(task)).join('')}
                </div>
            </div>
        </div>
    </main>

    <script>
        let tasks = ${JSON.stringify(tasks)};
        let taskIdCounter = ${this.taskIdCounter};

        function updateTaskCount() {
            document.getElementById('taskCount').textContent = tasks.length;
        }

        function renderTaskItem(task) {
            const deadline = task.deadline ? new Date(task.deadline).toLocaleDateString() : null;
            const createdAt = new Date(task.createdAt).toLocaleDateString();
            
            return \`
                <div class="task-item priority-\${task.priority}">
                    <div class="task-title">\${task.title}</div>
                    <div class="task-description">\${task.description}</div>
                    <div class="task-meta">
                        <span class="priority-badge priority-\${task.priority}">\${task.priority}</span>
                        <span>Created: \${createdAt}</span>
                        \${deadline ? \`<span>Due: \${deadline}</span>\` : ''}
                    </div>
                </div>
            \`;
        }

        function renderTaskList() {
            const taskList = document.getElementById('taskList');
            if (tasks.length === 0) {
                taskList.innerHTML = '<p style="color: var(--gray-600); text-align: center; padding: 2rem;">No tasks yet. Create your first task!</p>';
            } else {
                taskList.innerHTML = tasks.map(renderTaskItem).join('');
            }
        }

        function showError(elementId, message) {
            const errorElement = document.getElementById(elementId);
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }

        function hideError(elementId) {
            const errorElement = document.getElementById(elementId);
            errorElement.style.display = 'none';
        }

        function validateTitle(title) {
            if (!title.trim()) {
                showError('titleError', 'Task title cannot be empty');
                return false;
            }
            hideError('titleError');
            return true;
        }

        document.getElementById('taskForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const title = document.getElementById('title').value;
            const description = document.getElementById('description').value;
            const priority = document.getElementById('priority').value;
            const deadline = document.getElementById('deadline').value;
            
            if (!validateTitle(title)) {
                return;
            }
            
            const task = {
                id: \`task-\${taskIdCounter++}\`,
                title: title.trim(),
                description: description.trim(),
                priority: priority,
                deadline: deadline || undefined,
                createdAt: new Date()
            };
            
            tasks.push(task);
            updateTaskCount();
            renderTaskList();
            
            // Reset form
            this.reset();
            document.getElementById('priority').value = 'medium';
        });

        // Real-time title validation
        document.getElementById('title').addEventListener('input', function() {
            validateTitle(this.value);
        });
    </script>
</body>
</html>`;
  }

  private renderTaskItem(task: Task): string {
    const deadline = task.deadline ? new Date(task.deadline).toLocaleDateString() : null;
    const createdAt = task.createdAt.toLocaleDateString();
    
    return `
        <div class="task-item priority-${task.priority}">
            <div class="task-title">${task.title}</div>
            <div class="task-description">${task.description}</div>
            <div class="task-meta">
                <span class="priority-badge priority-${task.priority}">${task.priority}</span>
                <span>Created: ${createdAt}</span>
                ${deadline ? `<span>Due: ${deadline}</span>` : ''}
            </div>
        </div>
    `;
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