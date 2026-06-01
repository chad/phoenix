/**
 * Architecture & Runtime Target
 *
 * Architecture defines the SYSTEM SHAPE — communication patterns, data ownership,
 * component grain, evaluation surfaces. Language/runtime agnostic.
 *
 * Runtime Target defines the COMPILATION TARGET — language, frameworks, templates,
 * packages. Implements an architecture in a specific stack.
 *
 * Hierarchy:
 *   Spec (what users want)
 *     → Architecture (what kind of system)
 *       → Runtime Target (what language/framework)
 *         → Generated Code
 */

import type { ImplementationUnit } from './iu.js';

// ─── Architecture (system shape, language-agnostic) ─────────────────────────

export interface Architecture {
  /** Unique name, e.g., 'web-api' */
  name: string;
  /** Human description */
  description: string;

  /** How components communicate: 'rest', 'graphql', 'grpc', 'events', 'cli' */
  communicationPattern: string;
  /** How data is owned: 'per-component', 'shared-db', 'event-sourced' */
  dataOwnership: string;
  /** How to verify components: 'http-endpoints', 'unit-tests', 'cli-output' */
  evaluationSurface: string;

  /** Architecture-level prompt: describes system shape for the LLM (no language specifics) */
  systemPrompt: string;

  /** Available runtime targets for this architecture */
  runtimeTargets: string[];
}

// ─── Compile diagnostics (target-neutral) ───────────────────────────────────

export interface CompileError {
  file: string;        // project-relative path, as the compiler reports it
  line: number;
  col: number;
  code: string;        // e.g. 'TS18048', or a target-defined code
  message: string;
  raw: string;         // the original compiler line
}

// ─── Service grouping (defined here to keep scaffold.ts ↔ architecture.ts acyclic) ──

export interface ServiceDescriptor {
  /** Service name, e.g. "issue" */
  name: string;
  /** Directory under src/generated/, e.g. "issue" */
  dir: string;
  /** Module file names (with extension), e.g. ["issue.ts"] */
  modules: string[];
  /** The IUs belonging to this service */
  ius: ImplementationUnit[];
  /** Default port for this service */
  port: number;
}

// ─── Shared aggregate artifacts (e.g. migrations) ───────────────────────────

/** One contribution lifted from a module into a shared aggregate file. */
export interface AggregateContribution {
  /** Stable key within the role (e.g. the table name). */
  key: string;
  /** The contribution's rendered statement (the region body). */
  body: string;
}

export interface AggregateRecognition {
  /** The module with the contributions removed (and any now-dead imports pruned). */
  strippedCode: string;
  /** 0-based line indices removed from the module (so the engine can remap provenance). */
  removed: number[];
  contributions: AggregateContribution[];
}

/**
 * A class of content that is intrinsically shared across IUs and must live in ONE
 * aggregate file rather than be duplicated per module. The target owns the language
 * specifics (how to recognize a contribution, the comment syntax, the file header);
 * the engine owns the generic machinery (per-IU regions, provenance remap, dedupe,
 * hashing, drift).
 */
export interface AggregateRole {
  role: string;                    // 'migration'
  /** Path of the assembled aggregate file. */
  filePath: string;
  /** Line-comment prefix for region markers in this file ('//', '#', '--'). */
  commentPrefix: string;
  /** Fixed header at the top of the aggregate file (imports etc.). */
  fileHeader: string;
  /** Side-effect import the scaffold must add so the aggregate runs, or null. */
  importSpecifier: string | null;
  /** Pull this role's contributions out of one module. */
  recognize(moduleCode: string): AggregateRecognition;
}

// ─── Runtime Target (language/framework specific) ───────────────────────────

export interface RuntimeTarget {
  /** Unique name, e.g., 'node-typescript' */
  name: string;
  /** Human description */
  description: string;
  /** Language: 'typescript', 'python', 'go', etc. */
  language: string;
  /** Source file extension, without the dot: 'ts', 'py', 'go'. */
  fileExtension: string;

  /** Production dependencies: package name → version range */
  packages: Record<string, string>;
  /** Dev dependencies */
  devPackages: Record<string, string>;

  /** Module template — the LLM fills in marked sections, structure is guaranteed */
  moduleTemplate: string;
  /** LLM prompt extension — language/framework-specific rules (system prompt) */
  promptExtension: string;
  /** Per-module generation guide injected into the user prompt: mandatory imports,
   *  schema/validation conventions, and browser-code rules for this stack. */
  moduleGuide: string;
  /** Few-shot code examples showing the exact patterns */
  codeExamples: string;

  /** Shared boilerplate files: relative path → file content */
  sharedFiles: Record<string, string>;
  /** Extra package.json / pyproject.toml fields */
  packageExtras: Record<string, unknown>;

  // ── Codegen hooks (the seam that makes a target swappable) ──

  /** Primary output path for an IU given its service/dir slug. */
  outputPathFor(slug: string): string;
  /** Repair raw LLM output into a structurally-valid module (imports, exports, metadata). */
  assemble(llmResponse: string, iu: ImplementationUnit): string;
  /** Fallback stub when generation fails. */
  stub(iu: ImplementationUnit): string;
  /** Extract a module's public contract (schemas + routes) so consumer IUs match it. */
  extractContract(code: string): string | null;
  /** Compile/typecheck the whole assembled project; returns [] when it compiles. */
  compile(projectRoot: string): CompileError[];
  /** Whether the compile gate owns (may auto-repair) this generated file path. */
  ownsGeneratedFile(path: string): boolean;
  /** Optional extra source gate beyond compile (e.g. inline-<script> validation). */
  validateSource?(code: string): string | null;
  /** Shared aggregate artifacts this target lifts out of modules (e.g. migrations). */
  aggregates: AggregateRole[];
  /** Generate the runnable shell: server entry, project config, per-service wiring. */
  scaffold(services: ServiceDescriptor[], projectName: string, sharedImports: string[]): Map<string, string>;
  /** Optional: prepare the project before generation so the compiler can resolve imports
   *  (e.g. write package.json + npm install for tsc). No-op for targets that don't need it. */
  prepareProject?(projectRoot: string): void;
}

// ─── Resolved target (what the pipeline actually uses) ──────────────────────

export interface ResolvedTarget {
  architecture: Architecture;
  runtime: RuntimeTarget;
}
