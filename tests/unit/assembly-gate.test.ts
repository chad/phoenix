/**
 * The assembly gate — Phoenix gates PARTS (compile, drift, evidence); this gates the
 * WHOLE. The freeqworld-game run compiled 137 modules perfectly and produced 367
 * entities piled onto one screen — soup that passed every existing gate. This is the
 * gate that must go RED on exactly that, so "bootstrap complete ✔" can never again
 * mean "compiles" when the product is incoherent.
 */

import { describe, it, expect } from 'vitest';
import { assessSpatialCoherence } from '../../src/architectures/browser-typescript.js';

const codes = (fs: { code: string }[]) => fs.map(f => f.code).sort();

describe('assessSpatialCoherence', () => {
  it('the embarrassing run: no composition + off-grid + stacked all fire', () => {
    // Many modules, each placing entities blind — some off the 26×15 grid, some stacked.
    const moduleSources = [
      `engine.registerEntity({ id: 'a', name: 'terminal', color: '#fff', x: 5, y: 5 });`,
      `engine.registerEntity({ id: 'b', name: 'jukebox', color: '#fff', x: 5, y: 5 });`,   // stacked on (5,5)
      `engine.registerEntity({ id: 'c', name: 'stage', color: '#fff', x: 80, y: 3 });`,    // off-grid (x>=26)
      `engine.registerPlayer({ id: 'p', name: 'you', color: '#8cf', x: 12, y: 10 });`,
    ];
    const findings = assessSpatialCoherence({ moduleSources, hasLayoutComposition: false, cols: 26, rows: 15 });
    expect(codes(findings)).toEqual(['entities-off-grid', 'entities-stacked', 'no-composition']);
    expect(findings.find(f => f.code === 'entities-stacked')!.message).toMatch(/worst: 2/);
    expect(findings.every(f => f.severity === 'error')).toBe(true);
  });

  it('a composed world with distinct in-bounds cells and one player is coherent', () => {
    const moduleSources = [
      `engine.registerEntity({ id: 'a', name: 'terminal', color: '#fff', x: 4, y: 3 });`,
      `engine.registerEntity({ id: 'b', name: 'jukebox', color: '#fff', x: 8, y: 6 });`,
      `engine.registerPlayer({ id: 'p', name: 'you', color: '#8cf', x: 12, y: 10 });`,
    ];
    const findings = assessSpatialCoherence({ moduleSources, hasLayoutComposition: true, cols: 26, rows: 15 });
    expect(findings).toEqual([]);
  });

  it('no-composition does NOT fire once a layout aggregate composes the world', () => {
    const moduleSources = [`engine.registerEntity({ id: 'a', name: 'x', color: '#fff', x: 3, y: 3 });`];
    const withComposition = assessSpatialCoherence({ moduleSources, hasLayoutComposition: true, cols: 26, rows: 15 });
    expect(codes(withComposition)).not.toContain('no-composition');
    const without = assessSpatialCoherence({ moduleSources, hasLayoutComposition: false, cols: 26, rows: 15 });
    expect(codes(without)).toContain('no-composition');
  });

  it('over-dense is a warning even when placement is otherwise fine', () => {
    // 400 entities > 26×15 tiles, but computed coords (no literals) so no stack/offgrid.
    const moduleSources = Array.from({ length: 400 }, (_, i) =>
      `engine.registerEntity({ id: 'e${i}', name: 'n', color: '#fff', x: place(${i}), y: row(${i}) });`);
    moduleSources.push(`engine.registerPlayer({ id: 'p', name: 'you', color: '#8cf', x: pick(), y: pick() });`);
    const findings = assessSpatialCoherence({ moduleSources, hasLayoutComposition: true, cols: 26, rows: 15 });
    expect(codes(findings)).toEqual(['over-dense']);
    expect(findings[0].severity).toBe('warning');
  });

  it('player count: zero and many both warn', () => {
    const zero = assessSpatialCoherence({ moduleSources: [`engine.registerEntity({ x: 3, y: 3 });`], hasLayoutComposition: true, cols: 26, rows: 15 });
    expect(codes(zero)).toContain('player-count');
    const many = assessSpatialCoherence({
      moduleSources: [`engine.registerPlayer({ x: 3, y: 3 });`, `engine.registerPlayer({ x: 4, y: 4 });`],
      hasLayoutComposition: true, cols: 26, rows: 15,
    });
    expect(many.find(f => f.code === 'player-count')!.message).toMatch(/2 modules register a player/);
  });

  it('an empty world (no entities) is vacuously coherent — the gate does not cry wolf', () => {
    expect(assessSpatialCoherence({ moduleSources: [], hasLayoutComposition: false, cols: 26, rows: 15 }))
      .toEqual([]);
  });
});
