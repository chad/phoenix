import { describe, it, expect } from 'vitest';
import { normalizeText } from '../../src/normalizer.js';

describe('normalizeText', () => {
  it('removes markdown heading markers', () => {
    const result = normalizeText('## Hello World');
    expect(result).toBe('hello world');
  });

  it('removes bold and italic markers', () => {
    expect(normalizeText('**bold** and *italic*')).toBe('bold and italic');
    expect(normalizeText('__bold__ and _italic_')).toBe('bold and italic');
  });

  it('removes inline code backticks but keeps content', () => {
    expect(normalizeText('use `foo()` here')).toBe('use foo() here');
  });

  it('removes link syntax, keeps text', () => {
    expect(normalizeText('[click here](https://example.com)')).toBe('click here');
  });

  it('lowercases everything', () => {
    expect(normalizeText('Hello WORLD FoO')).toBe('hello world foo');
  });

  it('collapses whitespace', () => {
    expect(normalizeText('hello    world\t\there')).toBe('hello world here');
  });

  it('strips empty lines', () => {
    const input = 'line one\n\n\nline two\n\n';
    expect(normalizeText(input)).toBe('line one\nline two');
  });

  it('sorts list items for order-invariant hashing', () => {
    const input1 = '- cherry\n- apple\n- banana';
    const input2 = '- apple\n- banana\n- cherry';
    expect(normalizeText(input1)).toBe(normalizeText(input2));
  });

  it('preserves numbered list order (ordered sequences)', () => {
    const input = '1. cherry\n2. apple\n3. banana';
    const result = normalizeText(input);
    // Numbered lists are ordered — should NOT be sorted
    expect(result).toBe('cherry\napple\nbanana');
  });

  it('preserves bullet list order when items contain arrows', () => {
    const input = '- open → in_progress\n- in_progress → done';
    const result = normalizeText(input);
    // Sequence indicators prevent sorting; underscores stripped by lowercase/normalize
    expect(result).toContain('→');
    // Order preserved (not sorted alphabetically)
    const lines = result.split('\n');
    expect(lines[0]).toContain('open');
    expect(lines[1]).toContain('done');
  });

  it('handles mixed content and lists', () => {
    const input = 'Intro text\n\n- beta\n- alpha\n\nConclusion';
    const result = normalizeText(input);
    expect(result).toBe('intro text\nalpha\nbeta\nconclusion');
  });

  it('strips fenced code blocks', () => {
    const input = 'Some text\n\n```typescript\nconst x = 1;\n# Not a heading\n- Not a list\n```\n\nMore text';
    const result = normalizeText(input);
    expect(result).not.toContain('const x');
    expect(result).not.toContain('# Not a heading');
    expect(result).toContain('(code block)');
    expect(result).toContain('more text');
  });

  it('is idempotent', () => {
    const input = '## **Bold** heading\n\n- z item\n- a item';
    const once = normalizeText(input);
    const twice = normalizeText(once);
    expect(once).toBe(twice);
  });

  it('produces same output for formatting-only changes', () => {
    const v1 = '## Overview\n\nPhoenix is a VCS.';
    const v2 = '## Overview\n\n**Phoenix** is a VCS.';
    expect(normalizeText(v1)).toBe(normalizeText(v2));
  });
});
