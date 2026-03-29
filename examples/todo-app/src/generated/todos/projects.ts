import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// Register table migration
registerMigration('projects', `
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#3b82f6',
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
      COALESCE(t.active_count, 0) as active_task_count
    FROM projects p
    LEFT JOIN (
      SELECT 
        project_id,
        COUNT(*) as active_count
      FROM tasks 
      WHERE completed = 0
      GROUP BY project_id
    ) t ON p.id = t.project_id
    ORDER BY p.created_at DESC
  `).all();
  return c.json(projects);
});

// Get single project
router.get('/:id', (c) => {
  const project = db.prepare(`
    SELECT 
      p.*,
      COALESCE(t.active_count, 0) as active_task_count
    FROM projects p
    LEFT JOIN (
      SELECT 
        project_id,
        COUNT(*) as active_count
      FROM tasks 
      WHERE completed = 0 AND project_id = ?
      GROUP BY project_id
    ) t ON p.id = t.project_id
    WHERE p.id = ?
  `).get(c.req.param('id'), c.req.param('id'));
  
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
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
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
        COALESCE(t.active_count, 0) as active_task_count
      FROM projects p
      LEFT JOIN (
        SELECT 
          project_id,
          COUNT(*) as active_count
        FROM tasks 
        WHERE completed = 0 AND project_id = ?
        GROUP BY project_id
      ) t ON p.id = t.project_id
      WHERE p.id = ?
    `).get(id, id);

    return c.json(updated);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
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
    return c.json({ error: 'Cannot delete project that contains tasks' }, 400);
  }

  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return c.body(null, 204);
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '85a06deb292fbc006424c2365b05d081f4f92fa2581e04a09ee20cb9f7295067',
  name: 'Projects',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;