import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  const members = db.prepare('SELECT COUNT(*) as n FROM members').get() as { n: number };
  const books = db.prepare('SELECT COUNT(*) as n FROM books').get() as { n: number };
  const copiesOnLoan = db.prepare('SELECT COUNT(*) as n FROM loans WHERE returned = 0').get() as { n: number };
  const activeLoans = db.prepare('SELECT COUNT(*) as n FROM loans WHERE returned = 0').get() as { n: number };
  return c.json({
    members: members.n,
    books: books.n,
    copies_on_loan: copiesOnLoan.n,
    active_loans: activeLoans.n,
  });
});




export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '4becec2b5cf6add402c248133e7f6f49e68798896fc7549465238e4627867613',
  name: 'summary',
  risk_tier: 'low',
  canon_ids: ["7f555374bc4fca20030955f9e0c3da106109f840876d2b829267fd6f4793e633"] as const,
} as const;
