/**
 * Code-generation utilities shared by the engine and the runtime targets.
 *
 * These are language-neutral (or, for the inline-script gate, frontend-JS-neutral):
 * stripping markdown fences off an LLM reply, the fix-prompt shape, and validating the
 * JavaScript inside an HTML page's <script> the way a browser will actually parse it.
 * They live here so a RuntimeTarget implementation can use them without importing the
 * engine (regen.ts), which would create a cycle.
 */

import vm from 'node:vm';

/** Strip markdown code fences from an LLM response. */
export function cleanCodeResponse(raw: string): string {
  let code = raw.trim();

  const fenceMatch = code.match(/^```(?:typescript|ts|python|py|go|ruby|rb)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    code = fenceMatch[1];
  }

  const innerMatch = code.match(/```(?:typescript|ts|python|py|go|ruby|rb)?\s*\n([\s\S]*?)\n```/);
  if (innerMatch && /\b(export|def|func|class|import|package)\b/.test(innerMatch[1])) {
    code = innerMatch[1];
  }

  // Strip any remaining standalone markdown fence lines.
  code = code.split('\n').filter(l => !/^\s*```[a-zA-Z]*\s*$/.test(l)).join('\n');

  return code;
}

/**
 * Build a prompt asking the LLM to fix compiler/typecheck errors. Language-neutral —
 * the errors and code carry the language; the rules cover the universal pitfalls.
 */
export function buildFixPrompt(code: string, errors: string): string {
  return `The following module has compilation errors. Fix them.

## Current code:
\`\`\`
${code}
\`\`\`

## Compiler errors:
${errors}

## Rules:
- Output ONLY the fixed module. No markdown fences, no explanation.
- Do NOT add new third-party dependencies; use what the module already imports.
- Keep all existing exports/public symbols and any Phoenix provenance metadata.
- Keep any //phx:<label> (or #phx:/<label>) provenance marker comments exactly where they are.

Output the complete fixed module now.`;
}

/**
 * Cook a string the way a backtick template literal would. Our inline <script> blocks
 * are emitted inside a host template literal (e.g. TS c.html(`…`)), so the browser
 * receives the COOKED text: `${…}` interpolations resolve to runtime values (we
 * neutralize them) and backslash escapes are consumed (`\'`→`'`, `\\`→`\`…). Validating
 * the cooked form catches client-JS syntax errors the raw source hides.
 */
export function cookTemplateLiteral(body: string): string {
  const noInterp = body.replace(/(^|[^\\])\$\{[^}]*\}/g, '$1(0)');
  const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };
  return noInterp.replace(/\\([\s\S])/g, (_, c: string) => map[c] ?? c);
}

/**
 * Validate inline <script> blocks an HTML page emits. The page's JS is executed by a
 * real browser and must be valid JS — not merely a valid host-language string — so a
 * nested-quote or template-cooking bug passes a backend typecheck but blanks the page.
 * vm.Script only parses; it never runs, so browser globals are irrelevant.
 */
export function validateInlineScripts(code: string): string | null {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const body = m[1];
    if (!body.trim()) continue;
    try {
      new vm.Script(cookTemplateLiteral(body));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Inline <script> has a browser JavaScript syntax error: ${msg}. `
        + 'The HTML you build inside the page template is executed by a real browser and must be valid JS, '
        + 'not just a valid string. A common cause is unescaped nested quotes in an inline '
        + 'event handler like onclick="moveIssue(\' + id + \', \'\' + status + \'\')". Do NOT build inline '
        + 'on* handlers by string concatenation — render elements with data-* attributes and attach '
        + 'behaviour with addEventListener after inserting the HTML.';
    }
  }
  return null;
}
