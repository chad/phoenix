import { describe, it, expect } from 'vitest';
import { validateInlineScripts } from '../../src/codegen-util.js';

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

  it('catches the escaped-quote collapse the outer template literal performs', () => {
    // The real Trail board bug: in SOURCE the handler uses `\'` (a valid escaped
    // quote, so tsc AND a naive parse of the raw script both pass). But the inline
    // <script> sits inside c.html(`…`); at render the template literal cooks `\'`→`'`,
    // yielding `', '' +` (two adjacent string literals) which the browser rejects.
    // The gate must validate the COOKED form. String.raw keeps the `\'` source form.
    const SCRIPT_END = '</' + 'script>';
    const code = String.raw`<script>
  card.innerHTML = '<button onclick="move(' + issue.id + ', \'' + next + '\')">go</button>';
` + SCRIPT_END;
    const err = validateInlineScripts(code);
    expect(err).toBeTruthy();
    expect(err).toContain('syntax error');
  });

  it('does not false-positive on a valid escaped quote inside cooked client JS', () => {
    // `\'` cooks to `'` inside a double-quoted JS string — still valid.
    const SCRIPT_END = '</' + 'script>';
    const code = String.raw`<script>
  const label = "it\'s fine";
  console.log(label);
` + SCRIPT_END;
    expect(validateInlineScripts(code)).toBeNull();
  });
});
