import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

registerMigration('todos', `
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateTodoSchema = z.object({
  title: z.string().min(1, 'Title must not be empty').max(200, 'Title must not exceed 200 characters'),
});

const UpdateTodoSchema = z.object({
  title: z.string().min(1, 'Title must not be empty').max(200, 'Title must not exceed 200 characters').optional(),
  completed: z.number().int().min(0).max(1).optional(),
});

const router = new Hono();

// List all todos
router.get('/', (c) => {
  const todos = db.prepare('SELECT * FROM todos ORDER BY created_at DESC').all();
  return c.json(todos);
});

// Get single todo
router.get('/:id', (c) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(c.req.param('id'));
  if (!todo) return c.json({ error: 'Not found' }, 404);
  return c.json(todo);
});

// Create todo
router.post('/', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400);
  }
  
  const result = CreateTodoSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }
  
  const { title } = result.data;
  const info = db.prepare('INSERT INTO todos (title) VALUES (?)').run(title);
  const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(info.lastInsertRowid);
  return c.json(todo, 201);
});

// Update todo
router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400);
  }
  
  const result = UpdateTodoSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }
  
  const updates = result.data;
  if (updates.title !== undefined) {
    db.prepare('UPDATE todos SET title = ? WHERE id = ?').run(updates.title, id);
  }
  if (updates.completed !== undefined) {
    db.prepare('UPDATE todos SET completed = ? WHERE id = ?').run(updates.completed, id);
  }
  
  const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  return c.json(updated);
});

// Delete todo
router.delete('/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  
  db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  return c.body(null, 204);
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '9034ad0a11e5572f648cbbbc49401554d7901e78d9b24de3209750fb3a04b1ef',
  name: 'Todos Resource',
  risk_tier: 'high',
  canon_ids: [12 as const],
} as const;