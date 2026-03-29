import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSpec } from '../src/spec-parser.js';
import { extractCanonicalNodes } from '../src/canonicalizer.js';
import { GOLD_SPECS } from '../tests/eval/gold-standard.js';

const ROOT = resolve(import.meta.dirname, '..');

for (const s of GOLD_SPECS) {
  const text = readFileSync(resolve(ROOT, s.path), 'utf8');
  const clauses = parseSpec(text, s.docId);
  const nodes = extractCanonicalNodes(clauses);
  let found = 0, correct = 0;
  const misses: string[] = [];
  for (const g of s.expectedNodes) {
    const n = nodes.find(n => n.statement.toLowerCase().includes(g.statement.toLowerCase()));
    if (n) {
      found++;
      if (n.type === g.type) correct++;
      else misses.push(`  MISS "${g.statement}" gold=${g.type} got=${n.type}`);
    } else {
      misses.push(`  GONE "${g.statement}"`);
    }
  }
  if (misses.length > 0) {
    console.log(`=== ${s.name} (${correct}/${found} correct) ===`);
    misses.forEach(m => console.log(m));
  }
}
