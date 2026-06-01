from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from typing import Optional
from src.db import db, register_migration

router = APIRouter()

@router.get("/", response_class=HTMLResponse)  #phx:R1
def board_ui():
    return HTMLResponse(content="""
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
            color: #333;
            line-height: 1.5;
        }
        
        .top-bar {
            background: white;
            border-bottom: 1px solid #e9ecef;
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
            border-radius: 4px;
            background: white;
        }
        
        .stats-summary {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-left: auto;
            flex-wrap: wrap;
        }
        
        .stat {
            font-size: 0.875rem;
            color: #6c757d;
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
            font-weight: 600;
        }
        
        .controls {
            padding: 1rem 2rem;
            background: white;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .new-issue-form {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            align-items: center;
        }
        
        .new-issue-form input, .new-issue-form select, .new-issue-form textarea {
            padding: 0.5rem;
            border: 1px solid #ced4da;
            border-radius: 4px;
            font-size: 0.875rem;
        }
        
        .new-issue-form input[name="title"] {
            min-width: 200px;
        }
        
        .new-issue-form textarea {
            min-width: 200px;
            height: 60px;
            resize: vertical;
        }
        
        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
        }
        
        .btn-primary {
            background: #007bff;
            color: white;
        }
        
        .btn-primary:hover {
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
            border-radius: 4px;
            font-size: 0.875rem;
        }
        
        .board {
            padding: 2rem;
            display: flex;
            gap: 1.5rem;
            overflow-x: auto;
            min-height: calc(100vh - 200px);
        }
        
        .column {
            min-width: 280px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .column-header {
            padding: 1rem;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .column-title {
            font-weight: 600;
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .column-stats {
            font-size: 0.75rem;
            color: #6c757d;
        }
        
        .column.backlog .column-header { border-left: 4px solid #6c757d; }
        .column.todo .column-header { border-left: 4px solid #007bff; }
        .column.inprogress .column-header { border-left: 4px solid #ffc107; }
        .column.inreview .column-header { border-left: 4px solid #6f42c1; }
        .column.done .column-header { border-left: 4px solid #28a745; }
        
        .cards {
            padding: 1rem;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            min-height: 200px;
        }
        
        .card {
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 6px;
            padding: 0.75rem;
            cursor: pointer;
            transition: box-shadow 0.2s ease;
        }
        
        .card:hover {
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .card.done {
            opacity: 0.7;
        }
        
        .card-title {
            font-weight: 500;
            margin-bottom: 0.5rem;
            line-height: 1.3;
        }
        
        .card-meta {
            display: flex;
            gap: 0.5rem;
            align-items: center;
            flex-wrap: wrap;
            margin-bottom: 0.5rem;
        }
        
        .priority-badge {
            font-size: 0.75rem;
            padding: 0.125rem 0.375rem;
            border-radius: 12px;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .priority-urgent { background: #dc3545; color: white; }
        .priority-high { background: #fd7e14; color: white; }
        .priority-normal { background: #007bff; color: white; }
        .priority-low { background: #6c757d; color: white; }
        
        .points {
            font-size: 0.75rem;
            background: #e9ecef;
            color: #495057;
            padding: 0.125rem 0.375rem;
            border-radius: 12px;
            font-weight: 500;
        }
        
        .assignee {
            font-size: 0.75rem;
            color: #6c757d;
        }
        
        .labels {
            display: flex;
            gap: 0.25rem;
            flex-wrap: wrap;
        }
        
        .label {
            font-size: 0.625rem;
            background: #f8f9fa;
            color: #495057;
            padding: 0.125rem 0.25rem;
            border-radius: 8px;
            border: 1px solid #e9ecef;
        }
        
        .card-controls {
            display: flex;
            gap: 0.25rem;
            margin-top: 0.5rem;
        }
        
        .card-btn {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
            border: 1px solid #ced4da;
            background: white;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .card-btn:hover {
            background: #f8f9fa;
        }
        
        .done-check {
            color: #28a745;
            margin-right: 0.5rem;
        }
        
        @media (max-width: 768px) {
            .top-bar, .controls {
                padding: 1rem;
            }
            
            .board {
                padding: 1rem;
            }
            
            .column {
                min-width: 250px;
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
            <div class="stat" id="totalIssues">0 issues</div>
            <div class="stat" id="totalPoints">0 points</div>
            <div class="stat" id="completedPoints">0 completed</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: 0%"></div>
            </div>
            <div class="stat" id="percentComplete">0%</div>
            <div class="warning" id="capacityWarning" style="display: none;"></div>
        </div>
    </div>
    
    <div class="controls">
        <form class="new-issue-form" id="newIssueForm">
            <input type="text" name="title" placeholder="Issue title" required>
            <textarea name="description" placeholder="Description"></textarea>
            <select name="priority">
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="low">Low</option>
            </select>
            <select name="point_estimate">
                <option value="">No estimate</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="5">5</option>
                <option value="8">8</option>
                <option value="13">13</option>
            </select>
            <input type="text" name="assignee" placeholder="Assignee">
            <input type="text" name="labels" placeholder="Labels (comma-separated)">
            <select name="status">
                <option value="backlog">Backlog</option>
                <option value="todo">Todo</option>
                <option value="inprogress">In Progress</option>
                <option value="inreview">In Review</option>
                <option value="done">Done</option>
            </select>
            <button type="submit" class="btn btn-primary">Add Issue</button>
        </form>
        
        <div class="filters">
            <input type="text" id="searchInput" placeholder="Search issues...">
            <select id="assigneeFilter">
                <option value="">All assignees</option>
            </select>
            <select id="labelFilter">
                <option value="">All labels</option>
            </select>
        </div>
    </div>
    
    <div class="board" id="board">
        <div class="column backlog" data-status="backlog">
            <div class="column-header">
                <div class="column-title">Backlog</div>
                <div class="column-stats" id="backlog-stats">0 issues, 0 pts</div>
            </div>
            <div class="cards" id="backlog-cards"></div>
        </div>
        
        <div class="column todo" data-status="todo">
            <div class="column-header">
                <div class="column-title">Todo</div>
                <div class="column-stats" id="todo-stats">0 issues, 0 pts</div>
            </div>
            <div class="cards" id="todo-cards"></div>
        </div>
        
        <div class="column inprogress" data-status="inprogress">
            <div class="column-header">
                <div class="column-title">In Progress</div>
                <div class="column-stats" id="inprogress-stats">0 issues, 0 pts</div>
            </div>
            <div class="cards" id="inprogress-cards"></div>
        </div>
        
        <div class="column inreview" data-status="inreview">
            <div class="column-header">
                <div class="column-title">In Review</div>
                <div class="column-stats" id="inreview-stats">0 issues, 0 pts</div>
            </div>
            <div class="cards" id="inreview-cards"></div>
        </div>
        
        <div class="column done" data-status="done">
            <div class="column-header">
                <div class="column-title">Done</div>
                <div class="column-stats" id="done-stats">0 issues, 0 pts</div>
            </div>
            <div class="cards" id="done-cards"></div>
        </div>
    </div>

    <script>
        let currentSprint = null;
        let allIssues = [];
        let allSprints = [];
        let filteredIssues = [];
        
        const statusOrder = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
        
        async function loadData() {
            try {
                const [issuesResponse, sprintsResponse] = await Promise.all([
                    fetch('/issue'),
                    fetch('/sprint')
                ]);
                
                allIssues = await issuesResponse.json();
                allSprints = await sprintsResponse.json();
                
                populateSprintSelector();
                populateFilters();
                applyFilters();
                updateBoard();
                updateStats();
            } catch (error) {
                console.error('Failed to load data:', error);
            }
        }
        
        function populateSprintSelector() {
            const select = document.getElementById('sprintSelect');
            select.innerHTML = '<option value="">Backlog (no sprint)</option>';
            
            allSprints.forEach(sprint => {
                const option = document.createElement('option');
                option.value = sprint.id;
                option.textContent = sprint.name;
                if (sprint.is_current) {
                    option.selected = true;
                    currentSprint = sprint.id;
                }
                select.appendChild(option);
            });
        }
        
        function populateFilters() {
            const assigneeFilter = document.getElementById('assigneeFilter');
            const labelFilter = document.getElementById('labelFilter');
            
            const assignees = [...new Set(allIssues.map(i => i.assignee).filter(Boolean))];
            const labels = [...new Set(allIssues.flatMap(i => i.labels || []))];
            
            assigneeFilter.innerHTML = '<option value="">All assignees</option>';
            assignees.forEach(assignee => {
                const option = document.createElement('option');
                option.value = assignee;
                option.textContent = assignee;
                assigneeFilter.appendChild(option);
            });
            
            labelFilter.innerHTML = '<option value="">All labels</option>';
            labels.forEach(label => {
                const option = document.createElement('option');
                option.value = label;
                option.textContent = label;
                labelFilter.appendChild(option);
            });
        }
        
        function applyFilters() {
            const search = document.getElementById('searchInput').value.toLowerCase();
            const assigneeFilter = document.getElementById('assigneeFilter').value;
            const labelFilter = document.getElementById('labelFilter').value;
            
            filteredIssues = allIssues.filter(issue => {
                // Sprint filter
                const sprintMatch = currentSprint === null ? 
                    !issue.sprint_id : 
                    issue.sprint_id === currentSprint;
                
                // Search filter
                const searchMatch = !search || 
                    issue.title.toLowerCase().includes(search) ||
                    (issue.description && issue.description.toLowerCase().includes(search));
                
                // Assignee filter
                const assigneeMatch = !assigneeFilter || issue.assignee === assigneeFilter;
                
                // Label filter
                const labelMatch = !labelFilter || (issue.labels && issue.labels.includes(labelFilter));
                
                return sprintMatch && searchMatch && assigneeMatch && labelMatch;
            });
        }
        
        function updateBoard() {
            statusOrder.forEach(status => {
                const container = document.getElementById(status + '-cards');
                const statusIssues = filteredIssues.filter(issue => issue.status === status);
                
                container.innerHTML = '';
                statusIssues.forEach(issue => {
                    container.appendChild(createIssueCard(issue));
                });
                
                updateColumnStats(status, statusIssues);
            });
        }
        
        function updateColumnStats(status, issues) {
            const statsEl = document.getElementById(status + '-stats');
            const totalPoints = issues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
            statsEl.textContent = issues.length + ' issues, ' + totalPoints + ' pts';
        }
        
        function createIssueCard(issue) {
            const card = document.createElement('div');
            card.className = 'card' + (issue.status === 'done' ? ' done' : '');
            card.dataset.issueId = issue.id;
            
            const priorityClass = 'priority-' + issue.priority;
            const doneCheck = issue.status === 'done' ? '<span class="done-check">✓</span>' : '';
            
            const labels = issue.labels ? 
                issue.labels.map(label => '<span class="label">' + label + '</span>').join('') : '';
            
            const assignee = issue.assignee ? '<span class="assignee">@' + issue.assignee + '</span>' : '';
            const points = issue.point_estimate ? '<span class="points">' + issue.point_estimate + '</span>' : '';
            
            const currentIndex = statusOrder.indexOf(issue.status);
            const canMoveBack = currentIndex > 0;
            const canMoveForward = currentIndex < statusOrder.length - 1;
            
            let backButton = '';
            let forwardButton = '';
            
            if (canMoveBack) {
                backButton = '<button class="card-btn" data-action="back">← ' + statusOrder[currentIndex - 1] + '</button>';
            }
            if (canMoveForward) {
                forwardButton = '<button class="card-btn" data-action="forward">' + statusOrder[currentIndex + 1] + ' →</button>';
            }
            
            card.innerHTML = 
                '<div class="card-title">' + doneCheck + issue.title + '</div>' +
                '<div class="card-meta">' +
                    '<span class="priority-badge ' + priorityClass + '">' + issue.priority + '</span>' +
                    points +
                    assignee +
                '</div>' +
                '<div class="labels">' + labels + '</div>' +
                '<div class="card-controls">' +
                    backButton +
                    forwardButton +
                    '<button class="card-btn" data-action="edit">Edit</button>' +
                    '<button class="card-btn" data-action="delete">Delete</button>' +
                '</div>';
            
            return card;
        }
        
        async function updateStats() {
            if (currentSprint === null) {
                // Backlog view - show basic stats
                const totalIssues = filteredIssues.length;
                const totalPoints = filteredIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
                const completedIssues = filteredIssues.filter(issue => issue.status === 'done');
                const completedPoints = completedIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
                const percentage = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
                
                document.getElementById('totalIssues').textContent = totalIssues + ' issues';
                document.getElementById('totalPoints').textContent = totalPoints + ' points';
                document.getElementById('completedPoints').textContent = completedPoints + ' completed';
                document.getElementById('percentComplete').textContent = percentage + '%';
                document.getElementById('progressFill').style.width = percentage + '%';
                document.getElementById('capacityWarning').style.display = 'none';
            } else {
                // Sprint view - get rollup data
                try {
                    const response = await fetch('/sprint-rollup/' + currentSprint);
                    const rollup = await response.json();
                    
                    document.getElementById('totalIssues').textContent = rollup.total_issues + ' issues';
                    document.getElementById('totalPoints').textContent = rollup.total_points + ' points';
                    document.getElementById('completedPoints').textContent = rollup.completed_points + ' completed';
                    document.getElementById('percentComplete').textContent = Math.round(rollup.percentage_completed) + '%';
                    document.getElementById('progressFill').style.width = rollup.percentage_completed + '%';
                    
                    const warningEl = document.getElementById('capacityWarning');
                    if (rollup.over_capacity) {
                        warningEl.textContent = 'Over capacity by ' + rollup.capacity_exceeded_by + ' points';
                        warningEl.style.display = 'block';
                    } else {
                        warningEl.style.display = 'none';
                    }
                } catch (error) {
                    console.error('Failed to load sprint rollup:', error);
                }
            }
        }
        
        async function moveIssue(issueId, newStatus) {
            try {
                await fetch('/issue/' + issueId, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });
                
                await loadData();
            } catch (error) {
                console.error('Failed to move issue:', error);
            }
        }
        
        async function deleteIssue(issueId) {
            if (!confirm('Delete this issue?')) return;
            
            try {
                await fetch('/issue/' + issueId, { method: 'DELETE' });
                await loadData();
            } catch (error) {
                console.error('Failed to delete issue:', error);
            }
        }
        
        function editIssue(issueId) {
            const issue = allIssues.find(i => i.id === issueId);
            if (!issue) return;
            
            const form = document.getElementById('newIssueForm');
            form.title.value = issue.title;
            form.description.value = issue.description || '';
            form.priority.value = issue.priority;
            form.point_estimate.value = issue.point_estimate || '';
            form.assignee.value = issue.assignee || '';
            form.labels.value = issue.labels ? issue.labels.join(', ') : '';
            form.status.value = issue.status;
            
            form.dataset.editingId = issueId;
            form.querySelector('button').textContent = 'Update Issue';
        }
        
        // Event listeners
        document.getElementById('sprintSelect').addEventListener('change', function() {
            currentSprint = this.value ? parseInt(this.value) : null;
            applyFilters();
            updateBoard();
            updateStats();
        });
        
        document.getElementById('searchInput').addEventListener('input', function() {
            applyFilters();
            updateBoard();
        });
        
        document.getElementById('assigneeFilter').addEventListener('change', function() {
            applyFilters();
            updateBoard();
        });
        
        document.getElementById('labelFilter').addEventListener('change', function() {
            applyFilters();
            updateBoard();
        });
        
        document.getElementById('newIssueForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const labels = formData.get('labels').split(',').map(l => l.trim()).filter(Boolean);
            
            const payload = {
                title: formData.get('title'),
                description: formData.get('description') || '',
                priority: formData.get('priority'),
                assignee: formData.get('assignee') || null,
                labels: labels.length > 0 ? labels : null,
                sprint_id: currentSprint
            };
            
            if (formData.get('point_estimate')) {
                payload.point_estimate = parseInt(formData.get('point_estimate'));
            }
            
            try {
                const editingId = e.target.dataset.editingId;
                if (editingId) {
                    // Update existing issue
                    payload.status = formData.get('status');
                    await fetch('/issue/' + editingId, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    delete e.target.dataset.editingId;
                    e.target.querySelector('button').textContent = 'Add Issue';
                } else {
                    // Create new issue with target status
                    const targetStatus = formData.get('status');
                    await fetch('/issue', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    // If target status is not backlog, move the issue
                    if (targetStatus !== 'backlog') {
                        const issuesResponse = await fetch('/issue');
                        const issues = await issuesResponse.json();
                        const newIssue = issues[0]; // Most recently created
                        
                        await fetch('/issue/' + newIssue.id, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: targetStatus })
                        });
                    }
                }
                
                e.target.reset();
                await loadData();
            } catch (error) {
                console.error('Failed to save issue:', error);
            }
        });
        
        document.getElementById('board').addEventListener('click', function(e) {
            if (e.target.classList.contains('card-btn')) {
                const card = e.target.closest('.card');
                const issueId = parseInt(card.dataset.issueId);
                const action = e.target.dataset.action;
                const issue = allIssues.find(i => i.id === issueId);
                
                if (action === 'back') {
                    const currentIndex = statusOrder.indexOf(issue.status);
                    const newStatus = statusOrder[currentIndex - 1];
                    moveIssue(issueId, newStatus);
                } else if (action === 'forward') {
                    const currentIndex = statusOrder.indexOf(issue.status);
                    const newStatus = statusOrder[currentIndex + 1];
                    moveIssue(issueId, newStatus);
                } else if (action === 'edit') {
                    editIssue(issueId);
                } else if (action === 'delete') {
                    deleteIssue(issueId);
                }
            }
        });
        
        // Load data on page load
        loadData();
    </script>
</body>
</html>
    """)

# Phoenix VCS traceability - do not remove.
_phoenix = {
  "iu_id": "f993393e0f54e9daed3424d2bc6140677cce222c01d98ed066f74052c2bd1f86",
  "name": "board ui",
  "risk_tier": "high",
  "canon_ids": [6]
}