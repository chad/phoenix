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
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; } /*phx:R3*/
    
    .top-bar { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; display: flex; align-items: center; gap: 2rem; flex-wrap: wrap; }
    .top-bar h1 { font-size: 1.5rem; font-weight: 600; }
    .sprint-selector select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.375rem; }
    .stats { display: flex; gap: 1rem; align-items: center; font-size: 0.875rem; }
    .progress-bar { width: 100px; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #28a745; transition: width 0.3s; }
    
    .controls { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; }
    .new-issue-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .new-issue-form input, .new-issue-form select, .new-issue-form button { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.375rem; }
    .new-issue-form input[type="text"] { flex: 1; min-width: 200px; }
    .new-issue-form button { background: #007bff; color: white; border-color: #007bff; cursor: pointer; }
    .new-issue-form button:hover { background: #0056b3; }
    
    .filters { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .filters input, .filters select { padding: 0.375rem; border: 1px solid #ced4da; border-radius: 0.375rem; }
    
    .board { display: flex; gap: 1rem; padding: 1rem; overflow-x: auto; min-height: calc(100vh - 200px); } /*phx:I1*/
    .column { flex: 1; min-width: 280px; background: white; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .column-header { padding: 1rem; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center; }
    .column-title { font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
    .column-stats { font-size: 0.875rem; color: #6c757d; }
    
    .column.backlog .column-header { background: #f8f9fa; } /*phx:R3*/
    .column.todo .column-header { background: #e3f2fd; } /*phx:R3*/
    .column.in-progress .column-header { background: #fff3e0; } /*phx:R3*/
    .column.in-review .column-header { background: #f3e5f5; } /*phx:R3*/
    .column.done .column-header { background: #e8f5e8; } /*phx:R3*/
    
    .cards { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .card { background: white; border: 1px solid #dee2e6; border-radius: 0.375rem; padding: 0.75rem; cursor: pointer; transition: box-shadow 0.2s; }
    .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .card.done { opacity: 0.7; } /*phx:R3*/
    .card.done::before { content: "✓ "; color: #28a745; font-weight: bold; } /*phx:R3*/
    
    .card-title { font-weight: 500; margin-bottom: 0.5rem; }
    .card-meta { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; font-size: 0.75rem; }
    .priority-badge { padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-weight: 500; }
    .priority-urgent { background: #dc3545; color: white; }
    .priority-high { background: #fd7e14; color: white; }
    .priority-normal { background: #007bff; color: white; }
    .priority-low { background: #6c757d; color: white; }
    .points { background: #e9ecef; padding: 0.125rem 0.375rem; border-radius: 0.25rem; }
    .assignee { background: #f8f9fa; padding: 0.125rem 0.375rem; border-radius: 0.25rem; }
    .label { background: #6f42c1; color: white; padding: 0.125rem 0.375rem; border-radius: 0.25rem; }
    
    .card-controls { margin-top: 0.5rem; display: flex; gap: 0.25rem; }
    .card-controls button { padding: 0.25rem 0.5rem; border: 1px solid #ced4da; background: white; border-radius: 0.25rem; cursor: pointer; font-size: 0.75rem; }
    .card-controls button:hover { background: #f8f9fa; }
    
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
    .modal.show { display: flex; align-items: center; justify-content: center; }
    .modal-content { background: white; border-radius: 0.5rem; padding: 2rem; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .modal-title { font-size: 1.25rem; font-weight: 600; }
    .close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; }
    
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; }
    .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.375rem; }
    .form-group textarea { min-height: 100px; resize: vertical; }
    
    .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem; }
    .modal-actions button { padding: 0.5rem 1rem; border: 1px solid #ced4da; border-radius: 0.375rem; cursor: pointer; }
    .btn-primary { background: #007bff; color: white; border-color: #007bff; }
    .btn-danger { background: #dc3545; color: white; border-color: #dc3545; }
    .btn-secondary { background: #6c757d; color: white; border-color: #6c757d; }
    
    @media (max-width: 768px) {
      .board { flex-direction: column; }
      .column { min-width: auto; }
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
      <span id="capacityWarning" style="color: #dc3545; display: none;">Over capacity!</span>
    </div>
  </div>
  
  <div class="controls">
    <form class="new-issue-form" id="newIssueForm">
      <input type="text" id="newTitle" placeholder="Issue title" required>
      <select id="newPriority">
        <option value="normal">Normal</option>
        <option value="low">Low</option>
        <option value="high">High</option>
        <option value="urgent">Urgent</option>
      </select>
      <input type="number" id="newPoints" placeholder="Points" min="1">
      <input type="text" id="newAssignee" placeholder="Assignee">
      <select id="newStatus">
        <option value="backlog">Backlog</option>
        <option value="todo">Todo</option>
        <option value="in_progress">In Progress</option>
        <option value="in_review">In Review</option>
        <option value="done">Done</option>
      </select>
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
  
  <div class="board" id="board"> /*phx:R1*/
    <div class="column backlog" data-status="backlog">
      <div class="column-header">
        <div class="column-title">Backlog <span class="column-stats" id="backlog-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="cards" id="backlog-cards"></div>
    </div>
    
    <div class="column todo" data-status="todo">
      <div class="column-header">
        <div class="column-title">Todo <span class="column-stats" id="todo-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="cards" id="todo-cards"></div>
    </div>
    
    <div class="column in-progress" data-status="in_progress">
      <div class="column-header">
        <div class="column-title">In Progress <span class="column-stats" id="in_progress-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="cards" id="in_progress-cards"></div>
    </div>
    
    <div class="column in-review" data-status="in_review">
      <div class="column-header">
        <div class="column-title">In Review <span class="column-stats" id="in_review-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="cards" id="in_review-cards"></div>
    </div>
    
    <div class="column done" data-status="done">
      <div class="column-header">
        <div class="column-title">Done <span class="column-stats" id="done-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="cards" id="done-cards"></div>
    </div>
  </div>
  
  <div class="modal" id="issueModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Edit Issue</h2>
        <button class="close-btn" onclick="closeModal()">&times;</button>
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
            <option value="in_progress">In Progress</option>
            <option value="in_review">In Review</option>
            <option value="done">Done</option>
          </select>
        </div>
        
        <div class="form-group">
          <label for="editPriority">Priority</label>
          <select id="editPriority">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        
        <div class="form-group">
          <label for="editPoints">Points</label>
          <input type="number" id="editPoints" min="1">
        </div>
        
        <div class="form-group">
          <label for="editAssignee">Assignee</label>
          <input type="text" id="editAssignee">
        </div>
        
        <div class="form-group">
          <label for="editLabels">Labels (comma-separated)</label>
          <input type="text" id="editLabels">
        </div>
        
        <div class="form-group">
          <label for="editSprint">Sprint</label>
          <select id="editSprint">
            <option value="">No sprint</option>
          </select>
        </div>
        
        <div class="modal-actions">
          <button type="button" class="btn-danger" onclick="deleteIssue()">Delete</button>
          <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn-primary">Save</button>
        </div>
      </form>
    </div>
  </div>
  
  <script>
    let currentIssue = null;
    let issues = [];
    let sprints = [];
    let currentSprintId = null;
    
    async function loadData() { /*phx:R1*/
      try {
        const [issuesRes, sprintsRes] = await Promise.all([
          fetch('/issues'),
          fetch('/sprints')
        ]);
        issues = await issuesRes.json();
        sprints = await sprintsRes.json();
        
        updateSprintSelector();
        renderBoard();
        updateStats();
        updateFilters();
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    }
    
    function updateSprintSelector() {
      const select = document.getElementById('sprintSelect');
      const editSelect = document.getElementById('editSprint');
      
      select.innerHTML = '<option value="">Backlog</option>';
      editSelect.innerHTML = '<option value="">No sprint</option>';
      
      sprints.forEach(sprint => {
        const option = new Option(sprint.name, sprint.id);
        const editOption = new Option(sprint.name, sprint.id);
        select.appendChild(option);
        editSelect.appendChild(editOption);
        
        if (sprint.is_current) {
          currentSprintId = sprint.id;
          select.value = sprint.id;
        }
      });
    }
    
    function getFilteredIssues() {
      const selectedSprint = document.getElementById('sprintSelect').value;
      const searchTerm = document.getElementById('searchBox').value.toLowerCase();
      const assigneeFilter = document.getElementById('assigneeFilter').value;
      const labelFilter = document.getElementById('labelFilter').value;
      
      return issues.filter(issue => {
        // Sprint filter
        if (selectedSprint === '') {
          if (issue.sprint_id !== null) return false;
        } else {
          if (issue.sprint_id != selectedSprint) return false;
        }
        
        // Search filter
        if (searchTerm && !issue.title.toLowerCase().includes(searchTerm) && 
            !(issue.description || '').toLowerCase().includes(searchTerm)) {
          return false;
        }
        
        // Assignee filter
        if (assigneeFilter && issue.assignee !== assigneeFilter) return false;
        
        // Label filter
        if (labelFilter && (!issue.labels || !issue.labels.includes(labelFilter))) return false;
        
        return true;
      });
    }
    
    function renderBoard() { /*phx:R4*/
      const filteredIssues = getFilteredIssues();
      const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
      
      statuses.forEach(status => {
        const container = document.getElementById(status + '-cards');
        const statusIssues = filteredIssues.filter(issue => issue.status === status);
        
        container.innerHTML = '';
        statusIssues.forEach(issue => {
          const card = createIssueCard(issue);
          container.appendChild(card);
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
      card.onclick = () => openIssueModal(issue); /*phx:R2*/
      
      const priorityClass = 'priority-' + issue.priority;
      const labelsHtml = (issue.labels || []).map(label => 
        '<span class="label">' + label + '</span>'
      ).join('');
      
      card.innerHTML = \`
        <div class="card-title">\${issue.title}</div>
        <div class="card-meta">
          <span class="priority-badge \${priorityClass}">\${issue.priority}</span>
          \${issue.points ? '<span class="points">' + issue.points + ' pts</span>' : ''}
          \${issue.assignee ? '<span class="assignee">' + issue.assignee + '</span>' : ''}
          \${labelsHtml}
        </div>
        <div class="card-controls">
          \${getCardControls(issue)}
        </div>
      \`;
      
      return card;
    }
    
    function getCardControls(issue) {
      const controls = [];
      
      if (issue.status === 'backlog') {
        controls.push('<button onclick="moveIssue(event, ' + issue.id + ', \\'todo\\')">→ Todo</button>');
      } else if (issue.status === 'todo') {
        controls.push('<button onclick="moveIssue(event, ' + issue.id + ', \\'backlog\\')">← Backlog</button>');
        controls.push('<button onclick="moveIssue(event, ' + issue.id + ', \\'in_progress\\')">→ In Progress</button>');
      } else if (issue.status === 'in_progress') {
        controls.push('<button onclick="moveIssue(event, ' + issue.id + ', \\'todo\\')">← Todo</button>');
        controls.push('<button onclick="moveIssue(event, ' + issue.id + ', \\'in_review\\')">→ In Review</button>');
      } else if (issue.status === 'in_review') {
        controls.push('<button onclick="moveIssue(event, ' + issue.id + ', \\'in_progress\\')">← In Progress</button>');
        controls.push('<button onclick="moveIssue(event, ' + issue.id + ', \\'done\\')">→ Done</button>');
      } else if (issue.status === 'done') {
        controls.push('<button onclick="moveIssue(event, ' + issue.id + ', \\'in_review\\')">← In Review</button>');
      }
      
      return controls.join('');
    }
    
    async function moveIssue(event, issueId, newStatus) { /*phx:R4*/
      event.stopPropagation();
      
      try {
        await fetch('/issues/' + issueId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        
        await loadData();
      } catch (error) {
        console.error('Failed to move issue:', error);
      }
    }
    
    function openIssueModal(issue) { /*phx:R2*/
      currentIssue = issue;
      
      document.getElementById('editTitle').value = issue.title;
      document.getElementById('editDescription').value = issue.description || '';
      document.getElementById('editStatus').value = issue.status;
      document.getElementById('editPriority').value = issue.priority;
      document.getElementById('editPoints').value = issue.points || '';
      document.getElementById('editAssignee').value = issue.assignee || '';
      document.getElementById('editLabels').value = (issue.labels || []).join(', ');
      document.getElementById('editSprint').value = issue.sprint_id || '';
      
      document.getElementById('issueModal').classList.add('show');
    }
    
    function closeModal() {
      document.getElementById('issueModal').classList.remove('show');
      currentIssue = null;
    }
    
    async function deleteIssue() { /*phx:R2*/
      if (!currentIssue || !confirm('Delete this issue?')) return;
      
      try {
        await fetch('/issues/' + currentIssue.id, { method: 'DELETE' });
        closeModal();
        await loadData();
      } catch (error) {
        console.error('Failed to delete issue:', error);
      }
    }
    
    function updateStats() {
      const filteredIssues = getFilteredIssues();
      const totalIssues = filteredIssues.length;
      const totalPoints = filteredIssues.reduce((sum, issue) => sum + (issue.points || 0), 0);
      const completedPoints = filteredIssues
        .filter(issue => issue.status === 'done')
        .reduce((sum, issue) => sum + (issue.points || 0), 0);
      const percentComplete = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
      
      document.getElementById('totalIssues').textContent = totalIssues + ' issues';
      document.getElementById('totalPoints').textContent = totalPoints + ' points';
      document.getElementById('completedPoints').textContent = completedPoints + ' completed';
      document.getElementById('percentComplete').textContent = percentComplete + '%';
      document.getElementById('progressFill').style.width = percentComplete + '%';
      
      // Check capacity warning
      const selectedSprint = document.getElementById('sprintSelect').value;
      const sprint = sprints.find(s => s.id == selectedSprint);
      const warning = document.getElementById('capacityWarning');
      
      if (sprint && totalPoints > sprint.capacity) {
        warning.style.display = 'inline';
      } else {
        warning.style.display = 'none';
      }
    }
    
    function updateFilters() {
      const assignees = [...new Set(issues.map(i => i.assignee).filter(Boolean))];
      const labels = [...new Set(issues.flatMap(i => i.labels || []))];
      
      const assigneeSelect = document.getElementById('assigneeFilter');
      const labelSelect = document.getElementById('labelFilter');
      
      assigneeSelect.innerHTML = '<option value="">All assignees</option>';
      labelSelect.innerHTML = '<option value="">All labels</option>';
      
      assignees.forEach(assignee => {
        assigneeSelect.appendChild(new Option(assignee, assignee));
      });
      
      labels.forEach(label => {
        labelSelect.appendChild(new Option(label, label));
      });
    }
    
    // Event listeners
    document.getElementById('sprintSelect').addEventListener('change', () => { /*phx:R4*/
      renderBoard();
      updateStats();
    });
    
    document.getElementById('searchBox').addEventListener('input', () => { /*phx:R4*/
      renderBoard();
      updateStats();
    });
    
    document.getElementById('assigneeFilter').addEventListener('change', () => { /*phx:R4*/
      renderBoard();
      updateStats();
    });
    
    document.getElementById('labelFilter').addEventListener('change', () => { /*phx:R4*/
      renderBoard();
      updateStats();
    });
    
    document.getElementById('newIssueForm').addEventListener('submit', async (e) => { /*phx:R4*/
      e.preventDefault();
      
      const formData = {
        title: document.getElementById('newTitle').value,
        priority: document.getElementById('newPriority').value,
        status: document.getElementById('newStatus').value,
        points: document.getElementById('newPoints').value ? parseInt(document.getElementById('newPoints').value) : null,
        assignee: document.getElementById('newAssignee').value || null,
        sprint_id: document.getElementById('sprintSelect').value || null
      };
      
      try {
        await fetch('/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        document.getElementById('newIssueForm').reset();
        await loadData();
      } catch (error) {
        console.error('Failed to create issue:', error);
      }
    });
    
    document.getElementById('editIssueForm').addEventListener('submit', async (e) => { /*phx:R2*/
      e.preventDefault();
      
      if (!currentIssue) return;
      
      const formData = {
        title: document.getElementById('editTitle').value,
        description: document.getElementById('editDescription').value || null,
        status: document.getElementById('editStatus').value,
        priority: document.getElementById('editPriority').value,
        points: document.getElementById('editPoints').value ? parseInt(document.getElementById('editPoints').value) : null,
        assignee: document.getElementById('editAssignee').value || null,
        labels: document.getElementById('editLabels').value.split(',').map(l => l.trim()).filter(Boolean),
        sprint_id: document.getElementById('editSprint').value || null
      };
      
      try {
        await fetch('/issues/' + currentIssue.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        closeModal();
        await loadData();
      } catch (error) {
        console.error('Failed to update issue:', error);
      }
    });
    
    // Close modal on outside click
    document.getElementById('issueModal').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal')) {
        closeModal();
      }
    });
    
    // Load initial data
    loadData(); /*phx:R1*/
  </script>
</body>
</html>`); /*phx:R1*/
});

/** @internal Phoenix VCS traceability — do not remove. */


/** @internal Phoenix VCS traceability — do not remove. */


/** @internal Phoenix VCS traceability — do not remove. */


export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '0835de860d33df09991a975e261c68d5848ed8840594606ec9ea20b91f95070d',
  name: 'Design',
  risk_tier: 'high',
  canon_ids: [5 as const],
} as const;
