/**
 * Gold-standard change pairs — a labeled dataset for classifier accuracy.
 *
 * Before Phase 3 the A/B/C/D classifier had NO accuracy baseline: its tests
 * were near-tautological and its own experiment report admitted classification
 * was "untested". The D-rate loop would tune a classifier whose accuracy nobody
 * had measured. This dataset is the held-out ground truth.
 *
 * Each pair is (before, after, expected class) with the reasoning:
 *   A = trivial (formatting/whitespace/punctuation/reordering — no meaning change)
 *   B = local semantic change (wording/value change within one clause's concept)
 *   C = contextual shift (section move, or change touching many canonical concepts)
 *   D = uncertain (genuinely ambiguous large rewrite)
 *
 * Labels are conservative: a change is only A if a human would agree no
 * regeneration is warranted.
 */

import { ChangeClass } from '../../src/models/classification.js';

export interface ChangePair {
  id: string;
  section: string[];
  before: string;
  after: string;
  expected: ChangeClass;
  /** Acceptable alternatives — classification is graded correct if it lands in this set. */
  acceptable?: ChangeClass[];
  note: string;
}

export const CHANGE_PAIRS: ChangePair[] = [
  // ── Class A: formatting only ──
  {
    id: 'a-whitespace',
    section: ['Tasks'],
    before: 'A task must have a title.',
    after: 'A task must have a title.',
    expected: ChangeClass.A,
    note: 'identical — no change at all',
  },
  {
    id: 'a-trailing-space',
    section: ['Tasks'],
    before: 'A task must have a title.',
    after: 'A task must have a title.   ',
    expected: ChangeClass.A,
    note: 'trailing whitespace normalizes away',
  },
  {
    id: 'a-case',
    section: ['Tasks'],
    before: 'A Task must have a Title.',
    after: 'A task must have a title.',
    expected: ChangeClass.A,
    acceptable: [ChangeClass.A, ChangeClass.B],
    note: 'capitalization only',
  },

  // ── Class B: local semantic change ──
  {
    id: 'b-value',
    section: ['Auth'],
    before: 'Passwords must be hashed with bcrypt.',
    after: 'Passwords must be hashed with argon2id.',
    expected: ChangeClass.B,
    acceptable: [ChangeClass.B, ChangeClass.C],
    note: 'algorithm value changed — real local semantic change',
  },
  {
    id: 'b-number',
    section: ['Limits'],
    before: 'A title must be under 200 characters.',
    after: 'A title must be under 500 characters.',
    expected: ChangeClass.B,
    note: 'numeric bound changed',
  },
  {
    id: 'b-add-attribute',
    section: ['Tasks'],
    before: 'A task has a title and a priority.',
    after: 'A task has a title, a priority, and a due date.',
    expected: ChangeClass.B,
    acceptable: [ChangeClass.B, ChangeClass.C],
    note: 'added an attribute — expands the concept',
  },
  {
    id: 'b-synonym-plus-meaning',
    section: ['Customers'],
    before: 'Users can register and manage customers.',
    after: 'Users can register, manage, and deactivate customers.',
    expected: ChangeClass.B,
    acceptable: [ChangeClass.B, ChangeClass.C],
    note: 'added an operation — local change',
  },

  // ── Class C: contextual shift ──
  {
    id: 'c-negation-flip',
    section: ['Auth'],
    before: 'Sessions may be shared across devices.',
    after: 'Sessions must never be shared across devices.',
    expected: ChangeClass.C,
    acceptable: [ChangeClass.B, ChangeClass.C],
    note: 'permission flipped to an invariant — changes the type/severity',
  },

  // ── Class A/B: pure synonym reword (meaning preserved) ──
  {
    id: 'a-reword-synonym',
    section: ['Tasks'],
    before: 'A task title must not be empty.',
    after: 'A task title cannot be empty.',
    expected: ChangeClass.B,
    acceptable: [ChangeClass.A, ChangeClass.B],
    note: 'must not → cannot: meaning preserved; A or B both defensible',
  },
];
