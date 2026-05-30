import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

registerMigration('design', `
  CREATE TABLE IF NOT EXISTS design (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateDesignSchema = z.object({});
const UpdateDesignSchema = z.object({});

// ─── Routes ─────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trail - Issue & Sprint Tracker</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; }
    
    .top-bar { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; display: flex; align-items: center; gap: 2rem; }
    .top-bar h1 { font-size: 1.5rem; font-weight: 600; }
    .sprint-selector select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .stats { display: flex; gap: 1rem; align-items: center; margin-left: auto; }
    .stats-item { font-size: 0.875rem; }
    .progress-bar { width: 100px; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #28a745; transition: width 0.3s; }
    .warning { color: #dc3545; font-weight: 600; }
    
    .controls { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; }
    .new-issue-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .new-issue-form input, .new-issue-form select, .new-issue-form textarea { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .new-issue-form input[type="text"] { flex: 1; min-width: 200px; }
    .new-issue-form textarea { width: 100%; min-height: 60px; resize: vertical; }
    .new-issue-form button { padding: 0.5rem 1rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .new-issue-form button:hover { background: #0056b3; }
    
    .filters { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .filters input, .filters select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    
    .board { display: flex; gap: 1rem; padding: 1rem; min-height: calc(100vh - 200px); overflow-x: auto; }
    .column { flex: 1; min-width: 280px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .column-header { padding: 1rem; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center; }
    .column-title { font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
    .column-stats { font-size: 0.875rem; color: #6c757d; }
    .column-content { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; min-height: 300px; }
    
    .column.backlog .column-title::before { content: ''; width: 4px; height: 20px; background: #6c757d; border-radius: 2px; }
    .column.todo .column-title::before { content: ''; width: 4px; height: 20px; background: #007bff; border-radius: 2px; }
    .column.inprogress .column-title::before { content: ''; width: 4px; height: 20px; background: #ffc107; border-radius: 2px; }
    .column.inreview .column-title::before { content: ''; width: 4px; height: 20px; background: #6f42c1; border-radius: 2px; }
    .column.done .column-title::before { content: ''; width: 4px; height: 20px; background: #28a745; border-radius: 2px; }
    
    .card { background: white; border: 1px solid #dee2e6; border-radius: 6px; padding: 0.75rem; cursor: pointer; transition: all 0.2s; }
    .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); transform: translateY(-1px); }
    .card.done { opacity: 0.7; }
    .card.done::after { content: '✓'; position: absolute; top: 0.5rem; right: 0.5rem; color: #28a745; font-weight: bold; }
    .card { position: relative; }
    
    .card-title { font-weight: 600; margin-bottom: 0.5rem; line-height: 1.3; }
    .card-meta { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .priority-badge { padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .priority-urgent { background: #dc3545; color: white; }
    .priority-high { background: #fd7e14; color: white; }
    .priority-normal { background: #007bff; color: white; }
    .priority-low { background: #6c757d; color: white; }
    .points { background: #e9ecef; color: #495057; padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; }
    .assignee { color: #6c757d; font-size: 0.875rem; }
    
    .labels { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.5rem; }
    .label { background: #e9ecef; color: #495057; padding: 0.125rem 0.375rem; border-radius: 8px; font-size: 0.75rem; }
    
    .card-controls { display: flex; gap: 0.25rem; margin-top: 0.5rem; opacity: 0; transition: opacity 0.2s; }
    .card:hover .card-controls { opacity: 1; }
    .card-control { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 0.25rem 0.5rem; font-size: 0.75rem; cursor: pointer; }
    .card-control:hover { background: #e9ecef; }
    
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
    .modal.show { display: flex; align-items: center; justify-content: center; }
    .modal-content { background: white; border-radius: 8px; padding: 2rem; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .modal-title { font-size: 1.25rem; font-weight: 600; }
    .close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #6c757d; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
    .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .form-group textarea { min-height: 100px; resize: vertical; }
    .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem; }
    .btn { padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; }
    .btn-primary { background: #007bff; color: white; }
    .btn-primary:hover { background: #0056b3; }
    .btn-danger { background: #dc3545; color: white; }
    .btn-danger:hover { background: #c82333; }
    .btn-secondary { background: #6c757d; color: white; }
    .btn-secondary:hover { background: #545b62; }
    
    @media (max-width: 768px) {
      .board { flex-direction: column; }
      .column { min-width: auto; }
      .top-bar { flex-direction: column; gap: 1rem; }
      .stats { margin-left: 0; }
    }
  </style>
</head>
<body>
  <div class="top-bar"> <!--phx:R1-->
    <h1>Trail</h1>
    <div class="sprint-selector">
      <select id="sprintSelect">
        <option value="">Backlog</option>
      </select>
    </div>
    <div class="stats">
      <div class="stats-item">Issues: <span id="totalIssues">0</span></div>
      <div class="stats-item">Points: <span id="totalPoints">0</span></div>
      <div class="stats-item">Complete: <span id="completedPoints">0</span></div>
      <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
      <div class="stats-item"><span id="percentComplete">0%</span></div>
      <div id="capacityWarning" class="warning" style="display: none;">Over capacity!</div>
    </div>
  </div>
  
  <div class="controls">
    <form class="new-issue-form" id="newIssueForm">
      <input type="text" id="newTitle" placeholder="Issue title" required>
      <select id="newPriority">
        <option value="normal">Normal</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="low">Low</option>
      </select>
      <select id="newPoints">
        <option value="">No estimate</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="5">5</option>
        <option value="8">8</option>
        <option value="13">13</option>
      </select>
      <input type="text" id="newAssignee" placeholder="Assignee">
      <input type="text" id="newLabels" placeholder="Labels (comma-separated)">
      <select id="newStatus">
        <option value="backlog">Backlog</option>
        <option value="todo">Todo</option>
        <option value="inprogress">In Progress</option>
        <option value="inreview">In Review</option>
        <option value="done">Done</option>
      </select>
      <button type="submit">Add Issue</button>
      <textarea id="newDescription" placeholder="Description (optional)"></textarea>
    </form>
    
    <div class="filters">
      <input type="text" id="searchBox" placeholder="Search issues...">
      <select id="assigneeFilter">
        <option value="">All assignees</option>
      </select>
      <select id="labelFilter">
        <option value="">All labels</option>
      </select>
    </div>
  </div>
  
  <div class="board" id="board"> <!--phx:I1-->
    <div class="column backlog" data-status="backlog"> <!--phx:R3-->
      <div class="column-header">
        <div class="column-title">Backlog</div>
        <div class="column-stats"><span class="count">0</span> • <span class="points">0</span>pts</div>
      </div>
      <div class="column-content"></div>
    </div>
    <div class="column todo" data-status="todo">
      <div class="column-header">
        <div class="column-title">Todo</div>
        <div class="column-stats"><span class="count">0</span> • <span class="points">0</span>pts</div>
      </div>
      <div class="column-content"></div>
    </div>
    <div class="column inprogress" data-status="inprogress">
      <div class="column-header">
        <div class="column-title">In Progress</div>
        <div class="column-stats"><span class="count">0</span> • <span class="points">0</span>pts</div>
      </div>
      <div class="column-content"></div>
    </div>
    <div class="column inreview" data-status="inreview">
      <div class="column-header">
        <div class="column-title">In Review</div>
        <div class="column-stats"><span class="count">0</span> • <span class="points">0</span>pts</div>
      </div>
      <div class="column-content"></div>
    </div>
    <div class="column done" data-status="done">
      <div class="column-header">
        <div class="column-title">Done</div>
        <div class="column-stats"><span class="count">0</span> • <span class="points">0</span>pts</div>
      </div>
      <div class="column-content"></div>
    </div>
  </div>
  
  <div class="modal" id="issueModal"> <!--phx:R2-->
    <div class="modal-content">
      <div class="modal-header">
        <div class="modal-title">Edit Issue</div>
        <button class="close-btn" onclick="closeModal()">&times;</button>
      </div>
      <form id="editIssueForm">
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="editTitle" required>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="editDescription"></textarea>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select id="editStatus">
            <option value="backlog">Backlog</option>
            <option value="todo">Todo</option>
            <option value="inprogress">In Progress</option>
            <option value="inreview">In Review</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div class="form-group">
          <label>Priority</label>
          <select id="editPriority">
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div class="form-group">
          <label>Points</label>
          <select id="editPoints">
            <option value="">No estimate</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="5">5</option>
            <option value="8">8</option>
            <option value="13">13</option>
          </select>
        </div>
        <div class="form-group">
          <label>Assignee</label>
          <input type="text" id="editAssignee">
        </div>
        <div class="form-group">
          <label>Labels</label>
          <input type="text" id="editLabels" placeholder="Comma-separated">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-danger" onclick="deleteIssue()">Delete</button>
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  </div>
  
  <script>
    let issues = [];
    let sprints = [];
    let currentEditingId = null;
    let currentSprintId = null;
    
    async function loadData() {
      try {
        const [issuesRes, sprintsRes] = await Promise.all([
          fetch('/issues'),
          fetch('/sprints')
        ]);
        issues = await issuesRes.json();
        sprints = await sprintsRes.json();
        
        populateSprintSelector();
        populateFilters();
        renderBoard();
        updateStats();
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    }
    
    function populateSprintSelector() {
      const select = document.getElementById('sprintSelect');
      select.innerHTML = '<option value="">Backlog</option>';
      
      const activeSprints = sprints.filter(s => !s.is_closed).sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
      const closedSprints = sprints.filter(s => s.is_closed).sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
      
      [...activeSprints, ...closedSprints].forEach(sprint => {
        const option = document.createElement('option');
        option.value = sprint.id;
        option.textContent = sprint.name + (sprint.is_current ? ' (Current)' : '') + (sprint.is_closed ? ' (Closed)' : '');
        select.appendChild(option);
      });
      
      const currentSprint = sprints.find(s => s.is_current);
      if (currentSprint) {
        select.value = currentSprint.id;
        currentSprintId = currentSprint.id;
      }
    }
    
    function populateFilters() {
      const assignees = [...new Set(issues.map(i => i.assignee).filter(Boolean))];
      const labels = [...new Set(issues.flatMap(i => i.labels || []))];
      
      const assigneeSelect = document.getElementById('assigneeFilter');
      assigneeSelect.innerHTML = '<option value="">All assignees</option>';
      assignees.forEach(assignee => {
        const option = document.createElement('option');
        option.value = assignee;
        option.textContent = assignee;
        assigneeSelect.appendChild(option);
      });
      
      const labelSelect = document.getElementById('labelFilter');
      labelSelect.innerHTML = '<option value="">All labels</option>';
      labels.forEach(label => {
        const option = document.createElement('option');
        option.value = label;
        option.textContent = label;
        labelSelect.appendChild(option);
      });
    }
    
    function getFilteredIssues() {
      const search = document.getElementById('searchBox').value.toLowerCase();
      const assigneeFilter = document.getElementById('assigneeFilter').value;
      const labelFilter = document.getElementById('labelFilter').value;
      const sprintSelect = document.getElementById('sprintSelect');
      const selectedSprintId = sprintSelect.value ? parseInt(sprintSelect.value) : null;
      
      return issues.filter(issue => {
        // Sprint filter
        if (selectedSprintId === null && issue.sprint_id !== null) return false;
        if (selectedSprintId !== null && issue.sprint_id !== selectedSprintId) return false;
        
        // Search filter
        if (search && !issue.title.toLowerCase().includes(search) && 
            !(issue.description || '').toLowerCase().includes(search)) return false;
        
        // Assignee filter
        if (assigneeFilter && issue.assignee !== assigneeFilter) return false;
        
        // Label filter
        if (labelFilter && !(issue.labels || []).includes(labelFilter)) return false;
        
        return true;
      });
    }
    
    function renderBoard() {
      const filteredIssues = getFilteredIssues();
      const columns = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
      
      columns.forEach(status => {
        const column = document.querySelector('[data-status="' + status + '"]');
        const content = column.querySelector('.column-content');
        const statusIssues = filteredIssues.filter(issue => issue.status === status);
        
        content.innerHTML = '';
        statusIssues.forEach(issue => {
          const card = createIssueCard(issue);
          content.appendChild(card);
        });
        
        // Update column stats
        const count = statusIssues.length;
        const points = statusIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
        column.querySelector('.count').textContent = count;
        column.querySelector('.points').textContent = points;
      });
    }
    
    function createIssueCard(issue) {
      const card = document.createElement('div');
      card.className = 'card ' + (issue.status === 'done' ? 'done' : '');
      card.onclick = () => openIssueModal(issue);
      
      const priorityClass = 'priority-' + issue.priority;
      const pointsHtml = issue.point_estimate ? '<span class="points">' + issue.point_estimate + '</span>' : '';
      const assigneeHtml = issue.assignee ? '<span class="assignee">' + issue.assignee + '</span>' : '';
      const labelsHtml = (issue.labels || []).map(label => '<span class="label">' + label + '</span>').join('');
      
      const prevStatus = getPrevStatus(issue.status);
      const nextStatus = getNextStatus(issue.status);
      const prevBtn = prevStatus ? '<button class="card-control" onclick="event.stopPropagation(); moveIssue(' + issue.id + ', \'' + prevStatus + '\')">← ' + prevStatus + '</button>' : '';
      const nextBtn = nextStatus ? '<button class="card-control" onclick="event.stopPropagation(); moveIssue(' + issue.id + ', \'' + nextStatus + '\')">' + nextStatus + ' →</button>' : '';
      
      card.innerHTML = 
        '<div class="card-title">' + issue.title + '</div>' +
        '<div class="card-meta">' +
          '<span class="priority-badge ' + priorityClass + '">' + issue.priority + '</span>' +
          pointsHtml +
          assigneeHtml +
        '</div>' +
        (labelsHtml ? '<div class="labels">' + labelsHtml + '</div>' : '') +
        '<div class="card-controls">' +
          prevBtn +
          nextBtn +
        '</div>';
      
      return card;
    }
    
    function getPrevStatus(status) {
      const statuses = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
      const index = statuses.indexOf(status);
      return index > 0 ? statuses[index - 1] : null;
    }
    
    function getNextStatus(status) {
      const statuses = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
      const index = statuses.indexOf(status);
      return index < statuses.length - 1 ? statuses[index + 1] : null;
    }
    
    async function moveIssue(id, newStatus) {
      try {
        const response = await fetch('/issues/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        
        if (response.ok) {
          const updatedIssue = await response.json();
          const index = issues.findIndex(i => i.id === id);
          if (index !== -1) {
            issues[index] = updatedIssue;
          }
          renderBoard();
          updateStats();
        }
      } catch (error) {
        console.error('Failed to move issue:', error);
      }
    }
    
    function updateStats() {
      const filteredIssues = getFilteredIssues();
      const totalIssues = filteredIssues.length;
      const totalPoints = filteredIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
      const completedPoints = filteredIssues.filter(i => i.status === 'done').reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
      const percentComplete = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
      
      document.getElementById('totalIssues').textContent = totalIssues;
      document.getElementById('totalPoints').textContent = totalPoints;
      document.getElementById('completedPoints').textContent = completedPoints;
      document.getElementById('percentComplete').textContent = percentComplete + '%';
      document.getElementById('progressFill').style.width = percentComplete + '%';
      
      // Check capacity warning
      const sprintSelect = document.getElementById('sprintSelect');
      const selectedSprintId = sprintSelect.value ? parseInt(sprintSelect.value) : null;
      const sprint = sprints.find(s => s.id === selectedSprintId);
      const warning = document.getElementById('capacityWarning');
      
      if (sprint && sprint.capacity && totalPoints > sprint.capacity) {
        warning.style.display = 'block';
      } else {
        warning.style.display = 'none';
      }
    }
    
    function openIssueModal(issue) {
      currentEditingId = issue.id;
      document.getElementById('editTitle').value = issue.title;
      document.getElementById('editDescription').value = issue.description || '';
      document.getElementById('editStatus').value = issue.status;
      document.getElementById('editPriority').value = issue.priority;
      document.getElementById('editPoints').value = issue.point_estimate || '';
      document.getElementById('editAssignee').value = issue.assignee || '';
      document.getElementById('editLabels').value = (issue.labels || []).join(', ');
      document.getElementById('issueModal').classList.add('show');
    }
    
    function closeModal() {
      document.getElementById('issueModal').classList.remove('show');
      currentEditingId = null;
    }
    
    async function deleteIssue() {
      if (!currentEditingId) return;
      
      if (confirm('Are you sure you want to delete this issue?')) {
        try {
          const response = await fetch('/issues/' + currentEditingId, {
            method: 'DELETE'
          });
          
          if (response.ok) {
            issues = issues.filter(i => i.id !== currentEditingId);
            closeModal();
            renderBoard();
            updateStats();
            populateFilters();
          }
        } catch (error) {
          console.error('Failed to delete issue:', error);
        }
      }
    }
    
    // Event listeners
    document.getElementById('sprintSelect').addEventListener('change', () => {
      renderBoard();
      updateStats();
    });
    
    document.getElementById('searchBox').addEventListener('input', () => {
      renderBoard();
      updateStats();
    });
    
    document.getElementById('assigneeFilter').addEventListener('change', () => {
      renderBoard();
      updateStats();
    });
    
    document.getElementById('labelFilter').addEventListener('change', () => {
      renderBoard();
      updateStats();
    });
    
    document.getElementById('newIssueForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const title = document.getElementById('newTitle').value;
      const description = document.getElementById('newDescription').value;
      const priority = document.getElementById('newPriority').value;
      const pointEstimate = document.getElementById('newPoints').value;
      const assignee = document.getElementById('newAssignee').value;
      const labels = document.getElementById('newLabels').value.split(',').map(l => l.trim()).filter(Boolean);
      const status = document.getElementById('newStatus').value;
      const sprintSelect = document.getElementById('sprintSelect');
      const sprintId = sprintSelect.value ? parseInt(sprintSelect.value) : null;
      
      const payload = {
        title,
        status,
        priority
      };
      
      if (description) payload.description = description;
      if (pointEstimate) payload.point_estimate = parseInt(pointEstimate);
      if (assignee) payload.assignee = assignee;
      if (labels.length > 0) payload.labels = labels;
      if (sprintId) payload.sprint_id = sprintId;
      
      try {
        const response = await fetch('/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (response.ok) {
          const newIssue = await response.json();
          issues.push(newIssue);
          document.getElementById('newIssueForm').reset();
          renderBoard();
          updateStats();
          populateFilters();
        }
      } catch (error) {
        console.error('Failed to create issue:', error);
      }
    });
    
    document.getElementById('editIssueForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!currentEditingId) return;
      
      const title = document.getElementById('editTitle').value;
      const description = document.getElementById('editDescription').value;
      const status = document.getElementById('editStatus').value;
      const priority = document.getElementById('editPriority').value;
      const pointEstimate = document.getElementById('editPoints').value;
      const assignee = document.getElementById('editAssignee').value;
      const labels = document.getElementById('editLabels').value.split(',').map(l => l.trim()).filter(Boolean);
      
      const payload = {
        title,
        status,
        priority,
        description: description || null,
        point_estimate: pointEstimate ? parseInt(pointEstimate) : null,
        assignee: assignee || null,
        labels: labels.length > 0 ? labels : null
      };
      
      try {
        const response = await fetch('/issues/' + currentEditingId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (response.ok) {
          const updatedIssue = await response.json();
          const index = issues.findIndex(i => i.id === currentEditingId);
          if (index !== -1) {
            issues[index] = updatedIssue;
          }
          closeModal();
          renderBoard();
          updateStats();
          populateFilters();
        }
      } catch (error) {
        console.error('Failed to update issue:', error);
      }
    });
    
    // Close modal when clicking outside
    document.getElementById('issueModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        closeModal();
      }
    });
    
    // Load data on page load
    loadData();
  </script>
</body>
</html>`);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '0835de860d33df09991a975e261c68d5848ed8840594606ec9ea20b91f95070d',
  name: 'Design',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;
