/**
 * Layers configuration — selects which impls run, and in what order, for each
 * pipeline layer.
 *
 * Stored in `.phoenix/config.json` under the `layers` key, e.g.:
 *
 *   {
 *     "llm": { "provider": "anthropic", "model": "..." },
 *     "layers": {
 *       "canonicalizer": ["rule-extractor", "llm-normalizer", "requirements-specialist"],
 *       "classifier":    ["rule-classifier", "llm-d-resolver"],
 *       "iu-planner":    ["section-based"],
 *       "regenerator":   ["llm-or-stub", "lint-fix"],
 *       "policy":        ["evidence-checker", "security-gate"]
 *     }
 *   }
 *
 * Any layer omitted from the config falls back to its DEFAULT_*_STACK.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CANONICALIZER_STACK } from './canonicalizer/index.js';
import { DEFAULT_CLASSIFIER_STACK } from './classifier/index.js';
import { DEFAULT_IU_PLANNER_STACK } from './iu-planner/index.js';
import { DEFAULT_REGENERATOR_STACK } from './regenerator/index.js';
import { DEFAULT_POLICY_STACK } from './policy/index.js';

export interface LayersConfig {
  canonicalizer: string[];
  classifier: string[];
  'iu-planner': string[];
  regenerator: string[];
  policy: string[];
}

export function defaultLayersConfig(): LayersConfig {
  return {
    canonicalizer: [...DEFAULT_CANONICALIZER_STACK],
    classifier: [...DEFAULT_CLASSIFIER_STACK],
    'iu-planner': [...DEFAULT_IU_PLANNER_STACK],
    regenerator: [...DEFAULT_REGENERATOR_STACK],
    policy: [...DEFAULT_POLICY_STACK],
  };
}

/**
 * Merge a partial config (typically from disk) on top of defaults. Arrays
 * fully replace defaults; missing keys keep defaults.
 */
export function mergeLayersConfig(partial?: Partial<LayersConfig> | null): LayersConfig {
  const base = defaultLayersConfig();
  if (!partial) return base;
  const merged: LayersConfig = { ...base };
  for (const key of Object.keys(base) as (keyof LayersConfig)[]) {
    const v = partial[key];
    if (Array.isArray(v) && v.length > 0) {
      merged[key] = [...v];
    }
  }
  return merged;
}

/** Load the `layers` block from `.phoenix/config.json`, merged with defaults. */
export function loadLayersConfig(phoenixDir: string): LayersConfig {
  const path = join(phoenixDir, 'config.json');
  if (!existsSync(path)) return defaultLayersConfig();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return mergeLayersConfig(raw?.layers);
  } catch {
    return defaultLayersConfig();
  }
}
