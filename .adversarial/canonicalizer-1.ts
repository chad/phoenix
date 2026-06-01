import { extractCandidates } from '/Users/chad/src/phoenix/src/canonicalizer.js';
import type { Clause } from '/Users/chad/src/phoenix/src/models/clause.js';

const text = 'Bob is an admin who must approve refunds';

const clause: Clause = {
  clause_id: 'c1',
  source_doc_id: 'doc1',
  source_line_range: [1, 1],
  raw_text: text,
  normalized_text: text.toLowerCase(),
  section_path: [],
  clause_semhash: 'h1',
  context_semhash_cold: 'h2',
};

const result = extractCandidates([clause]);
console.log('INPUT:', JSON.stringify(text));
console.log('num candidates:', result.candidates.length);
for (const c of result.candidates) {
  console.log('TYPE:', c.type, 'CONF:', c.confidence, 'STMT:', JSON.stringify(c.statement));
}
console.log('COVERAGE:', JSON.stringify(result.coverage));
