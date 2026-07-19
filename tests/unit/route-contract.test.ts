/**
 * Route-contract reader — the seeder overlay (P2).
 *
 * The seeder derives create bodies from the DDL + the constraint algebra, but some
 * acceptance requirements live only in the generated module's Zod create-schema. This
 * reader recovers them. The suite proves:
 *   1. It reads the real generated shapes: named-const enums, inline enums, unions of
 *      literals, CSV-length refines, optional()/default() requiredness, scalar families.
 *   2. It ABSTAINS on what it does not recognize (a missing schema, an unfamiliar shape)
 *      — a partial or empty contract, never a guess (the overlay only makes seeding
 *      more valid; it must never invent acceptance facts).
 *   3. The seeder honors the precedence: DDL CHECK → route enum → constraint algebra →
 *      csv-min-parts → type default.
 */

import { describe, it, expect } from 'vitest';
import { parseRouteContract } from '../../src/route-contract.js';
import { synthesizeColumnValue, makeSeededRng, type ColumnSchema } from '../../src/live-seed.js';
import type { StructuredConstraint } from '../../src/constraints/model.js';

const MODULE = `
import { z } from 'zod';

const PRIORITIES = ['low', 'normal', 'high'] as const;

const CreateHabitSchema = z.object({
  name: z.string().min(1).max(80),
  cadence: z.enum(['daily', 'weekly']),
  priority: z.enum(PRIORITIES),
  tags: z.string().refine(s => s.split(',').length >= 2),
  color: z.string().optional(),
  note: z.string().nullable().optional(),
  points: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  retries: z.number().int().default(0),
});

const UpdateHabitSchema = z.object({
  name: z.string().optional(),
});
`;

describe('parseRouteContract', () => {
  const c = parseRouteContract(MODULE);

  it('reads inline enums, named-const enums, and unions of literals', () => {
    expect(c.get('cadence')?.enumValues).toEqual(['daily', 'weekly']);
    expect(c.get('priority')?.enumValues).toEqual(['low', 'normal', 'high']);
    expect(c.get('points')?.enumValues).toEqual([1, 2, 3]);
  });

  it('reads the CSV-length refine (the afterimage cold-start shape)', () => {
    expect(c.get('tags')?.csvMinParts).toBe(2);
  });

  it('reads requiredness: .optional() and .default() mark a field omittable', () => {
    expect(c.get('name')?.optional).toBe(false);
    expect(c.get('tags')?.optional).toBe(false);
    expect(c.get('color')?.optional).toBe(true);
    expect(c.get('note')?.optional).toBe(true);
    expect(c.get('retries')?.optional).toBe(true); // .default(0) — the route supplies it
  });

  it('reads scalar families', () => {
    expect(c.get('name')?.scalar).toBe('string');
    expect(c.get('retries')?.scalar).toBe('number');
  });

  it('prefers the Create schema over the Update schema', () => {
    // UpdateHabitSchema marks name optional; the CREATE schema is the POST contract.
    expect(c.get('name')?.optional).toBe(false);
  });

  it('abstains on sources with no schema and never invents fields', () => {
    expect(parseRouteContract('const x = 1;').size).toBe(0);
    expect(parseRouteContract('').size).toBe(0);
  });
});

// ─── the seeder honors the precedence ─────────────────────────────────────────
describe('synthesizeColumnValue with a route-contract overlay', () => {
  const rng = makeSeededRng();
  const col = (over: Partial<ColumnSchema>): ColumnSchema => ({
    name: 'f', type: 'text', notNull: true, hasDefault: false,
    isPrimaryKey: false, isAutoincrement: false, ...over,
  });
  const membership: StructuredConstraint = {
    constraint_id: 'x', binding: { entity: 'habit', attribute: 'f' },
    assertion: { kind: 'membership', values: ['specA', 'specB'] }, source: { statement: 's' },
  };

  it('DDL CHECK beats the route enum beats the constraint algebra', () => {
    expect(synthesizeColumnValue(col({ checkEnum: ['ddl1'] }), [membership], rng, undefined,
      { enumValues: ['route1'], optional: false })).toBe('ddl1');
    expect(synthesizeColumnValue(col({}), [membership], rng, undefined,
      { enumValues: ['route1'], optional: false })).toBe('route1');
    expect(synthesizeColumnValue(col({}), [membership], rng)).toBe('specA');
  });

  it('csv-min-parts applies after the constraint algebra (a membership on the field wins)', () => {
    expect(synthesizeColumnValue(col({ name: 'tags' }), [], rng, undefined,
      { csvMinParts: 3, optional: false })).toBe('part1,part2,part3');
    expect(synthesizeColumnValue(col({ name: 'tags' }), [membership], rng, undefined,
      { csvMinParts: 3, optional: false })).toBe('specA');
  });

  it('scalar family fills in when the SQL type is too coarse', () => {
    expect(synthesizeColumnValue(col({ type: '' }), [], rng, undefined, { scalar: 'boolean', optional: false })).toBe(true);
    expect(typeof synthesizeColumnValue(col({ type: '' }), [], rng, undefined, { scalar: 'number', optional: false })).toBe('number');
  });
});

describe('the afterimage dialect (real generated shapes from ~/afterimage)', () => {
  it('resolves a named ZOD-const enum behind a bare field reference', () => {
    const src = `
const CardTypeEnum = z.enum(['note', 'motif', 'texture', 'interruption', 'cue', 'room']);
const CreateCardSchema = z.object({
  name: z.string().min(1).max(60),
  type: CardTypeEnum,
  intensity: z.number().int().min(1).max(5),
});
`;
    const c = parseRouteContract(src);
    expect(c.get('type')?.enumValues).toEqual(['note', 'motif', 'texture', 'interruption', 'cue', 'room']);
    expect(c.get('type')?.optional).toBe(false);
    expect(c.get('name')?.optional).toBe(false);
  });

  it('a cross-field .refine() is NOT claimed as a csv contract (unknown shapes abstain)', () => {
    const src = `
const CreateDeckSchema = z.object({
  ensemble_id: z.number().int(),
  cards: z.array(CardSchema).min(30),
}).refine(
  (deck) => deck.cards.length >= 30,
  { message: 'a deck needs at least 30 cards' }
);
`;
    const c = parseRouteContract(src);
    expect(c.get('cards')?.csvMinParts).toBeUndefined();
    expect(c.get('ensemble_id')?.scalar).toBe('number');
  });
});
