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
            color: #2563eb;
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
            flex-wrap: wrap;
        }
        
        .form-group {
            flex: 1;
            min-width: 200px;
        }
        
        .form-group.full-width {
            flex: 100%;
        }
        
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: #555;
        }
        
        input, textarea, select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        
        textarea {
            resize: vertical;
            min-height: 80px;
        }
        
        .description-toggle {
            background: none;
            border: none;
            color: #2563eb;
            cursor: pointer;
            font-size: 14px;
            text-decoration: underline;
            margin-bottom: 10px;
        }
        
        .description-section {
            display: none;
        }
        
        .description-section.expanded {
            display: block;
        }
        
        .btn {
            background: #2563eb;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        }
        
        .btn:hover {
            background: #1d4ed8;
        }
        
        .filters {
            background: white;
            border-radius: 8px;
            padding: 20px;
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
            background: #2563eb;
            color: white;
            border-color: #2563eb;
        }
        
        .task-list {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .task-item {
            padding: 15px 20px;
            border-bottom: 1px solid #eee;
            position: relative;
            transition: background-color 0.2s;
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
            border-left: 4px solid #dc2626;
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
            cursor: pointer;
        }
        
        .task-title.editing {
            display: none;
        }
        
        .task-title-input {
            display: none;
            flex: 1;
            margin-right: 10px;
        }
        
        .task-title-input.editing {
            display: block;
        }
        
        .priority-badge {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .priority-urgent {
            background: #fecaca;
            color: #dc2626;
        }
        
        .priority-high {
            background: #fed7aa;
            color: #ea580c;
        }
        
        .priority-normal {
            background: #dbeafe;
            color: #2563eb;
        }
        
        .priority-low {
            background: #f3f4f6;
            color: #6b7280;
        }
        
        .task-meta {
            display: flex;
            gap: 15px;
            font-size: 14px;
            color: #666;
            align-items: center;
        }
        
        .project-name {
            color: #2563eb;
        }
        
        .due-date {
            color: #666;
        }
        
        .due-date.overdue {
            color: #dc2626;
            font-weight: 500;
        }
        
        .delete-btn {
            position: absolute;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            background: #dc2626;
            color: white;
            border: none;
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        
        .task-item:hover .delete-btn {
            opacity: 1;
        }
        
        .delete-btn:hover {
            background: #b91c1c;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #666;
        }
        
        .loading {
            text-align: center;
            padding: 20px;
            color: #666;
        }
        
        .error {
            background: #fef2f2;
            color: #dc2626;
            padding: 10px 15px;
            border-radius: 4px;
            margin-bottom: 20px;
            border: 1px solid #fecaca;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Task Manager</h1>
            <p>Organize your work and life</p>
        </div>
        
        <div id="error-message" class="error" style="display: none;"></div>
        
        <form id="add-task-form" class="add-task-form">
            <div class="form-row">
                <div class="form-group">
                    <label for="task-title">Task Title *</label>
                    <input type="text" id="task-title" name="title" required>
                </div>
                <div class="form-group">
                    <label for="task-priority">Priority</label>
                    <select id="task-priority" name="priority">
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                    </select>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label for="task-project">Project</label>
                    <select id="task-project" name="project_id">
                        <option value="">Inbox</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="task-due-date">Due Date</label>
                    <input type="datetime-local" id="task-due-date" name="due_date">
                </div>
            </div>
            
            <button type="button" class="description-toggle" onclick="toggleDescription()">
                + Add Description
            </button>
            
            <div id="description-section" class="description-section">
                <div class="form-group full-width">
                    <label for="task-description">Description</label>
                    <textarea id="task-description" name="description" placeholder="Add more details..."></textarea>
                </div>
            </div>
            
            <button type="submit" class="btn">Add Task</button>
        </form>
        
        <div class="filters">
            <div class="filter-row">
                <div class="filter-buttons">
                    <button class="filter-btn active" data-status="all">All</button>
                    <button class="filter-btn" data-status="active">Active</button>
                    <button class="filter-btn" data-status="completed">Completed</button>
                </div>
                
                <div class="form-group" style="min-width: 150px;">
                    <select id="priority-filter">
                        <option value="">All Priorities</option>
                        <option value="urgent">Urgent</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                    </select>
                </div>
                
                <div class="form-group" style="min-width: 150px;">
                    <select id="project-filter">
                        <option value="">All Projects</option>
                        <option value="null">Inbox</option>
                    </select>
                </div>
            </div>
        </div>
        
        <div id="task-list" class="task-list">
            <div class="loading">Loading tasks...</div>
        </div>
    </div>

    <script>
        let tasks = [];
        let projects = [];
        let currentFilters = {
            status: 'all',
            priority: '',
            project: ''
        };

        // Initialize the app
        async function init() {
            await loadProjects();
            await loadTasks();
            setupEventListeners();
        }

        // Load projects from API
        async function loadProjects() {
            try {
                const response = await fetch('/projects');
                if (response.ok) {
                    projects = await response.json();
                    populateProjectDropdowns();
                }
            } catch (error) {
                console.error('Failed to load projects:', error);
            }
        }

        // Load tasks from API
        async function loadTasks() {
            try {
                const response = await fetch('/tasks');
                if (response.ok) {
                    tasks = await response.json();
                    renderTasks();
                } else {
                    showError('Failed to load tasks');
                }
            } catch (error) {
                showError('Failed to load tasks: ' + error.message);
            }
        }

        // Populate project dropdowns
        function populateProjectDropdowns() {
            const taskProjectSelect = document.getElementById('task-project');
            const projectFilterSelect = document.getElementById('project-filter');
            
            // Clear existing options (except default)
            taskProjectSelect.innerHTML = '<option value="">Inbox</option>';
            projectFilterSelect.innerHTML = '<option value="">All Projects</option><option value="null">Inbox</option>';
            
            projects.forEach(project => {
                const option1 = document.createElement('option');
                option1.value = project.id;
                option1.textContent = project.name;
                taskProjectSelect.appendChild(option1);
                
                const option2 = document.createElement('option');
                option2.value = project.id;
                option2.textContent = project.name;
                projectFilterSelect.appendChild(option2);
            });
        }

        // Setup event listeners
        function setupEventListeners() {
            // Add task form
            document.getElementById('add-task-form').addEventListener('submit', handleAddTask);
            
            // Filter buttons
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    currentFilters.status = e.target.dataset.status;
                    renderTasks();
                });
            });
            
            // Filter dropdowns
            document.getElementById('priority-filter').addEventListener('change', (e) => {
                currentFilters.priority = e.target.value;
                renderTasks();
            });
            
            document.getElementById('project-filter').addEventListener('change', (e) => {
                currentFilters.project = e.target.value;
                renderTasks();
            });
        }

        // Handle add task form submission
        async function handleAddTask(e) {
            e.preventDefault();
            
            const formData = new FormData(e.target);
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
                    tasks.unshift(newTask);
                    renderTasks();
                    e.target.reset();
                    hideDescription();
                    hideError();
                } else {
                    const error = await response.json();
                    showError(error.error || 'Failed to create task');
                }
            } catch (error) {
                showError('Failed to create task: ' + error.message);
            }
        }

        // Toggle task completion
        async function toggleTaskCompletion(taskId, completed) {
            try {
                const response = await fetch('/tasks/' + taskId, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ completed })
                });
                
                if (response.ok) {
                    const updatedTask = await response.json();
                    const index = tasks.findIndex(t => t.id === taskId);
                    if (index !== -1) {
                        tasks[index] = updatedTask;
                        renderTasks();
                    }
                } else {
                    showError('Failed to update task');
                }
            } catch (error) {
                showError('Failed to update task: ' + error.message);
            }
        }

        // Delete task
        async function deleteTask(taskId) {
            if (!confirm('Are you sure you want to delete this task?')) return;
            
            try {
                const response = await fetch('/tasks/' + taskId, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    tasks = tasks.filter(t => t.id !== taskId);
                    renderTasks();
                } else {
                    showError('Failed to delete task');
                }
            } catch (error) {
                showError('Failed to delete task: ' + error.message);
            }
        }

        // Edit task title inline
        async function editTaskTitle(taskId, newTitle) {
            if (!newTitle.trim()) return;
            
            try {
                const response = await fetch('/tasks/' + taskId, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle.trim() })
                });
                
                if (response.ok) {
                    const updatedTask = await response.json();
                    const index = tasks.findIndex(t => t.id === taskId);
                    if (index !== -1) {
                        tasks[index] = updatedTask;
                        renderTasks();
                    }
                } else {
                    showError('Failed to update task');
                }
            } catch (error) {
                showError('Failed to update task: ' + error.message);
            }
        }

        // Filter tasks based on current filters
        function getFilteredTasks() {
            return tasks.filter(task => {
                // Status filter
                if (currentFilters.status === 'active' && task.completed) return false;
                if (currentFilters.status === 'completed' && !task.completed) return false;
                
                // Priority filter
                if (currentFilters.priority && task.priority !== currentFilters.priority) return false;
                
                // Project filter
                if (currentFilters.project) {
                    if (currentFilters.project === 'null' && task.project_id !== null) return false;
                    if (currentFilters.project !== 'null' && task.project_id !== parseInt(currentFilters.project)) return false;
                }
                
                return true;
            });
        }

        // Render tasks
        function renderTasks() {
            const taskList = document.getElementById('task-list');
            const filteredTasks = getFilteredTasks();
            
            if (filteredTasks.length === 0) {
                taskList.innerHTML = '<div class="empty-state">No tasks found</div>';
                return;
            }
            
            // Sort tasks: incomplete first, then by priority, then by due date
            const sortedTasks = filteredTasks.sort((a, b) => {
                if (a.completed !== b.completed) return a.completed ? 1 : -1;
                
                const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
                const aPriority = priorityOrder[a.priority] ?? 2;
                const bPriority = priorityOrder[b.priority] ?? 2;
                if (aPriority !== bPriority) return aPriority - bPriority;
                
                if (a.due_date && b.due_date) {
                    return new Date(a.due_date) - new Date(b.due_date);
                }
                if (a.due_date) return -1;
                if (b.due_date) return 1;
                
                return new Date(b.created_at) - new Date(a.created_at);
            });
            
            taskList.innerHTML = sortedTasks.map(task => renderTask(task)).join('');
        }

        // Render individual task
        function renderTask(task) {
            const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !task.completed;
            const project = projects.find(p => p.id === task.project_id);
            
            return '<div class="task-item ' + (task.completed ? 'completed' : '') + ' ' + (isOverdue ? 'overdue' : '') + '" data-task-id="' + task.id + '">' +
                '<div class="task-header">' +
                    '<input type="checkbox" class="task-checkbox" ' + (task.completed ? 'checked' : '') + ' onchange="toggleTaskCompletion(' + task.id + ', this.checked)">' +
                    '<span class="task-title" onclick="startEditTitle(' + task.id + ')">' + escapeHtml(task.title) + '</span>' +
                    '<input type="text" class="task-title-input" value="' + escapeHtml(task.title) + '" onblur="finishEditTitle(' + task.id + ', this.value)" onkeydown="handleTitleKeydown(event, ' + task.id + ', this.value)">' +
                    '<span class="priority-badge priority-' + task.priority + '">' + task.priority + '</span>' +
                '</div>' +
                '<div class="task-meta">' +
                    (project ? '<span class="project-name">' + escapeHtml(project.name) + '</span>' : '<span class="project-name">Inbox</span>') +
                    (task.due_date ? '<span class="due-date ' + (isOverdue ? 'overdue' : '') + '">Due: ' + formatDate(task.due_date) + '</span>' : '') +
                '</div>' +
                '<button class="delete-btn" onclick="deleteTask(' + task.id + ')">Delete</button>' +
            '</div>';
        }

        // Start editing task title
        function startEditTitle(taskId) {
            const taskItem = document.querySelector('[data-task-id="' + taskId + '"]');
            const titleSpan = taskItem.querySelector('.task-title');
            const titleInput = taskItem.querySelector('.task-title-input');
            
            titleSpan.classList.add('editing');
            titleInput.classList.add('editing');
            titleInput.focus();
            titleInput.select();
        }

        // Finish editing task title
        function finishEditTitle(taskId, newTitle) {
            const taskItem = document.querySelector('[data-task-id="' + taskId + '"]');
            const titleSpan = taskItem.querySelector('.task-title');
            const titleInput = taskItem.querySelector('.task-title-input');
            
            titleSpan.classList.remove('editing');
            titleInput.classList.remove('editing');
            
            const currentTask = tasks.find(t => t.id === taskId);
            if (newTitle.trim() && newTitle.trim() !== currentTask.title) {
                editTaskTitle(taskId, newTitle);
            }
        }

        // Handle keydown in title input
        function handleTitleKeydown(event, taskId, newTitle) {
            if (event.key === 'Enter') {
                event.target.blur();
            } else if (event.key === 'Escape') {
                const currentTask = tasks.find(t => t.id === taskId);
                event.target.value = currentTask.title;
                event.target.blur();
            }
        }

        // Toggle description section
        function toggleDescription() {
            const section = document.getElementById('description-section');
            const toggle = document.querySelector('.description-toggle');
            
            if (section.classList.contains('expanded')) {
                hideDescription();
            } else {
                section.classList.add('expanded');
                toggle.textContent = '- Hide Description';
            }
        }

        // Hide description section
        function hideDescription() {
            const section = document.getElementById('description-section');
            const toggle = document.querySelector('.description-toggle');
            
            section.classList.remove('expanded');
            toggle.textContent = '+ Add Description';
        }

        // Show error message
        function showError(message) {
            const errorDiv = document.getElementById('error-message');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        // Hide error message
        function hideError() {
            document.getElementById('error-message').style.display = 'none';
        }

        // Utility functions
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatDate(dateString) {
            const date = new Date(dateString);
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // Initialize the app when page loads
        document.addEventListener('DOMContentLoaded', init);
    </script>
</body>
</html>
  `);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '335590ecf9457e5b14124f79e4d9399888f58b7aff87edd6a264b6aa6fdc2d48',
  name: 'Web Experience',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;
