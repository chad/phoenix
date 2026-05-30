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
  <title>Trail - Issue Tracker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; }
    
    .top-bar { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; display: flex; align-items: center; gap: 2rem; flex-wrap: wrap; }
    .top-bar h1 { font-size: 1.5rem; font-weight: 600; }
    .sprint-selector select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .stats { display: flex; gap: 1rem; align-items: center; font-size: 0.875rem; }
    .progress-bar { width: 100px; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #28a745; transition: width 0.3s; }
    .warning { color: #dc3545; font-weight: 500; }
    
    .controls { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; }
    .new-issue-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .new-issue-form input, .new-issue-form select, .new-issue-form textarea { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .new-issue-form input[type="text"] { flex: 1; min-width: 200px; }
    .new-issue-form textarea { width: 100%; min-height: 60px; resize: vertical; }
    .new-issue-form button { padding: 0.5rem 1rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .new-issue-form button:hover { background: #0056b3; }
    
    .filters { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .filters input, .filters select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    
    .board { display: flex; gap: 1rem; padding: 1rem; overflow-x: auto; min-height: calc(100vh - 200px); }
    .column { flex: 1; min-width: 280px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .column-header { padding: 1rem; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center; }
    .column-title { font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
    .column-stats { font-size: 0.875rem; color: #6c757d; }
    .column-content { padding: 1rem; min-height: 200px; }
    
    .column.backlog .column-title::before { content: ''; width: 4px; height: 20px; background: #6c757d; border-radius: 2px; }
    .column.todo .column-title::before { content: ''; width: 4px; height: 20px; background: #007bff; border-radius: 2px; }
    .column.inprogress .column-title::before { content: ''; width: 4px; height: 20px; background: #ffc107; border-radius: 2px; }
    .column.inreview .column-title::before { content: ''; width: 4px; height: 20px; background: #6f42c1; border-radius: 2px; }
    .column.done .column-title::before { content: ''; width: 4px; height: 20px; background: #28a745; border-radius: 2px; }
    
    .card { background: white; border: 1px solid #dee2e6; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.75rem; cursor: pointer; transition: box-shadow 0.2s; }
    .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .card.done { opacity: 0.7; }
    .card.done::after { content: '✓'; position: absolute; top: 0.5rem; right: 0.5rem; color: #28a745; font-weight: bold; }
    .card { position: relative; }
    
    .card-title { font-weight: 500; margin-bottom: 0.5rem; line-height: 1.3; }
    .card-meta { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; font-size: 0.875rem; }
    .priority-badge { padding: 0.125rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
    .priority-urgent { background: #dc3545; color: white; }
    .priority-high { background: #fd7e14; color: white; }
    .priority-normal { background: #007bff; color: white; }
    .priority-low { background: #6c757d; color: white; }
    .points { background: #e9ecef; padding: 0.125rem 0.375rem; border-radius: 4px; font-weight: 500; }
    .assignee { color: #6c757d; }
    .labels { display: flex; gap: 0.25rem; flex-wrap: wrap; }
    .label { background: #f8f9fa; border: 1px solid #dee2e6; padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.75rem; }
    
    .card-controls { margin-top: 0.5rem; display: flex; gap: 0.25rem; }
    .card-controls button { padding: 0.25rem 0.5rem; font-size: 0.75rem; border: 1px solid #ced4da; background: white; border-radius: 4px; cursor: pointer; }
    .card-controls button:hover { background: #f8f9fa; }
    .card-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
    .modal.show { display: flex; align-items: center; justify-content: center; }
    .modal-content { background: white; border-radius: 8px; padding: 2rem; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .modal-title { font-size: 1.25rem; font-weight: 600; }
    .close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .form-group textarea { min-height: 100px; resize: vertical; }
    .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem; }
    .btn { padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; }
    .btn-primary { background: #007bff; color: white; }
    .btn-primary:hover { background: #0056b3; }
    .btn-danger { background: #dc3545; color: white; }
    .btn-danger:hover { background: #c82333; }
    .btn-secondary { background: #6c757d; color: white; }
    .btn-secondary:hover { background: #545b62; }
    
    @media (max-width: 768px) {
      .board { flex-direction: column; }
      .column { min-width: auto; }
      .top-bar { flex-direction: column; align-items: stretch; gap: 1rem; }
      .stats { justify-content: space-between; }
      .new-issue-form { flex-direction: column; }
      .filters { flex-direction: column; align-items: stretch; }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <h1>Trail</h1>
    <div class="sprint-selector">
      <select id="sprintSelect">
        <option value="">Backlog</option>
      </select>
    </div>
    <div class="stats">
      <span id="totalIssues">0 issues</span>
      <span id="totalPoints">0 points</span>
      <span id="completedPoints">0 completed</span>
      <div class="progress-bar">
        <div class="progress-fill" id="progressFill" style="width: 0%"></div>
      </div>
      <span id="percentComplete">0%</span>
      <span id="capacityWarning" class="warning" style="display: none;">Over capacity!</span>
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
      <select id="newStatus">
        <option value="backlog">Backlog</option>
        <option value="todo">Todo</option>
        <option value="inprogress">In Progress</option>
        <option value="inreview">In Review</option>
        <option value="done">Done</option>
      </select>
      <input type="text" id="newAssignee" placeholder="Assignee">
      <input type="text" id="newLabels" placeholder="Labels (comma-separated)">
      <textarea id="newDescription" placeholder="Description"></textarea>
      <button type="submit">Add Issue</button>
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
  
  <div class="board" id="board">
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
    
    <div class="column inprogress" data-status="inprogress">
      <div class="column-header">
        <div class="column-title">In Progress</div>
        <div class="column-stats" id="inprogress-stats">0 issues, 0 pts</div>
      </div>
      <div class="column-content" id="inprogress-content"></div>
    </div>
    
    <div class="column inreview" data-status="inreview">
      <div class="column-header">
        <div class="column-title">In Review</div>
        <div class="column-stats" id="inreview-stats">0 issues, 0 pts</div>
      </div>
      <div class="column-content" id="inreview-content"></div>
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
        <button class="close-btn" id="closeModal">&times;</button>
      </div>
      <form id="editIssueForm">
        <div class="form-group">
          <label for="editTitle">Title</label>
          <input type="text" id="editTitle" required>
        </div>
        <div class="form-group">
          <label for="editDescription">Description</label>
          <textarea id="editDescription"></textarea>
        </div>
        <div class="form-group">
          <label for="editStatus">Status</label>
          <select id="editStatus">
            <option value="backlog">Backlog</option>
            <option value="todo">Todo</option>
            <option value="inprogress">In Progress</option>
            <option value="inreview">In Review</option>
            <option value="done">Done</option>
          </select>
        </div>
        <div class="form-group">
          <label for="editPriority">Priority</label>
          <select id="editPriority">
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div class="form-group">
          <label for="editPoints">Point Estimate</label>
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
          <label for="editAssignee">Assignee</label>
          <input type="text" id="editAssignee">
        </div>
        <div class="form-group">
          <label for="editLabels">Labels</label>
          <input type="text" id="editLabels" placeholder="Comma-separated">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-danger" id="deleteIssue">Delete</button>
          <button type="button" class="btn btn-secondary" id="cancelEdit">Cancel</button>
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
    
    const statusOrder = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
    
    async function loadSprints() {
      try {
        const response = await fetch('/sprints');
        sprints = await response.json();
        
        const sprintSelect = document.getElementById('sprintSelect');
        sprintSelect.innerHTML = '<option value="">Backlog</option>';
        
        sprints.forEach(sprint => {
          const option = document.createElement('option');
          option.value = sprint.id;
          option.textContent = sprint.name;
          if (sprint.is_current) {
            option.selected = true;
            currentSprintId = sprint.id;
          }
          sprintSelect.appendChild(option);
        });
      } catch (error) {
        console.error('Failed to load sprints:', error);
      }
    }
    
    async function loadIssues() {
      try {
        const response = await fetch('/issues');
        issues = await response.json();
        renderBoard();
        updateStats();
        updateFilters();
      } catch (error) {
        console.error('Failed to load issues:', error);
      }
    }
    
    function getFilteredIssues() {
      const selectedSprintId = document.getElementById('sprintSelect').value;
      const searchTerm = document.getElementById('searchBox').value.toLowerCase();
      const assigneeFilter = document.getElementById('assigneeFilter').value;
      const labelFilter = document.getElementById('labelFilter').value;
      
      return issues.filter(issue => {
        // Sprint filter
        if (selectedSprintId === '') {
          if (issue.sprint_id !== null) return false;
        } else {
          if (issue.sprint_id !== parseInt(selectedSprintId)) return false;
        }
        
        // Search filter
        if (searchTerm && !issue.title.toLowerCase().includes(searchTerm) && 
            !(issue.description && issue.description.toLowerCase().includes(searchTerm))) {
          return false;
        }
        
        // Assignee filter
        if (assigneeFilter && issue.assignee !== assigneeFilter) return false;
        
        // Label filter
        if (labelFilter && (!issue.labels || !issue.labels.includes(labelFilter))) return false;
        
        return true;
      });
    }
    
    function renderBoard() {
      const filteredIssues = getFilteredIssues();
      
      statusOrder.forEach(status => {
        const content = document.getElementById(status + '-content');
        const statusIssues = filteredIssues.filter(issue => issue.status === status);
        
        content.innerHTML = '';
        statusIssues.forEach(issue => {
          const card = createIssueCard(issue);
          content.appendChild(card);
        });
        
        // Update column stats
        const points = statusIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
        document.getElementById(status + '-stats').textContent = statusIssues.length + ' issues, ' + points + ' pts';
      });
    }
    
    function createIssueCard(issue) {
      const card = document.createElement('div');
      card.className = 'card' + (issue.status === 'done' ? ' done' : '');
      card.dataset.id = issue.id;
      
      const priorityClass = 'priority-' + issue.priority;
      const pointsHtml = issue.point_estimate ? '<span class="points">' + issue.point_estimate + '</span>' : '';
      const assigneeHtml = issue.assignee ? '<span class="assignee">' + issue.assignee + '</span>' : '';
      const labelsHtml = issue.labels && issue.labels.length > 0 ? 
        '<div class="labels">' + issue.labels.map(label => '<span class="label">' + label + '</span>').join('') + '</div>' : '';
      
      card.innerHTML = 
        '<div class="card-title">' + issue.title + '</div>' +
        '<div class="card-meta">' +
          '<span class="priority-badge ' + priorityClass + '">' + issue.priority + '</span>' +
          pointsHtml + assigneeHtml +
        '</div>' +
        labelsHtml +
        '<div class="card-controls">' +
          '<button data-action="prev" ' + (statusOrder.indexOf(issue.status) === 0 ? 'disabled' : '') + '>←</button>' +
          '<button data-action="next" ' + (statusOrder.indexOf(issue.status) === statusOrder.length - 1 ? 'disabled' : '') + '>→</button>' +
        '</div>';
      
      return card;
    }
    
    function updateStats() {
      const filteredIssues = getFilteredIssues();
      const totalIssues = filteredIssues.length;
      const totalPoints = filteredIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
      const completedPoints = filteredIssues.filter(issue => issue.status === 'done')
        .reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
      const percentComplete = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
      
      document.getElementById('totalIssues').textContent = totalIssues + ' issues';
      document.getElementById('totalPoints').textContent = totalPoints + ' points';
      document.getElementById('completedPoints').textContent = completedPoints + ' completed';
      document.getElementById('progressFill').style.width = percentComplete + '%';
      document.getElementById('percentComplete').textContent = percentComplete + '%';
      
      // Check capacity warning
      const selectedSprintId = document.getElementById('sprintSelect').value;
      const sprint = sprints.find(s => s.id === parseInt(selectedSprintId));
      const warningEl = document.getElementById('capacityWarning');
      if (sprint && sprint.capacity && totalPoints > sprint.capacity) {
        warningEl.style.display = 'inline';
      } else {
        warningEl.style.display = 'none';
      }
    }
    
    function updateFilters() {
      const assignees = [...new Set(issues.map(issue => issue.assignee).filter(Boolean))];
      const labels = [...new Set(issues.flatMap(issue => issue.labels || []))];
      
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
    
    async function createIssue(issueData) {
      try {
        const response = await fetch('/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(issueData)
        });
        
        if (response.ok) {
          await loadIssues();
        } else {
          const error = await response.json();
          alert('Error creating issue: ' + error.error);
        }
      } catch (error) {
        console.error('Failed to create issue:', error);
        alert('Failed to create issue');
      }
    }
    
    async function updateIssue(id, updates) {
      try {
        const response = await fetch('/issues/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
        
        if (response.ok) {
          await loadIssues();
        } else {
          const error = await response.json();
          alert('Error updating issue: ' + error.error);
        }
      } catch (error) {
        console.error('Failed to update issue:', error);
        alert('Failed to update issue');
      }
    }
    
    async function deleteIssue(id) {
      try {
        const response = await fetch('/issues/' + id, { method: 'DELETE' });
        
        if (response.ok) {
          await loadIssues();
          closeModal();
        } else {
          const error = await response.json();
          alert('Error deleting issue: ' + error.error);
        }
      } catch (error) {
        console.error('Failed to delete issue:', error);
        alert('Failed to delete issue');
      }
    }
    
    function openIssueModal(issueId) {
      const issue = issues.find(i => i.id === issueId);
      if (!issue) return;
      
      editingIssueId = issueId;
      
      document.getElementById('editTitle').value = issue.title;
      document.getElementById('editDescription').value = issue.description || '';
      document.getElementById('editStatus').value = issue.status;
      document.getElementById('editPriority').value = issue.priority;
      document.getElementById('editPoints').value = issue.point_estimate || '';
      document.getElementById('editAssignee').value = issue.assignee || '';
      document.getElementById('editLabels').value = issue.labels ? issue.labels.join(', ') : '';
      
      document.getElementById('issueModal').classList.add('show');
    }
    
    function closeModal() {
      document.getElementById('issueModal').classList.remove('show');
      editingIssueId = null;
    }
    
    // Event listeners
    document.getElementById('newIssueForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const selectedSprintId = document.getElementById('sprintSelect').value;
      const labels = document.getElementById('newLabels').value.split(',').map(l => l.trim()).filter(Boolean);
      
      const issueData = {
        title: document.getElementById('newTitle').value,
        description: document.getElementById('newDescription').value || undefined,
        status: document.getElementById('newStatus').value,
        priority: document.getElementById('newPriority').value,
        point_estimate: document.getElementById('newPoints').value ? parseInt(document.getElementById('newPoints').value) : undefined,
        assignee: document.getElementById('newAssignee').value || undefined,
        labels: labels.length > 0 ? labels : undefined,
        sprint_id: selectedSprintId ? parseInt(selectedSprintId) : undefined
      };
      
      await createIssue(issueData);
      e.target.reset();
    });
    
    document.getElementById('editIssueForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const labels = document.getElementById('editLabels').value.split(',').map(l => l.trim()).filter(Boolean);
      
      const updates = {
        title: document.getElementById('editTitle').value,
        description: document.getElementById('editDescription').value || null,
        status: document.getElementById('editStatus').value,
        priority: document.getElementById('editPriority').value,
        point_estimate: document.getElementById('editPoints').value ? parseInt(document.getElementById('editPoints').value) : null,
        assignee: document.getElementById('editAssignee').value || null,
        labels: labels.length > 0 ? labels : null
      };
      
      await updateIssue(editingIssueId, updates);
      closeModal();
    });
    
    document.getElementById('board').addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      
      const issueId = parseInt(card.dataset.id);
      
      if (e.target.dataset.action === 'prev' || e.target.dataset.action === 'next') {
        e.stopPropagation();
        const issue = issues.find(i => i.id === issueId);
        const currentIndex = statusOrder.indexOf(issue.status);
        const newIndex = e.target.dataset.action === 'prev' ? currentIndex - 1 : currentIndex + 1;
        
        if (newIndex >= 0 && newIndex < statusOrder.length) {
          updateIssue(issueId, { status: statusOrder[newIndex] });
        }
      } else {
        openIssueModal(issueId);
      }
    });
    
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelEdit').addEventListener('click', closeModal);
    document.getElementById('deleteIssue').addEventListener('click', () => {
      if (confirm('Are you sure you want to delete this issue?')) {
        deleteIssue(editingIssueId);
      }
    });
    
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
    
    // Close modal when clicking outside
    document.getElementById('issueModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        closeModal();
      }
    });
    
    // Initialize
    loadSprints().then(() => loadIssues());
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
