import { describe, it, expect } from 'vitest';
import { extractDependencies } from '../../src/dep-extractor.js';

const imps = (src: string): string[] => extractDependencies(src, 'f.ts').imports.map(d => d.source);
const sc = (src: string) => extractDependencies(src, 'f.ts').side_channels;

describe('adversarial: dep-extractor', () => {
  it('#9 dynamic import() is detected', () => {
    expect(imps("const x = await import('dynpkg');")).toContain('dynpkg');
  });

  it('#10 commented and string-literal imports are NOT extracted', () => {
    expect(imps("// import x from 'evil-pkg'")).toEqual([]);
    expect(imps('const s = "import foo from \'bar\'";')).toEqual([]);
  });

  it('#23 multiple imports on one line are all captured', () => {
    expect(imps("import a from 'pkgA'; import b from 'pkgB';")).toEqual(['pkgA', 'pkgB']);
  });

  it('#24 export ... from re-exports are detected as dependencies', () => {
    expect(imps("export { x } from 'reexported';")).toContain('reexported');
    expect(imps("export * from 'star-reexport';")).toContain('star-reexport');
  });

  it('#25 word boundaries — prefetch/notfs do not produce side channels', () => {
    expect(sc("prefetch('http://x.com')").some(s => s.kind === 'external_api')).toBe(false);
    expect(sc('thisIsNotfs.readFile(p)').some(s => s.kind === 'file')).toBe(false);
    expect(sc("fetch('http://real.com')").some(s => s.kind === 'external_api')).toBe(true); // real fetch still found
  });

  it('#26 comments are ignored, and all env vars on a line are captured', () => {
    expect(sc("// fetch('http://evil.com')").some(s => s.kind === 'external_api')).toBe(false);
    const envs = sc('const a = process.env.FOO + process.env.BAR;').filter(s => s.kind === 'config').map(s => s.identifier);
    expect(envs).toEqual(['FOO', 'BAR']);
  });

  it('#39 bracketed env names with hyphens are detected', () => {
    expect(sc("process.env['FOO-BAR']").map(s => s.identifier)).toContain('FOO-BAR');
  });
});
