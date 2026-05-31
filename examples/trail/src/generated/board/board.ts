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
    .logo { font-size: 1.5rem; font-weight: 600; color: #495057; }
    .sprint-selector { display: flex; align-items: center; gap: 0.5rem; }
    .sprint-selector select { padding: 0.5rem; border: 1px solid #ced4da; border-radius: 4px; }
    .stats { display: flex; align-items: center; gap: 1rem; font-size: 0.875rem; color: #6c757d; }
    .progress-bar { width: 100px; height: 8px; background: #e9ecef; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #28a745; transition: width 0.3s; }
    .warning { color: #dc3545; font-weight: 500; }
    .controls { padding: 1rem; background: white; border-bottom: 1px solid #dee2e6; }
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
    .column-content { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; min-height: 200px; }
    .backlog .column-header { border-left: 4px solid #6c757d; }
    .todo .column-header { border-left: 4px solid #007bff; }
    .inprogress .column-header { border-left: 4px solid #ffc107; }
    .inreview .column-header { border-left: 4px solid #6f42c1; }
    .done .column-header { border-left: 4px solid #28a745; }
    .issue-card { background: white; border: 1px solid #dee2e6; border-radius: 6px; padding: 0.75rem; cursor: pointer; transition: box-shadow 0.2s; }
    .issue-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .issue-card.done { opacity: 0.7; }
    .issue-title { font-weight: 500; margin-bottom: 0.5rem; line-height: 1.3; }
    .issue-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
    .priority-badge { padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
    .priority-urgent { background: #dc3545; color: white; }
    .priority-high { background: #fd7e14; color: white; }
    .priority-normal { background: #007bff; color: white; }
    .priority-low { background: #6c757d; color: white; }
    .point-estimate { background: #e9ecef; color: #495057; padding: 0.25rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
    .assignee { color: #6c757d; font-size: 0.875rem; }
    .labels { display: flex; gap: 0.25rem; flex-wrap: wrap; }
    .label { background: #f8f9fa; color: #495057; padding: 0.125rem 0.375rem; border-radius: 8px; font-size: 0.75rem; border: 1px solid #dee2e6; }
    .issue-controls { display: flex; gap: 0.25rem; margin-top: 0.5rem; }
    .issue-controls button { padding: 0.25rem 0.5rem; border: 1px solid #ced4da; background: white; border-radius: 4px; cursor: pointer; font-size: 0.75rem; }
    .issue-controls button:hover { background: #f8f9fa; }
    .issue-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    .done-check { color: #28a745; margin-right: 0.5rem; }
    .hidden { display: none; }
    @media (max-width: 768px) {
      .board { flex-direction: column; }
      .column { min-width: auto; }
      .top-bar, .controls { flex-direction: column; align-items: stretch; }
      .new-issue-form { flex-direction: column; }
      .filters { flex-direction: column; align-items: stretch; }
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="logo">Trail</div>
    <div class="sprint-selector">
      <label>Sprint:</label>
      <select id="sprintSelect">
        <option value="">Backlog</option>
      </select>
    </div>
    <div class="stats" id="stats">
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
      <input type="text" id="newTitle" placeholder="Issue title" required>
      <select id="newPriority">
        <option value="normal">Normal</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="low">Low</option>
      </select>
      <select id="newEstimate">
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

  <div class="board" id="board">
    <div class="column backlog" data-status="backlog">
      <div class="column-header">
        <div class="column-title">Backlog <span id="backlogCount" class="column-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="backlogContent"></div>
    </div>
    <div class="column todo" data-status="todo">
      <div class="column-header">
        <div class="column-title">Todo <span id="todoCount" class="column-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="todoContent"></div>
    </div>
    <div class="column inprogress" data-status="inprogress">
      <div class="column-header">
        <div class="column-title">In Progress <span id="inprogressCount" class="column-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="inprogressContent"></div>
    </div>
    <div class="column inreview" data-status="inreview">
      <div class="column-header">
        <div class="column-title">In Review <span id="inreviewCount" class="column-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="inreviewContent"></div>
    </div>
    <div class="column done" data-status="done">
      <div class="column-header">
        <div class="column-title">Done <span id="doneCount" class="column-stats">0 issues, 0 pts</span></div>
      </div>
      <div class="column-content" id="doneContent"></div>
    </div>
  </div>

  <script>
    let issues = [];
    let sprints = [];
    let currentFilters = { search: '', assignee: '', label: '', sprint: '' };

    async function loadSprints() {
      try {
        const response = await fetch('/sprint');
        sprints = await response.json();
        const sprintSelect = document.getElementById('sprintSelect');
        sprintSelect.innerHTML = '<option value="">Backlog</option>';
        sprints.forEach(sprint => {
          const option = document.createElement('option');
          option.value = sprint.id;
          option.textContent = sprint.name;
          sprintSelect.appendChild(option);
        });
      } catch (error) {
        console.error('Failed to load sprints:', error);
      }
    }

    async function loadIssues() {
      try {
        const response = await fetch('/issue');
        issues = await response.json();
        updateFilters();
        renderBoard();
        updateStats();
      } catch (error) {
        console.error('Failed to load issues:', error);
      }
    }

    function updateFilters() {
      const assignees = [...new Set(issues.map(i => i.assignee).filter(Boolean))];
      const labels = [...new Set(issues.flatMap(i => i.labels || []))];
      
      const assigneeFilter = document.getElementById('assigneeFilter');
      assigneeFilter.innerHTML = '<option value="">All assignees</option>';
      assignees.forEach(assignee => {
        const option = document.createElement('option');
        option.value = assignee;
        option.textContent = assignee;
        assigneeFilter.appendChild(option);
      });

      const labelFilter = document.getElementById('labelFilter');
      labelFilter.innerHTML = '<option value="">All labels</option>';
      labels.forEach(label => {
        const option = document.createElement('option');
        option.value = label;
        option.textContent = label;
        labelFilter.appendChild(option);
      });
    }

    function filterIssues() {
      return issues.filter(issue => {
        if (currentFilters.search && !issue.title.toLowerCase().includes(currentFilters.search.toLowerCase()) && 
            !issue.description.toLowerCase().includes(currentFilters.search.toLowerCase())) return false;
        if (currentFilters.assignee && issue.assignee !== currentFilters.assignee) return false;
        if (currentFilters.label && (!issue.labels || !issue.labels.includes(currentFilters.label))) return false;
        if (currentFilters.sprint === '') {
          return !issue.sprint_id;
        } else if (currentFilters.sprint) {
          return issue.sprint_id == currentFilters.sprint;
        }
        return true;
      });
    }

    function renderBoard() {
      const filteredIssues = filterIssues();
      const statusColumns = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
      
      statusColumns.forEach(status => {
        const content = document.getElementById(status + 'Content');
        const statusIssues = filteredIssues.filter(issue => issue.status === status);
        
        content.innerHTML = '';
        statusIssues.forEach(issue => {
          const card = createIssueCard(issue);
          content.appendChild(card);
        });

        const count = statusIssues.length;
        const points = statusIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
        document.getElementById(status + 'Count').textContent = count + ' issues, ' + points + ' pts';
      });
    }

    function createIssueCard(issue) {
      const card = document.createElement('div');
      card.className = 'issue-card' + (issue.status === 'done' ? ' done' : '');
      card.dataset.id = issue.id;
      card.dataset.status = issue.status;
      card.dataset.priority = issue.priority;
      card.dataset.assignee = issue.assignee || '';
      card.dataset.labels = JSON.stringify(issue.labels || []);

      const doneCheck = issue.status === 'done' ? '<span class="done-check">✓</span>' : '';
      const priorityClass = 'priority-' + issue.priority;
      const pointEstimate = issue.point_estimate ? '<span class="point-estimate">' + issue.point_estimate + '</span>' : '';
      const assignee = issue.assignee ? '<span class="assignee">' + issue.assignee + '</span>' : '';
      const labels = (issue.labels || []).map(label => '<span class="label">' + label + '</span>').join('');

      card.innerHTML = 
        '<div class="issue-title">' + doneCheck + issue.title + '</div>' +
        '<div class="issue-meta">' +
          '<span class="priority-badge ' + priorityClass + '">' + issue.priority + '</span>' +
          pointEstimate + assignee +
          '<div class="labels">' + labels + '</div>' +
        '</div>' +
        '<div class="issue-controls">' +
          '<button data-action="back">← Back</button>' +
          '<button data-action="forward">Forward →</button>' +
        '</div>';

      return card;
    }

    function updateStats() {
      const filteredIssues = filterIssues();
      const totalIssues = filteredIssues.length;
      const totalPoints = filteredIssues.reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
      const completedPoints = filteredIssues.filter(issue => issue.status === 'done').reduce((sum, issue) => sum + (issue.point_estimate || 0), 0);
      const percentComplete = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

      document.getElementById('totalIssues').textContent = totalIssues + ' issues';
      document.getElementById('totalPoints').textContent = totalPoints + ' points';
      document.getElementById('completedPoints').textContent = completedPoints + ' completed';
      document.getElementById('progressFill').style.width = percentComplete + '%';
      document.getElementById('percentComplete').textContent = percentComplete + '%';

      const currentSprint = sprints.find(s => s.id == currentFilters.sprint);
      const capacityWarning = document.getElementById('capacityWarning');
      if (currentSprint && currentSprint.capacity != null && totalPoints > currentSprint.capacity) {
        capacityWarning.classList.remove('hidden');
      } else {
        capacityWarning.classList.add('hidden');
      }
    }

    async function moveIssue(issueId, direction) {
      const issue = issues.find(i => i.id == issueId);
      if (!issue) return;

      const statusFlow = ['backlog', 'todo', 'inprogress', 'inreview', 'done'];
      const currentIndex = statusFlow.indexOf(issue.status);
      let newIndex;

      if (direction === 'forward' && currentIndex < statusFlow.length - 1) {
        newIndex = currentIndex + 1;
      } else if (direction === 'back' && currentIndex > 0) {
        newIndex = currentIndex - 1;
      } else {
        return;
      }

      const newStatus = statusFlow[newIndex];
      
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

    async function createIssue(formData) {
      try {
        const labels = formData.labels ? formData.labels.split(',').map(l => l.trim()).filter(Boolean) : [];
        const payload = {
          title: formData.title,
          description: formData.description || '',
          status: formData.status,
          priority: formData.priority,
          assignee: formData.assignee || null,
          labels: labels,
          sprint_id: currentFilters.sprint ? Number(currentFilters.sprint) : null
        };
        
        if (formData.point_estimate) {
          payload.point_estimate = Number(formData.point_estimate);
        }

        const response = await fetch('/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (response.ok) {
          const newIssue = await response.json();
          issues.push(newIssue);
          updateFilters();
          renderBoard();
          updateStats();
          document.getElementById('newIssueForm').reset();
        }
      } catch (error) {
        console.error('Failed to create issue:', error);
      }
    }

    // Event listeners
    document.getElementById('newIssueForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      createIssue({
        title: formData.get('title'),
        description: formData.get('description'),
        status: formData.get('status'),
        priority: formData.get('priority'),
        point_estimate: formData.get('point_estimate'),
        assignee: formData.get('assignee'),
        labels: formData.get('labels')
      });
    });

    document.getElementById('board').addEventListener('click', (e) => {
      if (e.target.dataset.action) {
        const card = e.target.closest('.issue-card');
        const issueId = card.dataset.id;
        const action = e.target.dataset.action;
        moveIssue(issueId, action);
      }
    });

    document.getElementById('searchBox').addEventListener('input', (e) => {
      currentFilters.search = e.target.value;
      renderBoard();
      updateStats();
    });

    document.getElementById('assigneeFilter').addEventListener('change', (e) => {
      currentFilters.assignee = e.target.value;
      renderBoard();
      updateStats();
    });

    document.getElementById('labelFilter').addEventListener('change', (e) => {
      currentFilters.label = e.target.value;
      renderBoard();
      updateStats();
    });

    document.getElementById('sprintSelect').addEventListener('change', (e) => {
      currentFilters.sprint = e.target.value;
      renderBoard();
      updateStats();
    });

    // Initialize
    loadSprints().then(() => loadIssues());
  </script>
</body>
</html>`);
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
