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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; }
    
    .top-bar { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; display: flex; align-items: center; gap: 2rem; }
    .app-title { font-size: 1.5rem; font-weight: 600; color: #495057; }
    .sprint-selector select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .stats-summary { display: flex; align-items: center; gap: 1rem; margin-left: auto; }
    .stat { font-size: 0.875rem; }
    .progress-bar { width: 100px; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #28a745; transition: width 0.3s; }
    .warning { color: #dc3545; font-weight: 600; }
    
    .controls { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; }
    .new-issue-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .new-issue-form input, .new-issue-form select, .new-issue-form textarea { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .new-issue-form input[name="title"] { flex: 1; min-width: 200px; }
    .new-issue-form textarea { width: 100%; min-height: 60px; resize: vertical; }
    .new-issue-form button { padding: 0.5rem 1rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .new-issue-form button:hover { background: #0056b3; }
    
    .filters { display: flex; gap: 1rem; align-items: center; }
    .filters input, .filters select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    
    .board { display: flex; gap: 1rem; padding: 1rem; min-height: calc(100vh - 200px); overflow-x: auto; }
    .column { flex: 1; min-width: 280px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .column-header { padding: 1rem; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center; }
    .column-title { font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
    .column-stats { font-size: 0.875rem; color: #6c757d; }
    .column-content { padding: 1rem; min-height: 400px; }
    
    .column.backlog .column-header { border-left: 4px solid #6c757d; }
    .column.todo .column-header { border-left: 4px solid #007bff; }
    .column.in_progress .column-header { border-left: 4px solid #ffc107; }
    .column.in_review .column-header { border-left: 4px solid #6f42c1; }
    .column.done .column-header { border-left: 4px solid #28a745; }
    
    .card { background: white; border: 1px solid #dee2e6; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.75rem; cursor: pointer; transition: box-shadow 0.2s; }
    .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .card.done { opacity: 0.7; }
    .card.done .card-title::before { content: "✓ "; color: #28a745; }
    
    .card-title { font-weight: 500; margin-bottom: 0.5rem; }
    .card-meta { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .priority-badge { padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
    .priority-urgent { background: #dc3545; color: white; }
    .priority-high { background: #fd7e14; color: white; }
    .priority-normal { background: #007bff; color: white; }
    .priority-low { background: #6c757d; color: white; }
    .points { background: #e9ecef; padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; }
    .assignee { background: #f8f9fa; padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; }
    .label { background: #e7f3ff; color: #0056b3; padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; }
    
    .card-controls { margin-top: 0.5rem; display: flex; gap: 0.25rem; }
    .card-controls button { padding: 0.25rem 0.5rem; font-size: 0.75rem; border: 1px solid #ced4da; background: white; border-radius: 4px; cursor: pointer; }
    .card-controls button:hover { background: #f8f9fa; }
    
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
    .modal.show { display: flex; align-items: center; justify-content: center; }
    .modal-content { background: white; border-radius: 8px; padding: 2rem; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .modal-title { font-size: 1.25rem; font-weight: 600; }
    .close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .form-group textarea { min-height: 100px; resize: vertical; }
    .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
    .btn { padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; }
    .btn-primary { background: #007bff; color: white; }
    .btn-primary:hover { background: #0056b3; }
    .btn-secondary { background: #6c757d; color: white; }
    .btn-secondary:hover { background: #545b62; }
    .btn-danger { background: #dc3545; color: white; }
    .btn-danger:hover { background: #c82333; }
    
    @media (max-width: 768px) {
      .board { flex-direction: column; }
      .column { min-width: auto; }
      .top-bar { flex-direction: column; align-items: stretch; gap: 1rem; }
      .stats-summary { margin-left: 0; }
      .new-issue-form { flex-direction: column; }
      .filters { flex-direction: column; align-items: stretch; }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="app-title">Trail</div>
    <div class="sprint-selector">
      <select id="sprintSelect">
        <option value="">Backlog</option>
      </select>
    </div>
    <div class="stats-summary">
      <div class="stat">Issues: <span id="totalIssues">0</span></div>
      <div class="stat">Points: <span id="completedPoints">0</span>/<span id="totalPoints">0</span></div>
      <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
      <div class="stat"><span id="percentComplete">0</span>%</div>
      <div id="capacityWarning" class="warning" style="display: none;">Over capacity!</div>
    </div>
  </div>
  
  <div class="controls">
    <form class="new-issue-form" id="newIssueForm">
      <input type="text" name="title" placeholder="Issue title" required>
      <select name="priority">
        <option value="normal">Normal</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="low">Low</option>
      </select>
      <select name="points">
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
        <option value="in_progress">In Progress</option>
        <option value="in_review">In Review</option>
        <option value="done">Done</option>
      </select>
      <button type="submit">Add Issue</button>
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
        <div class="column-title">Backlog <span class="column-stats" id="backlog-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="backlog-content"></div>
    </div>
    <div class="column todo" data-status="todo">
      <div class="column-header">
        <div class="column-title">Todo <span class="column-stats" id="todo-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="todo-content"></div>
    </div>
    <div class="column in_progress" data-status="in_progress">
      <div class="column-header">
        <div class="column-title">In Progress <span class="column-stats" id="in_progress-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="in_progress-content"></div>
    </div>
    <div class="column in_review" data-status="in_review">
      <div class="column-header">
        <div class="column-title">In Review <span class="column-stats" id="in_review-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="in_review-content"></div>
    </div>
    <div class="column done" data-status="done">
      <div class="column-header">
        <div class="column-title">Done <span class="column-stats" id="done-stats">0 issues, 0 pts</span></div>
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
      <form id="editIssueForm">
        <div class="form-group">
          <label>Title</label>
          <input type="text" name="title" required>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description"></textarea>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select name="status">
            <option value="backlog">Backlog</option>
            <option value="todo">Todo</option>
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div class="form-group">
          <label>Priority</label>
          <select name="priority">
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div class="form-group">
          <label>Points</label>
          <select name="points">
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
          <input type="text" name="assignee">
        </div>
        <div class="form-group">
          <label>Labels</label>
          <input type="text" name="labels" placeholder="Comma-separated">
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
    let currentSprintId = null;
    let editingIssueId = null;
    let filters = { search: '', assignee: '', label: '' };
    
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
      
      const currentSprint = sprints.find(s => s.is_current);
      if (currentSprint) {
        currentSprintId = currentSprint.id;
        select.value = currentSprint.id;
      }
      
      sprints.forEach(sprint => {
        const option = document.createElement('option');
        option.value = sprint.id;
        option.textContent = sprint.name;
        if (sprint.is_current) option.selected = true;
        select.appendChild(option);
      });
    }
    
    function populateFilters() {
      const assignees = [...new Set(issues.map(i => i.assignee).filter(Boolean))];
      const labels = [...new Set(issues.flatMap(i => i.labels ? i.labels.split(',').map(l => l.trim()) : []))];
      
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
      const sprintId = document.getElementById('sprintSelect').value;
      
      return issues.filter(issue => {
        // Sprint filter
        if (sprintId === '') {
          if (issue.sprint_id !== null) return false;
        } else {
          if (issue.sprint_id != sprintId) return false;
        }
        
        // Search filter
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          if (!issue.title.toLowerCase().includes(searchLower) && 
              !issue.description.toLowerCase().includes(searchLower)) {
            return false;
          }
        }
        
        // Assignee filter
        if (filters.assignee && issue.assignee !== filters.assignee) {
          return false;
        }
        
        // Label filter
        if (filters.label) {
          const issueLabels = issue.labels ? issue.labels.split(',').map(l => l.trim()) : [];
          if (!issueLabels.includes(filters.label)) {
            return false;
          }
        }
        
        return true;
      });
    }
    
    function renderBoard() {
      const filteredIssues = getFilteredIssues();
      const columns = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
      
      columns.forEach(status => {
        const content = document.getElementById(status + '-content');
        const statusIssues = filteredIssues.filter(issue => issue.status === status);
        
        content.innerHTML = '';
        statusIssues.forEach(issue => {
          const card = createIssueCard(issue);
          content.appendChild(card);
        });
        
        // Update column stats
        const count = statusIssues.length;
        const points = statusIssues.reduce((sum, issue) => sum + (issue.points || 0), 0);
        document.getElementById(status + '-stats').textContent = count + ' issues, ' + points + ' pts';
      });
    }
    
    function createIssueCard(issue) {
      const card = document.createElement('div');
      card.className = 'card' + (issue.status === 'done' ? ' done' : '');
      card.onclick = () => openIssueModal(issue);
      
      const priorityClass = 'priority-' + issue.priority;
      const priorityText = issue.priority.charAt(0).toUpperCase() + issue.priority.slice(1);
      
      const labels = issue.labels ? issue.labels.split(',').map(l => l.trim()).filter(Boolean) : [];
      const labelsHtml = labels.map(label => '<span class="label">' + escapeHtml(label) + '</span>').join('');
      
      card.innerHTML = 
        '<div class="card-title">' + escapeHtml(issue.title) + '</div>' +
        '<div class="card-meta">' +
          '<span class="priority-badge ' + priorityClass + '">' + priorityText + '</span>' +
          (issue.points ? '<span class="points">' + issue.points + ' pts</span>' : '') +
          (issue.assignee ? '<span class="assignee">' + escapeHtml(issue.assignee) + '</span>' : '') +
          labelsHtml +
        '</div>' +
        '<div class="card-controls">' +
          (issue.status !== 'backlog' ? '<button onclick="moveIssue(event, ' + issue.id + ', \'backward\')">←</button>' : '') +
          (issue.status !== 'done' ? '<button onclick="moveIssue(event, ' + issue.id + ', \'forward\')">→</button>' : '') +
        '</div>';
      
      return card;
    }
    
    async function moveIssue(event, issueId, direction) {
      event.stopPropagation();
      
      const issue = issues.find(i => i.id === issueId);
      const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
      const currentIndex = statuses.indexOf(issue.status);
      
      let newIndex;
      if (direction === 'forward' && currentIndex < statuses.length - 1) {
        newIndex = currentIndex + 1;
      } else if (direction === 'backward' && currentIndex > 0) {
        newIndex = currentIndex - 1;
      } else {
        return;
      }
      
      const newStatus = statuses[newIndex];
      
      try {
        const response = await fetch('/issues/' + issueId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        
        if (response.ok) {
          const updatedIssue = await response.json();
          const index = issues.findIndex(i => i.id === issueId);
          issues[index] = updatedIssue;
          renderBoard();
          updateStats();
        }
      } catch (error) {
        console.error('Failed to move issue:', error);
      }
    }
    
    function openIssueModal(issue) {
      editingIssueId = issue.id;
      const form = document.getElementById('editIssueForm');
      
      form.title.value = issue.title;
      form.description.value = issue.description || '';
      form.status.value = issue.status;
      form.priority.value = issue.priority;
      form.points.value = issue.points || '';
      form.assignee.value = issue.assignee || '';
      form.labels.value = issue.labels || '';
      
      document.getElementById('issueModal').classList.add('show');
    }
    
    function closeModal() {
      document.getElementById('issueModal').classList.remove('show');
      editingIssueId = null;
    }
    
    async function deleteIssue() {
      if (!editingIssueId || !confirm('Delete this issue?')) return;
      
      try {
        const response = await fetch('/issues/' + editingIssueId, { method: 'DELETE' });
        if (response.ok) {
          issues = issues.filter(i => i.id !== editingIssueId);
          closeModal();
          renderBoard();
          updateStats();
        }
      } catch (error) {
        console.error('Failed to delete issue:', error);
      }
    }
    
    function updateStats() {
      const filteredIssues = getFilteredIssues();
      const totalIssues = filteredIssues.length;
      const totalPoints = filteredIssues.reduce((sum, issue) => sum + (issue.points || 0), 0);
      const completedPoints = filteredIssues.filter(i => i.status === 'done').reduce((sum, issue) => sum + (issue.points || 0), 0);
      const percentComplete = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
      
      document.getElementById('totalIssues').textContent = totalIssues;
      document.getElementById('totalPoints').textContent = totalPoints;
      document.getElementById('completedPoints').textContent = completedPoints;
      document.getElementById('percentComplete').textContent = percentComplete;
      document.getElementById('progressFill').style.width = percentComplete + '%';
      
      // Check capacity warning
      const sprintId = document.getElementById('sprintSelect').value;
      if (sprintId) {
        const sprint = sprints.find(s => s.id == sprintId);
        if (sprint && sprint.capacity && totalPoints > sprint.capacity) {
          document.getElementById('capacityWarning').style.display = 'block';
        } else {
          document.getElementById('capacityWarning').style.display = 'none';
        }
      } else {
        document.getElementById('capacityWarning').style.display = 'none';
      }
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    // Event listeners
    document.getElementById('sprintSelect').addEventListener('change', () => {
      renderBoard();
      updateStats();
    });
    
    document.getElementById('searchInput').addEventListener('input', (e) => {
      filters.search = e.target.value;
      renderBoard();
    });
    
    document.getElementById('assigneeFilter').addEventListener('change', (e) => {
      filters.assignee = e.target.value;
      renderBoard();
    });
    
    document.getElementById('labelFilter').addEventListener('change', (e) => {
      filters.label = e.target.value;
      renderBoard();
    });
    
    document.getElementById('newIssueForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      
      const issueData = {
        title: formData.get('title'),
        priority: formData.get('priority'),
        status: formData.get('status'),
        assignee: formData.get('assignee') || null,
        labels: formData.get('labels') || '',
        sprint_id: document.getElementById('sprintSelect').value || null
      };
      
      if (formData.get('points')) {
        issueData.points = parseInt(formData.get('points'));
      }
      
      try {
        const response = await fetch('/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(issueData)
        });
        
        if (response.ok) {
          const newIssue = await response.json();
          issues.push(newIssue);
          e.target.reset();
          populateFilters();
          renderBoard();
          updateStats();
        }
      } catch (error) {
        console.error('Failed to create issue:', error);
      }
    });
    
    document.getElementById('editIssueForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editingIssueId) return;
      
      const formData = new FormData(e.target);
      const issueData = {
        title: formData.get('title'),
        description: formData.get('description'),
        status: formData.get('status'),
        priority: formData.get('priority'),
        assignee: formData.get('assignee') || null,
        labels: formData.get('labels') || ''
      };
      
      if (formData.get('points')) {
        issueData.points = parseInt(formData.get('points'));
      }
      
      try {
        const response = await fetch('/issues/' + editingIssueId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(issueData)
        });
        
        if (response.ok) {
          const updatedIssue = await response.json();
          const index = issues.findIndex(i => i.id === editingIssueId);
          issues[index] = updatedIssue;
          closeModal();
          populateFilters();
          renderBoard();
          updateStats();
        }
      } catch (error) {
        console.error('Failed to update issue:', error);
      }
    });
    
    // Close modal when clicking outside
    document.getElementById('issueModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
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
