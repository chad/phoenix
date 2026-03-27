import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// Register table migrations
registerMigration('categories', `
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

registerMigration('todos', `
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateTodoSchema = z.object({
  title: z.string().min(1).max(200),
  category_id: z.number().int().optional(),
});

const UpdateTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  completed: z.number().int().min(0).max(1).optional(),
  category_id: z.number().int().nullable().optional(),
});

const router = new Hono();

// List todos with filtering and category names
router.get('/', (c) => {
  let sql = 'SELECT todos.*, categories.name as category_name FROM todos LEFT JOIN categories ON todos.category_id = categories.id';
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const completed = c.req.query('completed');
  if (completed !== undefined) {
    conditions.push('todos.completed = ?');
    params.push(Number(completed));
  }

  const categoryId = c.req.query('category_id');
  if (categoryId !== undefined) {
    conditions.push('todos.category_id = ?');
    params.push(Number(categoryId));
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY todos.created_at DESC';

  return c.json(db.prepare(sql).all(...params));
});

// Get stats
router.get('/stats', (c) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM todos').get() as { count: number };
  const completed = db.prepare('SELECT COUNT(*) as count FROM todos WHERE completed = 1').get() as { count: number };
  const incomplete = db.prepare('SELECT COUNT(*) as count FROM todos WHERE completed = 0').get() as { count: number };
  
  const byCategory = db.prepare(`
    SELECT categories.name as category_name, COUNT(todos.id) as count 
    FROM categories 
    LEFT JOIN todos ON categories.id = todos.category_id 
    GROUP BY categories.id, categories.name 
    ORDER BY count DESC
  `).all() as { category_name: string; count: number }[];

  return c.json({
    total: total.count,
    completed: completed.count,
    incomplete: incomplete.count,
    by_category: byCategory
  });
});

// Get single todo
router.get('/:id', (c) => {
  const todo = db.prepare('SELECT todos.*, categories.name as category_name FROM todos LEFT JOIN categories ON todos.category_id = categories.id WHERE todos.id = ?').get(c.req.param('id'));
  if (!todo) return c.json({ error: 'Not found' }, 404);
  return c.json(todo);
});

// Create todo
router.post('/', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = CreateTodoSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }

  const { title, category_id } = result.data;

  // Validate category exists if provided
  if (category_id !== undefined) {
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
    if (!category) {
      return c.json({ error: 'Category not found' }, 400);
    }
  }

  const info = db.prepare('INSERT INTO todos (title, category_id) VALUES (?, ?)').run(title, category_id ?? null);
  const todo = db.prepare('SELECT todos.*, categories.name as category_name FROM todos LEFT JOIN categories ON todos.category_id = categories.id WHERE todos.id = ?').get(info.lastInsertRowid);
  return c.json(todo, 201);
});

// Update todo
router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = UpdateTodoSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }

  const updates = result.data;

  // Validate category exists if provided
  if (updates.category_id !== undefined && updates.category_id !== null) {
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(updates.category_id);
    if (!category) {
      return c.json({ error: 'Category not found' }, 400);
    }
  }

  if (updates.title !== undefined) {
    db.prepare('UPDATE todos SET title = ? WHERE id = ?').run(updates.title, id);
  }
  if (updates.completed !== undefined) {
    db.prepare('UPDATE todos SET completed = ? WHERE id = ?').run(updates.completed, id);
  }
  if (updates.category_id !== undefined) {
    db.prepare('UPDATE todos SET category_id = ? WHERE id = ?').run(updates.category_id, id);
  }

  const updated = db.prepare('SELECT todos.*, categories.name as category_name FROM todos LEFT JOIN categories ON todos.category_id = categories.id WHERE todos.id = ?').get(id);
  return c.json(updated);
});

// Delete todo
router.delete('/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  return c.body(null, 204);
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '614d1c26e17fec59d237b38cb78d14045816af536a424d086aee82f154b0e287',
  name: 'Todos',
  risk_tier: 'high',
  canon_ids: [13 as const],
} as const;