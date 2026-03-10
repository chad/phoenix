import { describe, it, expect } from 'vitest';
import {
  inferPaceLayer,
  isPaceAppropriate,
  detectLayerCrossing,
  defaultPaceLayerMetadata,
} from '../../src/models/pace-layer.js';

describe('Pace Layers', () => {
  it('infers foundation for high dependency weight', () => {
    expect(inferPaceLayer(5, false)).toBe('foundation');
    expect(inferPaceLayer(3, true)).toBe('foundation');
  });

  it('infers domain for moderate dependency weight', () => {
    expect(inferPaceLayer(3, false)).toBe('domain');
    expect(inferPaceLayer(4, false)).toBe('domain');
  });

  it('infers service for low dependency weight', () => {
    expect(inferPaceLayer(1, false)).toBe('service');
    expect(inferPaceLayer(2, false)).toBe('service');
  });

  it('infers surface for zero dependency weight', () => {
    expect(inferPaceLayer(0, false)).toBe('surface');
  });

  it('allows daily regen for surface layer', () => {
    expect(isPaceAppropriate('surface', 1)).toBe(true);
    expect(isPaceAppropriate('surface', 0)).toBe(false);
  });

  it('requires weekly minimum for service layer', () => {
    expect(isPaceAppropriate('service', 7)).toBe(true);
    expect(isPaceAppropriate('service', 3)).toBe(false);
  });

  it('requires monthly minimum for domain layer', () => {
    expect(isPaceAppropriate('domain', 30)).toBe(true);
    expect(isPaceAppropriate('domain', 15)).toBe(false);
  });

  it('requires quarterly minimum for foundation layer', () => {
    expect(isPaceAppropriate('foundation', 90)).toBe(true);
    expect(isPaceAppropriate('foundation', 60)).toBe(false);
  });

  it('detects slow-depends-on-fast violation', () => {
    const v = detectLayerCrossing('foundation', 'surface');
    expect(v).not.toBeNull();
    expect(v!.violation_type).toBe('dependency_crosses_layer');
  });

  it('allows fast-depends-on-slow (normal)', () => {
    expect(detectLayerCrossing('surface', 'foundation')).toBeNull();
    expect(detectLayerCrossing('service', 'domain')).toBeNull();
  });

  it('allows same-layer dependencies', () => {
    expect(detectLayerCrossing('domain', 'domain')).toBeNull();
  });

  it('provides sensible defaults', () => {
    const d = defaultPaceLayerMetadata();
    expect(d.pace_layer).toBe('service');
    expect(d.conservation).toBe(false);
  });
});
