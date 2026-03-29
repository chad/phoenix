/**
 * Change Classification Eval — tests classifier accuracy on known change pairs.
 */
import { parseSpec } from '../src/spec-parser.js';
import { classifyChange } from '../src/classifier.js';
import { extractCanonicalNodes } from '../src/canonicalizer.js';
import { diffClauses } from '../src/diff.js';
import { DiffType } from '../src/models/clause.js';

interface ChangeTestCase {
  name: string;
  before: string;
  after: string;
  expectedClass: 'A' | 'B' | 'C' | 'D';
}

const CASES: ChangeTestCase[] = [
  // Class A: trivial/formatting
  {
    name: 'whitespace only',
    before: '- Users must log in',
    after: '-  Users must  log in',
    expectedClass: 'A',
  },
  {
    name: 'capitalization change',
    before: '- The system must validate input',
    after: '- The System Must Validate Input',
    expectedClass: 'A',
  },
  {
    name: 'punctuation change',
    before: '- Users must authenticate.',
    after: '- Users must authenticate',
    expectedClass: 'A',
  },

  // Class B: local semantic change
  {
    name: 'word substitution (synonym)',
    before: '- The system must validate user email',
    after: '- The system must verify user email',
    expectedClass: 'B',
  },
  {
    name: 'added detail',
    before: '- Users must authenticate',
    after: '- Users must authenticate with email and password',
    expectedClass: 'B',
  },
  {
    name: 'numeric value change',
    before: '- Passwords must be at least 8 characters',
    after: '- Passwords must be at least 12 characters',
    expectedClass: 'B',
  },

  // Class C: contextual/structural
  {
    name: 'section reorganization',
    before: '## Authentication\n\n- Users must log in\n- Sessions expire after 30 minutes',
    after: '## Security\n\n- Users must log in\n- Sessions expire after 30 minutes',
    expectedClass: 'C',
  },

  // Class D: uncertain/major
  {
    name: 'complete rewrite',
    before: '- The system authenticates users via email and password',
    after: '- OAuth2 providers handle all authentication flows',
    expectedClass: 'D',
  },
  {
    name: 'semantic reversal',
    before: '- Users must provide a password',
    after: '- Users must use passwordless authentication',
    expectedClass: 'D',
  },
];

let passed = 0;
let total = 0;

console.log('Change Classification Eval\n');

for (const tc of CASES) {
  total++;
  const beforeClauses = parseSpec(`# Test\n\n${tc.before}`, 'test.md');
  const afterClauses = parseSpec(`# Test\n\n${tc.after}`, 'test.md');
  const beforeNodes = extractCanonicalNodes(beforeClauses);
  const afterNodes = extractCanonicalNodes(afterClauses);

  const diffs = diffClauses(beforeClauses, afterClauses);
  // Find the modified/added diff (skip unchanged)
  const diff = diffs.find(d => d.diff_type !== DiffType.UNCHANGED) ?? diffs[diffs.length - 1];
  const result = classifyChange(diff, beforeNodes, afterNodes);

  const ok = result.change_class === tc.expectedClass;
  if (ok) passed++;
  console.log(`  ${ok ? '✓' : '✗'} ${tc.name}: expected=${tc.expectedClass} got=${result.change_class} conf=${result.confidence.toFixed(2)}`);
}

console.log(`\nScore: ${passed}/${total} (${(passed/total*100).toFixed(0)}%)`);
console.log(`val_score=${(passed/total).toFixed(4)}`);
