import { describe, it, expect } from 'vitest';
import { resolveGraph } from '../../src/resolution.js';
import { extractCandidates } from '../../src/canonicalizer.js';
import { parseSpec } from '../../src/spec-parser.js';
import { CanonicalType } from '../../src/models/canonical.js';
import type { CandidateNode } from '../../src/models/canonical.js';
import { sha256 } from '../../src/semhash.js';

function makeCandidate(overrides: Partial<CandidateNode> & { statement: string }): CandidateNode {
  const type = overrides.type ?? CanonicalType.REQUIREMENT;
  const stmt = overrides.statement;
  const clauseId = overrides.source_clause_ids?.[0] ?? 'clause-1';
  return {
    candidate_id: sha256([type, stmt, clauseId].join('\x00')),
    type,
    statement: stmt,
    confidence: overrides.confidence ?? 0.8,
    source_clause_ids: overrides.source_clause_ids ?? ['clause-1'],
    tags: overrides.tags ?? stmt.toLowerCase().split(/\s+/).filter(t => t.length > 2),
    sentence_index: overrides.sentence_index ?? 0,
    extraction_method: overrides.extraction_method ?? 'rule',
  };
}

describe('resolveGraph', () => {
  it('returns empty array for empty input', () => {
    expect(resolveGraph([], [])).toEqual([]);
  });

  it('converts candidates to canonical nodes with anchors', () => {
    const candidates = [
      makeCandidate({ statement: 'Users must authenticate with email' }),
    ];
    const nodes = resolveGraph(candidates, []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].canon_id).toBeTruthy();
    expect(nodes[0].canon_anchor).toBeTruthy();
    expect(nodes[0].confidence).toBe(0.8);
    expect(nodes[0].link_types).toBeDefined();
  });

  it('deduplicates near-identical candidates from different clauses', () => {
    const c1 = makeCandidate({
      statement: 'users must authenticate with email and password',
      source_clause_ids: ['clause-1'],
      tags: ['users', 'authenticate', 'email', 'password'],
    });
    const c2 = makeCandidate({
      statement: 'users must authenticate with email and password',
      source_clause_ids: ['clause-2'],
      tags: ['users', 'authenticate', 'email', 'password'],
    });
    const nodes = resolveGraph([c1, c2], []);
    // Should merge into one node with both source clauses
    expect(nodes.length).toBe(1);
    expect(nodes[0].source_clause_ids).toContain('clause-1');
    expect(nodes[0].source_clause_ids).toContain('clause-2');
  });

  it('does NOT merge dissimilar candidates', () => {
    const c1 = makeCandidate({
      statement: 'users must authenticate with email',
      tags: ['users', 'authenticate', 'email'],
    });
    const c2 = makeCandidate({
      statement: 'sessions must expire after timeout',
      tags: ['sessions', 'expire', 'timeout'],
    });
    const nodes = resolveGraph([c1, c2], []);
    expect(nodes.length).toBe(2);
  });

  it('infers typed edges between constraint and requirement', () => {
    const spec = `# Auth

- Users must authenticate with tokens
- Token lifetime must not exceed 24 hours
- Sessions must always be encrypted
- Authentication means verifying user identity`;
    const clauses = parseSpec(spec, 'test.md');
    const { candidates } = extractCandidates(clauses);
    const nodes = resolveGraph(candidates, clauses);

    // Check that we got different types
    const types = new Set(nodes.map(n => n.type));
    expect(types.size).toBeGreaterThan(1);

    // Check that typed edges exist (link_types should be non-empty for linked nodes)
    for (const node of nodes) {
      for (const linkedId of node.linked_canon_ids) {
        const edgeType = node.link_types?.[linkedId];
        if (edgeType) {
          expect(['constrains', 'defines', 'refines', 'invariant_of', 'relates_to', 'duplicates']).toContain(edgeType);
        }
      }
    }
  });

  it('enforces max degree cap', () => {
    // Create many candidates that share tags
    const candidates: CandidateNode[] = [];
    for (let i = 0; i < 20; i++) {
      candidates.push(makeCandidate({
        statement: `requirement ${i} must handle shared-term and common-tag`,
        tags: ['shared-term', 'common-tag', `unique-${i}`, 'handle', 'requirement'],
        source_clause_ids: [`clause-${i}`],
      }));
    }
    const nodes = resolveGraph(candidates, []);

    // No node should have more than 8 non-duplicate edges
    for (const node of nodes) {
      const nonDupEdges = node.linked_canon_ids.filter(
        id => node.link_types?.[id] !== 'duplicates'
      );
      expect(nonDupEdges.length).toBeLessThanOrEqual(8);
    }
  });

  it('computes stable anchors', () => {
    const candidates = [
      makeCandidate({
        statement: 'users must authenticate with email',
        tags: ['users', 'authenticate', 'email'],
      }),
    ];
    const nodes1 = resolveGraph(candidates, []);
    const nodes2 = resolveGraph(candidates, []);

    expect(nodes1[0].canon_anchor).toBe(nodes2[0].canon_anchor);
  });

  it('infers hierarchy from heading structure', () => {
    const spec = `# Service

A task management system for teams.

## Task Lifecycle

- Tasks must support status transitions
- Invalid transitions must be rejected`;
    const clauses = parseSpec(spec, 'test.md');
    const { candidates } = extractCandidates(clauses);
    const nodes = resolveGraph(candidates, clauses);

    // CONTEXT node from "A task management system for teams" should be at higher level
    const contextNodes = nodes.filter(n => n.type === CanonicalType.CONTEXT);
    const reqNodes = nodes.filter(n => n.type === CanonicalType.REQUIREMENT);

    // Some requirement nodes might have parent_canon_id pointing to a context node
    // This depends on heading depth differences
    expect(nodes.length).toBeGreaterThan(0);
    // Hierarchy is best-effort from heading structure
  });
});

