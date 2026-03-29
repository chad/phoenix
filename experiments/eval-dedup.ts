/**
 * Dedup Eval — tests dedup quality on specs with known near-duplicates.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSpec } from '../src/spec-parser.js';
import { extractCanonicalNodes } from '../src/canonicalizer.js';
import { GOLD_SPECS } from '../tests/eval/gold-standard.js';

const ROOT = resolve(import.meta.dirname, '..');

let totalNodes = 0;
let totalUniqueStatements = 0;

console.log('Dedup Quality Eval\n');

for (const spec of GOLD_SPECS) {
  const text = readFileSync(resolve(ROOT, spec.path), 'utf8');
  const clauses = parseSpec(text, spec.docId);
  const nodes = extractCanonicalNodes(clauses);

  // Check for near-duplicate statements
  const stmts = nodes.map(n => n.statement.toLowerCase().trim());
  const unique = new Set(stmts);
  const exactDupes = stmts.length - unique.size;

  // Check for high-similarity pairs (token Jaccard > 0.6)
  let nearDupes = 0;
  for (let i = 0; i < stmts.length; i++) {
    for (let j = i + 1; j < stmts.length; j++) {
      const a = new Set(stmts[i].split(/\s+/));
      const b = new Set(stmts[j].split(/\s+/));
      let shared = 0;
      for (const t of a) if (b.has(t)) shared++;
      const jaccard = shared / (a.size + b.size - shared);
      if (jaccard > 0.6) nearDupes++;
    }
  }

  totalNodes += stmts.length;
  totalUniqueStatements += unique.size;

  if (exactDupes > 0 || nearDupes > 0) {
    console.log(`  ${spec.name}: ${stmts.length} nodes, ${exactDupes} exact dupes, ${nearDupes} near-dupes (Jaccard>0.6)`);
  }
}

const dedupRate = totalNodes > 0 ? (1 - totalUniqueStatements / totalNodes) * 100 : 0;
console.log(`\nTotal: ${totalNodes} nodes, ${totalUniqueStatements} unique, dedup rate: ${dedupRate.toFixed(1)}%`);
console.log(`val_score=${(1 - dedupRate/100).toFixed(4)}`);
