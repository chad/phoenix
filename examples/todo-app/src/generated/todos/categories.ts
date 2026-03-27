import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

registerMigration('categories', `
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#888888',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().optional().default('#888888'),
});

const router = new Hono();

router.get('/', (c) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  return c.json(categories);
});

router.post('/', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  
  const result = CreateCategorySchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: result.error.issues[0].message }, 400);
  }
  
  const { name, color } = result.data;
  
  try {
    const info = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run(name, color);
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
    return c.json(category, 201);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'Category name already exists' }, 400);
    }
    throw error;
  }
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const todosCount = db.prepare('SELECT COUNT(*) as count FROM todos WHERE category_id = ?').get(id) as { count: number };
  if (todosCount.count > 0) {
    return c.json({ error: 'Cannot delete category with todos' }, 400);
  }
  
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return c.body(null, 204);
});

export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '643061e5748a224153e0f670e25f0f3b8edb566356e175dbe8555bab2d2adf49',
  name: 'Categories',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;