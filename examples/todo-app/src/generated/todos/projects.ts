import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// Register table migrations
registerMigration('projects', `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

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

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#3b82f6'),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const router = new Hono();

// List all projects with active task counts
router.get('/', (c) => {
  const projects = db.prepare(`
    SELECT 
      p.*,
      COALESCE(COUNT(CASE WHEN t.completed = 0 THEN 1 END), 0) as active_task_count
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id
    GROUP BY p.id, p.name, p.color, p.created_at
    ORDER BY p.name
  `).all();
  return c.json(projects);
});

// Get single project
router.get('/:id', (c) => {
  const project = db.prepare(`
    SELECT 
      p.*,
      COALESCE(COUNT(CASE WHEN t.completed = 0 THEN 1 END), 0) as active_task_count
    FROM projects p
    LEFT JOIN tasks t ON p.id = t.project_id
    WHERE p.id = ?
    GROUP BY p.id, p.name, p.color, p.created_at
  `).get(c.req.param('id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json(project);
});

// Create project
router.post('/', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  
  const result = CreateProjectSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }
  
  const { name, color } = result.data;
  
  try {
    const info = db.prepare('INSERT INTO projects (name, color) VALUES (?, ?)').run(name, color);
    const project = db.prepare(`
      SELECT 
        p.*,
        0 as active_task_count
      FROM projects p
      WHERE p.id = ?
    `).get(info.lastInsertRowid);
    return c.json(project, 201);
  } catch (error: any) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'Project name already exists' }, 400);
    }
    throw error;
  }
});

// Update project
router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Project not found' }, 404);
  
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  
  const result = UpdateProjectSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }
  
  const updates = result.data;
  
  try {
    if (updates.name !== undefined) {
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(updates.name, id);
    }
    if (updates.color !== undefined) {
      db.prepare('UPDATE projects SET color = ? WHERE id = ?').run(updates.color, id);
    }
    
    const updated = db.prepare(`
      SELECT 
        p.*,
        COALESCE(COUNT(CASE WHEN t.completed = 0 THEN 1 END), 0) as active_task_count
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      WHERE p.id = ?
      GROUP BY p.id, p.name, p.color, p.created_at
    `).get(id);
    return c.json(updated);
  } catch (error: any) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'Project name already exists' }, 400);
    }
    throw error;
  }
});

// Delete project (with cascade protection)
router.delete('/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Project not found' }, 404);
  
  // Check for tasks in this project
  const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(id) as { count: number };
  if (taskCount.count > 0) {
    return c.json({ 
      error: 'Cannot delete project that contains tasks',
      task_count: taskCount.count 
    }, 400);
  }
  
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return c.body(null, 204);
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '684e98680b126a8a1535a88875ffb4157cfc3bc1881f7a6b34c2fdae1830e9b1',
  name: 'Projects',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;