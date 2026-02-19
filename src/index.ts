/**
 * Phoenix VCS — Public API
 */

// Models
export type { Clause, IngestResult, ClauseDiff } from './models/clause.js';
export { DiffType } from './models/clause.js';
export type { CanonicalNode, CanonicalGraph } from './models/canonical.js';
export { CanonicalType } from './models/canonical.js';
export type { ClassificationSignals, ChangeClassification, DRateStatus } from './models/classification.js';
export { ChangeClass, DRateLevel, BootstrapState } from './models/classification.js';
export type { ImplementationUnit, BoundaryPolicy, EnforcementConfig, IUContract, EvidencePolicy } from './models/iu.js';
export { defaultBoundaryPolicy, defaultEnforcement } from './models/iu.js';
export type { GeneratedManifest, IUManifest, FileManifestEntry, RegenMetadata, DriftEntry, DriftReport, DriftWaiver } from './models/manifest.js';
export { DriftStatus } from './models/manifest.js';
export type { Diagnostic } from './models/diagnostic.js';
export type { EvidenceRecord, PolicyEvaluation, CascadeEvent, CascadeAction } from './models/evidence.js';
export { EvidenceKind, EvidenceStatus } from './models/evidence.js';
export type { PipelineConfig, ShadowDiffMetrics, ShadowResult, CompactionEvent } from './models/pipeline.js';
export { UpgradeClassification, StorageTier } from './models/pipeline.js';
export type { BotCommand, BotResponse, BotName } from './models/bot.js';

// Phase A
export { normalizeText } from './normalizer.js';
export { sha256, clauseSemhash, contextSemhashCold, clauseId } from './semhash.js';
export { parseSpec } from './spec-parser.js';
export { diffClauses } from './diff.js';

// Phase B
export { extractCanonicalNodes, extractTerms } from './canonicalizer.js';
export { extractCanonicalNodesLLM } from './canonicalizer-llm.js';
export { contextSemhashWarm, computeWarmHashes } from './warm-hasher.js';
export { classifyChange, classifyChanges } from './classifier.js';
export { classifyChangeWithLLM, classifyChangesWithLLM } from './classifier-llm.js';
export { DRateTracker } from './d-rate.js';
export { BootstrapStateMachine } from './bootstrap.js';

// Phase C1
export { planIUs } from './iu-planner.js';
export { generateIU, generateAll } from './regen.js';
export type { RegenContext } from './regen.js';
export { ManifestManager } from './manifest.js';
export { detectDrift } from './drift.js';

// Phase C2
export { extractDependencies } from './dep-extractor.js';
export type { ExtractedDep, ExtractedSideChannel, DependencyGraph } from './dep-extractor.js';
export { validateBoundary, validateIU, detectBoundaryChanges } from './boundary-validator.js';
export type { UnitBoundaryChange } from './boundary-validator.js';

// Phase D
export { evaluatePolicy, evaluateAllPolicies } from './policy-engine.js';
export { computeCascade, getTransitiveDependents } from './cascade.js';

// Phase E
export { computeShadowDiff, classifyShadowDiff, runShadowPipeline } from './shadow-pipeline.js';
export { identifyCandidates, runCompaction, shouldTriggerCompaction } from './compaction.js';
export type { StorageStats, CompactionCandidate } from './compaction.js';

// Phase F
export { parseCommand, routeCommand, getAllCommands } from './bot-router.js';

// Scaffold
export { deriveServices, generateScaffold } from './scaffold.js';
export type { ServiceDescriptor, ScaffoldResult } from './scaffold.js';

// LLM
export type { LLMProvider, GenerateOptions, LLMConfig } from './llm/provider.js';
export { DEFAULT_MODELS } from './llm/provider.js';
export { AnthropicProvider } from './llm/anthropic.js';
export { OpenAIProvider } from './llm/openai.js';
export { resolveProvider, describeAvailability } from './llm/resolve.js';
export { buildPrompt, SYSTEM_PROMPT } from './llm/prompt.js';

// Stores
export { ContentStore } from './store/content-store.js';
export { SpecStore } from './store/spec-store.js';
export { CanonicalStore } from './store/canonical-store.js';
export { EvidenceStore } from './store/evidence-store.js';
