import { describe, it, expect } from 'vitest';
import { validateInlineScripts } from '../../src/regen.js';

describe('validateInlineScripts', () => {
  it('catches a browser-fatal syntax error TypeScript cannot see (nested quotes in onclick)', () => {
    // The whole HTML is a TS template-literal string, so tsc passes; the inline
    // <script> is only invalid when a browser parses it.
    // The real bug pattern: nested quotes collapse into adjacent string literals.
    const code = [
      'const html = `<!DOCTYPE html><html><body><script>',
      "  const btn = '<button onclick=\"move(' + id + ', '' + status + '')\">x</button>';",
      '</' + 'script></body></html>`;',
    ].join('\n');
    const err = validateInlineScripts(code);
    expect(err).toBeTruthy();
    expect(err).toContain('syntax error');
  });

  it('passes a valid inline script', () => {
    const code = [
      'const html = `<html><body><script>',
      "  document.querySelectorAll('.card').forEach(el => el.addEventListener('click', () => move(el.dataset.id)));",
      '</' + 'script></body></html>`;',
    ].join('\n');
    expect(validateInlineScripts(code)).toBeNull();
  });

  it('ignores modules with no inline script', () => {
    expect(validateInlineScripts('const x = 1;\nexport default x;')).toBeNull();
  });
});
