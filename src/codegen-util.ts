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

/**
 * Fix SQLite string-literal quoting in generated SQL. SQLite treats "x" as an
 * identifier, not a string — so `datetime("now")` / `DEFAULT "todo"` are bugs in ANY
 * host language. Host-independent, shared by every target that emits SQLite SQL.
 */
export function fixSqliteQuotes(code: string): string {
  return code
    .replace(/datetime\s*\(\s*"now"\s*\)/g, "datetime('now')")
    .replace(/date\s*\(\s*"now"\s*\)/g, "date('now')")
    .replace(/WHEN "(\w+)" THEN/g, "WHEN '$1' THEN")
    .replace(/DEFAULT "((?:[^"]|"")*)"/g, (_m, body: string) => {
      const value = body.replace(/""/g, '"');                 // un-double SQLite escapes
      return "DEFAULT '" + value.replace(/'/g, "''") + "'";   // emit a real string literal
    });
}

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

  // Strip a leading/trailing standalone fence line (bare or tagged), plus any interior
  // LANGUAGE-TAGGED fence (e.g. a stray ```typescript the model left mid-body). Keep
  // interior BARE ``` lines, which may be legitimate template-literal string content.
  const fenceLine = /^\s*```[a-zA-Z]*\s*$/;
  const lines = code.split('\n');
  if (lines.length && fenceLine.test(lines[0])) lines.shift();
  if (lines.length && fenceLine.test(lines[lines.length - 1])) lines.pop();
  code = lines.filter(l => !/^\s*```[a-zA-Z]+\s*$/.test(l)).join('\n');

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
  // Collapse each (unescaped, brace-balanced) ${…} to a neutral literal. A regex can't
  // do this: [^}]* breaks on nested braces and a [^\\] guard consumes the char between
  // adjacent interpolations. Scan with a depth counter instead.
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let bs = 0, k = i - 1;
      while (k >= 0 && body[k] === '\\') { bs++; k--; }
      if (bs % 2 === 1) { out += body[i]; continue; } // escaped \${ — literal
      let depth = 1, j = i + 2;
      for (; j < body.length && depth > 0; j++) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
      }
      if (depth === 0) { out += '(0)'; i = j - 1; continue; }
      // unbalanced — fall through and keep the literal text
    }
    out += body[i];
  }
  const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };
  return out.replace(/\\([\s\S])/g, (_, c: string) => map[c] ?? c);
}

/**
 * Validate inline <script> blocks an HTML page emits. The page's JS is executed by a
 * real browser and must be valid JS — not merely a valid host-language string — so a
 * nested-quote or template-cooking bug passes a backend typecheck but blanks the page.
 * vm.Script only parses; it never runs, so browser globals are irrelevant.
 */
export function validateInlineScripts(code: string): string | null {
  // Capture the attribute string so we can tell a genuine EXTERNAL script (real src=
  // attribute) from an inline script that merely contains "src=" inside some other
  // attribute value (e.g. data-x="src=").
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (/(^|\s)src\s*=/i.test(m[1])) continue; // genuine external script
    const body = m[2];
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
