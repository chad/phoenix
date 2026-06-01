import { describe, it, expect } from 'vitest';
import {
  cookTemplateLiteral, validateInlineScripts, cleanCodeResponse, fixSqliteQuotes,
} from '../../src/codegen-util.js';

// Adversarial regression tests — each pins a confirmed bug (round 1).
describe('adversarial: codegen-util', () => {
  it('#4 cookTemplateLiteral neutralizes ADJACENT ${} interpolations', () => {
    expect(cookTemplateLiteral('a${x}${y}b')).toBe('a(0)(0)b');
  });

  it('#5 cookTemplateLiteral handles ${} with NESTED braces', () => {
    expect(cookTemplateLiteral('x${ {a:1} }y')).toBe('x(0)y');
  });

  it('cookTemplateLiteral leaves an escaped \\${} as literal text (guard)', () => {
    expect(cookTemplateLiteral('x\\${a}y')).toBe('x${a}y');
  });

  it('#6 validateInlineScripts does NOT skip a script whose attrs merely contain "src="', () => {
    expect(validateInlineScripts('<script data-x="src=" id="a">var x = ;</script>')).toBeTruthy();
  });

  it('validateInlineScripts still skips a genuine external script (guard)', () => {
    expect(validateInlineScripts('<script src="/app.js">!!! not js !!!</script>')).toBeNull();
  });

  it('#7 cleanCodeResponse keeps interior ``` lines that are template-string content', () => {
    const code = 'const help = `\nUsage:\n```\nrun foo\n```\n`;\nexport default help;';
    expect(cleanCodeResponse(code)).toBe(code);
  });

  it('cleanCodeResponse still strips a wrapping fenced block (guard)', () => {
    expect(cleanCodeResponse('```ts\nexport const x = 1;\n```')).toBe('export const x = 1;');
  });

  it('#34 fixSqliteQuotes handles SQLite doubled-quote escapes in DEFAULT', () => {
    expect(fixSqliteQuotes('DEFAULT "say ""hi"""')).toBe(`DEFAULT 'say "hi"'`);
    expect(fixSqliteQuotes('DEFAULT "todo"')).toBe(`DEFAULT 'todo'`);
    expect(fixSqliteQuotes(`DEFAULT "o'brien"`)).toBe(`DEFAULT 'o''brien'`);
  });
});
