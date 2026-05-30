import { describe, it, expect } from 'vitest';
import { extractContract } from '../../src/regen.js';
import { buildPrompt, type SiblingContract } from '../../src/llm/prompt.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';
import type { CanonicalNode } from '../../src/models/canonical.js';

const ISSUES_MODULE = `import { Hono } from 'hono';
const router = new Hono();

const CreateIssueSchema = z.object({
  title: z.string().min(1).max(500),
  points: z.number().int().nullable().optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done']).optional(),
  labels: z.string().optional(),
});

router.get('/', (c) => c.json([]));
router.patch('/:id', async (c) => c.json({}));
export default router;`;

describe('extractContract', () => {
  it('pulls out zod schemas and routes, dropping the noise', () => {
    const c = extractContract(ISSUES_MODULE);
    expect(c).toContain('CreateIssueSchema');
    expect(c).toContain("points: z.number().int().nullable().optional()");
    expect(c).toContain("status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done'])");
    expect(c).toContain("router.get('/')");
    expect(c).toContain("router.patch('/:id')");
    // not the whole file
    expect(c).not.toContain("import { Hono }");
  });

  it('returns empty for a module with no schema or routes', () => {
    expect(extractContract('const x = 1;\nexport const _phoenix = {};')).toBe('');
  });
});

function makeIU(name: string): ImplementationUnit {
  return {
    iu_id: 'iu-board', kind: 'module', name, risk_tier: 'high',
    contract: { description: 'board', inputs: [], outputs: [], invariants: [] },
    source_canon_ids: [], dependencies: [], boundary_policy: defaultBoundaryPolicy(),
    enforcement: defaultEnforcement(), evidence_policy: { required: [] },
    output_files: ['src/generated/board/design.ts'],
  };
}
const NODES: CanonicalNode[] = [];

describe('buildPrompt sibling contract injection', () => {
  it('injects the real API contract so the consumer is generated against it', () => {
    const siblingContracts: SiblingContract[] = [
      { name: 'Issues', mountPath: '/issues', contract: extractContract(ISSUES_MODULE) },
    ];
    const p = buildPrompt(makeIU('Design'), NODES, [], { runtime: {} } as any, [], siblingContracts);
    expect(p).toContain('Sibling module contracts — call these EXACTLY');
    expect(p).toContain('mounted at /issues');
    expect(p).toContain('CreateIssueSchema'); // the consumer now sees `points`, not `estimate`
    expect(p).toContain('OMIT it from the request body');
  });

  it('omits the section when there are no known sibling contracts', () => {
    const p = buildPrompt(makeIU('Design'), NODES, [], { runtime: {} } as any, [], []);
    expect(p).not.toContain('Sibling module contracts');
  });
});
