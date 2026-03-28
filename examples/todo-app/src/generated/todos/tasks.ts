import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// Register table migration
registerMigration('tasks', `
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    due_date TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    project_id INTEGER REFERENCES projects(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional().default('normal'),
  due_date: z.string().nullable().optional(),
  project_id: z.number().int().nullable().optional(),
});

const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
  due_date: z.string().nullable().optional(),
  completed: z.number().int().min(0).max(1).optional(),
  project_id: z.number().int().nullable().optional(),
});

const router = new Hono();

// List all tasks with filtering and sorting
router.get('/', (c) => {
  let sql = `
    SELECT tasks.*, projects.name as project_name 
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id
  `;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const status = c.req.query('status');
  if (status === 'active') {
    conditions.push('tasks.completed = 0');
  } else if (status === 'completed') {
    conditions.push('tasks.completed = 1');
  }

  const priority = c.req.query('priority');
  if (priority) {
    conditions.push('tasks.priority = ?');
    params.push(priority);
  }

  const projectId = c.req.query('project_id');
  if (projectId) {
    conditions.push('tasks.project_id = ?');
    params.push(Number(projectId));
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  // Sort by urgency and overdue status first, then by creation date
  sql += ` ORDER BY 
    CASE WHEN tasks.due_date < date('now') AND tasks.completed = 0 THEN 0 ELSE 1 END,
    CASE tasks.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 END,
    tasks.created_at DESC
  `;

  const tasks = db.prepare(sql).all(...params);
  return c.json(tasks);
});

// Get single task
router.get('/:id', (c) => {
  const task = db.prepare(`
    SELECT tasks.*, projects.name as project_name 
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id 
    WHERE tasks.id = ?
  `).get(c.req.param('id'));
  
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

// Create task
router.post('/', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = CreateTaskSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }

  const { title, description, priority, due_date, project_id } = result.data;

  // Validate project exists if provided
  if (project_id !== undefined && project_id !== null) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(project_id);
    if (!project) {
      return c.json({ error: 'Project not found' }, 400);
    }
  }

  const info = db.prepare(`
    INSERT INTO tasks (title, description, priority, due_date, project_id) 
    VALUES (?, ?, ?, ?, ?)
  `).run(title, description, priority, due_date, project_id);

  const task = db.prepare(`
    SELECT tasks.*, projects.name as project_name 
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id 
    WHERE tasks.id = ?
  `).get(info.lastInsertRowid);

  return c.json(task, 201);
});

// Update task
router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!existing) {
    return c.json({ error: 'Task not found' }, 404);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = UpdateTaskSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }

  const updates = result.data;

  // Validate project exists if being updated
  if (updates.project_id !== undefined && updates.project_id !== null) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(updates.project_id);
    if (!project) {
      return c.json({ error: 'Project not found' }, 400);
    }
  }

  // Apply updates
  if (updates.title !== undefined) {
    db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(updates.title, id);
  }
  if (updates.description !== undefined) {
    db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(updates.description, id);
  }
  if (updates.priority !== undefined) {
    db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(updates.priority, id);
  }
  if (updates.due_date !== undefined) {
    db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(updates.due_date, id);
  }
  if (updates.completed !== undefined) {
    db.prepare('UPDATE tasks SET completed = ? WHERE id = ?').run(updates.completed, id);
  }
  if (updates.project_id !== undefined) {
    db.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(updates.project_id, id);
  }

  const updated = db.prepare(`
    SELECT tasks.*, projects.name as project_name 
    FROM tasks 
    LEFT JOIN projects ON tasks.project_id = projects.id 
    WHERE tasks.id = ?
  `).get(id);

  return c.json(updated);
});

// Delete task
router.delete('/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!existing) {
    return c.json({ error: 'Task not found' }, 404);
  }

  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return c.body(null, 204);
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '1628f3b0f6e0816a698cf8b53a7b135c5dc11469a9bca1fa49299db6018b08f7',
  name: 'Tasks',
  risk_tier: 'high',
  canon_ids: [4 as const],
} as const;