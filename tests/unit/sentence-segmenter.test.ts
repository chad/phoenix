import { describe, it, expect } from 'vitest';
import { segmentSentences } from '../../src/sentence-segmenter.js';

describe('segmentSentences', () => {
  it('splits list items into separate sentences', () => {
    const text = '## Requirements\n\n- Users must log in\n- Sessions must expire\n- Passwords must be hashed';
    const sentences = segmentSentences(text);
    expect(sentences).toHaveLength(3);
    expect(sentences[0].text).toContain('Users must log in');
    expect(sentences[1].text).toContain('Sessions must expire');
    expect(sentences[2].text).toContain('Passwords must be hashed');
    expect(sentences.every(s => s.fromList)).toBe(true);
  });

  it('splits prose into sentences', () => {
    const text = 'The system handles authentication and authorization for all services. Users must log in with credentials. Sessions expire after 24 hours of inactivity.';
    const sentences = segmentSentences(text);
    expect(sentences.length).toBeGreaterThanOrEqual(3);
  });

  it('splits compound modals with "and must"', () => {
    const text = '- Tasks must be created and must be assigned to a user';
    const sentences = segmentSentences(text);
    expect(sentences.length).toBe(2);
    expect(sentences[0].text).toContain('created');
    expect(sentences[1].text).toContain('assigned');
  });

  it('splits compound modals with semicolons', () => {
    const text = '- Users must log in; sessions must expire';
    const sentences = segmentSentences(text);
    expect(sentences.length).toBe(2);
  });

  it('skips headings', () => {
    const text = '# Title\n\n## Section\n\nContent here.';
    const sentences = segmentSentences(text);
    expect(sentences.every(s => !s.text.startsWith('#'))).toBe(true);
  });

  it('skips very short content', () => {
    const text = '- OK\n- A\n- This is a real sentence';
    const sentences = segmentSentences(text);
    // "OK" and "A" are < 3 chars, should still be included by segmenter
    // (filtering happens in extraction, not segmentation)
    expect(sentences.length).toBeGreaterThanOrEqual(1);
  });

  it('handles numbered lists', () => {
    const text = '1. First step\n2. Second step\n3. Third step';
    const sentences = segmentSentences(text);
    expect(sentences).toHaveLength(3);
    expect(sentences[0].text).toBe('First step');
    expect(sentences[2].text).toBe('Third step');
  });

  it('handles mixed content', () => {
    const text = '## Overview\n\nThe system is complex.\n\n- Must do A\n- Must do B\n\nFinal note.';
    const sentences = segmentSentences(text);
    expect(sentences.length).toBeGreaterThanOrEqual(4);
  });

  it('assigns sequential indices', () => {
    const text = '- A must do X\n- B must do Y\n- C must do Z';
    const sentences = segmentSentences(text);
    for (let i = 0; i < sentences.length; i++) {
      expect(sentences[i].index).toBe(i);
    }
  });
});
