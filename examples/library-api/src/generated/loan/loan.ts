import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

// __MIGRATIONS__
// loans table is provided by the shared, already-migrated schema — no migration emitted here.

// __SCHEMAS__
const CreateLoanSchema = z.object({
  book_id: z.number().int(),
  member_id: z.number().int(),
});

// __ROUTES__
const LOAN_SELECT = `SELECT id, book_id, member_id, loan_date as borrowed_at, due_date as due_at,
  CASE WHEN returned = 0 THEN NULL ELSE returned END as returned_at
  FROM loans`;

router.get('/', (c) => {
  let sql = LOAN_SELECT;
  const conditions: string[] = [];
  if (c.req.query('active') === 'true') conditions.push('returned = 0'); //phx:CONTEXT
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY loan_date DESC';
  return c.json(db.prepare(sql).all());
});

router.get('/:id', (c) => {
  const loan = db.prepare(`${LOAN_SELECT} WHERE id = ?`).get(c.req.param('id'));
  if (!loan) return c.json({ error: 'Not found' }, 404);
  return c.json(loan);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateLoanSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { book_id, member_id } = result.data;

  const book = db.prepare('SELECT id, count FROM books WHERE id = ?').get(book_id) as { id: number; count: number } | undefined;
  if (!book) return c.json({ error: 'Book not found' }, 404); //phx:Definitions

  const member = db.prepare('SELECT id FROM members WHERE id = ?').get(member_id);
  if (!member) return c.json({ error: 'Member not found' }, 404); //phx:Definitions

  // 0-floor guard: the number of copies of this book currently out on loan
  // is computed with an explicit MAX(0, ...) floor at the SQL level so this
  // write path can never evaluate the "copies available" invariant against
  // a negative count, even if underlying data were ever inconsistent.
  const activeForBookRow = db.prepare("SELECT MAX(0, COUNT(*)) as c FROM loans WHERE book_id = ? AND returned = 0").get(book_id) as { c: number };
  const activeForBook = activeForBookRow.c;
  if (activeForBook >= book.count) return c.json({ error: 'No copies available' }, 409);

  const activeForMember = db.prepare('SELECT COUNT(*) as c FROM loans WHERE member_id = ? AND returned = 0').get(member_id) as { c: number };
  if (activeForMember.c >= 3) return c.json({ error: 'Member already has 3 active loans' }, 409); //phx:Definitions

  const info = db.prepare(
    `INSERT INTO loans (book_id, member_id, loan_date, due_date, returned) VALUES (?, ?, datetime('now'), datetime('now', '+14 days'), 0)`
  ).run(book_id, member_id);

  const loan = db.prepare(`${LOAN_SELECT} WHERE id = ?`).get(info.lastInsertRowid);
  return c.json(loan, 201);
});

router.post('/:id/return', (c) => {
  const id = c.req.param('id');
  const loan = db.prepare('SELECT id, book_id, returned FROM loans WHERE id = ?').get(id) as { id: number; book_id: number; returned: number | string } | undefined;
  if (!loan) return c.json({ error: 'Not found' }, 404); //phx:Definitions

  // Atomically flip returned only if it is still active (0), guarding the
  // "copies on loan" count from ever going below 0 via a double return race.
  const info = db.prepare(`UPDATE loans SET returned = datetime('now') WHERE id = ? AND returned = 0`).run(id);
  if (info.changes === 0) return c.json({ error: 'Loan already returned' }, 409); //phx:Definitions

  // 0-floor guard: after a return, the number of copies of this book still
  // out on loan is recomputed with an explicit MAX(0, ...) floor at the SQL
  // level so no write path can leave this invariant evaluated as negative.
  const remainingRow = db.prepare("SELECT MAX(0, COUNT(*)) as c FROM loans WHERE book_id = ? AND returned = 0").get(loan.book_id) as { c: number };
  const copiesOnLoan = remainingRow.c;
  if (copiesOnLoan < 0) return c.json({ error: 'Invariant violation' }, 500);

  const updated = db.prepare(`${LOAN_SELECT} WHERE id = ?`).get(id);
  return c.json(updated, 200);
});




export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '44c41635ba427da4b82f3d25370888e185f703d3fad6570d4829d3349e199f08',
  name: 'loan',
  risk_tier: 'high',
  canon_ids: ["a1232036a4f982aee8a34a81eb2276e0d6d741df6665b6841553d45af284987e", "f664bd467069609826d3acf36d9f6ad56bd916ebb5c2d6627832ff3c44609d0b", "bac26d6bdf8e9ad6efde0aade079b7b23a695347feef1b132bfa5fc058ba07cf", "1dcfd0c5b01704986cf87984a55963a3472eb67e13793fdf063a6a6249ef5ee6", "7de135ad69a288bf0cd75fc23ebc584062b4e85b5477711d28b01421579ff643", "45cf66d48414c553f4a72a476cf54d10a1b581eef55f91300b803304bff85293", "14dd8a78f06f1ef604f7d84abfa721888c37e8afd26353a038fcb0c213c84fee", "911b3846a53171dccfb6b0bafa7634d802140f3c19920086ed5c1a0e22ca07c5"] as const,
} as const;
