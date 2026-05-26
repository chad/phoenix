/**
 * Regenerator Layer types.
 *
 * Runs per-IU. The first impl produces an initial `RegenResult` from the IU
 * contract; later impls can refine the files (lint, type-tighten, doc-add,
 * test-augment) before the manifest is written. Each impl receives the
 * previous result so transformations compose naturally.
 */

import type { ImplementationUnit } from '../../models/iu.js';
import type { CanonicalNode } from '../../models/canonical.js';
import type { ResolvedTarget } from '../../models/architecture.js';
import type { Layer } from '../types.js';

export interface RegeneratorInput {
  iu: ImplementationUnit;
  canonNodes: CanonicalNode[];
  allIUs: ImplementationUnit[];
  target?: ResolvedTarget | null;
  onProgress?: (iu: ImplementationUnit, status: 'start' | 'done' | 'error', message?: string) => void;
}

/** Same shape as `RegenResult` from `regen.ts` but defined here to avoid
 *  a circular import; the regenerator impl returns the real type. */
export interface RegeneratorOutput {
  iu_id: string;
  files: Map<string, string>;
  manifest: import('../../models/manifest.js').IUManifest;
}

export type RegeneratorLayer = Layer<RegeneratorInput, RegeneratorOutput>;
