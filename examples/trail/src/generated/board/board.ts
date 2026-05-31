import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

registerMigration('board', `
  CREATE TABLE IF NOT EXISTS board_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_sprint_id INTEGER REFERENCES sprint(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateBoardSchema = z.object({
  current_sprint_id: z.number().int().nullable().optional(),
});

const UpdateBoardSchema = z.object({
  current_sprint_id: z.number().int().nullable().optional(),
});

router.get('/', async (c) => {
  // Return the kanban board HTML interface
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trail - Issue Tracker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; }
    
    .top-bar { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; display: flex; align-items: center; gap: 2rem; flex-wrap: wrap; }
    .app-title { font-size: 1.5rem; font-weight: 600; color: #495057; }
    .sprint-selector { display: flex; align-items: center; gap: 0.5rem; }
    .sprint-selector select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.25rem; }
    .stats-summary { display: flex; align-items: center; gap: 1rem; margin-left: auto; }
    .stat { font-size: 0.875rem; }
    .progress-bar { width: 100px; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #28a745; transition: width 0.3s; }
    .over-capacity { color: #dc3545; font-weight: 600; }
    
    .controls { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; }
    .new-issue-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .new-issue-form input, .new-issue-form select, .new-issue-form textarea { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.25rem; }
    .new-issue-form input[name="title"] { flex: 1; min-width: 200px; }
    .new-issue-form textarea { width: 100%; min-height: 60px; resize: vertical; }
    .new-issue-form button { padding: 0.5rem 1rem; background: #007bff; color: white; border: none; border-radius: 0.25rem; cursor: pointer; }
    .new-issue-form button:hover { background: #0056b3; }
    
    .filters { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .filters input, .filters select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.25rem; }
    .filters input[type="search"] { min-width: 200px; }
    
    .board { display: flex; gap: 1rem; padding: 1rem; min-height: calc(100vh - 200px); overflow-x: auto; }
    .column { flex: 1; min-width: 280px; background: white; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .column-header { padding: 1rem; border-bottom: 1px solid #dee2e6; display: flex; justify-content: space-between; align-items: center; }
    .column-title { font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
    .column-stats { font-size: 0.875rem; color: #6c757d; }
    .column-content { padding: 1rem; min-height: 400px; }
    
    .column.backlog .column-header { background: #f8f9fa; }
    .column.todo .column-header { background: #e3f2fd; }
    .column.inprogress .column-header { background: #fff3e0; }
    .column.inreview .column-header { background: #f3e5f5; }
    .column.done .column-header { background: #e8f5e8; }
    
    .issue-card { background: white; border: 1px solid #dee2e6; border-radius: 0.25rem; padding: 0.75rem; margin-bottom: 0.75rem; cursor: pointer; transition: box-shadow 0.2s; }
    .issue-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .issue-card.done { opacity: 0.7; }
    .issue-card.done .issue-title::before { content: "✓ "; color: #28a745; }
    
    .issue-title { font-weight: 500; margin-bottom: 0.5rem; }
    .issue-meta { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .priority-badge { padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 500; }
    .priority-urgent { background: #dc3545; color: white; }
    .priority-high { background: #fd7e14; color: white; }
    .priority-normal { background: #007bff; color: white; }
    .priority-low { background: #6c757d; color: white; }
    .point-estimate { background: #e9ecef; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.75rem; }
    .assignee { background: #f8f9fa; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.75rem; }
    .label { background: #e3f2fd; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.75rem; }
    
    .issue-controls { display: flex; gap: 0.25rem; margin-top: 0.5rem; }
    .issue-controls button { padding: 0.25rem 0.5rem; border: 1px solid #ced4da; background: white; border-radius: 0.25rem; font-size: 0.75rem; cursor: pointer; }
    .issue-controls button:hover { background: #f8f9fa; }
    .issue-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .hidden { display: none; }
    
    @media (max-width: 768px) {
      .board { flex-direction: column; }
      .column { min-width: auto; }
      .top-bar, .controls { flex-direction: column; align-items: stretch; }
      .stats-summary { margin-left: 0; }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="app-title">Trail</div> <!--phx:R1-->
    <div class="sprint-selector">
      <label>Sprint:</label>
      <select id="sprintSelect">
        <option value="">Backlog</option>
      </select>
    </div>
    <div class="stats-summary">
      <div class="stat">Issues: <span id="totalIssues">0</span></div>
      <div class="stat">Points: <span id="completedPoints">0</span>/<span id="totalPoints">0</span></div>
      <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
      <div class="stat"><span id="completionPercent">0</span>%</div>
      <div class="stat over-capacity hidden" id="overCapacity">Over capacity by <span id="overCapacityBy">0</span></div>
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
      <button type="submit">Add Issue</button>
      <textarea name="description" placeholder="Description (optional)"></textarea>
    </form>
    
    <div class="filters">
      <input type="search" id="searchInput" placeholder="Search issues...">
      <select id="assigneeFilter">
        <option value="">All assignees</option>
      </select>
      <select id="labelFilter">
        <option value="">All labels</option>
      </select>
    </div>
  </div>
  
  <div class="board"> <!--phx:I1-->
    <div class="column backlog" data-status="backlog">
      <div class="column-header">
        <div class="column-title">Backlog</div>
        <div class="column-stats"><span class="issue-count">0</span> issues, <span class="point-sum">0</span> pts</div>
      </div>
      <div class="column-content"></div>
    </div>
    <div class="column todo" data-status="todo">
      <div class="column-header">
        <div class="column-title">Todo</div>
        <div class="column-stats"><span class="issue-count">0</span> issues, <span class="point-sum">0</span> pts</div>
      </div>
      <div class="column-content"></div>
    </div>
    <div class="column inprogress" data-status="inprogress">
      <div class="column-header">
        <div class="column-title">In Progress</div>
        <div class="column-stats"><span class="issue-count">0</span> issues, <span class="point-sum">0</span> pts</div>
      </div>
      <div class="column-content"></div>
    </div>
    <div class="column inreview" data-status="inreview">
      <div class="column-header">
        <div class="column-title">In Review</div>
        <div class="column-stats"><span class="issue-count">0</span> issues, <span class="point-sum">0</span> pts</div>
      </div>
      <div class="column-content"></div>
    </div>
    <div class="column done" data-status="done">
      <div class="column-header">
        <div class="column-title">Done</div>
        <div class="column-stats"><span class="issue-count">0</span> issues, <span class="point-sum">0</span> pts</div>
      </div>
      <div class="column-content"></div>
    </div>
  </div>

  <script>
    let currentSprintId = null;
    let allIssues = [];
    let allSprints = [];
    let currentRollup = null;
    
    const statusOrder = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
    
    async function loadData() {
      try {
        const [issuesRes, sprintsRes] = await Promise.all([
          fetch('/issue'),
          fetch('/sprint')
        ]);
        allIssues = await issuesRes.json();
        allSprints = await sprintsRes.json();
        
        populateSprintSelector();
        await loadRollup();
        renderBoard();
        updateStats();
        populateFilters();
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    }
    
    function populateSprintSelector() {
      const select = document.getElementById('sprintSelect');
      select.innerHTML = '<option value="">Backlog</option>';
      
      allSprints.forEach(sprint => {
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
    
    async function loadRollup() {
      if (!currentSprintId) {
        currentRollup = null;
        return;
      }
      
      try {
        const res = await fetch('/sprint-rollup/' + currentSprintId);
        if (res.ok) {
          currentRollup = await res.json();
        } else {
          currentRollup = null;
        }
      } catch (error) {
        console.error('Failed to load rollup:', error);
        currentRollup = null;
      }
    }
    
    function getFilteredIssues() {
      let filtered = allIssues;
      
      // Sprint filter
      if (currentSprintId) {
        filtered = filtered.filter(issue => issue.sprint_id === currentSprintId);
      } else {
        filtered = filtered.filter(issue => !issue.sprint_id);
      }
      
      // Search filter
      const searchTerm = document.getElementById('searchInput').value.toLowerCase();
      if (searchTerm) {
        filtered = filtered.filter(issue => 
          issue.title.toLowerCase().includes(searchTerm) ||
          (issue.description && issue.description.toLowerCase().includes(searchTerm))
        );
      }
      
      // Assignee filter
      const assigneeFilter = document.getElementById('assigneeFilter').value;
      if (assigneeFilter) {
        filtered = filtered.filter(issue => issue.assignee === assigneeFilter);
      }
      
      // Label filter
      const labelFilter = document.getElementById('labelFilter').value;
      if (labelFilter) {
        filtered = filtered.filter(issue => issue.labels && issue.labels.includes(labelFilter));
      }
      
      return filtered;
    }
    
    function renderBoard() {
      const filteredIssues = getFilteredIssues();
      
      // Clear all columns
      document.querySelectorAll('.column-content').forEach(content => {
        content.innerHTML = '';
      });
      
      // Group issues by status
      const issuesByStatus = {};
      statusOrder.forEach(status => {
        issuesByStatus[status] = filteredIssues.filter(issue => issue.status === status);
      });
      
      // Render issues in each column
      statusOrder.forEach(status => {
        const column = document.querySelector('[data-status="' + status + '"] .column-content');
        const issues = issuesByStatus[status];
        
        issues.forEach(issue => {
          const card = createIssueCard(issue);
          column.appendChild(card);
        });
        
        // Update column stats
        const issueCount = issues.length;
        const pointSum = issues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
        
        const columnHeader = document.querySelector('[data-status="' + status + '"] .column-header');
        columnHeader.querySelector('.issue-count').textContent = issueCount;
        columnHeader.querySelector('.point-sum').textContent = pointSum;
      });
    }
    
    function createIssueCard(issue) {
      const card = document.createElement('div');
      card.className = 'issue-card' + (issue.status === 'done' ? ' done' : '');
      card.dataset.id = issue.id;
      card.dataset.status = issue.status;
      
      const priorityClass = 'priority-' + issue.priority;
      const pointEstimate = issue.point_estimate ? '<span class="point-estimate">' + issue.point_estimate + '</span>' : '';
      const assignee = issue.assignee ? '<span class="assignee">' + issue.assignee + '</span>' : '';
      const labels = issue.labels ? issue.labels.map(label => '<span class="label">' + label + '</span>').join('') : '';
      
      const currentStatusIndex = statusOrder.indexOf(issue.status);
      const canMoveBack = currentStatusIndex > 0;
      const canMoveForward = currentStatusIndex < statusOrder.length - 1;
      
      card.innerHTML = 
        '<div class="issue-title">' + issue.title + '</div>' +
        '<div class="issue-meta">' +
          '<span class="priority-badge ' + priorityClass + '">' + issue.priority + '</span>' +
          pointEstimate +
          assignee +
          labels +
        '</div>' +
        '<div class="issue-controls">' +
          '<button ' + (!canMoveBack ? 'disabled' : '') + ' data-action="move-back">← Back</button>' +
          '<button ' + (!canMoveForward ? 'disabled' : '') + ' data-action="move-forward">Forward →</button>' +
          '<button data-action="edit">Edit</button>' +
          '<button data-action="delete">Delete</button>' +
        '</div>';
      
      // Add event listeners
      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
          e.stopPropagation();
          handleIssueAction(issue.id, e.target.dataset.action);
        }
      });
      
      return card;
    }
    
    async function handleIssueAction(issueId, action) {
      const issue = allIssues.find(i => i.id === issueId);
      if (!issue) return;
      
      try {
        if (action === 'move-back') {
          const currentIndex = statusOrder.indexOf(issue.status);
          if (currentIndex > 0) {
            const newStatus = statusOrder[currentIndex - 1];
            await updateIssue(issueId, { status: newStatus });
          }
        } else if (action === 'move-forward') {
          const currentIndex = statusOrder.indexOf(issue.status);
          if (currentIndex < statusOrder.length - 1) {
            const newStatus = statusOrder[currentIndex + 1];
            await updateIssue(issueId, { status: newStatus });
          }
        } else if (action === 'edit') {
          editIssue(issue);
        } else if (action === 'delete') {
          if (confirm('Delete this issue?')) {
            await deleteIssue(issueId);
          }
        }
      } catch (error) {
        console.error('Action failed:', error);
        alert('Action failed. Please try again.');
      }
    }
    
    async function updateIssue(id, updates) {
      const res = await fetch('/issue/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      
      if (!res.ok) {
        throw new Error('Update failed');
      }
      
      const updated = await res.json();
      const index = allIssues.findIndex(i => i.id === id);
      if (index >= 0) {
        allIssues[index] = updated;
      }
      
      await loadRollup();
      renderBoard();
      updateStats();
    }
    
    async function deleteIssue(id) {
      const res = await fetch('/issue/' + id, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error('Delete failed');
      }
      
      allIssues = allIssues.filter(i => i.id !== id);
      await loadRollup();
      renderBoard();
      updateStats();
      populateFilters();
    }
    
    function editIssue(issue) {
      const form = document.getElementById('newIssueForm');
      form.title.value = issue.title;
      form.description.value = issue.description || '';
      form.priority.value = issue.priority;
      form.point_estimate.value = issue.point_estimate || '';
      form.assignee.value = issue.assignee || '';
      form.labels.value = issue.labels ? issue.labels.join(', ') : '';
      form.status.value = issue.status;
      
      form.dataset.editingId = issue.id;
      form.querySelector('button[type="submit"]').textContent = 'Update Issue';
    }
    
    function updateStats() {
      const filteredIssues = getFilteredIssues();
      
      if (currentRollup) {
        document.getElementById('totalIssues').textContent = currentRollup.total_issues;
        document.getElementById('totalPoints').textContent = currentRollup.total_points;
        document.getElementById('completedPoints').textContent = currentRollup.completed_points;
        document.getElementById('completionPercent').textContent = Math.round(currentRollup.completion_percentage);
        document.getElementById('progressFill').style.width = currentRollup.completion_percentage + '%';
        
        const overCapacityEl = document.getElementById('overCapacity');
        if (currentRollup.is_over_capacity) {
          overCapacityEl.classList.remove('hidden');
          document.getElementById('overCapacityBy').textContent = currentRollup.over_capacity_by;
        } else {
          overCapacityEl.classList.add('hidden');
        }
      } else {
        const totalIssues = filteredIssues.length;
        const totalPoints = filteredIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
        const completedPoints = filteredIssues.filter(i => i.status === 'done').reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
        const completionPercent = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
        
        document.getElementById('totalIssues').textContent = totalIssues;
        document.getElementById('totalPoints').textContent = totalPoints;
        document.getElementById('completedPoints').textContent = completedPoints;
        document.getElementById('completionPercent').textContent = completionPercent;
        document.getElementById('progressFill').style.width = completionPercent + '%';
        document.getElementById('overCapacity').classList.add('hidden');
      }
    }
    
    function populateFilters() {
      const assignees = [...new Set(allIssues.map(i => i.assignee).filter(Boolean))];
      const labels = [...new Set(allIssues.flatMap(i => i.labels || []))];
      
      const assigneeSelect = document.getElementById('assigneeFilter');
      const currentAssignee = assigneeSelect.value;
      assigneeSelect.innerHTML = '<option value="">All assignees</option>';
      assignees.forEach(assignee => {
        const option = document.createElement('option');
        option.value = assignee;
        option.textContent = assignee;
        if (assignee === currentAssignee) option.selected = true;
        assigneeSelect.appendChild(option);
      });
      
      const labelSelect = document.getElementById('labelFilter');
      const currentLabel = labelSelect.value;
      labelSelect.innerHTML = '<option value="">All labels</option>';
      labels.forEach(label => {
        const option = document.createElement('option');
        option.value = label;
        option.textContent = label;
        if (label === currentLabel) option.selected = true;
        labelSelect.appendChild(option);
      });
    }
    
    // Event listeners
    document.getElementById('sprintSelect').addEventListener('change', async (e) => {
      currentSprintId = e.target.value ? parseInt(e.target.value) : null;
      await loadRollup();
      renderBoard();
      updateStats();
    });
    
    document.getElementById('searchInput').addEventListener('input', () => {
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
      const form = e.target;
      const formData = new FormData(form);
      
      const issueData = {
        title: formData.get('title'),
        description: formData.get('description') || undefined,
        priority: formData.get('priority'),
        point_estimate: formData.get('point_estimate') ? parseInt(formData.get('point_estimate')) : undefined,
        assignee: formData.get('assignee') || undefined,
        labels: formData.get('labels') ? formData.get('labels').split(',').map(l => l.trim()).filter(Boolean) : undefined,
        status: formData.get('status'),
        sprint_id: currentSprintId || undefined
      };
      
      try {
        const editingId = form.dataset.editingId;
        let res;
        
        if (editingId) {
          res = await fetch('/issue/' + editingId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(issueData)
          });
          
          if (res.ok) {
            const updated = await res.json();
            const index = allIssues.findIndex(i => i.id === parseInt(editingId));
            if (index >= 0) {
              allIssues[index] = updated;
            }
          }
        } else {
          res = await fetch('/issue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(issueData)
          });
          
          if (res.ok) {
            const newIssue = await res.json();
            allIssues.push(newIssue);
          }
        }
        
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Request failed');
        }
        
        form.reset();
        delete form.dataset.editingId;
        form.querySelector('button[type="submit"]').textContent = 'Add Issue';
        
        await loadRollup();
        renderBoard();
        updateStats();
        populateFilters();
      } catch (error) {
        console.error('Failed to save issue:', error);
        alert('Failed to save issue: ' + error.message);
      }
    });
    
    // Initialize
    loadData();
  </script>
</body>
</html>
  `);
});

router.get('/settings', (c) => {
  const settings = db.prepare('SELECT * FROM board_settings ORDER BY id DESC LIMIT 1').get();
  return c.json(settings || { current_sprint_id: null });
});

router.patch('/settings', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  
  const result = UpdateBoardSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }
  
  const { current_sprint_id } = result.data;
  
  if (current_sprint_id != null) {
    const sprint = db.prepare('SELECT id FROM sprint WHERE id = ?').get(current_sprint_id);
    if (!sprint) {
      return c.json({ error: 'Sprint not found' }, 400);
    }
  }
  
  // Clear existing settings and insert new ones
  db.prepare('DELETE FROM board_settings').run();
  db.prepare('INSERT INTO board_settings (current_sprint_id) VALUES (?)').run(current_sprint_id ?? null);
  
  const settings = db.prepare('SELECT * FROM board_settings ORDER BY id DESC LIMIT 1').get();
  return c.json(settings);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'b9bb7ff20f5c774e1ce8b76f2bdf86a7e5705d8280ec49196276bad035f5d987',
  name: 'board',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;
