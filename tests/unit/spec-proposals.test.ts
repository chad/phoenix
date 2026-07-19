/**
 * Spec proposals — the spec talks back (P2).
 *
 * The trust contract under test:
 *   1. Every surfaced rewording is VALIDATED by re-running the frozen extractor — the
 *      proposal carries the receipt of what would be captured. Nothing ships on hope.
 *   2. Proposals are read-only: the original spec line is preserved verbatim and no
 *      input structure is mutated. Intent is human-sovereign.
 *   3. Honesty: when no rewording validates, the output says "no confident proposal" —
 *      it never fabricates a fix. Conflicting bounds are informational only (the spec
 *      contradicting itself is a human decision).
 *
 * Fixtures mirror the two real failure classes: the afterimage binding defect ("the
 * room tension must not exceed 5" — subject the graph can't place) and the rule-floor
 * paraphrase misses (normative sentences no rule cue captures).
 */

import { describe, it, expect } from 'vitest';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CanonicalNode } from '../../src/models/canonical.js';
import type { Clause } from '../../src/models/clause.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import { proposeSpecFixes, renderSpecProposals, type SpecProposalInput } from '../../src/spec-proposals.js';

function iu(name: string): ImplementationUnit {
  return {
    iu_id: 'iu-' + name, kind: 'module', name, risk_tier: 'low',
    contract: { description: '', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: [`src/generated/${name}/${name}.ts`],
  };
}

let seq = 0;
const clause = (text: string, doc = 'spec/app.md', line = 1): Clause => ({
  clause_id: `cl-${seq++}`, source_doc_id: doc, source_line_range: [line, line],
  raw_text: text, normalized_text: text.toLowerCase(), section_path: [],
  clause_semhash: 'h', context_semhash_cold: 'h',
});
const node = (statement: string, type: CanonicalType, cl: Clause, tags: string[] = []): CanonicalNode => ({
  canon_id: `n-${seq++}`, type, statement, source_clause_ids: [cl.clause_id],
  linked_canon_ids: [], tags,
} as unknown as CanonicalNode);

function fixture(opts: {
  ius: ImplementationUnit[];
  spec: string[];                       // spec/app.md lines (1-based by index+1)
  defs: string[];
  rules: Array<{ line: number; tags?: string[] }>;
  tracked?: Set<string>;
}): SpecProposalInput {
  const clauses: Clause[] = [];
  const canonNodes: CanonicalNode[] = [];
  for (const d of opts.defs) {
    const cl = clause(d, 'spec/app.md', opts.spec.indexOf(d) + 1 || 1);
    clauses.push(cl);
    canonNodes.push(node(d.toLowerCase(), CanonicalType.DEFINITION, cl));
  }
  for (const r of opts.rules) {
    const text = opts.spec[r.line - 1];
    const cl = clause(text, 'spec/app.md', r.line);
    clauses.push(cl);
    canonNodes.push(node(text.toLowerCase().replace(/\.$/, ''), CanonicalType.CONSTRAINT, cl, r.tags ?? []));
  }
  return { ius: opts.ius, canonNodes, clauses, specLines: new Map([['spec/app.md', opts.spec]]), trackedByEval: opts.tracked };
}

// ─── defects: entity qualification, validated ────────────────────────────────
describe('binding defects → validated entity-qualification proposals', () => {
  const input = fixture({
    ius: [iu('match')],
    spec: [
      'a match has players and a score',
      'the room tension must not exceed 5',
    ],
    defs: ['a match has players and a score'],
    rules: [{ line: 2, tags: ['match', 'tension'] }],
  });

  it('proposes qualifying the unbound subject with its entity — with a re-extraction receipt', () => {
    const proposals = proposeSpecFixes(input);
    const p = proposals.find(x => x.kind === 'rewording');
    expect(p, 'a rewording proposal exists').toBeDefined();
    expect(p!.doc).toBe('spec/app.md');
    expect(p!.line).toBe(2);
    expect(p!.original).toBe('the room tension must not exceed 5');
    expect(p!.proposed).toBe('the match room tension must not exceed 5');
    expect(p!.validation).toContain('match.tension');
    expect(p!.validation).toContain('≤ 5');
    expect(p!.resolves).toContain('"room"');
  });

  it('is read-only: inputs are never mutated and the original line is preserved', () => {
    const before = input.specLines.get('spec/app.md')!.slice();
    const canonBefore = JSON.stringify(input.canonNodes);
    proposeSpecFixes(input);
    expect(input.specLines.get('spec/app.md')).toEqual(before);
    expect(JSON.stringify(input.canonNodes)).toBe(canonBefore);
  });
});

describe('a defect with no safe insertion point → honest no-confident-proposal', () => {
  it('never fabricates a fix', () => {
    // The defect subject (from the canonical statement) does not appear in the spec
    // line as written — there is no safe place to insert an entity qualifier, so the
    // honest answer is no proposal, not a guess.
    const input = fixture({
      ius: [iu('match')],
      spec: ['a match has players and a score', 'tension is capped at 5'],
      defs: ['a match has players and a score'],
      rules: [{ line: 2, tags: ['match', 'tension'] }],
    });
    // Force the canonical statement to name a subject the raw line does not contain.
    const ruleNode = input.canonNodes.find(n => n.type === CanonicalType.CONSTRAINT)!;
    ruleNode.statement = 'the room tension must not exceed 5';
    const proposals = proposeSpecFixes(input);
    expect(proposals.some(p => p.kind === 'rewording')).toBe(false);
    const nc = proposals.find(p => p.kind === 'no-confident-proposal');
    expect(nc).toBeDefined();
    expect(nc!.rationale).toContain('no safe insertion point');
  });
});

// ─── obligations: cue canonicalization, validated ────────────────────────────
describe('unverified obligations → validated cue-canonicalization proposals', () => {
  it.each([
    ['a habit cadence can only be daily or weekly', 'must be one of daily, weekly'],
    ['a habit cadence must be restricted to daily and weekly', 'must be one of daily, weekly'],
    ['customer emails shall not repeat', 'must be unique'],
    ['an order cannot be empty of line items', 'must have at least one'],
    ['a habit name must be capped at 80 characters', 'must not exceed 80'],
  ])('"%s" → a validated rewording', (line, mustContain) => {
    const entity = line.includes('customer') ? 'customer' : line.includes('order') ? 'order' : 'habit';
    const defLine = entity === 'customer' ? 'a customer has an email and a name'
      : entity === 'order' ? 'an order has a total and line items'
      : 'a habit has a name and a cadence';
    const input = fixture({
      ius: [iu(entity)],
      spec: [defLine, line],
      defs: [defLine],
      rules: [{ line: 2 }],
    });
    const p = proposeSpecFixes(input).find(x => x.kind === 'rewording');
    expect(p, `a validated rewording for "${line}"`).toBeDefined();
    expect(p!.proposed!.toLowerCase()).toContain(mustContain);
    expect(p!.validation).toContain('re-extraction captures:');
    expect(p!.resolves).toContain('unverified obligation');
  });

  it('an obligation the table cannot canonicalize → no-confident-proposal (honest)', () => {
    const input = fixture({
      ius: [iu('habit')],
      spec: ['a habit has a name and a cadence', 'a habit name should resonate with the user'],
      defs: ['a habit has a name and a cadence'],
      rules: [{ line: 2 }],
    });
    const proposals = proposeSpecFixes(input);
    expect(proposals.some(p => p.kind === 'rewording')).toBe(false);
    expect(proposals.some(p => p.kind === 'no-confident-proposal')).toBe(true);
  });

  it('eval-verified obligations are NOT re-proposed (status parity via trackedByEval)', () => {
    const input = fixture({
      ius: [iu('habit')],
      spec: ['a habit has a name and a cadence', 'a habit cadence can only be daily or weekly'],
      defs: ['a habit has a name and a cadence'],
      rules: [{ line: 2 }],
    });
    const ruleNode = input.canonNodes.find(n => n.type === CanonicalType.CONSTRAINT)!;
    const withTracking = { ...input, trackedByEval: new Set([ruleNode.canon_id]) };
    expect(proposeSpecFixes(withTracking).some(p => p.kind === 'rewording')).toBe(false);
  });
});

// ─── conflicting bounds: informational only ──────────────────────────────────
describe('conflicting bounds → informational, never a rewording', () => {
  it('names both lines and both values; no auto-fix', () => {
    const input = fixture({
      ius: [iu('habit')],
      spec: [
        'a habit has a name and a color',
        'a habit name must not exceed 60 characters',
        'a habit name must not exceed 80 characters',
      ],
      defs: ['a habit has a name and a color'],
      rules: [{ line: 2, tags: ['name'] }, { line: 3, tags: ['name'] }],
    });
    const proposals = proposeSpecFixes(input);
    const info = proposals.find(p => p.kind === 'informational');
    expect(info).toBeDefined();
    expect(info!.rationale).toContain('60');
    expect(info!.rationale).toContain('80');
    expect(info!.rationale).toContain('spec/app.md:2');
    expect(info!.rationale).toContain('spec/app.md:3');
    expect(info!.proposed).toBeUndefined();
  });
});

// ─── rendering ────────────────────────────────────────────────────────────────
describe('renderSpecProposals', () => {
  it('renders unified hunks with provenance and the re-extraction receipt', () => {
    const input = fixture({
      ius: [iu('match')],
      spec: ['a match has players and a score', 'the room tension must not exceed 5'],
      defs: ['a match has players and a score'],
      rules: [{ line: 2, tags: ['match', 'tension'] }],
    });
    const text = renderSpecProposals(proposeSpecFixes(input));
    expect(text).toContain('--- a/spec/app.md');
    expect(text).toContain('+++ b/spec/app.md');
    expect(text).toContain('@@ -2,1 +2,1 @@');
    expect(text).toContain('-the room tension must not exceed 5');
    expect(text).toContain('+the match room tension must not exceed 5');
    expect(text).toContain('# resolves: binding defect "room"');
    expect(text).toContain('# validation: re-extraction captures: match.tension');
  });

  it('says so when there is nothing to propose', () => {
    const input = fixture({
      ius: [iu('habit')],
      spec: ['a habit has a name and a color', 'a habit name must not exceed 80 characters'],
      defs: ['a habit has a name and a color'],
      rules: [{ line: 2, tags: ['name'] }],
    });
    expect(renderSpecProposals(proposeSpecFixes(input))).toContain('no spec proposals');
  });
});
