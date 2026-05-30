import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

registerMigration('issues', `
  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'backlog',
    priority TEXT NOT NULL DEFAULT 'normal',
    points INTEGER,
    assignee TEXT,
    labels TEXT NOT NULL DEFAULT '',
    sprint_id INTEGER REFERENCES sprints(id),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateIssueSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional().default(''),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done']).optional().default('backlog'),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().default('normal'),
  points: z.number().int().min(1).nullable().optional(),
  assignee: z.string().nullable().optional(),
  labels: z.string().optional().default(''),
  sprint_id: z.number().int().nullable().optional(),
});

const UpdateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done']).optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  points: z.number().int().min(1).nullable().optional(),
  assignee: z.string().nullable().optional(),
  labels: z.string().optional(),
  sprint_id: z.number().int().nullable().optional(),
});

router.get('/', (c) => {
  let sql = 'SELECT issues.*, sprints.name as sprint_name FROM issues LEFT JOIN sprints ON issues.sprint_id = sprints.id';
  const conditions: string[] = [];
  const params: unknown[] = [];
  
  const status = c.req.query('status');
  if (status !== undefined) { conditions.push('issues.status = ?'); params.push(status); }
  
  const assignee = c.req.query('assignee');
  if (assignee !== undefined) { conditions.push('issues.assignee = ?'); params.push(assignee); }
  
  const label = c.req.query('label');
  if (label !== undefined) { conditions.push('issues.labels LIKE ?'); params.push(`%${label}%`); }
  
  const sprintId = c.req.query('sprint_id');
  if (sprintId !== undefined) { conditions.push('issues.sprint_id = ?'); params.push(Number(sprintId)); }
  
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += " ORDER BY CASE issues.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END, issues.updated_at DESC";
  
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const issue = db.prepare('SELECT issues.*, sprints.name as sprint_name FROM issues LEFT JOIN sprints ON issues.sprint_id = sprints.id WHERE issues.id = ?').get(c.req.param('id'));
  if (!issue) return c.json({ error: 'Not found' }, 404);
  return c.json(issue);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateIssueSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { title, description, status, priority, points, assignee, labels, sprint_id } = result.data;
  
  if (sprint_id != null) {
    if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(sprint_id)) return c.json({ error: 'Sprint not found' }, 400);
  }
  
  const info = db.prepare('INSERT INTO issues (title, description, status, priority, points, assignee, labels, sprint_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(title, description, status, priority, points ?? null, assignee ?? null, labels, sprint_id ?? null);
  const issue = db.prepare('SELECT issues.*, sprints.name as sprint_name FROM issues LEFT JOIN sprints ON issues.sprint_id = sprints.id WHERE issues.id = ?').get(info.lastInsertRowid);
  return c.json(issue, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM issues WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateIssueSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  
  if (u.sprint_id !== undefined && u.sprint_id != null) {
    if (!db.prepare('SELECT id FROM sprints WHERE id = ?').get(u.sprint_id)) return c.json({ error: 'Sprint not found' }, 400);
  }
  
  if (u.title !== undefined) db.prepare("UPDATE issues SET title = ?, updated_at = datetime('now') WHERE id = ?").run(u.title, id);
  if (u.description !== undefined) db.prepare("UPDATE issues SET description = ?, updated_at = datetime('now') WHERE id = ?").run(u.description, id);
  if (u.priority !== undefined) db.prepare("UPDATE issues SET priority = ?, updated_at = datetime('now') WHERE id = ?").run(u.priority, id);
  if (u.points !== undefined) db.prepare("UPDATE issues SET points = ?, updated_at = datetime('now') WHERE id = ?").run(u.points, id);
  if (u.assignee !== undefined) db.prepare("UPDATE issues SET assignee = ?, updated_at = datetime('now') WHERE id = ?").run(u.assignee, id);
  if (u.labels !== undefined) db.prepare("UPDATE issues SET labels = ?, updated_at = datetime('now') WHERE id = ?").run(u.labels, id);
  if (u.sprint_id !== undefined) db.prepare("UPDATE issues SET sprint_id = ?, updated_at = datetime('now') WHERE id = ?").run(u.sprint_id, id);
  
  if (u.status !== undefined) {
    const wasCompleted = existing.status === 'done';
    const nowCompleted = u.status === 'done';
    
    if (!wasCompleted && nowCompleted) {
      db.prepare("UPDATE issues SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    } else if (wasCompleted && !nowCompleted) {
      db.prepare("UPDATE issues SET status = ?, completed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    } else {
      db.prepare("UPDATE issues SET status = ?, updated_at = datetime('now') WHERE id = ?").run(u.status, id);
    }
  }
  
  return c.json(db.prepare('SELECT issues.*, sprints.name as sprint_name FROM issues LEFT JOIN sprints ON issues.sprint_id = sprints.id WHERE issues.id = ?').get(id));
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM issues WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  db.prepare('DELETE FROM issues WHERE id = ?').run(id);
  return c.body(null, 204);
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'caf2230f0f0b8ca06f1ac444a82cb0e9ba5765422cc953d1519ba4cc610e9a73',
  name: 'Issues',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;
