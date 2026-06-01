import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/bot-router.js';
import { computeConceptualMass } from '../../src/models/conceptual-mass.js';
import { failedGenerationKnowledge } from '../../src/models/negative-knowledge.js';

describe('adversarial: bot-router parseCommand', () => {
  it('#8 a trailing positional token alongside key=value is not dropped', () => {
    const r = parseCommand('SpecBot: ingest title=hi extra') as { args: Record<string, string> };
    expect(r.args.title).toBe('hi');
    expect(r.args._).toBe('extra');
  });

  it('#9 a quoted value with spaces is kept whole', () => {
    const r = parseCommand('ImplBot: regen name="John Smith"') as { args: Record<string, string> };
    expect(r.args.name).toBe('John Smith');
  });

  it('#24 an explicitly empty value (key=) is parsed as empty, not a positional', () => {
    const r = parseCommand('SpecBot: ingest doc=') as { args: Record<string, string> };
    expect(r.args.doc).toBe('');
    expect(r.args._).toBeUndefined();
  });
});

describe('adversarial: conceptual-mass', () => {
  it('#2 file_count contributes to conceptual mass', () => {
    const base = { contract_inputs: 0, contract_outputs: 0, contract_invariants: 0, dependency_count: 0, side_channel_count: 0, canon_node_count: 0 };
    expect(computeConceptualMass({ ...base, file_count: 100 })).toBe(100);
    expect(computeConceptualMass({ ...base, file_count: 0 })).toBe(0);
  });
});

describe('adversarial: negative-knowledge', () => {
  it('#13 distinct models produce distinct nk_ids (immune memory not overwritten)', () => {
    const a = failedGenerationKnowledge({ iu_id: 'iu1', model_id: 'gpt-4', promptpack_hash: 'abcd1234ef', reason: 'x', recorded_at: 'now' });
    const b = failedGenerationKnowledge({ iu_id: 'iu1', model_id: 'claude-3', promptpack_hash: 'abcd1234ef', reason: 'y', recorded_at: 'now' });
    expect(a.nk_id).not.toBe(b.nk_id);
  });
});
