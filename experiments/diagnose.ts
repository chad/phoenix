import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSpec } from '../src/spec-parser.js';
import { extractCanonicalNodes } from '../src/canonicalizer.js';

const ROOT = resolve(import.meta.dirname, '..');

const specs = [
  { name: 'Settlements', path: 'examples/settle-up/spec/settlements.md', docId: 'spec/settlements.md',
    gold: [
      { statement: 'minimum number of payments', type: 'CONSTRAINT' },
      { statement: 'same net effect', type: 'REQUIREMENT' },
      { statement: 'cycles', type: 'REQUIREMENT' },
      { statement: 'all balances are zero', type: 'REQUIREMENT' },
      { statement: 'exceeds', type: 'REQUIREMENT' },
      { statement: 'settled up', type: 'REQUIREMENT' },
    ]},
  { name: 'TicTacToe', path: 'examples/tictactoe/spec/game-engine.md', docId: 'spec/game-engine.md',
    gold: [
      { statement: '3x3 grid', type: 'REQUIREMENT' },
      { statement: 'already occupied', type: 'REQUIREMENT' },
      { statement: 'x always moves first', type: 'INVARIANT' },
      { statement: 'win detection', type: 'CONTEXT' },
      { statement: 'draw', type: 'REQUIREMENT' },
      { statement: 'game must track the current status', type: 'REQUIREMENT' },
    ]},
  { name: 'Pixel Wars', path: 'examples/pixel-wars/spec/game.md', docId: 'spec/game.md',
    gold: [
      { statement: '20 columns', type: 'CONTEXT' },
      { statement: 'cooldown', type: 'CONSTRAINT' },
      { statement: 'rejected', type: 'REQUIREMENT' },
      { statement: 'broadcast', type: 'REQUIREMENT' },
      { statement: '120 seconds', type: 'CONTEXT' },
      { statement: 'round-robin', type: 'CONTEXT' },
    ]},
  { name: 'User Service', path: 'examples/microservices/spec/user-service.md', docId: 'spec/user-service.md',
    gold: [
      { statement: 'system of record', type: 'CONTEXT' },
      { statement: 'email addresses must be unique', type: 'REQUIREMENT' },
      { statement: 'never store or return plaintext passwords', type: 'INVARIANT' },
      { statement: 'soft delete', type: 'REQUIREMENT' },
      { statement: '100 characters', type: 'CONSTRAINT' },
      { statement: 'locked for 1 hour', type: 'REQUIREMENT' },
      { statement: 'parameterized statements', type: 'CONSTRAINT' },
      { statement: 'event payloads must never contain passwords', type: 'INVARIANT' },
      { statement: '50 results per page', type: 'CONSTRAINT' },
      { statement: 'usercreated', type: 'REQUIREMENT' },
    ]},
];

for (const spec of specs) {
  const text = readFileSync(resolve(ROOT, spec.path), 'utf8');
  const clauses = parseSpec(text, spec.docId);
  const nodes = extractCanonicalNodes(clauses);
  console.log(`\n=== ${spec.name} (${nodes.length} nodes) ===`);
  for (const g of spec.gold) {
    const match = nodes.find(n => n.statement.toLowerCase().includes(g.statement.toLowerCase()));
    if (match) {
      const ok = match.type === g.type ? 'OK  ' : 'MISS';
      console.log(`${ok} "${g.statement}" expected=${g.type} got=${match.type} conf=${match.confidence?.toFixed(2)} stmt="${match.statement.substring(0, 80)}"`);
    } else {
      console.log(`GONE "${g.statement}"`);
    }
  }
}
