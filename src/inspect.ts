/**
 * Phoenix Inspect — dynamic provenance inspector.
 *
 * Collects the full compilation graph + trust layer and serves it as a single
 * self-contained HTML app (zero runtime dependencies). The centerpiece is the
 * Inspector: click any artifact to see its full lineage, the actual generated
 * source mapped back to the canon nodes that produced it, and the trust layer
 * (readiness, conceptual mass, evidence, negative knowledge).
 *
 *   Spec Files → Clauses → Canonical Nodes → IUs → Generated Files
 *
 * Surfaces: Pipeline (browse) · Inspector (drawer) · Spec trace · Map (force
 * graph) · Compile (animated playback).
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Clause } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import type { ImplementationUnit } from './models/iu.js';
import type { DriftReport, DriftEntry, GeneratedManifest, RegenMetadata } from './models/manifest.js';

// ─── Data model passed to the HTML renderer ──────────────────────────────────

export interface InspectData {
  projectName: string;
  systemState: string;
  specFiles: SpecFileInfo[];
  clauses: ClauseInfo[];
  canonNodes: CanonNodeInfo[];
  ius: IUInfo[];
  generatedFiles: GenFileInfo[];
  edges: Edge[];
  stats: PipelineStats;
}

export interface SpecFileInfo {
  id: string;
  path: string;
  clauseCount: number;
  lines?: string[];
}

export interface ClauseInfo {
  id: string;
  docId: string;
  sectionPath: string;
  lineRange: string;
  preview: string;
  semhash: string;
}

export interface CanonNodeInfo {
  id: string;
  type: string;
  statement: string;
  tags: string[];
  linkCount: number;
  confidence?: number;
  anchor?: string;
  parentId?: string;
  linkTypes?: Record<string, string>;
  extractionMethod?: string;
}

export interface EvidenceInfo { kind: string; status: string; message?: string; }
export interface NKInfo { kind: string; whatWasTried: string; whyItFailed: string; constraint: string; }
export interface EvalCoverageInfo { total: number; ratio: number; gaps: number; }

export interface IUInfo {
  id: string;
  name: string;
  kind: string;
  riskTier: string;
  canonCount: number;
  outputFiles: string[];
  evidenceRequired: string[];
  description: string;
  invariants: string[];
  regenMeta?: RegenMetadata;
  /** Trust layer */
  readiness?: string;
  conceptualMass?: number;
  evidence: EvidenceInfo[];
  negativeKnowledge: NKInfo[];
  evalCoverage?: EvalCoverageInfo;
}

export interface GenFileInfo {
  path: string;
  iuId: string;
  iuName: string;
  contentHash: string;
  size: number;
  driftStatus: string;
  /** Actual generated source (embedded; may be truncated). */
  content?: string;
  truncated?: boolean;
  /** Exact line→canon provenance from generation markers (line index string → canon id). */
  lineProvenance?: Record<string, string>;
}

export interface Edge {
  from: string;
  to: string;
  type: 'spec→clause' | 'clause→canon' | 'canon→iu' | 'iu→file' | 'canon→canon' | 'canon→parent';
  edgeType?: string;
}

export interface PipelineStats {
  specFiles: number;
  clauses: number;
  canonNodes: number;
  canonByType: Record<string, number>;
  ius: number;
  iusByRisk: Record<string, number>;
  generatedFiles: number;
  totalSize: number;
  driftClean: number;
  driftDirty: number;
  edgeCount: number;
  readinessByLevel: Record<string, number>;
  negativeKnowledge: number;
}

/** Optional trust inputs assembled by the CLI from the stores. */
export interface TrustInputs {
  evidenceByIU?: Record<string, EvidenceInfo[]>;
  nkByIU?: Record<string, NKInfo[]>;
  evalByIU?: Record<string, EvalCoverageInfo>;
}

const MAX_FILE_BYTES = 64 * 1024;     // per-file source embed cap
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // total source embed cap

// ─── Data collection ─────────────────────────────────────────────────────────

export function collectInspectData(
  projectName: string,
  systemState: string,
  clauses: Clause[],
  canonNodes: CanonicalNode[],
  ius: ImplementationUnit[],
  manifest: GeneratedManifest,
  driftReport: DriftReport | null,
  projectRoot?: string,
  trust?: TrustInputs,
): InspectData {
  const edges: Edge[] = [];

  // Spec files
  const docMap = new Map<string, Clause[]>();
  for (const c of clauses) {
    const list = docMap.get(c.source_doc_id) ?? [];
    list.push(c);
    docMap.set(c.source_doc_id, list);
  }
  const specFiles: SpecFileInfo[] = [...docMap.entries()].map(([docId, docClauses]) => {
    let lines: string[] | undefined;
    if (projectRoot) {
      const fullPath = join(projectRoot, docId);
      if (existsSync(fullPath)) lines = readFileSync(fullPath, 'utf8').split('\n');
    }
    return { id: `spec:${docId}`, path: docId, clauseCount: docClauses.length, lines };
  });

  // Clauses + spec→clause edges
  const clauseInfos: ClauseInfo[] = clauses.map(c => {
    edges.push({ from: `spec:${c.source_doc_id}`, to: `clause:${c.clause_id}`, type: 'spec→clause' });
    return {
      id: c.clause_id,
      docId: c.source_doc_id,
      sectionPath: c.section_path.join(' > '),
      lineRange: `L${c.source_line_range[0]}–${c.source_line_range[1]}`,
      preview: c.normalized_text.slice(0, 160).replace(/\n/g, ' '),
      semhash: c.clause_semhash.slice(0, 12),
    };
  });

  // Canon nodes + clause→canon + canon→canon + canon→parent edges. Only emit canon→canon
  // / canon→parent edges to KNOWN nodes — a dangling/stale link id has no client `items`
  // entry and would crash the Provenance panel on lookup.
  const knownCanon = new Set(canonNodes.map(n => n.canon_id));
  const canonInfos: CanonNodeInfo[] = canonNodes.map(n => {
    for (const clauseId of n.source_clause_ids) {
      edges.push({ from: `clause:${clauseId}`, to: `canon:${n.canon_id}`, type: 'clause→canon' });
    }
    for (const linkedId of n.linked_canon_ids) {
      if (!knownCanon.has(linkedId)) continue; // skip dangling link
      const edgeType = n.link_types?.[linkedId];
      edges.push({ from: `canon:${n.canon_id}`, to: `canon:${linkedId}`, type: 'canon→canon', edgeType });
    }
    if (n.parent_canon_id && knownCanon.has(n.parent_canon_id)) {
      edges.push({ from: `canon:${n.parent_canon_id}`, to: `canon:${n.canon_id}`, type: 'canon→parent' });
    }
    return {
      id: n.canon_id,
      type: n.type,
      statement: n.statement,
      tags: n.tags,
      linkCount: n.linked_canon_ids.length,
      confidence: n.confidence,
      anchor: n.canon_anchor?.slice(0, 12),
      parentId: n.parent_canon_id,
      linkTypes: n.link_types,
      extractionMethod: n.extraction_method,
    };
  });

  // IUs + canon→iu edges + trust
  const iuInfos: IUInfo[] = ius.map(iu => {
    const iuManifest = manifest.iu_manifests[iu.iu_id];
    for (const canonId of iu.source_canon_ids) {
      edges.push({ from: `canon:${canonId}`, to: `iu:${iu.iu_id}`, type: 'canon→iu' });
    }
    const regenMeta = iuManifest?.regen_metadata;
    return {
      id: iu.iu_id,
      name: iu.name,
      kind: iu.kind,
      riskTier: iu.risk_tier,
      canonCount: iu.source_canon_ids.length,
      outputFiles: iu.output_files,
      evidenceRequired: iu.evidence_policy.required,
      description: iu.contract.description,
      invariants: iu.contract.invariants,
      regenMeta,
      readiness: regenMeta?.readiness,
      conceptualMass: regenMeta?.conceptual_mass,
      evidence: trust?.evidenceByIU?.[iu.iu_id] ?? [],
      negativeKnowledge: trust?.nkByIU?.[iu.iu_id] ?? [],
      evalCoverage: trust?.evalByIU?.[iu.iu_id],
    };
  });

  // Generated files + iu→file edges + embedded source
  const driftMap = new Map<string, DriftEntry>();
  if (driftReport) for (const e of driftReport.entries) driftMap.set(e.file_path, e);

  const genFiles: GenFileInfo[] = [];
  let totalEmbedded = 0;
  for (const iuM of Object.values(manifest.iu_manifests)) {
    for (const [fp, entry] of Object.entries(iuM.files)) {
      edges.push({ from: `iu:${iuM.iu_id}`, to: `file:${fp}`, type: 'iu→file' });
      const drift = driftMap.get(fp);

      let content: string | undefined;
      let truncated = false;
      if (projectRoot) {
        const fullPath = join(projectRoot, fp);
        try {
          if (existsSync(fullPath) && statSync(fullPath).isFile() && totalEmbedded < MAX_TOTAL_BYTES) {
            const raw = readFileSync(fullPath, 'utf8');
            if (raw.length > MAX_FILE_BYTES) {
              content = raw.slice(0, MAX_FILE_BYTES);
              truncated = true;
            } else {
              content = raw;
            }
            totalEmbedded += content.length;
          }
        } catch { /* unreadable — skip */ }
      }

      genFiles.push({
        path: fp,
        iuId: iuM.iu_id,
        iuName: iuM.iu_name,
        contentHash: entry.content_hash.slice(0, 12),
        size: entry.size,
        driftStatus: drift?.status ?? 'UNKNOWN',
        content,
        truncated,
        lineProvenance: entry.line_provenance,
      });
    }
  }

  // Stats
  const canonByType: Record<string, number> = {};
  for (const n of canonNodes) canonByType[n.type] = (canonByType[n.type] ?? 0) + 1;
  const iusByRisk: Record<string, number> = {};
  for (const iu of ius) iusByRisk[iu.risk_tier] = (iusByRisk[iu.risk_tier] ?? 0) + 1;
  const readinessByLevel: Record<string, number> = {};
  for (const iu of iuInfos) {
    const r = iu.readiness ?? 'unstamped';
    readinessByLevel[r] = (readinessByLevel[r] ?? 0) + 1;
  }
  const nkTotal = iuInfos.reduce((s, iu) => s + iu.negativeKnowledge.length, 0);

  return {
    projectName,
    systemState,
    specFiles,
    clauses: clauseInfos,
    canonNodes: canonInfos,
    ius: iuInfos,
    generatedFiles: genFiles,
    edges,
    stats: {
      specFiles: specFiles.length,
      clauses: clauses.length,
      canonNodes: canonNodes.length,
      canonByType,
      ius: ius.length,
      iusByRisk,
      generatedFiles: genFiles.length,
      totalSize: genFiles.reduce((s, f) => s + f.size, 0),
      driftClean: driftReport?.clean_count ?? 0,
      driftDirty: (driftReport?.drifted_count ?? 0) + (driftReport?.missing_count ?? 0),
      edgeCount: edges.length,
      readinessByLevel,
      negativeKnowledge: nkTotal,
    },
  };
}