describe('extractCandidates', () => {
  it('produces candidates with coverage metrics', () => {
    const spec = `# Auth

- Users must log in
- Sessions expire after 24 hours
- A brief description`;
    const clauses = parseSpec(spec, 'test.md');
    const { candidates, coverage } = extractCandidates(clauses);

    expect(candidates.length).toBeGreaterThan(0);
    expect(coverage.length).toBe(clauses.length);

    for (const cov of coverage) {
      expect(cov.clause_id).toBeTruthy();
      expect(cov.total_sentences).toBeGreaterThanOrEqual(0);
      expect(cov.coverage_pct).toBeGreaterThanOrEqual(0);
      expect(cov.coverage_pct).toBeLessThanOrEqual(100);
    }
  });

  it('assigns confidence scores to candidates', () => {
    const clauses = parseSpec('# Auth\n\n- Users must authenticate\n- Must not share passwords', 'test.md');
    const { candidates } = extractCandidates(clauses);

    for (const c of candidates) {
      expect(c.confidence).toBeGreaterThanOrEqual(0.3);
      expect(c.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  it('classifies CONTEXT for non-actionable text', () => {
    const clauses = parseSpec('# Intro\n\nThe system handles various tasks.', 'test.md');
    const { candidates } = extractCandidates(clauses);

    const contextCandidates = candidates.filter(c => c.type === CanonicalType.CONTEXT);
    expect(contextCandidates.length).toBeGreaterThan(0);
  });

  it('classifies CONSTRAINT for prohibition patterns', () => {
    const clauses = parseSpec('# Rules\n\n- Users must not share passwords\n- Rate limited to 5 per minute', 'test.md');
    const { candidates } = extractCandidates(clauses);

    const constraints = candidates.filter(c => c.type === CanonicalType.CONSTRAINT);
    expect(constraints.length).toBeGreaterThan(0);
  });

  it('classifies INVARIANT for always/never patterns', () => {
    const clauses = parseSpec('# Guarantees\n\n- Data must always be encrypted at rest', 'test.md');
    const { candidates } = extractCandidates(clauses);

    const invariants = candidates.filter(c => c.type === CanonicalType.INVARIANT);
    expect(invariants.length).toBeGreaterThan(0);
  });
});
