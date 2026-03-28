import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

const router = new Hono();

router.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
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
            background: #f8f9fa;
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
        
        .sidebar {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .sidebar h3 {
            margin-bottom: 15px;
            color: #374151;
        }
        
        .project-list {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 20px;
        }
        
        .project-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: #f3f4f6;
            border-radius: 6px;
            cursor: pointer;
            border: 2px solid transparent;
            transition: all 0.2s;
        }
        
        .project-item:hover {
            background: #e5e7eb;
        }
        
        .project-item.active {
            border-color: #2563eb;
            background: #eff6ff;
        }
        
        .project-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }
        
        .project-count {
            background: #6b7280;
            color: white;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 12px;
        }
        
        .add-task-form {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .add-task-form h3 {
            margin-bottom: 15px;
            color: #374151;
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
        
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: #374151;
        }
        
        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .form-group textarea {
            resize: vertical;
            min-height: 80px;
        }
        
        .description-toggle {
            background: none;
            border: none;
            color: #2563eb;
            cursor: pointer;
            font-size: 14px;
            margin-bottom: 10px;
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
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }
        
        .btn-primary {
            background: #2563eb;
            color: white;
        }
        
        .btn-primary:hover {
            background: #1d4ed8;
        }
        
        .filters {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
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
            border: 1px solid #d1d5db;
            background: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }
        
        .filter-btn.active {
            background: #2563eb;
            color: white;
            border-color: #2563eb;
        }
        
        .stats {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px;
        }
        
        .stat-item {
            text-align: center;
        }
        
        .stat-number {
            font-size: 24px;
            font-weight: bold;
            color: #2563eb;
        }
        
        .stat-label {
            font-size: 14px;
            color: #6b7280;
        }
        
        .task-list {
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .task-item {
            padding: 15px 20px;
            border-bottom: 1px solid #f3f4f6;
            position: relative;
            transition: all 0.2s;
        }
        
        .task-item:last-child {
            border-bottom: none;
        }
        
        .task-item:hover {
            background: #f9fafb;
        }
        
        .task-item.completed {
            opacity: 0.6;
        }
        
        .task-item.completed .task-title {
            text-decoration: line-through;
        }
        
        .task-item.overdue {
            border-left: 4px solid #dc2626;
            background: #fef2f2;
        }
        
        .task-header {
            display: flex;
            align-items: center;
            gap: 12px;
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
            padding: 4px 8px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
        }
        
        .task-title-input.editing {
            display: block;
        }
        
        .priority-badge {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }
        
        .priority-urgent {
            background: #fef2f2;
            color: #dc2626;
        }
        
        .priority-high {
            background: #fff7ed;
            color: #ea580c;
        }
        
        .priority-normal {
            background: #eff6ff;
            color: #2563eb;
        }
        
        .priority-low {
            background: #f3f4f6;
            color: #6b7280;
        }
        
        .task-meta {
            display: flex;
            gap: 15px;
            align-items: center;
            font-size: 14px;
            color: #6b7280;
            margin-left: 30px;
        }
        
        .task-project {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .task-actions {
            position: absolute;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            display: none;
            gap: 8px;
        }
        
        .task-item:hover .task-actions {
            display: flex;
        }
        
        .action-btn {
            padding: 4px 8px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s;
        }
        
        .action-btn.edit {
            background: #f3f4f6;
            color: #374151;
        }
        
        .action-btn.edit:hover {
            background: #e5e7eb;
        }
        
        .action-btn.delete {
            background: #fef2f2;
            color: #dc2626;
        }
        
        .action-btn.delete:hover {
            background: #fee2e2;
        }
        
        .overdue-badge {
            background: #dc2626;
            color: white;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #6b7280;
        }
        
        @media (max-width: 640px) {
            .container {
                padding: 10px;
            }
            
            .form-row {
                flex-direction: column;
            }
            
            .filter-row {
                flex-direction: column;
                align-items: stretch;
            }
            
            .task-meta {
                flex-direction: column;
                align-items: flex-start;
                gap: 5px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Task Manager</h1>
            <p>Organize your work and life</p>
        </div>
        
        <div class="sidebar">
            <h3>Projects</h3>
            <div class="project-list" id="projectList">
                <div class="project-item active" data-project="inbox">
                    <span class="project-dot" style="background: #6b7280;"></span>
                    <span>Inbox</span>
                    <span class="project-count" id="inboxCount">0</span>
                </div>
            </div>
        </div>
        
        <div class="add-task-form">
            <h3>Add New Task</h3>
            <form id="addTaskForm">
                <div class="form-row">
                    <div class="form-group">
                        <label for="taskTitle">Title *</label>
                        <input type="text" id="taskTitle" required>
                    </div>
                    <div class="form-group">
                        <label for="taskPriority">Priority</label>
                        <select id="taskPriority">
                            <option value="normal">Normal</option>
                            <option value="low">Low</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>
                    </div>
                </div>
                
                <button type="button" class="description-toggle" id="descriptionToggle">
                    + Add Description
                </button>
                
                <div class="description-section" id="descriptionSection">
                    <div class="form-group">
                        <label for="taskDescription">Description</label>
                        <textarea id="taskDescription" placeholder="Add task details..."></textarea>
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="taskProject">Project</label>
                        <select id="taskProject">
                            <option value="">Inbox</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="taskDueDate">Due Date</label>
                        <input type="date" id="taskDueDate">
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
                
                <div class="form-group" style="min-width: 150px;">
                    <select id="priorityFilter">
                        <option value="">All Priorities</option>
                        <option value="urgent">Urgent</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                    </select>
                </div>
            </div>
        </div>
        
        <div class="stats" id="statsSection">
            <div class="stats-grid" id="statsGrid">
                <!-- Stats will be loaded here -->
            </div>
        </div>
        
        <div class="task-list" id="taskList">
            <!-- Tasks will be loaded here -->
        </div>
    </div>

    <script>
        let currentProject = 'inbox';
        let currentStatus = 'all';
        let currentPriority = '';
        let projects = [];
        let tasks = [];

        // Initialize the app
        document.addEventListener('DOMContentLoaded', () => {
            loadProjects();
            loadTasks();
            loadStats();
            setupEventListeners();
        });

        function setupEventListeners() {
            // Description toggle
            document.getElementById('descriptionToggle').addEventListener('click', () => {
                const section = document.getElementById('descriptionSection');
                const toggle = document.getElementById('descriptionToggle');
                if (section.classList.contains('expanded')) {
                    section.classList.remove('expanded');
                    toggle.textContent = '+ Add Description';
                } else {
                    section.classList.add('expanded');
                    toggle.textContent = '- Hide Description';
                }
            });

            // Add task form
            document.getElementById('addTaskForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await addTask();
            });

            // Status filters
            document.querySelectorAll('[data-status]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    currentStatus = e.target.dataset.status;
                    loadTasks();
                });
            });

            // Priority filter
            document.getElementById('priorityFilter').addEventListener('change', (e) => {
                currentPriority = e.target.value;
                loadTasks();
            });

            // Project selection
            document.addEventListener('click', (e) => {
                if (e.target.closest('.project-item')) {
                    const projectItem = e.target.closest('.project-item');
                    document.querySelectorAll('.project-item').forEach(p => p.classList.remove('active'));
                    projectItem.classList.add('active');
                    currentProject = projectItem.dataset.project;
                    loadTasks();
                }
            });
        }

        async function loadProjects() {
            try {
                const response = await fetch('/projects');
                projects = await response.json();
                renderProjects();
                populateProjectDropdown();
            } catch (error) {
                console.error('Failed to load projects:', error);
            }
        }

        async function loadTasks() {
            try {
                let url = '/filtering-and-views';
                const params = new URLSearchParams();
                
                if (currentProject !== 'inbox') {
                    params.append('project_id', currentProject);
                } else {
                    params.append('project_id', '');
                }
                
                if (currentStatus === 'active') {
                    params.append('completed', '0');
                } else if (currentStatus === 'completed') {
                    params.append('completed', '1');
                }
                
                if (currentPriority) {
                    params.append('priority', currentPriority);
                }
                
                if (params.toString()) {
                    url += '?' + params.toString();
                }
                
                const response = await fetch(url);
                tasks = await response.json();
                renderTasks();
                updateProjectCounts();
            } catch (error) {
                console.error('Failed to load tasks:', error);
            }
        }

        async function loadStats() {
            try {
                const response = await fetch('/quick-stats');
                const stats = await response.json();
                renderStats(stats);
            } catch (error) {
                console.error('Failed to load stats:', error);
            }
        }

        function renderProjects() {
            const projectList = document.getElementById('projectList');
            const inboxItem = projectList.querySelector('[data-project="inbox"]');
            
            // Clear existing projects (keep inbox)
            projectList.innerHTML = '';
            projectList.appendChild(inboxItem);
            
            projects.forEach(project => {
                const projectItem = document.createElement('div');
                projectItem.className = 'project-item';
                projectItem.dataset.project = project.id;
                projectItem.innerHTML = \`
                    <span class="project-dot" style="background: \${project.color};"></span>
                    <span>\${project.name}</span>
                    <span class="project-count" id="project-\${project.id}-count">0</span>
                \`;
                projectList.appendChild(projectItem);
            });
        }

        function populateProjectDropdown() {
            const select = document.getElementById('taskProject');
            select.innerHTML = '<option value="">Inbox</option>';
            projects.forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                select.appendChild(option);
            });
        }

        function renderTasks() {
            const taskList = document.getElementById('taskList');
            
            if (tasks.length === 0) {
                taskList.innerHTML = '<div class="empty-state">No tasks found</div>';
                return;
            }
            
            taskList.innerHTML = tasks.map(task => {
                const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !task.completed;
                const project = projects.find(p => p.id === task.project_id);
                
                return \`
                    <div class="task-item \${task.completed ? 'completed' : ''} \${isOverdue ? 'overdue' : ''}" data-task-id="\${task.id}">
                        <div class="task-header">
                            <input type="checkbox" class="task-checkbox" \${task.completed ? 'checked' : ''} onchange="toggleTask(\${task.id})">
                            <span class="task-title" onclick="editTaskTitle(\${task.id})">\${task.title}</span>
                            <input type="text" class="task-title-input" value="\${task.title}" onblur="saveTaskTitle(\${task.id})" onkeydown="handleTitleKeydown(event, \${task.id})">
                            <span class="priority-badge priority-\${task.priority}">\${task.priority}</span>
                            \${isOverdue ? '<span class="overdue-badge">Overdue</span>' : ''}
                        </div>
                        \${task.description ? \`<div class="task-description" style="margin-left: 30px; color: #6b7280; font-size: 14px;">\${task.description}</div>\` : ''}
                        <div class="task-meta">
                            \${project ? \`<div class="task-project"><span class="project-dot" style="background: \${project.color};"></span>\${project.name}</div>\` : '<div class="task-project">Inbox</div>'}
                            \${task.due_date ? \`<div>Due: \${new Date(task.due_date).toLocaleDateString()}</div>\` : ''}
                        </div>
                        <div class="task-actions">
                            <button class="action-btn edit" onclick="editTask(\${task.id})">Edit</button>
                            <button class="action-btn delete" onclick="deleteTask(\${task.id})">Delete</button>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function renderStats(stats) {
            const statsGrid = document.getElementById('statsGrid');
            statsGrid.innerHTML = \`
                <div class="stat-item">
                    <div class="stat-number">\${stats.total_tasks}</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">\${stats.active_tasks}</div>
                    <div class="stat-label">Active</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">\${stats.completed_tasks}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">\${stats.overdue_tasks}</div>
                    <div class="stat-label">Overdue</div>
                </div>
            \`;
        }

        function updateProjectCounts() {
            // Update inbox count
            const inboxTasks = tasks.filter(t => !t.project_id && !t.completed);
            document.getElementById('inboxCount').textContent = inboxTasks.length;
            
            // Update project counts
            projects.forEach(project => {
                const projectTasks = tasks.filter(t => t.project_id === project.id && !t.completed);
                const countEl = document.getElementById(\`project-\${project.id}-count\`);
                if (countEl) {
                    countEl.textContent = projectTasks.length;
                }
            });
        }

        async function addTask() {
            const title = document.getElementById('taskTitle').value.trim();
            const description = document.getElementById('taskDescription').value.trim();
            const priority = document.getElementById('taskPriority').value;
            const projectId = document.getElementById('taskProject').value;
            const dueDate = document.getElementById('taskDueDate').value;
            
            if (!title) return;
            
            const taskData = {
                title,
                priority,
                ...(description && { description }),
                ...(projectId && { project_id: parseInt(projectId) }),
                ...(dueDate && { due_date: dueDate })
            };
            
            try {
                const response = await fetch('/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData)
                });
                
                if (response.ok) {
                    document.getElementById('addTaskForm').reset();
                    document.getElementById('descriptionSection').classList.remove('expanded');
                    document.getElementById('descriptionToggle').textContent = '+ Add Description';
                    loadTasks();
                    loadStats();
                }
            } catch (error) {
                console.error('Failed to add task:', error);
            }
        }

        async function toggleTask(taskId) {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            
            try {
                await fetch(\`/tasks/\${taskId}\`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ completed: task.completed ? 0 : 1 })
                });
                loadTasks();
                loadStats();
            } catch (error) {
                console.error('Failed to toggle task:', error);
            }
        }

        async function deleteTask(taskId) {
            if (!confirm('Are you sure you want to delete this task?')) return;
            
            try {
                await fetch(\`/tasks/\${taskId}\`, { method: 'DELETE' });
                loadTasks();
                loadStats();
            } catch (error) {
                console.error('Failed to delete task:', error);
            }
        }

        function editTaskTitle(taskId) {
            const taskItem = document.querySelector(\`[data-task-id="\${taskId}"]\`);
            const titleSpan = taskItem.querySelector('.task-title');
            const titleInput = taskItem.querySelector('.task-title-input');
            
            titleSpan.classList.add('editing');
            titleInput.classList.add('editing');
            titleInput.focus();
            titleInput.select();
        }

        async function saveTaskTitle(taskId) {
            const taskItem = document.querySelector(\`[data-task-id="\${taskId}"]\`);
            const titleSpan = taskItem.querySelector('.task-title');
            const titleInput = taskItem.querySelector('.task-title-input');
            const newTitle = titleInput.value.trim();
            
            if (newTitle && newTitle !== titleSpan.textContent) {
                try {
                    await fetch(\`/tasks/\${taskId}\`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: newTitle })
                    });
                    titleSpan.textContent = newTitle;
                } catch (error) {
                    console.error('Failed to update task title:', error);
                    titleInput.value = titleSpan.textContent;
                }
            }
            
            titleSpan.classList.remove('editing');
            titleInput.classList.remove('editing');
        }

        function handleTitleKeydown(event, taskId) {
            if (event.key === 'Enter') {
                event.target.blur();
            } else if (event.key === 'Escape') {
                const taskItem = document.querySelector(\`[data-task-id="\${taskId}"]\`);
                const titleSpan = taskItem.querySelector('.task-title');
                const titleInput = taskItem.querySelector('.task-title-input');
                titleInput.value = titleSpan.textContent;
                titleInput.blur();
            }
        }

        async function editTask(taskId) {
            const task = tasks.find(t => t.id === taskId);
            if (!task) return;
            
            // Simple edit - just populate the form with current values
            document.getElementById('taskTitle').value = task.title;
            document.getElementById('taskDescription').value = task.description || '';
            document.getElementById('taskPriority').value = task.priority;
            document.getElementById('taskProject').value = task.project_id || '';
            document.getElementById('taskDueDate').value = task.due_date || '';
            
            if (task.description) {
                document.getElementById('descriptionSection').classList.add('expanded');
                document.getElementById('descriptionToggle').textContent = '- Hide Description';
            }
            
            // Change form to edit mode
            const form = document.getElementById('addTaskForm');
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.textContent = 'Update Task';
            
            form.onsubmit = async (e) => {
                e.preventDefault();
                await updateTask(taskId);
            };
            
            // Scroll to form
            form.scrollIntoView({ behavior: 'smooth' });
        }

        async function updateTask(taskId) {
            const title = document.getElementById('taskTitle').value.trim();
            const description = document.getElementById('taskDescription').value.trim();
            const priority = document.getElementById('taskPriority').value;
            const projectId = document.getElementById('taskProject').value;
            const dueDate = document.getElementById('taskDueDate').value;
            
            if (!title) return;
            
            const taskData = {
                title,
                priority,
                description: description || null,
                project_id: projectId ? parseInt(projectId) : null,
                due_date: dueDate || null
            };
            
            try {
                const response = await fetch(\`/tasks/\${taskId}\`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData)
                });
                
                if (response.ok) {
                    // Reset form to add mode
                    document.getElementById('addTaskForm').reset();
                    document.getElementById('descriptionSection').classList.remove('expanded');
                    document.getElementById('descriptionToggle').textContent = '+ Add Description';
                    
                    const form = document.getElementById('addTaskForm');
                    const submitBtn = form.querySelector('button[type="submit"]');
                    submitBtn.textContent = 'Add Task';
                    
                    form.onsubmit = async (e) => {
                        e.preventDefault();
                        await addTask();
                    };
                    
                    loadTasks();
                    loadStats();
                }
            } catch (error) {
                console.error('Failed to update task:', error);
            }
        }
    </script>
</body>
</html>`);
});

export default router;

export const _phoenix = {
  iu_id: '335590ecf9457e5b14124f79e4d9399888f58b7aff87edd6a264b6aa6fdc2d48',
  name: 'Web Experience',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;