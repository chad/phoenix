import { Hono } from 'hono';
import { db } from '../../db.js';
import { z } from 'zod';

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateBoardSchema = z.object({
  name: z.string().min(1).max(200).optional().default('Trail Board'),
});

const UpdateBoardSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trail Board</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; }
    
    .top-bar { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; display: flex; align-items: center; gap: 2rem; flex-wrap: wrap; }
    .top-bar h1 { font-size: 1.5rem; font-weight: 600; }
    .sprint-selector select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.375rem; }
    .stats { display: flex; gap: 1rem; align-items: center; font-size: 0.875rem; }
    .progress-bar { width: 100px; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #28a745; transition: width 0.3s; }
    .warning { color: #dc3545; font-weight: 600; }
    
    .controls { background: white; border-bottom: 1px solid #dee2e6; padding: 1rem; }
    .new-issue-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .new-issue-form input, .new-issue-form select, .new-issue-form textarea { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.375rem; }
    .new-issue-form input[name="title"] { flex: 1; min-width: 200px; }
    .new-issue-form textarea { width: 100%; min-height: 60px; resize: vertical; }
    .new-issue-form button { padding: 0.5rem 1rem; background: #007bff; color: white; border: none; border-radius: 0.375rem; cursor: pointer; }
    .new-issue-form button:hover { background: #0056b3; }
    
    .filters { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .filters input, .filters select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 0.375rem; }
    
    .board { display: flex; gap: 1rem; padding: 1rem; min-height: calc(100vh - 200px); overflow-x: auto; }
    .column { flex: 1; min-width: 280px; background: white; border-radius: 0.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .column-header { padding: 1rem; border-bottom: 1px solid #dee2e6; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
    .column-stats { font-size: 0.875rem; color: #6c757d; }
    .column-content { padding: 0.5rem; min-height: 400px; }
    
    .column.backlog .column-header { background: #f8f9fa; color: #6c757d; }
    .column.todo .column-header { background: #e3f2fd; color: #1976d2; }
    .column.inprogress .column-header { background: #fff3e0; color: #f57c00; }
    .column.inreview .column-header { background: #f3e5f5; color: #7b1fa2; }
    .column.done .column-header { background: #e8f5e8; color: #388e3c; }
    
    .issue-card { background: white; border: 1px solid #dee2e6; border-radius: 0.375rem; padding: 0.75rem; margin-bottom: 0.5rem; cursor: pointer; transition: box-shadow 0.2s; }
    .issue-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .issue-card.done { opacity: 0.7; }
    .issue-card.done::before { content: "✓ "; color: #28a745; font-weight: bold; }
    
    .issue-title { font-weight: 500; margin-bottom: 0.5rem; }
    .issue-meta { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; font-size: 0.75rem; }
    .priority-badge { padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-weight: 500; }
    .priority-urgent { background: #dc3545; color: white; }
    .priority-high { background: #fd7e14; color: white; }
    .priority-normal { background: #007bff; color: white; }
    .priority-low { background: #6c757d; color: white; }
    .point-estimate { background: #e9ecef; padding: 0.125rem 0.375rem; border-radius: 0.25rem; }
    .assignee { background: #f8f9fa; padding: 0.125rem 0.375rem; border-radius: 0.25rem; }
    .label { background: #e3f2fd; color: #1976d2; padding: 0.125rem 0.375rem; border-radius: 0.25rem; }
    
    .issue-controls { margin-top: 0.5rem; display: flex; gap: 0.25rem; }
    .issue-controls button { padding: 0.25rem 0.5rem; font-size: 0.75rem; border: 1px solid #ced4da; background: white; border-radius: 0.25rem; cursor: pointer; }
    .issue-controls button:hover { background: #f8f9fa; }
    .issue-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .hidden { display: none; }
    
    @media (max-width: 768px) {
      .board { flex-direction: column; }
      .column { min-width: auto; }
      .top-bar, .controls { flex-direction: column; align-items: stretch; }
      .new-issue-form { flex-direction: column; }
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
      <span id="capacityWarning" class="warning hidden">Over capacity!</span>
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
  
  <div class="board">
    <div class="column backlog" data-status="backlog">
      <div class="column-header">
        <span>Backlog</span>
        <span class="column-stats" id="backlog-stats">0 issues, 0 pts</span>
      </div>
      <div class="column-content" id="backlog-content"></div>
    </div>
    
    <div class="column todo" data-status="todo">
      <div class="column-header">
        <span>Todo</span>
        <span class="column-stats" id="todo-stats">0 issues, 0 pts</span>
      </div>
      <div class="column-content" id="todo-content"></div>
    </div>
    
    <div class="column inprogress" data-status="inprogress">
      <div class="column-header">
        <span>In Progress</span>
        <span class="column-stats" id="inprogress-stats">0 issues, 0 pts</span>
      </div>
      <div class="column-content" id="inprogress-content"></div>
    </div>
    
    <div class="column inreview" data-status="inreview">
      <div class="column-header">
        <span>In Review</span>
        <span class="column-stats" id="inreview-stats">0 issues, 0 pts</span>
      </div>
      <div class="column-content" id="inreview-content"></div>
    </div>
    
    <div class="column done" data-status="done">
      <div class="column-header">
        <span>Done</span>
        <span class="column-stats" id="done-stats">0 issues, 0 pts</span>
      </div>
      <div class="column-content" id="done-content"></div>
    </div>
  </div>

  <script>
    let issues = [];
    let sprints = [];
    let currentSprintId = null;
    let filters = { search: '', assignee: '', label: '' };

    const statusOrder = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];

    async function loadData() {
      try {
        const [issuesRes, sprintsRes] = await Promise.all([
          fetch('/issue'),
          fetch('/sprint')
        ]);
        issues = await issuesRes.json();
        sprints = await sprintsRes.json();
        
        populateSprintSelector();
        populateFilterOptions();
        renderBoard();
        updateStats();
      } catch (error) {
        console.error('Failed to load data:', error);
      }
    }

    function populateSprintSelector() {
      const select = document.getElementById('sprintSelect');
      select.innerHTML = '<option value="">Backlog</option>';
      
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

    function populateFilterOptions() {
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
      const sprintId = document.getElementById('sprintSelect').value;
      
      return issues.filter(issue => {
        // Sprint filter
        if (sprintId === '') {
          if (issue.sprint_id != null) return false;
        } else {
          if (issue.sprint_id != parseInt(sprintId)) return false;
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
        if (filters.label && (!issue.labels || !issue.labels.includes(filters.label))) {
          return false;
        }
        
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
        const totalPoints = statusIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
        document.getElementById(status + '-stats').textContent = 
          statusIssues.length + ' issues, ' + totalPoints + ' pts';
      });
    }

    function createIssueCard(issue) {
      const card = document.createElement('div');
      card.className = 'issue-card' + (issue.status === 'done' ? ' done' : '');
      card.dataset.id = issue.id;
      card.dataset.status = issue.status;
      
      const meta = [];
      if (issue.priority !== 'normal') {
        meta.push('<span class="priority-badge priority-' + issue.priority + '">' + issue.priority + '</span>');
      }
      if (issue.point_estimate) {
        meta.push('<span class="point-estimate">' + issue.point_estimate + '</span>');
      }
      if (issue.assignee) {
        meta.push('<span class="assignee">' + issue.assignee + '</span>');
      }
      if (issue.labels && issue.labels.length > 0) {
        issue.labels.forEach(label => {
          meta.push('<span class="label">' + label + '</span>');
        });
      }
      
      const currentIndex = statusOrder.indexOf(issue.status);
      const canMoveBack = currentIndex > 0;
      const canMoveForward = currentIndex < statusOrder.length - 1;
      
      card.innerHTML = 
        '<div class="issue-title">' + issue.title + '</div>' +
        '<div class="issue-meta">' + meta.join('') + '</div>' +
        '<div class="issue-controls">' +
          '<button data-action="back"' + (canMoveBack ? '' : ' disabled') + '>← Back</button>' +
          '<button data-action="forward"' + (canMoveForward ? '' : ' disabled') + '>Forward →</button>' +
          '<button data-action="edit">Edit</button>' +
          '<button data-action="delete">Delete</button>' +
        '</div>';
      
      return card;
    }

    function updateStats() {
      const filteredIssues = getFilteredIssues();
      const totalIssues = filteredIssues.length;
      const totalPoints = filteredIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
      const completedPoints = filteredIssues
        .filter(issue => issue.status === 'done')
        .reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
      
      const percentComplete = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
      
      document.getElementById('totalIssues').textContent = totalIssues + ' issues';
      document.getElementById('totalPoints').textContent = totalPoints + ' points';
      document.getElementById('completedPoints').textContent = completedPoints + ' completed';
      document.getElementById('percentComplete').textContent = percentComplete + '%';
      document.getElementById('progressFill').style.width = percentComplete + '%';
      
      // Check capacity warning
      const sprintId = document.getElementById('sprintSelect').value;
      const sprint = sprints.find(s => s.id == sprintId);
      const warning = document.getElementById('capacityWarning');
      if (sprint && sprint.capacity && totalPoints > sprint.capacity) {
        warning.classList.remove('hidden');
      } else {
        warning.classList.add('hidden');
      }
    }

    async function moveIssue(issueId, direction) {
      const issue = issues.find(i => i.id == issueId);
      if (!issue) return;
      
      const currentIndex = statusOrder.indexOf(issue.status);
      let newIndex;
      if (direction === 'back') {
        newIndex = Math.max(0, currentIndex - 1);
      } else {
        newIndex = Math.min(statusOrder.length - 1, currentIndex + 1);
      }
      
      const newStatus = statusOrder[newIndex];
      if (newStatus === issue.status) return;
      
      try {
        const response = await fetch('/issue/' + issueId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        
        if (response.ok) {
          const updatedIssue = await response.json();
          const index = issues.findIndex(i => i.id == issueId);
          issues[index] = updatedIssue;
          renderBoard();
          updateStats();
        }
      } catch (error) {
        console.error('Failed to move issue:', error);
      }
    }

    async function deleteIssue(issueId) {
      if (!confirm('Delete this issue?')) return;
      
      try {
        const response = await fetch('/issue/' + issueId, { method: 'DELETE' });
        if (response.ok) {
          issues = issues.filter(i => i.id != issueId);
          renderBoard();
          updateStats();
          populateFilterOptions();
        }
      } catch (error) {
        console.error('Failed to delete issue:', error);
      }
    }

    // Event listeners
    document.getElementById('newIssueForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = {
        title: formData.get('title'),
        priority: formData.get('priority'),
        status: formData.get('status')
      };
      
      if (formData.get('point_estimate')) {
        data.point_estimate = parseInt(formData.get('point_estimate'));
      }
      if (formData.get('assignee')) {
        data.assignee = formData.get('assignee');
      }
      if (formData.get('labels')) {
        data.labels = formData.get('labels').split(',').map(l => l.trim()).filter(Boolean);
      }
      
      const sprintId = document.getElementById('sprintSelect').value;
      if (sprintId) {
        data.sprint_id = parseInt(sprintId);
      }
      
      try {
        const response = await fetch('/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        
        if (response.ok) {
          const newIssue = await response.json();
          issues.push(newIssue);
          e.target.reset();
          renderBoard();
          updateStats();
          populateFilterOptions();
        }
      } catch (error) {
        console.error('Failed to create issue:', error);
      }
    });

    document.getElementById('sprintSelect').addEventListener('change', () => {
      renderBoard();
      updateStats();
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
      filters.search = e.target.value;
      renderBoard();
      updateStats();
    });

    document.getElementById('assigneeFilter').addEventListener('change', (e) => {
      filters.assignee = e.target.value;
      renderBoard();
      updateStats();
    });

    document.getElementById('labelFilter').addEventListener('change', (e) => {
      filters.label = e.target.value;
      renderBoard();
      updateStats();
    });

    document.addEventListener('click', (e) => {
      if (e.target.dataset.action) {
        const card = e.target.closest('.issue-card');
        const issueId = card.dataset.id;
        
        switch (e.target.dataset.action) {
          case 'back':
          case 'forward':
            moveIssue(issueId, e.target.dataset.action);
            break;
          case 'delete':
            deleteIssue(issueId);
            break;
          case 'edit':
            // Simple edit - just prompt for new title
            const issue = issues.find(i => i.id == issueId);
            const newTitle = prompt('Edit title:', issue.title);
            if (newTitle && newTitle !== issue.title) {
              fetch('/issue/' + issueId, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
              }).then(response => {
                if (response.ok) {
                  return response.json();
                }
              }).then(updatedIssue => {
                if (updatedIssue) {
                  const index = issues.findIndex(i => i.id == issueId);
                  issues[index] = updatedIssue;
                  renderBoard();
                }
              });
            }
            break;
        }
      }
    });

    // Load initial data
    loadData();
  </script>
</body>
</html>
  `);
});

router.get('/:id', (c) => {
  const board = db.prepare('SELECT * FROM board WHERE id = ?').get(c.req.param('id'));
  if (!board) return c.json({ error: 'Not found' }, 404);
  return c.json(board);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateBoardSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { name } = result.data;
  const info = db.prepare('INSERT INTO board (name) VALUES (?)').run(name);
  const board = db.prepare('SELECT * FROM board WHERE id = ?').get(info.lastInsertRowid);
  return c.json(board, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM board WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateBoardSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const u = result.data;
  if (u.name !== undefined) db.prepare('UPDATE board SET name = ? WHERE id = ?').run(u.name, id);
  return c.json(db.prepare('SELECT * FROM board WHERE id = ?').get(id));
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM board WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  db.prepare('DELETE FROM board WHERE id = ?').run(id);
  return c.body(null, 204);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'b9bb7ff20f5c774e1ce8b76f2bdf86a7e5705d8280ec49196276bad035f5d987',
  name: 'board',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;
