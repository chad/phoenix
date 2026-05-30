import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

// No migrations needed - this is a web UI module

// No schemas needed - this is a web UI module

router.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trail - Issue Tracker</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #f8f9fa;
            color: #212529;
            line-height: 1.5;
        }
        
        .top-bar {
            background: white;
            border-bottom: 1px solid #dee2e6;
            padding: 1rem 2rem;
            display: flex;
            align-items: center;
            gap: 2rem;
            flex-wrap: wrap;
        }
        
        .app-title {
            font-size: 1.5rem;
            font-weight: 600;
            color: #495057;
        }
        
        .sprint-selector select {
            padding: 0.5rem;
            border: 1px solid #ced4da;
            border-radius: 0.375rem;
            background: white;
        }
        
        .stats-summary {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-left: auto;
            font-size: 0.875rem;
        }
        
        .progress-bar {
            width: 100px;
            height: 8px;
            background: #e9ecef;
            border-radius: 4px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: #28a745;
            transition: width 0.3s ease;
        }
        
        .warning {
            color: #dc3545;
            font-weight: 500;
        }
        
        .controls {
            padding: 1rem 2rem;
            background: white;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .new-issue-form {
            display: flex;
            gap: 0.5rem;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .new-issue-form input, .new-issue-form select {
            padding: 0.5rem;
            border: 1px solid #ced4da;
            border-radius: 0.375rem;
            font-size: 0.875rem;
        }
        
        .new-issue-form input[type="text"] {
            min-width: 200px;
        }
        
        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 0.375rem;
            background: #007bff;
            color: white;
            cursor: pointer;
            font-size: 0.875rem;
        }
        
        .btn:hover {
            background: #0056b3;
        }
        
        .filters {
            display: flex;
            gap: 1rem;
            align-items: center;
            margin-left: auto;
        }
        
        .filters input, .filters select {
            padding: 0.5rem;
            border: 1px solid #ced4da;
            border-radius: 0.375rem;
            font-size: 0.875rem;
        }
        
        .board {
            padding: 2rem;
            display: flex;
            gap: 1.5rem;
            min-height: calc(100vh - 200px);
            overflow-x: auto;
        }
        
        .column {
            min-width: 280px;
            background: white;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            display: flex;
            flex-direction: column;
        }
        
        .column-header {
            padding: 1rem;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .column-title {
            font-weight: 600;
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .column-stats {
            font-size: 0.75rem;
            color: #6c757d;
        }
        
        .column.backlog .column-header { border-left: 4px solid #6c757d; }
        .column.todo .column-header { border-left: 4px solid #007bff; }
        .column.in-progress .column-header { border-left: 4px solid #ffc107; }
        .column.in-review .column-header { border-left: 4px solid #6f42c1; }
        .column.done .column-header { border-left: 4px solid #28a745; }
        
        .column-content {
            padding: 1rem;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        
        .card {
            background: white;
            border: 1px solid #dee2e6;
            border-radius: 0.375rem;
            padding: 0.75rem;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .card:hover {
            border-color: #007bff;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .card.done {
            opacity: 0.7;
        }
        
        .card-title {
            font-weight: 500;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .card.done .card-title::before {
            content: "✓";
            color: #28a745;
            font-weight: bold;
        }
        
        .priority-badge {
            font-size: 0.625rem;
            padding: 0.125rem 0.375rem;
            border-radius: 0.25rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .priority-urgent { background: #dc3545; color: white; }
        .priority-high { background: #fd7e14; color: white; }
        .priority-normal { background: #007bff; color: white; }
        .priority-low { background: #6c757d; color: white; }
        
        .card-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 0.5rem;
            font-size: 0.75rem;
            color: #6c757d;
        }
        
        .card-labels {
            display: flex;
            gap: 0.25rem;
            flex-wrap: wrap;
        }
        
        .label-chip {
            background: #e9ecef;
            color: #495057;
            padding: 0.125rem 0.375rem;
            border-radius: 0.25rem;
            font-size: 0.625rem;
        }
        
        .card-controls {
            display: flex;
            gap: 0.25rem;
            margin-top: 0.5rem;
        }
        
        .card-controls button {
            padding: 0.25rem 0.5rem;
            border: 1px solid #ced4da;
            background: white;
            border-radius: 0.25rem;
            cursor: pointer;
            font-size: 0.625rem;
        }
        
        .card-controls button:hover {
            background: #f8f9fa;
        }
        
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
        }
        
        .modal.show {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .modal-content {
            background: white;
            border-radius: 0.5rem;
            padding: 2rem;
            width: 90%;
            max-width: 600px;
            max-height: 90vh;
            overflow-y: auto;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }
        
        .modal-title {
            font-size: 1.25rem;
            font-weight: 600;
        }
        
        .close-btn {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #6c757d;
        }
        
        .form-group {
            margin-bottom: 1rem;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 0.25rem;
            font-weight: 500;
            font-size: 0.875rem;
        }
        
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 0.5rem;
            border: 1px solid #ced4da;
            border-radius: 0.375rem;
            font-size: 0.875rem;
        }
        
        .form-group textarea {
            min-height: 100px;
            resize: vertical;
        }
        
        .form-actions {
            display: flex;
            gap: 1rem;
            justify-content: flex-end;
            margin-top: 1.5rem;
        }
        
        .btn-secondary {
            background: #6c757d;
        }
        
        .btn-secondary:hover {
            background: #545b62;
        }
        
        .btn-danger {
            background: #dc3545;
        }
        
        .btn-danger:hover {
            background: #c82333;
        }
        
        @media (max-width: 768px) {
            .board {
                padding: 1rem;
                gap: 1rem;
            }
            
            .column {
                min-width: 250px;
            }
            
            .top-bar, .controls {
                padding: 1rem;
            }
            
            .new-issue-form, .filters {
                width: 100%;
                justify-content: flex-start;
            }
        }
    </style>
</head>
<body>
    <div class="top-bar">
        <div class="app-title">Trail</div>
        <div class="sprint-selector">
            <select id="sprintSelect">
                <option value="">Loading...</option>
            </select>
        </div>
        <div class="stats-summary">
            <span id="totalIssues">0 issues</span>
            <span id="totalPoints">0 points</span>
            <span id="completedPoints">0 completed</span>
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
            <span id="percentComplete">0%</span>
            <span id="capacityWarning" class="warning" style="display: none;">Over capacity!</span>
        </div>
    </div>
    
    <div class="controls">
        <div class="new-issue-form">
            <input type="text" id="newIssueTitle" placeholder="Issue title" />
            <select id="newIssuePriority">
                <option value="normal">Normal</option>
                <option value="low">Low</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
            </select>
            <select id="newIssueStatus">
                <option value="backlog">Backlog</option>
                <option value="todo">Todo</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">In Review</option>
                <option value="done">Done</option>
            </select>
            <button class="btn" onclick="createIssue()">Add Issue</button>
        </div>
        
        <div class="filters">
            <select id="assigneeFilter">
                <option value="">All assignees</option>
            </select>
            <select id="labelFilter">
                <option value="">All labels</option>
            </select>
            <input type="text" id="searchBox" placeholder="Search issues..." />
        </div>
    </div>
    
    <div class="board">
        <div class="column backlog" data-status="backlog">
            <div class="column-header">
                <div class="column-title">Backlog</div>
                <div class="column-stats" id="backlog-stats">0 issues, 0 pts</div>
            </div>
            <div class="column-content" id="backlog-content"></div>
        </div>
        
        <div class="column todo" data-status="todo">
            <div class="column-header">
                <div class="column-title">Todo</div>
                <div class="column-stats" id="todo-stats">0 issues, 0 pts</div>
            </div>
            <div class="column-content" id="todo-content"></div>
        </div>
        
        <div class="column in-progress" data-status="in_progress">
            <div class="column-header">
                <div class="column-title">In Progress</div>
                <div class="column-stats" id="in_progress-stats">0 issues, 0 pts</div>
            </div>
            <div class="column-content" id="in_progress-content"></div>
        </div>
        
        <div class="column in-review" data-status="in_review">
            <div class="column-header">
                <div class="column-title">In Review</div>
                <div class="column-stats" id="in_review-stats">0 issues, 0 pts</div>
            </div>
            <div class="column-content" id="in_review-content"></div>
        </div>
        
        <div class="column done" data-status="done">
            <div class="column-header">
                <div class="column-title">Done</div>
                <div class="column-stats" id="done-stats">0 issues, 0 pts</div>
            </div>
            <div class="column-content" id="done-content"></div>
        </div>
    </div>
    
    <div class="modal" id="issueModal">
        <div class="modal-content">
            <div class="modal-header">
                <div class="modal-title">Edit Issue</div>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            
            <form id="issueForm">
                <div class="form-group">
                    <label for="issueTitle">Title</label>
                    <input type="text" id="issueTitle" required />
                </div>
                
                <div class="form-group">
                    <label for="issueDescription">Description</label>
                    <textarea id="issueDescription"></textarea>
                </div>
                
                <div class="form-group">
                    <label for="issueStatus">Status</label>
                    <select id="issueStatus">
                        <option value="backlog">Backlog</option>
                        <option value="todo">Todo</option>
                        <option value="in_progress">In Progress</option>
                        <option value="in_review">In Review</option>
                        <option value="done">Done</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="issuePriority">Priority</label>
                    <select id="issuePriority">
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="issueEstimate">Point Estimate</label>
                    <input type="number" id="issueEstimate" min="0" />
                </div>
                
                <div class="form-group">
                    <label for="issueAssignee">Assignee</label>
                    <input type="text" id="issueAssignee" />
                </div>
                
                <div class="form-group">
                    <label for="issueLabels">Labels (comma-separated)</label>
                    <input type="text" id="issueLabels" />
                </div>
                
                <div class="form-group">
                    <label for="issueSprint">Sprint</label>
                    <select id="issueSprint">
                        <option value="">No sprint</option>
                    </select>
                </div>
                
                <div class="form-actions">
                    <button type="button" class="btn btn-danger" onclick="deleteIssue()">Delete</button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn">Save</button>
                </div>
            </form>
        </div>
    </div>
    
    <script>
        let currentIssue = null;
        let issues = [];
        let sprints = [];
        let currentSprintId = null;
        
        // Load initial data
        async function loadData() {
            await Promise.all([
                loadSprints(),
                loadIssues()
            ]);
            updateBoard();
        }
        
        async function loadSprints() {
            try {
                const response = await fetch('/sprints');
                sprints = await response.json();
                updateSprintSelector();
            } catch (error) {
                console.error('Failed to load sprints:', error);
            }
        }
        
        async function loadIssues() {
            try {
                const params = new URLSearchParams();
                if (currentSprintId) params.set('sprint_id', currentSprintId);
                const response = await fetch('/issues?' + params);
                issues = await response.json();
            } catch (error) {
                console.error('Failed to load issues:', error);
            }
        }
        
        function updateSprintSelector() {
            const select = document.getElementById('sprintSelect');
            select.innerHTML = '<option value="">Backlog (No Sprint)</option>';
            
            sprints.forEach(sprint => {
                const option = document.createElement('option');
                option.value = sprint.id;
                option.textContent = sprint.name;
                if (sprint.is_current) {
                    option.selected = true;
                    currentSprintId = sprint.id;
                }
                select.appendChild(option);
            });
        }
        
        function updateBoard() {
            const filteredIssues = filterIssues();
            
            // Clear columns
            ['backlog', 'todo', 'in_progress', 'in_review', 'done'].forEach(status => {
                document.getElementById(status + '-content').innerHTML = '';
            });
            
            // Group issues by status
            const issuesByStatus = {};
            filteredIssues.forEach(issue => {
                if (!issuesByStatus[issue.status]) issuesByStatus[issue.status] = [];
                issuesByStatus[issue.status].push(issue);
            });
            
            // Render issues in columns
            Object.entries(issuesByStatus).forEach(([status, statusIssues]) => {
                const content = document.getElementById(status + '-content');
                statusIssues.forEach(issue => {
                    content.appendChild(createIssueCard(issue));
                });
                
                // Update column stats
                const count = statusIssues.length;
                const points = statusIssues.reduce((sum, issue) => sum + (issue.estimate || 0), 0);
                document.getElementById(status + '-stats').textContent = count + ' issues, ' + points + ' pts';
            });
            
            updateStats();
        }
        
        function filterIssues() {
            const assigneeFilter = document.getElementById('assigneeFilter').value;
            const labelFilter = document.getElementById('labelFilter').value;
            const searchText = document.getElementById('searchBox').value.toLowerCase();
            
            return issues.filter(issue => {
                if (assigneeFilter && issue.assignee !== assigneeFilter) return false;
                if (labelFilter && (!issue.labels || !issue.labels.includes(labelFilter))) return false;
                if (searchText && !issue.title.toLowerCase().includes(searchText) && 
                    (!issue.description || !issue.description.toLowerCase().includes(searchText))) return false;
                return true;
            });
        }
        
        function createIssueCard(issue) {
            const card = document.createElement('div');
            card.className = 'card' + (issue.status === 'done' ? ' done' : '');
            card.onclick = () => openIssueModal(issue);
            
            const priorityClass = 'priority-' + issue.priority;
            const labels = issue.labels ? issue.labels.split(',').map(l => l.trim()).filter(l => l) : [];
            
            card.innerHTML = \`
                <div class="card-title">
                    <span class="priority-badge \${priorityClass}">\${issue.priority}</span>
                    \${issue.title}
                </div>
                <div class="card-meta">
                    <div class="card-labels">
                        \${labels.map(label => \`<span class="label-chip">\${label}</span>\`).join('')}
                    </div>
                    <div>
                        \${issue.estimate ? issue.estimate + ' pts' : ''}
                        \${issue.assignee ? ' • ' + issue.assignee : ''}
                    </div>
                </div>
                <div class="card-controls">
                    \${getCardControls(issue)}
                </div>
            \`;
            
            return card;
        }
        
        function getCardControls(issue) {
            const controls = [];
            const statusOrder = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
            const currentIndex = statusOrder.indexOf(issue.status);
            
            if (currentIndex > 0) {
                const prevStatus = statusOrder[currentIndex - 1];
                controls.push(\`<button onclick="event.stopPropagation(); moveIssue(\${issue.id}, '\${prevStatus}')">← \${prevStatus}</button>\`);
            }
            
            if (currentIndex < statusOrder.length - 1) {
                const nextStatus = statusOrder[currentIndex + 1];
                controls.push(\`<button onclick="event.stopPropagation(); moveIssue(\${issue.id}, '\${nextStatus}')">→ \${nextStatus}</button>\`);
            }
            
            return controls.join('');
        }
        
        async function moveIssue(issueId, newStatus) {
            try {
                const response = await fetch(\`/issues/\${issueId}\`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });
                
                if (response.ok) {
                    await loadIssues();
                    updateBoard();
                }
            } catch (error) {
                console.error('Failed to move issue:', error);
            }
        }
        
        function openIssueModal(issue) {
            currentIssue = issue;
            
            document.getElementById('issueTitle').value = issue.title;
            document.getElementById('issueDescription').value = issue.description || '';
            document.getElementById('issueStatus').value = issue.status;
            document.getElementById('issuePriority').value = issue.priority;
            document.getElementById('issueEstimate').value = issue.estimate || '';
            document.getElementById('issueAssignee').value = issue.assignee || '';
            document.getElementById('issueLabels').value = issue.labels || '';
            document.getElementById('issueSprint').value = issue.sprint_id || '';
            
            // Populate sprint options
            const sprintSelect = document.getElementById('issueSprint');
            sprintSelect.innerHTML = '<option value="">No sprint</option>';
            sprints.forEach(sprint => {
                const option = document.createElement('option');
                option.value = sprint.id;
                option.textContent = sprint.name;
                sprintSelect.appendChild(option);
            });
            
            document.getElementById('issueModal').classList.add('show');
        }
        
        function closeModal() {
            document.getElementById('issueModal').classList.remove('show');
            currentIssue = null;
        }
        
        async function createIssue() {
            const title = document.getElementById('newIssueTitle').value.trim();
            if (!title) return;
            
            const priority = document.getElementById('newIssuePriority').value;
            const status = document.getElementById('newIssueStatus').value;
            
            try {
                const response = await fetch('/issues', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title,
                        priority,
                        status,
                        sprint_id: currentSprintId
                    })
                });
                
                if (response.ok) {
                    document.getElementById('newIssueTitle').value = '';
                    await loadIssues();
                    updateBoard();
                }
            } catch (error) {
                console.error('Failed to create issue:', error);
            }
        }
        
        async function saveIssue(event) {
            event.preventDefault();
            if (!currentIssue) return;
            
            const data = {
                title: document.getElementById('issueTitle').value,
                description: document.getElementById('issueDescription').value,
                status: document.getElementById('issueStatus').value,
                priority: document.getElementById('issuePriority').value,
                estimate: parseInt(document.getElementById('issueEstimate').value) || null,
                assignee: document.getElementById('issueAssignee').value || null,
                labels: document.getElementById('issueLabels').value || null,
                sprint_id: parseInt(document.getElementById('issueSprint').value) || null
            };
            
            try {
                const response = await fetch(\`/issues/\${currentIssue.id}\`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    closeModal();
                    await loadIssues();
                    updateBoard();
                }
            } catch (error) {
                console.error('Failed to save issue:', error);
            }
        }
        
        async function deleteIssue() {
            if (!currentIssue || !confirm('Delete this issue?')) return;
            
            try {
                const response = await fetch(\`/issues/\${currentIssue.id}\`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    closeModal();
                    await loadIssues();
                    updateBoard();
                }
            } catch (error) {
                console.error('Failed to delete issue:', error);
            }
        }
        
        function updateStats() {
            const totalIssues = issues.length;
            const totalPoints = issues.reduce((sum, issue) => sum + (issue.estimate || 0), 0);
            const completedPoints = issues.filter(issue => issue.status === 'done')
                .reduce((sum, issue) => sum + (issue.estimate || 0), 0);
            const percentComplete = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
            
            document.getElementById('totalIssues').textContent = totalIssues + ' issues';
            document.getElementById('totalPoints').textContent = totalPoints + ' points';
            document.getElementById('completedPoints').textContent = completedPoints + ' completed';
            document.getElementById('percentComplete').textContent = percentComplete + '%';
            document.getElementById('progressFill').style.width = percentComplete + '%';
            
            // Check capacity warning
            const currentSprint = sprints.find(s => s.id == currentSprintId);
            const warning = document.getElementById('capacityWarning');
            if (currentSprint && totalPoints > currentSprint.capacity) {
                warning.style.display = 'inline';
            } else {
                warning.style.display = 'none';
            }
        }
        
        // Event listeners
        document.getElementById('sprintSelect').addEventListener('change', async (e) => {
            currentSprintId = e.target.value || null;
            await loadIssues();
            updateBoard();
        });
        
        document.getElementById('assigneeFilter').addEventListener('change', updateBoard);
        document.getElementById('labelFilter').addEventListener('change', updateBoard);
        document.getElementById('searchBox').addEventListener('input', updateBoard);
        document.getElementById('issueForm').addEventListener('submit', saveIssue);
        
        // Load unique assignees and labels for filters
        function updateFilters() {
            const assignees = [...new Set(issues.map(i => i.assignee).filter(Boolean))];
            const labels = [...new Set(issues.flatMap(i => i.labels ? i.labels.split(',').map(l => l.trim()) : []).filter(Boolean))];
            
            const assigneeSelect = document.getElementById('assigneeFilter');
            const labelSelect = document.getElementById('labelFilter');
            
            assigneeSelect.innerHTML = '<option value="">All assignees</option>';
            assignees.forEach(assignee => {
                const option = document.createElement('option');
                option.value = assignee;
                option.textContent = assignee;
                assigneeSelect.appendChild(option);
            });
            
            labelSelect.innerHTML = '<option value="">All labels</option>';
            labels.forEach(label => {
                const option = document.createElement('option');
                option.value = label;
                option.textContent = label;
                labelSelect.appendChild(option);
            });
        }
        
        // Initialize
        loadData().then(() => {
            updateFilters();
        });
    </script>
</body>
</html>
  `);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '0835de860d33df09991a975e261c68d5848ed8840594606ec9ea20b91f95070d',
  name: 'Design',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;
