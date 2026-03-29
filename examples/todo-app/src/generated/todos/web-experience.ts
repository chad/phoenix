import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Manager</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background-color: #f8f9fa;
            color: #333;
            line-height: 1.5;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        
        .header h1 {
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .add-task-form {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .form-row {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            align-items: flex-start;
        }
        
        .form-group {
            flex: 1;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: #555;
        }
        
        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        
        .form-group textarea {
            resize: vertical;
            min-height: 60px;
        }
        
        .description-toggle {
            background: none;
            border: none;
            color: #007bff;
            cursor: pointer;
            font-size: 14px;
            text-decoration: underline;
        }
        
        .description-section {
            display: none;
        }
        
        .description-section.expanded {
            display: block;
        }
        
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        }
        
        .btn-primary {
            background-color: #007bff;
            color: white;
        }
        
        .btn-primary:hover {
            background-color: #0056b3;
        }
        
        .filters {
            background: white;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .filter-row {
            display: flex;
            gap: 15px;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .filter-buttons {
            display: flex;
            gap: 5px;
        }
        
        .filter-btn {
            padding: 6px 12px;
            border: 1px solid #ddd;
            background: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        
        .filter-btn.active {
            background-color: #007bff;
            color: white;
            border-color: #007bff;
        }
        
        .task-list {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .task-item {
            padding: 15px;
            border-bottom: 1px solid #eee;
            position: relative;
            cursor: pointer;
        }
        
        .task-item:last-child {
            border-bottom: none;
        }
        
        .task-item:hover {
            background-color: #f8f9fa;
        }
        
        .task-item.completed {
            opacity: 0.6;
        }
        
        .task-item.completed .task-title {
            text-decoration: line-through;
        }
        
        .task-item.overdue {
            border-left: 4px solid #dc3545;
        }
        
        .task-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }
        
        .task-checkbox {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }
        
        .task-title {
            font-weight: 500;
            flex: 1;
        }
        
        .priority-badge {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .priority-urgent {
            background-color: #dc3545;
            color: white;
        }
        
        .priority-high {
            background-color: #fd7e14;
            color: white;
        }
        
        .priority-normal {
            background-color: #007bff;
            color: white;
        }
        
        .priority-low {
            background-color: #6c757d;
            color: white;
        }
        
        .task-meta {
            display: flex;
            gap: 15px;
            font-size: 14px;
            color: #666;
            margin-left: 28px;
        }
        
        .delete-btn {
            position: absolute;
            right: 15px;
            top: 50%;
            transform: translateY(-50%);
            background: #dc3545;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        
        .task-item:hover .delete-btn {
            opacity: 1;
        }
        
        .delete-btn:hover {
            background: #c82333;
        }
        
        .overdue-badge {
            background-color: #dc3545;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        
        .loading {
            text-align: center;
            padding: 20px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Task Manager</h1>
        </div>
        
        <div class="add-task-form">
            <form id="addTaskForm">
                <div class="form-row">
                    <div class="form-group" style="flex: 2;">
                        <label for="title">Task Title</label>
                        <input type="text" id="title" name="title" required>
                    </div>
                    <div class="form-group">
                        <label for="priority">Priority</label>
                        <select id="priority" name="priority">
                            <option value="normal">Normal</option>
                            <option value="low">Low</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="project">Project</label>
                        <select id="project" name="project_id">
                            <option value="">Inbox</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="dueDate">Due Date</label>
                        <input type="date" id="dueDate" name="due_date">
                    </div>
                    <div class="form-group" style="flex: 0;">
                        <label>&nbsp;</label>
                        <button type="button" class="description-toggle" onclick="toggleDescription()">+ Description</button>
                    </div>
                </div>
                
                <div class="description-section" id="descriptionSection">
                    <div class="form-group">
                        <label for="description">Description</label>
                        <textarea id="description" name="description" placeholder="Optional task description..."></textarea>
                    </div>
                </div>
                
                <button type="submit" class="btn btn-primary">Add Task</button>
            </form>
        </div>
        
        <div class="filters">
            <div class="filter-row">
                <div class="filter-buttons">
                    <button class="filter-btn active" data-status="all">All</button>
                    <button class="filter-btn" data-status="active">Active</button>
                    <button class="filter-btn" data-status="completed">Completed</button>
                </div>
                
                <div class="form-group" style="min-width: 120px;">
                    <select id="priorityFilter">
                        <option value="">All Priorities</option>
                        <option value="urgent">Urgent</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                    </select>
                </div>
                
                <div class="form-group" style="min-width: 120px;">
                    <select id="projectFilter">
                        <option value="">All Projects</option>
                    </select>
                </div>
            </div>
        </div>
        
        <div class="task-list" id="taskList">
            <div class="loading">Loading tasks...</div>
        </div>
    </div>

    <script>
        let tasks = [];
        let projects = [];
        let currentFilters = {
            status: 'all',
            priority: '',
            project_id: ''
        };

        async function loadProjects() {
            try {
                const response = await fetch('/projects');
                projects = await response.json();
                
                const projectSelect = document.getElementById('project');
                const projectFilter = document.getElementById('projectFilter');
                
                projectSelect.innerHTML = '<option value="">Inbox</option>';
                projectFilter.innerHTML = '<option value="">All Projects</option>';
                
                projects.forEach(project => {
                    projectSelect.innerHTML += \`<option value="\${project.id}">\${project.name}</option>\`;
                    projectFilter.innerHTML += \`<option value="\${project.id}">\${project.name}</option>\`;
                });
            } catch (error) {
                console.error('Failed to load projects:', error);
            }
        }

        async function loadTasks() {
            try {
                const response = await fetch('/tasks');
                tasks = await response.json();
                renderTasks();
            } catch (error) {
                console.error('Failed to load tasks:', error);
                document.getElementById('taskList').innerHTML = '<div class="empty-state">Failed to load tasks</div>';
            }
        }

        function renderTasks() {
            const filteredTasks = tasks.filter(task => {
                if (currentFilters.status === 'active' && task.completed) return false;
                if (currentFilters.status === 'completed' && !task.completed) return false;
                if (currentFilters.priority && task.priority !== currentFilters.priority) return false;
                if (currentFilters.project_id && task.project_id != currentFilters.project_id) return false;
                return true;
            });

            filteredTasks.sort((a, b) => {
                const aOverdue = a.due_date && new Date(a.due_date) < new Date();
                const bOverdue = b.due_date && new Date(b.due_date) < new Date();
                const aPriorityWeight = { urgent: 4, high: 3, normal: 2, low: 1 }[a.priority] || 2;
                const bPriorityWeight = { urgent: 4, high: 3, normal: 2, low: 1 }[b.priority] || 2;
                
                if (aOverdue !== bOverdue) return bOverdue ? 1 : -1;
                if (aPriorityWeight !== bPriorityWeight) return bPriorityWeight - aPriorityWeight;
                if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
                if (a.due_date && !b.due_date) return -1;
                if (!a.due_date && b.due_date) return 1;
                return new Date(b.created_at) - new Date(a.created_at);
            });

            const taskList = document.getElementById('taskList');
            
            if (filteredTasks.length === 0) {
                taskList.innerHTML = '<div class="empty-state">No tasks found</div>';
                return;
            }

            taskList.innerHTML = filteredTasks.map(task => {
                const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !task.completed;
                const projectName = task.project_id ? (projects.find(p => p.id === task.project_id)?.name || 'Unknown Project') : 'Inbox';
                
                return \`
                    <div class="task-item \${task.completed ? 'completed' : ''} \${isOverdue ? 'overdue' : ''}" data-id="\${task.id}">
                        <div class="task-header">
                            <input type="checkbox" class="task-checkbox" \${task.completed ? 'checked' : ''} onchange="toggleTask(\${task.id})">
                            <div class="task-title">\${task.title}</div>
                            <div class="priority-badge priority-\${task.priority}">\${task.priority}</div>
                            \${isOverdue ? '<div class="overdue-badge">Overdue</div>' : ''}
                        </div>
                        <div class="task-meta">
                            <span>Project: \${projectName}</span>
                            \${task.due_date ? \`<span>Due: \${new Date(task.due_date).toLocaleDateString()}</span>\` : ''}
                        </div>
                        \${task.description ? \`<div class="task-meta"><span>\${task.description}</span></div>\` : ''}
                        <button class="delete-btn" onclick="deleteTask(\${task.id})">Delete</button>
                    </div>
                \`;
            }).join('');
        }

        async function addTask(event) {
            event.preventDefault();
            
            const formData = new FormData(event.target);
            const taskData = {
                title: formData.get('title'),
                description: formData.get('description') || '',
                priority: formData.get('priority'),
                project_id: formData.get('project_id') ? parseInt(formData.get('project_id')) : null,
                due_date: formData.get('due_date') || null
            };

            try {
                const response = await fetch('/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData)
                });

                if (response.ok) {
                    const newTask = await response.json();
                    tasks.push(newTask);
                    renderTasks();
                    event.target.reset();
                    
                    const descSection = document.getElementById('descriptionSection');
                    descSection.classList.remove('expanded');
                    document.querySelector('.description-toggle').textContent = '+ Description';
                } else {
                    const error = await response.json();
                    alert('Failed to add task: ' + error.error);
                }
            } catch (error) {
                console.error('Failed to add task:', error);
                alert('Failed to add task');
            }
        }

        async function toggleTask(taskId) {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;

            try {
                const response = await fetch(\`/tasks/\${taskId}\`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ completed: !task.completed })
                });

                if (response.ok) {
                    const updatedTask = await response.json();
                    const index = tasks.findIndex(t => t.id === taskId);
                    tasks[index] = updatedTask;
                    renderTasks();
                } else {
                    alert('Failed to update task');
                }
            } catch (error) {
                console.error('Failed to toggle task:', error);
                alert('Failed to update task');
            }
        }

        async function deleteTask(taskId) {
            if (!confirm('Are you sure you want to delete this task?')) return;

            try {
                const response = await fetch(\`/tasks/\${taskId}\`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    tasks = tasks.filter(t => t.id !== taskId);
                    renderTasks();
                } else {
                    alert('Failed to delete task');
                }
            } catch (error) {
                console.error('Failed to delete task:', error);
                alert('Failed to delete task');
            }
        }

        function toggleDescription() {
            const section = document.getElementById('descriptionSection');
            const toggle = document.querySelector('.description-toggle');
            
            if (section.classList.contains('expanded')) {
                section.classList.remove('expanded');
                toggle.textContent = '+ Description';
            } else {
                section.classList.add('expanded');
                toggle.textContent = '- Description';
            }
        }

        function setupFilters() {
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentFilters.status = btn.dataset.status;
                    renderTasks();
                });
            });

            document.getElementById('priorityFilter').addEventListener('change', (e) => {
                currentFilters.priority = e.target.value;
                renderTasks();
            });

            document.getElementById('projectFilter').addEventListener('change', (e) => {
                currentFilters.project_id = e.target.value;
                renderTasks();
            });
        }

        document.getElementById('addTaskForm').addEventListener('submit', addTask);
        setupFilters();
        loadProjects().then(() => loadTasks());
    </script>
</body>
</html>
  `);
});

/** @internal Phoenix VCS traceability — do not remove. */


export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '335590ecf9457e5b14124f79e4d9399888f58b7aff87edd6a264b6aa6fdc2d48',
  name: 'Web Experience',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;
