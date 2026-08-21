import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

registerMigration('books', `
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    isbn TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const CreateBookSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  isbn: z.string().nullable().optional(),
  copies_total: z.number().int().min(1),
});

const UpdateBookSchema = z.object({
  title: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  isbn: z.string().nullable().optional(),
  copies_total: z.number().int().min(1).optional(),
});

const BOOK_SELECT = `SELECT id, title, author, isbn, copies_total, copies_available FROM (
  SELECT books.id, books.title, books.author, books.isbn, books.count AS copies_total,
    (books.count - (SELECT COUNT(*) FROM loans WHERE loans.book_id = books.id AND loans.returned = 0)) AS copies_available
  FROM books
)`;

router.get('/', (c) => {
  let sql = BOOK_SELECT;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (c.req.query('available') === 'true') { conditions.push('copies_available >= 1'); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const book = db.prepare(`${BOOK_SELECT} WHERE id = ?`).get(c.req.param('id'));
  if (!book) return c.json({ error: 'Not found' }, 404);
  return c.json(book);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateBookSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { title, author, isbn, copies_total } = result.data;
  if (isbn != null) {
    const existing = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn);
    if (existing) return c.json({ error: 'ISBN already exists' }, 409);
  }
  const info = db.prepare('INSERT INTO books (title, author, isbn, count) VALUES (?, ?, ?, ?)').run(title, author, isbn ?? null, copies_total);
  const book = db.prepare(`${BOOK_SELECT} WHERE id = ?`).get(info.lastInsertRowid);
  return c.json(book, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateBookSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const u = result.data;
  if (u.isbn != null) {
    const existing = db.prepare('SELECT id FROM books WHERE isbn = ? AND id != ?').get(u.isbn, id);
    if (existing) return c.json({ error: 'ISBN already exists' }, 409);
  }
  if (u.title !== undefined) db.prepare('UPDATE books SET title = ? WHERE id = ?').run(u.title, id);
  if (u.author !== undefined) db.prepare('UPDATE books SET author = ? WHERE id = ?').run(u.author, id);
  if (u.isbn !== undefined) db.prepare('UPDATE books SET isbn = ? WHERE id = ?').run(u.isbn, id);
  if (u.copies_total !== undefined) db.prepare('UPDATE books SET count = ? WHERE id = ?').run(u.copies_total, id);
  return c.json(db.prepare(`${BOOK_SELECT} WHERE id = ?`).get(id));
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM books WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  const activeLoan = db.prepare('SELECT id FROM loans WHERE book_id = ? AND returned = 0').get(id);
  if (activeLoan) return c.json({ error: 'Cannot delete book with active loans' }, 409);
  db.prepare('DELETE FROM books WHERE id = ?').run(id);
  return c.body(null, 204);
});




export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '58ecb19058ff698225ee3951a4a6da0e7e2eee519d2e2d49f5f1442e4f6c3788',
  name: 'book',
  risk_tier: 'high',
  canon_ids: ["46aa8fa025803db34191884e1fb8019733234becd2659afc20fc307f024d1a92", "72af351a1dc27d77c55bdda72090b9b48bb4fa80c603d1941893e025b8072f13", "7fb633551f985841740f3f69faa39fb0df5ffd781cbf90e63f10d7086bd44b1f", "8de21afe31f1b166f1d45908a980546ab363f3cedd962183456f17c07ea2f83a", "158522b8b2bf56ce4ae7a2b5a075fba48a31cc19b2662fddd5f694b727a2d12c", "a688b1bccc762a0c162ce9206f9ac8d3adf0ad431a151607d90facc1e16e396b", "1e86e5018b7aa78e8c642d385588b62e48e17f9f7d078d125d5e6d3eb12b59a7"] as const,
} as const;
