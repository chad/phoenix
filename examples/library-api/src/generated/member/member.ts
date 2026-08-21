import { Hono } from 'hono';
import { db } from '../../db.js';
import { z } from 'zod';

const router = new Hono();

const CreateMemberSchema = z.object({
  name: z.string().min(1).max(120), //phx:C1
  email: z.string().min(1).refine((e) => e.includes('@'), { message: 'Email must contain @' }), //phx:C3
});
const UpdateMemberSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().min(1).refine((e) => e.includes('@'), { message: 'Email must contain @' }).optional(),
});

router.get('/', (c) => {
  const sql = `
    SELECT members.id, members.name, members.email, members.date as joined_at,
      (SELECT COUNT(*) FROM loans WHERE loans.member_id = members.id AND loans.returned = 0) as active_loans
    FROM members
    ORDER BY members.id
  `;
  return c.json(db.prepare(sql).all());
});

router.get('/:id', (c) => {
  const sql = `
    SELECT members.id, members.name, members.email, members.date as joined_at,
      (SELECT COUNT(*) FROM loans WHERE loans.member_id = members.id AND loans.returned = 0) as active_loans
    FROM members
    WHERE members.id = ?
  `;
  const member = db.prepare(sql).get(c.req.param('id'));
  if (!member) return c.json({ error: 'Not found' }, 404);
  return c.json(member);
});

router.post('/', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = CreateMemberSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { name, email } = result.data;
  const existing = db.prepare('SELECT id FROM members WHERE email = ?').get(email);
  if (existing) return c.json({ error: 'Email already in use' }, 409);
  const info = db.prepare(`INSERT INTO members (name, email, date) VALUES (?, ?, datetime('now'))`).run(name, email);
  const member = db.prepare(`
    SELECT members.id, members.name, members.email, members.date as joined_at,
      (SELECT COUNT(*) FROM loans WHERE loans.member_id = members.id AND loans.returned = 0) as active_loans
    FROM members
    WHERE members.id = ?
  `).get(info.lastInsertRowid);
  return c.json(member, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existingMember = db.prepare('SELECT id FROM members WHERE id = ?').get(id);
  if (!existingMember) return c.json({ error: 'Not found' }, 404);
  let body; try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = UpdateMemberSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  const { name, email } = result.data;
  if (email != null) {
    const existing = db.prepare('SELECT id FROM members WHERE email = ? AND id != ?').get(email, id);
    if (existing) return c.json({ error: 'Email already in use' }, 409);
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (email !== undefined) { fields.push('email = ?'); values.push(email); }
  if (fields.length > 0) {
    values.push(id);
    db.prepare(`UPDATE members SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
  const member = db.prepare(`
    SELECT members.id, members.name, members.email, members.date as joined_at,
      (SELECT COUNT(*) FROM loans WHERE loans.member_id = members.id AND loans.returned = 0) as active_loans
    FROM members
    WHERE members.id = ?
  `).get(id);
  return c.json(member);
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  const member = db.prepare('SELECT id FROM members WHERE id = ?').get(id);
  if (!member) return c.json({ error: 'Not found' }, 404);
  const activeLoan = db.prepare('SELECT id FROM loans WHERE member_id = ? AND returned = 0').get(id);
  if (activeLoan) return c.json({ error: 'Member holds an active loan' }, 409);
  db.prepare('DELETE FROM members WHERE id = ?').run(id);
  return c.body(null, 204);
});




export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '43f635d75ced238550de9f563b7ba033a161ffc5166870ef960f87e95880a13b',
  name: 'member',
  risk_tier: 'high',
  canon_ids: ["a20450168f1d5255e570f8d9b9b718acaba408f9727397561378559da176fe92", "669f08f2374cf075d176874a1bee7b45103654fb2da8fc1f1c5ff7c3708f4c33", "31c748230e50b3826850862ca9cd03339bf3d9faf62c25cc3ee3baaa7a920030", "f6ff5277cff19e2789def11fa9c96193f7cf6a702a70d2de306aba7ef52073a0", "c94f15dead313a77c262c83e3578683c736e96a1c4c16f574037c9655f68b3c2", "d47cb6d246ee58ff7c94f91a34a3bc65656d3c267b3237d5a5d1d6ab3cf5a3f3", "fa098533b1d11e6c2220c8583d04b9921065ddfdfdbabca4e4bc6ea90bcc96c3", "7e7cf25994703c0096a856db473dfd211f3910be4c18606e9f4e753ec5527011", "8404fa5924bb1956958c5e1f767be542b78c89d581527d2cad406db9f66d5ad2", "da4c133160fe885894950c954e200fccee5b35819deada1300be0c4d7107c9d9", "c29ba695db00f8651593d3c5b9de82c4fa25da24ebd6f86f5820b68a5afb77fe"] as const,
} as const;
