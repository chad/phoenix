import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { generateModule, toCamelCase, toPascalCase, singularize, isUiIU } from '../../src/regen.js';
import type { ImplementationUnit } from '../../src/models/iu.js';
import { defaultBoundaryPolicy, defaultEnforcement } from '../../src/models/iu.js';

function iu(name: string, canon: string[] = [], files: string[] = ['src/generated/x/x.ts'], description = ''): ImplementationUnit {
  return {
    iu_id: 'IU1', kind: 'module', name, risk_tier: 'low',
    contract: { description, inputs: [], outputs: [], invariants: [] },
    source_canon_ids: canon, dependencies: [],
    boundary_policy: defaultBoundaryPolicy(), enforcement: defaultEnforcement(),
    evidence_policy: { required: [] }, output_files: files,
  };
}
// Parse as JS (strip TS type annotations crudely is hard; instead just check identifiers).
const parses = (code: string): boolean => { try { new vm.Script(code.replace(/: [A-Za-z0-9_<>\[\]{}'", |&.]+(?=[)=;,])/g, '')); return true; } catch { return false; } };

describe('adversarial: regen helpers', () => {
  it('#24 generateModule._phoenix.canon_ids emits the ids, not the count', () => {
    const code = generateModule(iu('Issue', ['canon-a', 'canon-b', 'canon-c']));
    expect(code).toContain("'canon-a'");
    expect(code).not.toMatch(/canon_ids:\s*\[\s*3\b/);
  });

  it('#25 generateModule emits a NAMED function for a punctuation-only / empty name', () => {
    for (const name of ['!!!', '']) {
      const code = generateModule(iu(name));
      expect(code).not.toMatch(/export function\s*\(/);   // no anonymous function
      expect(code).not.toMatch(/export interface\s*\{/);  // no anonymous interface
    }
  });

  it('#47 singularize leaves ss/us/is words alone and handles -es plurals', () => {
    expect(singularize('addresses')).toBe('address');
    expect(singularize('status')).toBe('status');
    expect(singularize('analysis')).toBe('analysis');
    expect(singularize('class')).toBe('class');
    expect(singularize('bus')).toBe('bus');
    expect(singularize('tokens')).toBe('token');
    expect(singularize('policies')).toBe('policy');
    expect(singularize('boxes')).toBe('box');
  });

  it('#48 toCamelCase/toPascalCase preserve unicode letters and never return empty', () => {
    expect(toCamelCase('Café Service')).toBe('caféService');
    expect(toPascalCase('用户 service')).toBe('用户Service');
    expect(toCamelCase('!!!')).toBe('value');     // non-empty fallback
    expect(toPascalCase('###')).toBe('Value');
  });

  it('#49 isUiIU does not mis-classify backend modules, still catches real UI', () => {
    expect(isUiIU(iu('Page Cache'))).toBe(false);
    expect(isUiIU(iu('Interface Adapter'))).toBe(false);
    expect(isUiIU(iu('View Counter'))).toBe(false);
    expect(isUiIU(iu('Design Token Store'))).toBe(false);
    // genuine UI still detected
    expect(isUiIU(iu('Web Dashboard'))).toBe(true);
    expect(isUiIU(iu('board ui'))).toBe(true);
    expect(isUiIU(iu('x', [], ['src/generated/web/x.ts']))).toBe(true);
  });
});