// ─── HTML renderer ───────────────────────────────────────────────────────────

export function renderInspectHTML(data: InspectData): string {
  // Embedded as `const D = <json>` inside an inline <script>. Generated source we
  // embed (e.g. a web UI module) can itself contain "</script>" and the JS line
  // terminators U+2028/U+2029, which JSON.stringify leaves unescaped — any of these
  // would terminate or break our inline script. Escape them so the blob is safe.
  const sep = new RegExp('[\\u2028\\u2029]', 'g');
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(sep, c => (c.charCodeAt(0) === 0x2028 ? '\\u2028' : '\\u2029'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phoenix · ${esc(data.projectName)}</title>
<style>
${CSS}
</style>
</head>
<body>
<div class="header">
  <h1>🔥 Phoenix</h1>
  <div class="state">${esc(data.systemState)}</div>
  <div class="mode-btns">
    <button class="mode-btn active" data-mode="pipeline" onclick="setMode('pipeline')">▦ Pipeline</button>
    <button class="mode-btn" data-mode="spec" onclick="setMode('spec')">📄 Spec</button>
    <button class="mode-btn" data-mode="map" onclick="setMode('map')">⬡ Map</button>
    <button class="mode-btn play" onclick="playCompile()" id="btn-play">▶ Compile</button>
  </div>
  <div class="stats" id="stats"></div>
</div>

<div class="surface" id="surface-pipeline">
  <svg class="lines" id="svg-lines"></svg>
  <div class="pipeline" id="pipeline"></div>
  <div class="playcaption" id="playcaption"></div>
</div>

<div class="surface spec-view" id="surface-spec">
  <div class="spec-left" id="spec-text"></div>
  <div class="spec-right" id="spec-trace">
    <div class="trace-empty">Click a highlighted line to trace its path through the pipeline →</div>
  </div>
</div>

<div class="surface map-view" id="surface-map">
  <svg class="map-svg" id="map-svg"></svg>
  <div class="map-hint">drag nodes · scroll to zoom · drag background to pan · click a node to spotlight its lineage</div>
  <div class="map-legend" id="map-legend"></div>
</div>

<!-- Inspector drawer -->
<div class="drawer-scrim" id="drawer-scrim" onclick="closeInspector()"></div>
<div class="drawer" id="drawer">
  <div class="drawer-head">
    <div class="dh-icon" id="dh-icon"></div>
    <div class="dh-title">
      <div class="dh-stage" id="dh-stage"></div>
      <div class="dh-name" id="dh-name"></div>
    </div>
    <button class="dh-close" onclick="closeInspector()">✕</button>
  </div>
  <div class="ribbon" id="ribbon"></div>
  <div class="tabs" id="tabs">
    <button class="tab" data-tab="source" onclick="setTab('source')">⚡ Source</button>
    <button class="tab" data-tab="prov" onclick="setTab('prov')">🔗 Provenance</button>
    <button class="tab" data-tab="trust" onclick="setTab('trust')">🛡 Trust</button>
  </div>
  <div class="tabbody" id="tabbody"></div>
</div>

<script>
const D=${json};
${CLIENT_JS}
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Server ──────────────────────────────────────────────────────────────────

export function serveInspect(
  html: string,
  port: number,
  dataJson?: string,
): { server: ReturnType<typeof createServer>; port: number; ready: Promise<void> } {
  const server = createServer((req, res) => {
    if (req.url === '/data.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(dataJson ?? '{}');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    }
  });

  let actualPort = port;
  const ready = new Promise<void>(resolve => {
    server.listen(port, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') actualPort = addr.port;
      result.port = actualPort;
      resolve();
    });
  });

  const result = { server, port: actualPort, ready };
  return result;
}

// ─── Embedded CSS ─────────────────────────────────────────────────────────────

const CSS = String.raw`
:root{--bg:#0f1117;--surface:#1a1d27;--surface2:#232730;--border:#2e3345;--text:#e1e4ed;--dim:#7a8194;--blue:#5b9cf4;--green:#4ade80;--yellow:#fbbf24;--orange:#fb923c;--red:#f87171;--purple:#a78bfa;--cyan:#22d3ee;--font:'SF Mono','Fira Code','JetBrains Mono',ui-monospace,monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font);background:var(--bg);color:var(--text);font-size:13px;line-height:1.6;overflow:hidden;height:100vh}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:14px;z-index:100;height:52px}
.header h1{font-size:17px;font-weight:700;color:var(--blue)}
.header .state{font-size:10px;padding:3px 8px;border-radius:4px;background:var(--surface2);color:var(--yellow);border:1px solid var(--border)}
.mode-btns{display:flex;gap:4px}
.mode-btn{background:var(--surface2);border:1px solid var(--border);color:var(--dim);padding:5px 12px;border-radius:5px;cursor:pointer;font:inherit;font-size:11px}
.mode-btn:hover{border-color:var(--blue);color:var(--text)}
.mode-btn.active{background:var(--blue);color:#fff;border-color:var(--blue)}
.mode-btn.play{margin-left:6px;border-color:#34506e;color:var(--cyan)}
.mode-btn.play:hover{background:#16303f;border-color:var(--cyan)}
.stats{margin-left:auto;display:flex;gap:14px;font-size:11px;color:var(--dim);align-items:center}
.stats .st b{color:var(--text);font-weight:600}
.stats .st.warn b{color:var(--red)}
.stats .st.ok b{color:var(--green)}
.rdot{display:inline-block;margin-right:2px}

.surface{display:none;height:calc(100vh - 52px);position:relative}
.surface.open{display:flex}

/* Pipeline */
#surface-pipeline{flex-direction:row}
.lines{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10}
.lines path{fill:none;stroke:var(--cyan);stroke-width:1.5;opacity:.55}
.lines path.strong{stroke-width:2.5;opacity:1;filter:drop-shadow(0 0 4px rgba(34,211,238,.5))}
.pipeline{display:flex;flex:1;overflow:hidden}
.column{flex:1;min-width:0;border-right:1px solid var(--border);display:flex;flex-direction:column;transition:background .3s}
.column:last-child{border-right:none}
.column.stage-on{background:#11202c}
.col-header{padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--dim);display:flex;justify-content:space-between;align-items:center}
.col-header .ci{color:var(--text)}
.col-header .ct{color:var(--blue)}
.col-body{flex:1;overflow-y:auto;padding:6px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:4px;cursor:pointer;transition:all .12s;position:relative}
.card:hover{border-color:var(--blue);background:var(--surface2)}
.card.hl{border-color:var(--cyan);background:#142535;box-shadow:0 0 8px rgba(34,211,238,.18)}
.card.sel{border-color:var(--cyan);background:#1a3040;box-shadow:0 0 14px rgba(34,211,238,.3)}
.card.dim{opacity:.28}
.card.pulse{animation:pulse .6s ease}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(34,211,238,.5)}100%{box-shadow:0 0 0 14px rgba(34,211,238,0)}}
.card .t{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px}
.card .t .nm{overflow:hidden;text-overflow:ellipsis}
.card .s{font-size:9px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.badge{display:inline-block;font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.4px;vertical-align:middle;flex:none}
.b-req{background:#1e3a5f;color:var(--blue)}.b-con{background:#3b1e1e;color:var(--red)}.b-inv{background:#2d1e3f;color:var(--purple)}.b-def{background:#1e2d1e;color:var(--green)}.b-ctx{background:#2d2d1e;color:var(--yellow)}
.b-low{background:#1e2d1e;color:var(--green)}.b-medium{background:#2d2a1e;color:var(--yellow)}.b-high{background:#33240f;color:var(--orange)}.b-critical{background:#3b1e1e;color:var(--red)}
.b-clean{background:#1e2d1e;color:var(--green)}.b-drifted{background:#3b1e1e;color:var(--red)}.b-missing{background:#33240f;color:var(--orange)}.b-unknown{background:var(--surface2);color:var(--dim)}.b-untracked{background:var(--surface2);color:var(--dim)}.b-waived{background:#2d2d1e;color:var(--yellow)}
.tag{display:inline-block;font-size:8px;padding:1px 4px;border-radius:2px;background:var(--surface2);color:var(--dim);margin:1px}
.rd{font-weight:700;flex:none}
.rd-regenerable{color:var(--green)}.rd-evaluable{color:var(--blue)}.rd-observable{color:var(--yellow)}.rd-opaque{color:var(--red)}.rd-unstamped{color:var(--dim)}
.playcaption{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);max-width:680px;background:var(--surface);border:1px solid var(--cyan);border-radius:8px;padding:10px 16px;font-size:12px;color:var(--text);z-index:30;display:none;box-shadow:0 6px 30px rgba(0,0,0,.5)}
.playcaption.show{display:block}
.playcaption b{color:var(--cyan)}

/* Drawer */
.drawer-scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:none}
.drawer-scrim.open{display:block}
.drawer{position:fixed;top:0;right:0;height:100vh;width:min(940px,82vw);background:var(--bg);border-left:1px solid var(--border);z-index:310;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .22s cubic-bezier(.4,0,.2,1);box-shadow:-12px 0 40px rgba(0,0,0,.5)}
.drawer.open{transform:translateX(0)}
.drawer-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--surface)}
.dh-icon{font-size:22px;flex:none}
.dh-title{min-width:0;flex:1}
.dh-stage{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--dim)}
.dh-name{font-size:15px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dh-close{background:none;border:1px solid var(--border);color:var(--dim);width:30px;height:30px;border-radius:6px;cursor:pointer;font:inherit;flex:none}
.dh-close:hover{border-color:var(--red);color:var(--red)}
.ribbon{display:flex;align-items:stretch;gap:0;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface);overflow-x:auto}
.rib-stage{display:flex;flex-direction:column;gap:3px;min-width:0}
.rib-stage+.rib-stage{margin-left:0}
.rib-arrow{align-self:center;color:var(--dim);padding:0 8px;flex:none}
.rib-lbl{font-size:8px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim)}
.rib-chip{font-size:10px;padding:3px 8px;border-radius:5px;background:var(--surface2);border:1px solid var(--border);color:var(--dim);cursor:pointer;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
.rib-chip:hover{border-color:var(--blue);color:var(--text)}
.rib-chip.on{border-color:var(--cyan);background:#16303f;color:var(--cyan);font-weight:600}
.rib-more{font-size:9px;color:var(--dim);padding:2px 4px}
.tabs{display:flex;gap:2px;padding:8px 14px 0;border-bottom:1px solid var(--border);background:var(--surface)}
.tab{background:none;border:1px solid transparent;border-bottom:none;color:var(--dim);padding:7px 14px;border-radius:6px 6px 0 0;cursor:pointer;font:inherit;font-size:11px}
.tab:hover{color:var(--text)}
.tab.active{background:var(--bg);border-color:var(--border);color:var(--cyan)}
.tabbody{flex:1;overflow-y:auto;padding:16px 18px}

/* Source view */
.srcmeta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.kv{font-size:10px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:4px 8px;color:var(--dim)}
.kv b{color:var(--text);font-weight:600}
.filepick{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.filepick button{font-size:10px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:4px 9px;border-radius:5px;cursor:pointer;font:inherit}
.filepick button.on{border-color:var(--cyan);color:var(--cyan)}
.code{background:#0b0d13;border:1px solid var(--border);border-radius:8px;overflow:auto;font-size:12px;line-height:1.55}
.code table{border-collapse:collapse;width:100%}
.code td{vertical-align:top;padding:0}
.code .gut{width:42px;text-align:right;color:#444b5e;user-select:none;padding:0 8px 0 10px;border-right:1px solid var(--border);white-space:nowrap}
.code .ln{padding:0 10px;white-space:pre;color:#cdd3e1}
.code .prov{width:0;white-space:nowrap;padding:0}
.code tr.mapped .ln{background:rgba(34,211,238,.05)}
.code tr.mapped .gut{color:var(--cyan)}
.code .ptag{display:inline-block;font-size:9px;padding:0 6px;margin-left:8px;border-radius:3px;border:1px solid var(--border);color:var(--dim);cursor:pointer;vertical-align:middle}
.code .ptag:hover{border-color:var(--cyan);color:var(--cyan)}
.code .ptag.exact{border-color:var(--green);color:var(--green)}
.code .ptag.exact:hover{border-color:var(--green);color:var(--green)}
.provnote .sw.on{background:rgba(74,222,128,.18);border-color:var(--green)}
.code .pmeta{color:#5a7a3e}
.code .pkw{color:var(--purple)}
.code .pstr{color:#8bd47a}
.code .pcom{color:#5a6175;font-style:italic}
.code .pfn{color:var(--cyan)}
.provnote{font-size:10px;color:var(--dim);margin:10px 2px 4px;display:flex;align-items:center;gap:6px}
.provnote .sw{display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(34,211,238,.18);border:1px solid var(--cyan)}
.empty{color:var(--dim);text-align:center;padding:40px}

/* Provenance + Trust panels */
.panel{background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden}
.panel-h{padding:9px 13px;border-bottom:1px solid var(--border);font-weight:700;font-size:11px;display:flex;justify-content:space-between;align-items:center}
.panel-h .lbl{color:var(--dim);font-size:9px;text-transform:uppercase;letter-spacing:.6px}
.panel-b{padding:8px 13px}
.lin{padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;cursor:pointer;display:flex;align-items:center;gap:7px}
.lin:last-child{border-bottom:none}
.lin:hover{color:var(--cyan)}
.lin .chev{color:var(--dim);font-size:10px;flex:none}
.lin .ltxt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.minigraph{width:100%;background:#0b0d13;border:1px solid var(--border);border-radius:8px;margin-bottom:12px}
.minigraph .gn-lbl{font-size:8px;text-transform:uppercase;fill:var(--dim)}
.minigraph .gn-tx{font-size:10px;fill:var(--text)}
.minigraph rect.box{fill:var(--surface);stroke:var(--border);stroke-width:1.5}
.minigraph rect.box.on{stroke:var(--cyan);stroke-width:2}
.minigraph path.ge{fill:none;stroke:var(--cyan);stroke-width:1.5;opacity:.45}
.minigraph path.ge.on{opacity:.95;stroke-width:2.2}
.minigraph text.el{font-size:8px;fill:var(--dim)}

.trust-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.tcard{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px}
.tcard .lab{font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);margin-bottom:6px}
.tcard .big{font-size:20px;font-weight:700}
.tcard .sub{font-size:10px;color:var(--dim);margin-top:3px}
.gradient{display:flex;gap:3px;margin-top:8px}
.gradient .seg{flex:1;height:6px;border-radius:2px;background:var(--surface2)}
.evrow{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px}
.evrow:last-child{border-bottom:none}
.evrow .st{font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;flex:none}
.st-pass{background:#1e2d1e;color:var(--green)}.st-fail{background:#3b1e1e;color:var(--red)}.st-pending{background:#2d2d1e;color:var(--yellow)}.st-skipped{background:var(--surface2);color:var(--dim)}
.nkrow{padding:8px 0;border-bottom:1px solid var(--border)}
.nkrow:last-child{border-bottom:none}
.nkrow .nkh{font-size:11px;font-weight:600;color:var(--orange)}
.nkrow .nkw{font-size:11px;color:var(--text);margin-top:2px}
.nkrow .nkc{font-size:10px;color:var(--dim);margin-top:2px}

/* Spec view */
.spec-view{flex-direction:row}
.spec-left{width:50%;overflow-y:auto;border-right:1px solid var(--border)}
.spec-right{width:50%;overflow-y:auto;padding:16px}
.spec-file-tab{padding:8px 16px;background:var(--surface);border-bottom:1px solid var(--border);font-weight:700;font-size:12px;color:var(--blue);position:sticky;top:0;z-index:5}
.spec-line{padding:2px 16px 2px 50px;position:relative;font-size:13px;line-height:1.7;border-left:3px solid transparent;transition:all .1s}
.spec-line:hover{background:var(--surface2)}
.spec-line .ln{position:absolute;left:0;width:42px;text-align:right;color:var(--dim);font-size:11px;user-select:none}
.spec-line.has-clause{cursor:pointer;border-left-color:var(--blue)}
.spec-line.has-clause:hover{border-left-color:var(--cyan);background:#142535}
.spec-line.active{border-left-color:var(--cyan);background:#1a3040}
.spec-line .heading{color:var(--blue);font-weight:700}
.spec-line .bullet{color:var(--dim)}
.trace-empty{text-align:center;padding:40px;color:var(--dim)}

/* Map */
.map-view{overflow:hidden}
.map-svg{width:100%;height:100%;cursor:grab}
.map-svg:active{cursor:grabbing}
.map-svg .medge{fill:none;stroke:#2e3345;stroke-width:1.2}
.map-svg .medge.on{stroke:var(--cyan);stroke-width:2;opacity:.9}
.map-svg .mlabel{font-size:8px;fill:var(--dim);pointer-events:none}
.map-svg .mnode{cursor:pointer}
.map-svg .mnode circle{stroke:var(--border);stroke-width:1.5}
.map-svg .mnode.on circle{stroke:var(--cyan);stroke-width:2.5}
.map-svg .mnode.dim{opacity:.18}
.map-svg .mnode text{font-size:9px;fill:var(--text);pointer-events:none}
.map-hint{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--dim);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:5px 12px}
.map-legend{position:absolute;top:14px;left:14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:10px;display:flex;flex-direction:column;gap:5px}
.map-legend .lg{display:flex;align-items:center;gap:7px;color:var(--dim)}
.map-legend .lg .dot{width:11px;height:11px;border-radius:50%;flex:none}
`;

// ─── Embedded client JS ───────────────────────────────────────────────────────

const CLIENT_JS = String.raw`
const COL_ORDER=['spec','clause','canon','iu','file'];
const COL_ICON={spec:'📄',clause:'📋',canon:'📐',iu:'📦',file:'⚡'};
const COL_NAME={spec:'Spec File',clause:'Clause',canon:'Canonical Node',iu:'Implementation Unit',file:'Generated File'};
const STAGE_COLOR={spec:'#5b9cf4',clause:'#22d3ee',canon:'#a78bfa',iu:'#fbbf24',file:'#4ade80'};
const RD_ICON={regenerable:'●',evaluable:'◐',observable:'○',opaque:'◌'};

function E(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// indices
const fwd={},bwd={};
D.edges.forEach(e=>{(fwd[e.from]=fwd[e.from]||[]).push(e.to);(bwd[e.to]=bwd[e.to]||[]).push(e.from)});
const edgeMeta={};
D.edges.forEach(e=>{edgeMeta[e.from+'>'+e.to]={type:e.type,edgeType:e.edgeType}});
const items={};
D.specFiles.forEach(s=>items['spec:'+s.path]={col:'spec',d:s});
D.clauses.forEach(c=>items['clause:'+c.id]={col:'clause',d:c});
D.canonNodes.forEach(n=>items['canon:'+n.id]={col:'canon',d:n});
D.ius.forEach(u=>items['iu:'+u.id]={col:'iu',d:u});
D.generatedFiles.forEach(f=>items['file:'+f.path]={col:'file',d:f});
const fileByIU={};
D.generatedFiles.forEach(f=>{(fileByIU[f.iuId]=fileByIU[f.iuId]||[]).push(f)});

// lineage traversal (skip canon↔canon sibling links to keep chains linear)
function lineage(id){
  const set=new Set([id]),q=[id];
  while(q.length){const n=q.shift();
    for(const t of(fwd[n]||[])){if(!set.has(t)&&!(n.startsWith('canon:')&&t.startsWith('canon:'))){set.add(t);q.push(t)}}
    for(const t of(bwd[n]||[])){if(!set.has(t)&&!(n.startsWith('canon:')&&t.startsWith('canon:'))){set.add(t);q.push(t)}}
  }
  return set;
}

// ── Card rendering ──
function rdSpan(r){if(!r)return'';return '<span class="rd rd-'+r+'" title="readiness: '+r+'">'+(RD_ICON[r]||'·')+'</span>'}
function title(id){const it=items[id];if(!it)return E(id);const d=it.d;
  if(it.col==='spec')return '<span class="nm">'+E(d.path.split('/').pop())+'</span>';
  if(it.col==='clause')return '<span class="nm">'+E(d.sectionPath||d.preview.slice(0,40))+'</span>';
  if(it.col==='canon'){const tc=d.type==='CONTEXT'?'ctx':d.type==='CONSTRAINT'?'con':d.type==='REQUIREMENT'?'req':d.type==='INVARIANT'?'inv':'def';return '<span class="badge b-'+tc+'">'+d.type.slice(0,3)+'</span><span class="nm">'+E(d.statement.slice(0,60))+'</span>';}
  if(it.col==='iu')return rdSpan(d.readiness)+'<span class="nm">'+E(d.name)+'</span><span class="badge b-'+d.riskTier+'">'+d.riskTier+'</span>';
  if(it.col==='file')return '<span class="nm">'+E(d.path.split('/').pop())+'</span><span class="badge b-'+d.driftStatus.toLowerCase()+'">'+d.driftStatus+'</span>';
  return E(id);}
function sub(id){const it=items[id];if(!it)return'';const d=it.d;
  if(it.col==='spec')return d.clauseCount+' clauses';
  if(it.col==='clause')return d.lineRange+' · '+E(d.semhash)+'…';
  if(it.col==='canon'){let s=d.tags.slice(0,3).map(t=>'<span class="tag">'+E(t)+'</span>').join('');if(d.confidence!=null)s+='<span class="tag">conf '+d.confidence.toFixed(2)+'</span>';if(d.linkCount)s+='<span class="tag">'+d.linkCount+' links</span>';return s;}
  if(it.col==='iu'){let s=d.canonCount+' canon · '+d.outputFiles.length+' file(s)';if(d.conceptualMass!=null)s+=' · mass '+d.conceptualMass;return s;}
  if(it.col==='file')return E(d.iuName)+' · '+(d.size/1024).toFixed(1)+'KB · '+E(d.contentHash);
  return'';}
function card(id){return '<div class="card" data-id="'+E(id)+'"><div class="t">'+title(id)+'</div><div class="s">'+sub(id)+'</div></div>';}

// ── Pipeline ──
function renderPipeline(){
  const cols=[
    {col:'spec',ids:D.specFiles.map(s=>'spec:'+s.path)},
    {col:'clause',ids:D.clauses.map(c=>'clause:'+c.id)},
    {col:'canon',ids:D.canonNodes.map(n=>'canon:'+n.id)},
    {col:'iu',ids:D.ius.map(u=>'iu:'+u.id)},
    {col:'file',ids:D.generatedFiles.map(f=>'file:'+f.path)},
  ];
  document.getElementById('pipeline').innerHTML=cols.map(c=>
    '<div class="column" data-col="'+c.col+'"><div class="col-header"><span class="ci">'+COL_ICON[c.col]+' '+COL_NAME[c.col]+'s</span><span class="ct">'+c.ids.length+'</span></div><div class="col-body">'+c.ids.map(card).join('')+'</div></div>'
  ).join('');
  document.querySelectorAll('#pipeline .card').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();openInspector(el.dataset.id);highlightPipeline(el.dataset.id);}));
}
function highlightPipeline(id){
  const set=id?lineage(id):null;
  document.querySelectorAll('#pipeline .card').forEach(el=>{
    const cid=el.dataset.id;
    el.classList.toggle('sel',cid===id);
    el.classList.toggle('hl',!!set&&set.has(cid)&&cid!==id);
    el.classList.toggle('dim',!!set&&!set.has(cid));
  });
  requestAnimationFrame(()=>drawPipelineLines(set,id));
}
function clearPipelineHL(){document.querySelectorAll('#pipeline .card').forEach(el=>el.classList.remove('sel','hl','dim'));document.getElementById('svg-lines').innerHTML='';}
function drawPipelineLines(set,id){
  const svg=document.getElementById('svg-lines');svg.innerHTML='';
  if(!set)return;
  const wrap=document.getElementById('surface-pipeline').getBoundingClientRect();
  const r={};
  document.querySelectorAll('#pipeline .card').forEach(el=>{if(!set.has(el.dataset.id))return;const b=el.getBoundingClientRect();r[el.dataset.id]={x:b.left-wrap.left,y:b.top-wrap.top,w:b.width,cy:b.top-wrap.top+b.height/2}});
  const drawn=new Set();
  for(const n of set)for(const t of(fwd[n]||[])){
    if(!set.has(t))continue;if(n.startsWith('canon:')&&t.startsWith('canon:'))continue;
    const k=n+'>'+t;if(drawn.has(k))continue;drawn.add(k);
    const a=r[n],b=r[t];if(!a||!b)continue;
    const x1=a.x+a.w,y1=a.cy,x2=b.x,y2=b.cy,dx=(x2-x1)*0.45;
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d','M'+x1+','+y1+' C'+(x1+dx)+','+y1+' '+(x2-dx)+','+y2+' '+x2+','+y2);
    if(n===id||t===id)p.setAttribute('class','strong');
    svg.appendChild(p);
  }
}

// ── Inspector drawer ──
let selId=null,curTab='source',curFile=null;
function openInspector(id){
  if(!items[id])return;
  selId=id;curFile=null;
  const it=items[id];
  document.getElementById('dh-icon').textContent=COL_ICON[it.col];
  document.getElementById('dh-stage').textContent=COL_NAME[it.col];
  document.getElementById('dh-name').innerHTML=shortName(id);
  // default tab by type
  curTab=(it.col==='file'||it.col==='iu')?'source':'prov';
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-scrim').classList.add('open');
  renderRibbon();renderTabs();renderTab();
}
function closeInspector(){document.getElementById('drawer').classList.remove('open');document.getElementById('drawer-scrim').classList.remove('open');selId=null;clearPipelineHL();}
function shortName(id){const it=items[id],d=it.d;
  if(it.col==='spec')return E(d.path);if(it.col==='clause')return E(d.sectionPath||d.preview.slice(0,50));
  if(it.col==='canon')return '<span class="badge b-'+canonBadge(d.type)+'">'+d.type+'</span> '+E(d.statement.slice(0,70));
  if(it.col==='iu')return E(d.name);if(it.col==='file')return E(d.path.split('/').pop());return E(id);}
function canonBadge(t){return t==='CONTEXT'?'ctx':t==='CONSTRAINT'?'con':t==='REQUIREMENT'?'req':t==='INVARIANT'?'inv':'def'}

function setTab(t){curTab=t;renderTabs();renderTab();}
function renderTabs(){document.querySelectorAll('#tabs .tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===curTab));}
function renderTab(){
  const body=document.getElementById('tabbody');
  if(curTab==='source')body.innerHTML=viewSource();
  else if(curTab==='prov')body.innerHTML=viewProv();
  else body.innerHTML=viewTrust();
  if(curTab==='source')wireSource();
  if(curTab==='prov')wireProv();
}

// Ribbon: the actual lineage chain across the 5 stages
function renderRibbon(){
  const set=lineage(selId);
  const byCol={spec:[],clause:[],canon:[],iu:[],file:[]};
  for(const id of set){const it=items[id];if(it)byCol[it.col].push(id)}
  let html='';
  COL_ORDER.forEach((col,i)=>{
    const ids=byCol[col];
    if(i>0)html+='<div class="rib-arrow">→</div>';
    html+='<div class="rib-stage"><div class="rib-lbl">'+COL_ICON[col]+' '+COL_NAME[col]+'</div>';
    if(!ids.length)html+='<div class="rib-more">—</div>';
    ids.slice(0,4).forEach(id=>{html+='<div class="rib-chip'+(id===selId?' on':'')+'" data-id="'+E(id)+'" title="'+E(plain(id))+'">'+E(plain(id))+'</div>'});
    if(ids.length>4)html+='<div class="rib-more">+'+(ids.length-4)+' more</div>';
    html+='</div>';
  });
  const rib=document.getElementById('ribbon');
  rib.innerHTML=html;
  rib.querySelectorAll('.rib-chip').forEach(c=>c.addEventListener('click',()=>{openInspector(c.dataset.id);highlightPipeline(c.dataset.id);}));
}
function plain(id){const it=items[id];if(!it)return id;const d=it.d;
  if(it.col==='spec')return d.path.split('/').pop();
  if(it.col==='clause')return d.sectionPath||d.preview.slice(0,28);
  if(it.col==='canon')return d.statement.slice(0,30);
  if(it.col==='iu')return d.name;if(it.col==='file')return d.path.split('/').pop();return id;}

// ── Source tab ──
function iuOf(id){const it=items[id];if(it.col==='iu')return it.d;if(it.col==='file')return D.ius.find(u=>u.id===it.d.iuId);return null;}
function viewSource(){
  const it=items[selId];
  if(it.col==='file')return fileSource(it.d,iuOf(selId));
  if(it.col==='iu'){
    const files=fileByIU[it.d.id]||[];
    if(!files.length)return '<div class="empty">No generated files for this IU yet.</div>';
    const fid=curFile||files[0].path;
    const f=files.find(x=>x.path===fid)||files[0];
    let pick='<div class="filepick">'+files.map(x=>'<button class="'+(x.path===f.path?'on':'')+'" data-f="'+E(x.path)+'">'+E(x.path.split('/').pop())+'</button>').join('')+'</div>';
    return pick+fileSource(f,it.d);
  }
  // clause/canon/spec → point to downstream code
  const set=lineage(selId);
  const files=[...set].filter(x=>x.startsWith('file:')).map(x=>items[x].d);
  if(!files.length)return '<div class="empty">This node has no generated code downstream yet.<br><span style="font-size:11px">Try the Provenance tab to see its lineage.</span></div>';
  return '<div class="provnote">This '+COL_NAME[it.col].toLowerCase()+' flows into '+files.length+' generated file(s). Jump to one:</div>'+
    '<div class="filepick">'+files.map(f=>'<button data-jump="file:'+E(f.path)+'">⚡ '+E(f.path.split('/').pop())+'</button>').join('')+'</div>'+
    fileSource(files[0],D.ius.find(u=>u.id===files[0].iuId));
}
function fileSource(f,iu){
  if(f.content==null)return '<div class="empty">Source not embedded (file unreadable or over size cap).<br><span style="font-size:11px">'+E(f.path)+'</span></div>';
  const meta='<div class="srcmeta">'+
    '<span class="kv">path <b>'+E(f.path)+'</b></span>'+
    '<span class="kv">hash <b>'+E(f.contentHash)+'</b></span>'+
    '<span class="kv">size <b>'+(f.size/1024).toFixed(1)+'KB</b></span>'+
    '<span class="kv">drift <b>'+E(f.driftStatus)+'</b></span>'+
    (iu&&iu.regenMeta?'<span class="kv">model <b>'+E(iu.regenMeta.model_id)+'</b></span><span class="kv">promptpack <b>'+E((iu.regenMeta.promptpack_hash||'').slice(0,10))+'</b></span>':'')+
    (iu&&iu.readiness?'<span class="kv">readiness <b class="rd-'+iu.readiness+'">'+(RD_ICON[iu.readiness]||'')+' '+E(iu.readiness)+'</b></span>':'')+
    '</div>';
  // provenance: exact from generation markers when present, else inferred by term overlap
  let map={},exact=false;
  if(f.lineProvenance&&Object.keys(f.lineProvenance).length){
    exact=true;
    for(const k in f.lineProvenance){const it=items['canon:'+f.lineProvenance[k]];if(it)map[+k]={id:f.lineProvenance[k],type:it.d.type,statement:it.d.statement}}
  }else{
    const canon=iu?D.canonNodes.filter(n=>lineage('iu:'+iu.id).has('canon:'+n.id)&&['REQUIREMENT','CONSTRAINT','INVARIANT'].includes(n.type)):[];
    map=inferProvenance(f.content,canon);
  }
  const hasMap=Object.keys(map).length>0;
  const lines=f.content.split('\n');
  let rows='';
  lines.forEach((ln,i)=>{
    const m=map[i];
    const tag=m?'<span class="ptag'+(exact?' exact':'')+'" data-c="canon:'+E(m.id)+'" title="'+E(m.statement)+'">◄ '+m.type.slice(0,3)+'</span>':'';
    rows+='<tr class="'+(m?'mapped':'')+'"><td class="gut">'+(i+1)+'</td><td class="ln">'+hi(ln)+tag+'</td></tr>';
  });
  const note=exact
    ?'<div class="provnote"><span class="sw on"></span> highlighted lines are <b style="color:var(--green);font-weight:600;margin:0 3px">traced</b> from generation markers — exact line→requirement provenance. Click a ◄ tag to inspect that requirement.</div>'
    :'<div class="provnote"><span class="sw"></span> highlighted lines are an <b style="color:var(--cyan);font-weight:600;margin:0 3px">inferred</b> mapping to the canon node they most likely implement (term overlap). Click a ◄ tag to inspect that requirement.</div>';
  return meta+(hasMap?note:'')+'<div class="code"><table>'+rows+'</table></div>'+(f.truncated?'<div class="provnote">⚠ source truncated at size cap.</div>':'');
}
function wireSource(){
  document.querySelectorAll('#tabbody .filepick button[data-f]').forEach(b=>b.addEventListener('click',()=>{curFile=b.dataset.f;renderTab()}));
  document.querySelectorAll('#tabbody .filepick button[data-jump]').forEach(b=>b.addEventListener('click',()=>{openInspector(b.dataset.jump);highlightPipeline(b.dataset.jump)}));
  document.querySelectorAll('#tabbody .ptag[data-c]').forEach(t=>t.addEventListener('click',()=>{openInspector(t.dataset.c);highlightPipeline(t.dataset.c)}));
}
// minimal syntax highlight (ts)
function hi(s){
  let e=E(s);
  e=e.replace(/(\/\/.*)$/,'<span class="pcom">$1</span>');
  e=e.replace(/('[^']*'|\`[^\`]*\`)/g,'<span class="pstr">$1</span>');
  e=e.replace(/\b(const|let|export|import|from|return|function|async|await|if|else|new|interface|type|class|for|of|throw)\b/g,'<span class="pkw">$1</span>');
  e=e.replace(/(_phoenix|iu_id|risk_tier|canon_ids)/g,'<span class="pmeta">$1</span>');
  return e;
}
// term-overlap provenance inference
const STOP=new Set('a an the to of and or is are be must should can will not no with for from in on at by as this that it its their there which when then each all any new use using via per into out over under than'.split(' '));
function terms(s){return [...new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>2&&!STOP.has(w)))]}
function inferProvenance(code,canon){
  const cterms=canon.map(n=>({n,t:terms(n.statement)}));
  const lines=code.split('\n');const map={};
  lines.forEach((ln,i)=>{
    const lt=new Set(terms(ln));if(!lt.size)return;
    let best=null,bs=0;
    for(const c of cterms){let hit=0;for(const t of c.t)if(lt.has(t))hit++;if(hit>bs){bs=hit;best=c.n}}
    if(best&&bs>=2)map[i]={id:best.id,type:best.type,statement:best.statement};
  });
  return map;
}

// ── Provenance tab ──
function viewProv(){
  const up=[...lineage(selId)].filter(x=>x!==selId&&depth(x)<depth(selId));
  const down=[...lineage(selId)].filter(x=>x!==selId&&depth(x)>depth(selId));
  const sib=siblings(selId);
  let html=miniGraph(selId);
  html+=linPanel('⬆ Upstream — what produced this','derived from',up.sort((a,b)=>depth(a)-depth(b)));
  html+=linPanel('⬇ Downstream — what this produced','compiles to',down.sort((a,b)=>depth(a)-depth(b)));
  if(sib.length)html+=linPanel('↔ Related canon (typed links)','linked',sib);
  return html;
}
function depth(id){return COL_ORDER.indexOf(items[id].col)}
function siblings(id){
  if(!id.startsWith('canon:'))return [];
  const out=[];
  for(const t of(fwd[id]||[]))if(t.startsWith('canon:')){const m=edgeMeta[id+'>'+t];out.push({id:t,rel:m&&m.edgeType?m.edgeType:'links'})}
  for(const f of(bwd[id]||[]))if(f.startsWith('canon:')){const m=edgeMeta[f+'>'+id];out.push({id:f,rel:(m&&m.edgeType?m.edgeType:'links')+' (rev)'})}
  return out;
}
function linPanel(head,verb,ids){
  if(!ids.length)return'';
  let rows='';
  ids.forEach(x=>{
    const id=x.id||x;const rel=x.rel?'<span class="tag">'+E(x.rel)+'</span>':'';
    rows+='<div class="lin" data-id="'+E(id)+'"><span class="chev">'+COL_ICON[items[id].col]+'</span><span class="ltxt">'+plainBadge(id)+'</span>'+rel+'</div>';
  });
  return '<div class="panel"><div class="panel-h"><span>'+head+'</span><span class="lbl">'+ids.length+' · '+verb+'</span></div><div class="panel-b">'+rows+'</div></div>';
}
function plainBadge(id){const it=items[id],d=it.d;
  if(it.col==='canon')return '<span class="badge b-'+canonBadge(d.type)+'">'+d.type.slice(0,3)+'</span> '+E(d.statement.slice(0,64));
  if(it.col==='iu')return rdSpan(d.readiness)+' '+E(d.name);
  if(it.col==='file')return E(d.path.split('/').pop());
  return E(plain(id));}
function wireProv(){document.querySelectorAll('#tabbody .lin').forEach(l=>l.addEventListener('click',()=>{openInspector(l.dataset.id);highlightPipeline(l.dataset.id)}));
  document.querySelectorAll('#tabbody .minigraph .mnode').forEach(n=>n.addEventListener('click',()=>{openInspector(n.dataset.id);highlightPipeline(n.dataset.id)}));}

// layered mini graph of the connected subgraph
function miniGraph(id){
  const set=lineage(id);
  const byCol={spec:[],clause:[],canon:[],iu:[],file:[]};
  for(const x of set){const it=items[x];if(it)byCol[it.col].push(x)}
  const COLW=170,GAP=46,ROWH=40,PADX=14,PADY=20,BOXW=150,BOXH=30;
  const present=COL_ORDER.filter(c=>byCol[c].length);
  const colX={};present.forEach((c,i)=>colX[c]=PADX+i*(COLW+GAP));
  const pos={};present.forEach(c=>byCol[c].forEach((x,i)=>pos[x]={x:colX[c],y:PADY+18+i*ROWH}));
  const maxRows=Math.max(...present.map(c=>byCol[c].length),1);
  const W=PADX*2+present.length*COLW+(present.length-1)*GAP, H=PADY+18+maxRows*ROWH+10;
  let edgesSvg='';
  const drawn=new Set();
  for(const n of set)for(const t of(fwd[n]||[])){
    if(!set.has(t))continue;if(n.startsWith('canon:')&&t.startsWith('canon:'))continue;
    const k=n+'>'+t;if(drawn.has(k))continue;drawn.add(k);
    const a=pos[n],b=pos[t];if(!a||!b)continue;
    const x1=a.x+BOXW,y1=a.y+BOXH/2,x2=b.x,y2=b.y+BOXH/2,dx=(x2-x1)*0.4;
    const on=(n===id||t===id)?' on':'';
    edgesSvg+='<path class="ge'+on+'" d="M'+x1+','+y1+' C'+(x1+dx)+','+y1+' '+(x2-dx)+','+y2+' '+x2+','+y2+'"/>';
  }
  let nodesSvg='';
  present.forEach(c=>{
    nodesSvg+='<text class="el" x="'+(colX[c])+'" y="'+(PADY+6)+'">'+COL_ICON[c]+' '+E(COL_NAME[c])+'</text>';
    byCol[c].forEach(x=>{const p=pos[x];const on=x===id?' on':'';
      nodesSvg+='<g class="mnode" data-id="'+E(x)+'">'+
        '<rect class="box'+on+'" x="'+p.x+'" y="'+p.y+'" width="'+BOXW+'" height="'+BOXH+'" rx="6"/>'+
        '<text class="gn-tx" x="'+(p.x+9)+'" y="'+(p.y+19)+'">'+E(clip(plain(x),22))+'</text></g>';
    });
  });
  return '<svg class="minigraph" viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">'+edgesSvg+nodesSvg+'</svg>';
}
function clip(s,n){return s.length>n?s.slice(0,n-1)+'…':s}

// ── Trust tab ──
function viewTrust(){
  const iu=iuOf(selId);
  if(!iu)return '<div class="empty">Trust data lives on Implementation Units & their files.<br><span style="font-size:11px">Select an IU or a generated file.</span></div>';
  const r=iu.readiness;
  const segOrder=['opaque','observable','evaluable','regenerable'];
  const segIdx=segOrder.indexOf(r);
  const grad='<div class="gradient">'+segOrder.map((s,i)=>'<div class="seg" style="background:'+(i<=segIdx&&segIdx>=0?readyColor(r):'var(--surface2)')+'" title="'+s+'"></div>').join('')+'</div>';
  let html='<div class="trust-grid">';
  html+='<div class="tcard"><div class="lab">Readiness</div><div class="big rd-'+(r||'unstamped')+'">'+(r?(RD_ICON[r]+' '+r):'unstamped')+'</div>'+grad+'<div class="sub">replacement audit gradient</div></div>';
  html+='<div class="tcard"><div class="lab">Conceptual mass</div><div class="big">'+(iu.conceptualMass!=null?iu.conceptualMass:'—')+'</div><div class="sub">concepts to hold in mind (ratchet target ≤ prior)</div></div>';
  html+='</div>';
  // evidence
  html+='<div class="panel"><div class="panel-h"><span>🧪 Evidence</span><span class="lbl">required: '+E((iu.evidenceRequired||[]).join(', ')||'none')+'</span></div><div class="panel-b">';
  if(!iu.evidence||!iu.evidence.length)html+='<div class="sub" style="color:var(--dim);padding:4px 0">No evidence records yet for this IU.</div>';
  else iu.evidence.forEach(ev=>{html+='<div class="evrow"><span class="st st-'+ev.status.toLowerCase()+'">'+E(ev.status)+'</span><b>'+E(ev.kind)+'</b>'+(ev.message?'<span style="color:var(--dim);font-size:11px">'+E(ev.message)+'</span>':'')+'</div>'});
  html+='</div></div>';
  // evaluations
  if(iu.evalCoverage){const c=iu.evalCoverage;
    html+='<div class="panel"><div class="panel-h"><span>📋 Evaluations</span><span class="lbl">the durable codebase</span></div><div class="panel-b"><div class="evrow"><b>'+c.total+'</b> evaluations · coverage <b>'+Math.round(c.ratio*100)+'%</b>'+(c.gaps?' · <span style="color:var(--orange)">'+c.gaps+' gap(s)</span>':'')+'</div></div></div>';
  }
  // negative knowledge
  html+='<div class="panel"><div class="panel-h"><span>🧠 Negative knowledge</span><span class="lbl">immune memory</span></div><div class="panel-b">';
  if(!iu.negativeKnowledge||!iu.negativeKnowledge.length)html+='<div class="sub" style="color:var(--dim);padding:4px 0">No recorded failures. Clean history.</div>';
  else iu.negativeKnowledge.forEach(nk=>{html+='<div class="nkrow"><div class="nkh">⚠ '+E(nk.kind)+'</div><div class="nkw">'+E(nk.whatWasTried)+' — '+E(nk.whyItFailed)+'</div><div class="nkc">→ '+E(nk.constraint)+'</div></div>'});
  html+='</div></div>';
  return html;
}
function readyColor(r){return {regenerable:'var(--green)',evaluable:'var(--blue)',observable:'var(--yellow)',opaque:'var(--red)'}[r]||'var(--dim)'}

// ── Modes ──
let mode='pipeline';
function setMode(m){
  mode=m;
  document.querySelectorAll('.mode-btn[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  ['pipeline','spec','map'].forEach(s=>document.getElementById('surface-'+s).classList.toggle('open',s===m));
  if(m==='spec')renderSpec();
  if(m==='map')renderMap();
}

// ── Stats bar ──
function renderStats(){
  const s=D.stats;
  let rd='';
  ['regenerable','evaluable','observable','opaque'].forEach(k=>{if(s.readinessByLevel[k])rd+='<span class="rdot rd-'+k+'">'+RD_ICON[k]+'</span>'+s.readinessByLevel[k]});
  document.getElementById('stats').innerHTML=
    '<div class="st"><b>'+s.specFiles+'</b> specs</div>'+
    '<div class="st"><b>'+s.clauses+'</b> clauses</div>'+
    '<div class="st"><b>'+s.canonNodes+'</b> canon</div>'+
    '<div class="st"><b>'+s.ius+'</b> IUs</div>'+
    '<div class="st"><b>'+s.generatedFiles+'</b> files</div>'+
    (rd?'<div class="st" title="readiness mix">'+rd+'</div>':'')+
    (s.negativeKnowledge?'<div class="st warn"><b>'+s.negativeKnowledge+'</b> ⚠ nk</div>':'')+
    (s.driftDirty>0?'<div class="st warn"><b>'+s.driftDirty+'</b> drift</div>':'<div class="st ok"><b>clean</b></div>');
}

// ── Spec trace view (ported) ──
function renderSpec(){
  const container=document.getElementById('spec-text');
  const lineClause={};
  D.clauses.forEach(cl=>{const m=cl.lineRange.match(/L(\d+)–(\d+)/);if(!m)return;for(let i=+m[1];i<=+m[2];i++)lineClause[cl.docId+'::'+i]=cl});
  let html='';
  D.specFiles.forEach(sf=>{if(!sf.lines)return;
    html+='<div class="spec-file-tab">'+E(sf.path)+'</div>';
    sf.lines.forEach((line,i)=>{const n=i+1;const cl=lineClause[sf.path+'::'+n];const isH=/^#{1,6}\s/.test(line);const isB=/^\s*[-*•]/.test(line);const c=E(line)||'&nbsp;';
      const disp=isH?'<span class="heading">'+c+'</span>':isB?'<span class="bullet">- </span>'+c.replace(/^\s*[-*•]\s*/,''):c;
      html+='<div class="spec-line'+(cl?' has-clause':'')+'" data-line="'+n+'" data-doc="'+E(sf.path)+'"'+(cl?' data-clause="'+cl.id+'"':'')+'><span class="ln">'+n+'</span>'+disp+'</div>';
    });
  });
  container.innerHTML=html;
  container.querySelectorAll('.spec-line.has-clause').forEach(el=>el.addEventListener('click',()=>{
    container.querySelectorAll('.spec-line.active').forEach(a=>a.classList.remove('active'));
    const cl=D.clauses.find(c=>c.id===el.dataset.clause);if(!cl)return;
    const m=cl.lineRange.match(/L(\d+)–(\d+)/);if(m)for(let i=+m[1];i<=+m[2];i++){const ln=container.querySelector('[data-line="'+i+'"][data-doc="'+el.dataset.doc+'"]');if(ln)ln.classList.add('active')}
    specTrace(el.dataset.clause);
  }));
}
function specTrace(clauseId){
  const panel=document.getElementById('spec-trace');
  const set=lineage('clause:'+clauseId);
  const canon=[...set].filter(x=>x.startsWith('canon:')).map(x=>items[x].d);
  const ius=[...set].filter(x=>x.startsWith('iu:')).map(x=>items[x].d);
  const files=[...set].filter(x=>x.startsWith('file:')).map(x=>items[x].d);
  const cl=D.clauses.find(c=>c.id===clauseId);
  let h='<div class="panel"><div class="panel-h"><span>📋 Clause</span><span class="lbl">'+E(cl.lineRange)+'</span></div><div class="panel-b"><div style="color:var(--blue);font-weight:600">'+E(cl.sectionPath)+'</div><div style="color:var(--dim);font-size:11px;margin-top:4px">'+E(cl.preview)+'</div></div></div>';
  if(canon.length){h+='<div class="panel"><div class="panel-h"><span>📐 Canonical</span><span class="lbl">'+canon.length+'</span></div><div class="panel-b">';canon.forEach(n=>{h+='<div class="lin" data-id="canon:'+E(n.id)+'"><span class="badge b-'+canonBadge(n.type)+'">'+n.type.slice(0,3)+'</span><span class="ltxt">'+E(n.statement.slice(0,80))+'</span></div>'});h+='</div></div>'}
  if(ius.length){h+='<div class="panel"><div class="panel-h"><span>📦 Impl Units</span><span class="lbl">'+ius.length+'</span></div><div class="panel-b">';ius.forEach(u=>{h+='<div class="lin" data-id="iu:'+E(u.id)+'">'+rdSpan(u.readiness)+'<span class="ltxt">'+E(u.name)+'</span><span class="badge b-'+u.riskTier+'">'+u.riskTier+'</span></div>'});h+='</div></div>'}
  if(files.length){h+='<div class="panel"><div class="panel-h"><span>⚡ Generated</span><span class="lbl">'+files.length+'</span></div><div class="panel-b">';files.forEach(f=>{h+='<div class="lin" data-id="file:'+E(f.path)+'"><span class="ltxt">'+E(f.path.split('/').pop())+'</span><span class="badge b-'+f.driftStatus.toLowerCase()+'">'+f.driftStatus+'</span></div>'});h+='</div></div>'}
  panel.innerHTML=h;
  panel.querySelectorAll('.lin').forEach(l=>l.addEventListener('click',()=>{setMode('pipeline');openInspector(l.dataset.id);highlightPipeline(l.dataset.id)}));
}

// ── Map: force-directed layered graph ──
let mapState=null;
function renderMap(){
  const svg=document.getElementById('map-svg');
  const rect=svg.getBoundingClientRect();const W=rect.width,H=rect.height;
  // nodes (skip showing every clause if huge? keep all)
  const nodes=Object.keys(items).map(id=>({id,col:items[id].col}));
  const idx={};nodes.forEach((n,i)=>idx[n.id]=i);
  // initial layout: x by stage, y spread
  const colCount={};nodes.forEach(n=>colCount[n.col]=(colCount[n.col]||0)+1);
  const seen={};
  nodes.forEach(n=>{const ci=COL_ORDER.indexOf(n.col);seen[n.col]=(seen[n.col]||0);
    n.x=80+ci*((W-160)/4);n.y=40+((seen[n.col]+0.5)/(colCount[n.col]))*(H-80);n.tx=n.x;seen[n.col]++});
  const links=[];
  D.edges.forEach(e=>{if(e.type==='canon→canon')return;if(idx[e.from]!=null&&idx[e.to]!=null)links.push({s:idx[e.from],t:idx[e.to],type:e.type,edgeType:e.edgeType})});
  // simulate
  for(let it=0;it<160;it++){
    // repulsion within column
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i],b=nodes[j];if(a.col!==b.col)continue;
      let dy=a.y-b.y;const d=Math.abs(dy)||0.1;if(d<60){const f=(60-d)/d*0.5;dy=dy||(Math.random()-0.5);a.y+=Math.sign(dy)*f;b.y-=Math.sign(dy)*f}
    }
    // springs pull y together
    for(const l of links){const a=nodes[l.s],b=nodes[l.t];const dy=(a.y-b.y)*0.02;a.y-=dy;b.y+=dy}
    // pin x to stage, clamp y
    for(const n of nodes){n.x+=(n.tx-n.x)*0.5;n.y=Math.max(30,Math.min(H-20,n.y))}
  }
  mapState={nodes,links,idx,tf:{x:0,y:0,k:1},sel:null};
  drawMap();
  // legend
  document.getElementById('map-legend').innerHTML=COL_ORDER.map(c=>'<div class="lg"><span class="dot" style="background:'+STAGE_COLOR[c]+'"></span>'+COL_NAME[c]+'</div>').join('');
  wireMapPanZoom();
}
function mapRadius(col){return col==='iu'?9:col==='file'?8:col==='spec'?9:6}
function drawMap(){
  const svg=document.getElementById('map-svg');const {nodes,links,tf,sel}=mapState;
  const set=sel?lineage(sel):null;
  let e='';
  links.forEach(l=>{const a=nodes[l.s],b=nodes[l.t];const on=set&&set.has(a.id)&&set.has(b.id);
    const dx=(b.x-a.x)*0.4;
    e+='<path class="medge'+(on?' on':'')+'" d="M'+a.x+','+a.y+' C'+(a.x+dx)+','+a.y+' '+(b.x-dx)+','+b.y+' '+b.x+','+b.y+'"/>';
  });
  let n='';
  nodes.forEach(nd=>{const on=sel===nd.id;const inset=set&&set.has(nd.id);const cls='mnode'+(on?' on':'')+(set&&!inset?' dim':'');
    n+='<g class="'+cls+'" data-id="'+E(nd.id)+'" transform="translate('+nd.x+','+nd.y+')">'+
      '<circle r="'+mapRadius(nd.col)+'" fill="'+STAGE_COLOR[nd.col]+'"/>'+
      ((inset||!set)&&(nd.col==='iu'||nd.col==='file'||nd.col==='spec')?'<text x="'+(mapRadius(nd.col)+3)+'" y="3">'+E(clip(plain(nd.id),18))+'</text>':'')+
      '</g>';
  });
  svg.innerHTML='<g transform="translate('+tf.x+','+tf.y+') scale('+tf.k+')">'+e+n+'</g>';
  svg.querySelectorAll('.mnode').forEach(g=>g.addEventListener('click',ev=>{ev.stopPropagation();mapState.sel=g.dataset.id;drawMap();openInspector(g.dataset.id);highlightPipeline(g.dataset.id)}));
}
function wireMapPanZoom(){
  const svg=document.getElementById('map-svg');
  let drag=null,node=null;
  svg.onwheel=e=>{e.preventDefault();const t=mapState.tf;const k=Math.max(.3,Math.min(3,t.k*(e.deltaY<0?1.1:0.9)));const r=svg.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;t.x=mx-(mx-t.x)*(k/t.k);t.y=my-(my-t.y)*(k/t.k);t.k=k;drawMap()};
  svg.onmousedown=e=>{const g=e.target.closest('.mnode');if(g){node=mapState.nodes[mapState.idx[g.dataset.id]]}else{drag={x:e.clientX,y:e.clientY,ox:mapState.tf.x,oy:mapState.tf.y}}};
  window.onmousemove=e=>{
    if(node){const r=svg.getBoundingClientRect();node.x=(e.clientX-r.left-mapState.tf.x)/mapState.tf.k;node.y=(e.clientY-r.top-mapState.tf.y)/mapState.tf.k;node.tx=node.x;drawMap()}
    else if(drag){mapState.tf.x=drag.ox+(e.clientX-drag.x);mapState.tf.y=drag.oy+(e.clientY-drag.y);drawMap()}
  };
  window.onmouseup=()=>{drag=null;node=null};
  svg.onclick=e=>{if(!e.target.closest('.mnode')){mapState.sel=null;drawMap()}};
}

// ── Compile playback ──
let playing=false;
const STAGE_CAP={
  spec:'<b>1 · Spec</b> — plain-language intent. Phoenix parses each document into clauses.',
  clause:'<b>2 · Clauses</b> — each clause is a content-addressed unit of intent with a semantic hash.',
  canon:'<b>3 · Canonicalization</b> — typed requirements, constraints & invariants are extracted.',
  iu:'<b>4 · Implementation Units</b> — requirements are grouped into stable compile boundaries.',
  file:'<b>5 · Generated code</b> — each IU is compiled to code; the gate stamps readiness + mass; drift is tracked.'
};
function playCompile(){
  if(playing)return;
  setMode('pipeline');closeInspector();
  // pick the clause with the richest lineage as the worked example
  let anchor=null,best=-1;
  D.clauses.forEach(c=>{const n=lineage('clause:'+c.id).size;if(n>best){best=n;anchor='clause:'+c.id}});
  if(!anchor){return}
  const set=lineage(anchor);
  playing=true;
  const cap=document.getElementById('playcaption');cap.classList.add('show');
  document.querySelectorAll('#pipeline .card').forEach(el=>el.classList.add('dim'));
  let i=0;
  function step(){
    if(i>=COL_ORDER.length){
      // settle on the anchor lineage view
      cap.innerHTML='<b>✓ Compiled.</b> One spec clause → its full provenance chain. Click any node to inspect it.';
      document.querySelectorAll('.column').forEach(c=>c.classList.remove('stage-on'));
      highlightPipeline(anchor);
      setTimeout(()=>{cap.classList.remove('show');playing=false},4200);
      return;
    }
    const col=COL_ORDER[i];
    document.querySelectorAll('.column').forEach(c=>c.classList.toggle('stage-on',c.dataset.col===col));
    cap.innerHTML=STAGE_CAP[col];
    // reveal this stage's nodes in the chain
    document.querySelectorAll('#pipeline .column[data-col="'+col+'"] .card').forEach(el=>{
      if(set.has(el.dataset.id)){el.classList.remove('dim');el.classList.add('hl','pulse');setTimeout(()=>el.classList.remove('pulse'),600)}
    });
    requestAnimationFrame(()=>drawPipelineLines(stageSet(set,i),anchor));
    i++;setTimeout(step,1150);
  }
  step();
}
function stageSet(set,upto){const s=new Set();for(const id of set){if(COL_ORDER.indexOf(items[id].col)<=upto)s.add(id)}return s}

// ── Global keys ──
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.getElementById('drawer').classList.contains('open'))closeInspector();}});
window.addEventListener('resize',()=>{if(mode==='pipeline'&&selId)requestAnimationFrame(()=>drawPipelineLines(lineage(selId),selId))});

// init
renderStats();renderPipeline();setMode('pipeline');
`;
