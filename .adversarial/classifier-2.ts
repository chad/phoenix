import { classifyChange } from '/Users/chad/src/phoenix/src/classifier.js';
import { DiffType } from '/Users/chad/src/phoenix/src/models/clause.js';
import type { Clause } from '/Users/chad/src/phoenix/src/models/clause.js';
import { CONFIG } from '/Users/chad/src/phoenix/src/experiment-config.js';

function mk(id: string, text: string): Clause {
  return {
    clause_id: id,
    source_doc_id: 'doc',
    source_line_range: [1, 1],
    raw_text: text,
    normalized_text: text,
    section_path: ['Sec', 'A'],
    clause_semhash: 'hash-' + text,
    context_semhash_cold: 'ctx-' + id,
  };
}

function run(a: string, b: string) {
  const before = mk('cb', a);
  const after = mk('ca', b);
  const diff = {
    diff_type: DiffType.MODIFIED,
    clause_id_before: 'cb',
    clause_id_after: 'ca',
    clause_before: before,
    clause_after: after,
  };
  const res = classifyChange(diff, [], []); // canonImpact=0, anchorMatch=0
  return res;
}

// Craft texts: 4 content terms each, 2 shared, 2 different -> termJaccard = 1 - 2/6 = 0.667 (in band)
// Make the string edit distance land in [0.5,0.7) too.
// before: "alpha beta gamma delta"  after: "alpha beta xxxxx yyyyy"
// Try several to find one with normDiff in band.
const candidates: Array<[string,string]> = [
  ['alpha beta gamma delta', 'alpha beta xxxxx yyyyy'],
  ['alpha beta gamma delta epsilon', 'alpha beta gamma mmmm nnnn'],
  ['mango pear apple grape', 'mango pear lemon olive'],
  ['vendor invoice net payment', 'vendor invoice gross refund'],
  ['cat dog fish bird worm horse', 'cat dog fish bird snake mouse'],
];

console.log('Band: pass B test means NOT(nd<0.5 && td<0.5); fail D-high means NOT(nd>0.7 || td>0.7)');
for (const [a, b] of candidates) {
  const res = run(a, b);
  const nd = res.signals.norm_diff;
  const td = res.signals.term_ref_delta;
  const failedBTest = !(nd < CONFIG.CLASS_B_NORM_DIFF && td < CONFIG.CLASS_B_TERM_DELTA);
  const failedDTest = !(nd > CONFIG.CLASS_D_HIGH_CHANGE || td > CONFIG.CLASS_D_HIGH_CHANGE);
  const inFallback = failedBTest && failedDTest;
  console.log('---');
  console.log(`a="${a}" b="${b}"`);
  console.log('normDiff=', nd.toFixed(4), 'termDelta=', td.toFixed(4));
  console.log('class=', res.change_class, 'confidence=', res.confidence,
    '| fallback-line-202?', inFallback);
}
