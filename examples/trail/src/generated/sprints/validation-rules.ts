import { Hono } from 'hono';
import { db, registerMigration } from '../../db.js';
import { z } from 'zod';

// ─── Database migrations ────────────────────────────────────────────────────

// ─── Database migrations ────────────────────────────────────────────────────

registerMigration('validation_rules', `
  CREATE TABLE IF NOT EXISTS validation_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_type TEXT NOT NULL,
    field_name TEXT NOT NULL,
    constraint_value TEXT,
    error_message TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateValidationRuleSchema = z.object({
  rule_type: z.string().min(1),
  field_name: z.string().min(1),
  constraint_value: z.string().optional(),
  error_message: z.string().min(1),
  is_active: z.boolean().optional().default(true),
});

const UpdateValidationRuleSchema = z.object({
  rule_type: z.string().min(1).optional(),
  field_name: z.string().min(1).optional(),
  constraint_value: z.string().optional(),
  error_message: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

const ValidateDataSchema = z.object({
  sprint_name: z.string().optional(),
  sprint_goal: z.string().optional(),
  capacity: z.number().int().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

// ─── Routes ─────────────────────────────────────────────────────────────────

const router = new Hono();

router.get('/', (c) => {
  let sql = 'SELECT * FROM validation_rules';
  const conditions: string[] = [];
  const params: unknown[] = [];
  
  const ruleType = c.req.query('rule_type');
  if (ruleType !== undefined) { 
    conditions.push('rule_type = ?'); 
    params.push(ruleType); 
  }
  
  const fieldName = c.req.query('field_name');
  if (fieldName !== undefined) { 
    conditions.push('field_name = ?'); 
    params.push(fieldName); 
  }
  
  const isActive = c.req.query('is_active');
  if (isActive !== undefined) { 
    conditions.push('is_active = ?'); 
    params.push(isActive === 'true' ? 1 : 0); 
  }
  
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY field_name, rule_type';
  
  return c.json(db.prepare(sql).all(...params));
});

router.get('/:id', (c) => {
  const rule = db.prepare('SELECT * FROM validation_rules WHERE id = ?').get(c.req.param('id'));
  if (!rule) return c.json({ error: 'Not found' }, 404);
  return c.json(rule);
});

router.post('/', async (c) => {
  let body; 
  try { 
    body = await c.req.json(); 
  } catch { 
    return c.json({ error: 'Invalid JSON' }, 400); 
  }
  
  const result = CreateValidationRuleSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const { rule_type, field_name, constraint_value, error_message, is_active } = result.data;
  
  const info = db.prepare('INSERT INTO validation_rules (rule_type, field_name, constraint_value, error_message, is_active) VALUES (?, ?, ?, ?, ?)').run(
    rule_type, 
    field_name, 
    constraint_value ?? null, 
    error_message, 
    is_active ? 1 : 0
  );
  
  const rule = db.prepare('SELECT * FROM validation_rules WHERE id = ?').get(info.lastInsertRowid);
  return c.json(rule, 201);
});

router.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM validation_rules WHERE id = ?').get(id)) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  let body; 
  try { 
    body = await c.req.json(); 
  } catch { 
    return c.json({ error: 'Invalid JSON' }, 400); 
  }
  
  const result = UpdateValidationRuleSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const u = result.data;
  if (u.rule_type !== undefined) db.prepare('UPDATE validation_rules SET rule_type = ? WHERE id = ?').run(u.rule_type, id);
  if (u.field_name !== undefined) db.prepare('UPDATE validation_rules SET field_name = ? WHERE id = ?').run(u.field_name, id);
  if (u.constraint_value !== undefined) db.prepare('UPDATE validation_rules SET constraint_value = ? WHERE id = ?').run(u.constraint_value, id);
  if (u.error_message !== undefined) db.prepare('UPDATE validation_rules SET error_message = ? WHERE id = ?').run(u.error_message, id);
  if (u.is_active !== undefined) db.prepare('UPDATE validation_rules SET is_active = ? WHERE id = ?').run(u.is_active ? 1 : 0, id);
  
  return c.json(db.prepare('SELECT * FROM validation_rules WHERE id = ?').get(id));
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT id FROM validation_rules WHERE id = ?').get(id)) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  db.prepare('DELETE FROM validation_rules WHERE id = ?').run(id);
  return c.body(null, 204);
});

router.post('/validate', async (c) => {
  let body; 
  try { 
    body = await c.req.json(); 
  } catch { 
    return c.json({ error: 'Invalid JSON' }, 400); 
  }
  
  const result = ValidateDataSchema.safeParse(body);
  if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
  
  const data = result.data;
  const errors: string[] = [];
  
  // Sprint name validation
  if (data.sprint_name !== undefined) {
    if (data.sprint_name.trim() === '') {
      errors.push('Sprint name cannot be empty');
    }
    if (data.sprint_name.length > 80) {
      errors.push('Sprint name must not exceed 80 characters');
    }
  }
  
  // Goal validation
  if (data.sprint_goal !== undefined && data.sprint_goal.length > 280) {
    errors.push('Goal must not exceed 280 characters');
  }
  
  // Capacity validation
  if (data.capacity !== undefined) {
    if (data.capacity <= 0 || !Number.isInteger(data.capacity)) {
      errors.push('Capacity must be a positive whole number of points');
    }
  }
  
  // Date validation
  if (data.start_date !== undefined || data.end_date !== undefined) {
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    
    if (data.start_date !== undefined) {
      startDate = new Date(data.start_date);
      if (isNaN(startDate.getTime())) {
        errors.push('Start date must be a valid date');
      }
    }
    
    if (data.end_date !== undefined) {
      endDate = new Date(data.end_date);
      if (isNaN(endDate.getTime())) {
        errors.push('End date must be a valid date');
      }
    }
    
    if (startDate && endDate && endDate < startDate) {
      errors.push('End date cannot be before start date');
    }
  }
  
  if (errors.length > 0) {
    return c.json({ valid: false, errors }, 400);
  }
  
  return c.json({ valid: true, errors: [] });
});



export default router;

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '4a4622a3a3ec9de392c28305561d96fe02b9a6f5b1d9b20761efa0b7e1479ff8',
  name: 'Validation rules',
  risk_tier: 'high',
  canon_ids: [6 as const],
} as const;
