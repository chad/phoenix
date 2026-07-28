/**
 * Architecture & Runtime Target Registry
 */

import type { Architecture, RuntimeTarget, ResolvedTarget } from '../models/architecture.js';
import { webApi } from './web-api.js';
import { nodeTypescript } from './node-typescript.js';
import { pythonFastapi } from './python-fastapi.js';
import { browserGame } from './browser-game.js';
import { browserTypescript } from './browser-typescript.js';

// ─── Architecture registry ──────────────────────────────────────────────────

const ARCHITECTURES: Record<string, Architecture> = {
  'web-api': webApi,
  'browser-game': browserGame,
};

// ─── Runtime target registry ────────────────────────────────────────────────

const RUNTIME_TARGETS: Record<string, RuntimeTarget> = {
  'node-typescript': nodeTypescript,
  'python-fastapi': pythonFastapi,
  'browser-typescript': browserTypescript,
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve a target string like "web-api/node-typescript" or legacy "sqlite-web-api"
 * into a full ResolvedTarget.
 */
export function resolveTarget(target: string): ResolvedTarget | null {
  // Handle legacy name
  if (target === 'sqlite-web-api') {
    return resolveTarget('web-api/node-typescript');
  }

  // Try "arch/runtime" format
  if (target.includes('/')) {
    const [archName, rtName] = target.split('/');
    const arch = ARCHITECTURES[archName];
    const rt = RUNTIME_TARGETS[rtName];
    if (arch && rt) return { architecture: arch, runtime: rt };
    return null;
  }

  // Try as architecture name, use first available runtime
  const arch = ARCHITECTURES[target];
  if (arch && arch.runtimeTargets.length > 0) {
    const rt = RUNTIME_TARGETS[arch.runtimeTargets[0]];
    if (rt) return { architecture: arch, runtime: rt };
  }

  return null;
}

export function listArchitectures(): string[] {
  return Object.keys(ARCHITECTURES);
}

/** The full architecture definitions (name, capabilities, composes) for adequacy
 *  resolution — Step 0 scores the spec's shape against every one of these. */
export function listArchitectureDefs(): Architecture[] {
  return Object.values(ARCHITECTURES);
}

export function listRuntimeTargets(): string[] {
  return Object.keys(RUNTIME_TARGETS);
}

/** @deprecated — use resolveTarget instead */
export function getArchitecture(name: string): ResolvedTarget | null {
  return resolveTarget(name);
}
