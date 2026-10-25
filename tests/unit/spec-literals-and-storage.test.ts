import { describe, it, expect } from 'vitest';
import { declaredStorageLines } from '../../src/schema-plan.js';
import { restoreLiteralCase } from '../../src/canonicalizer.js';
import type { Clause } from '../../src/models/clause.js';

describe('declaredStorageLines — a schema the spec declares', () => {
  const clause = (raw_text: string) => ({ raw_text } as unknown as Clause);
  it('finds table+column declarations, including soft-wrapped ones', () => {
    const lines = declaredStorageLines([clause([
      '## Votes',
      '- Votes must be stored in a table named `votes` with exactly the columns `question_id` INTEGER NOT NULL,',
      '  `voter` TEXT NOT NULL, and PRIMARY KEY (`question_id`, `voter`)',
      '- A voter must never upvote twice',
    ].join('\n'))]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('PRIMARY KEY');
  });
  it('ignores prose that merely mentions storage', () => {
    expect(declaredStorageLines([clause('- The vote count must never be stored anywhere else')])).toEqual([]);
  });
});

describe('restoreLiteralCase', () => {
  it('keeps the author\'s spelling inside quotes and code spans', () => {
    expect(restoreLiteralCase('store it as "anonymous" at db_path', 'Store it as "Anonymous" at `DB_PATH`'))
      .toBe('store it as "Anonymous" at DB_PATH');
  });
});
