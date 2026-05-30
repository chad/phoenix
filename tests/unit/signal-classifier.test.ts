import { describe, it, expect } from 'vitest';
import { classifySignal } from '../../src/signal-classifier.js';

describe('classifySignal', () => {
  const signal = [
    'Users can create an issue by providing at least a title',
    'A title must not be empty and must not exceed 200 characters',
    'Status must always be one of: backlog, todo, in_progress, in_review, done',
    'A session token is never reused',
    'A sprint is defined as a time-boxed iteration that groups issues',
    'We decided to use SQLite for storage',
    'The system must reject expired tokens',
  ];
  const noise = [
    'Hi everyone, thanks for joining',
    'John: I think we should look at this later',
    '[10:31] cool, sounds good',
    '+1',
    'Agenda: roadmap, hiring, lunch',
    'lol',
    'Should we circle back on this offline?',
    'Anyway, moving on',
  ];

  it('keeps intent-bearing statements', () => {
    for (const s of signal) {
      expect(classifySignal(s).signal, `should keep: ${s}`).toBe(true);
    }
  });

  it('drops conversational / structural noise', () => {
    for (const n of noise) {
      expect(classifySignal(n).signal, `should drop: ${n}`).toBe(false);
    }
  });

  it('is conservative — keeps ambiguous lines rather than dropping a possible requirement', () => {
    const v = classifySignal('Tasks belong to a project and have a priority');
    expect(v.signal).toBe(true);
  });

  it('drops empties and non-text', () => {
    expect(classifySignal('   ').signal).toBe(false);
    expect(classifySignal('   ').reason).toBe('empty');
  });
});
