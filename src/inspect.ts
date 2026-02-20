/**
 * Phoenix Inspect — interactive intent pipeline visualisation.
 *
 * Collects the full provenance graph and serves it as a single-page
 * HTML app with an interactive Sankey-style flow:
 *
 *   Spec Files → Clauses → Canonical Nodes → IUs → Generated Files
 *
 * Each node is clickable to expand detail. Edges show the causal chain.
 */

import { createServer } from 'node:http';
import type { Clause } from './models/clause.js';
import type { CanonicalNode } from './models/canonical.js';
import type { ImplementationUnit } from './models/iu.js';
import type { DriftReport, DriftEntry, GeneratedManifest, RegenMetadata } from './models/manifest.js';
import { DriftStatus } from './models/manifest.js';

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
}

export interface ClauseInfo {
  id: string;
  docId: string;
  sectionPath: string;
  lineRange: string;
  preview: string;
  rawText: string;
  semhash: string;
  contextHash: string;
}

export interface CanonNodeInfo {
  id: string;
  type: string;
  statement: string;
  tags: string[];
  linkedIds: string[];
  linkCount: number;
  confidence?: number;
  anchor?: string;
  parentId?: string;
  linkTypes?: Record<string, string>;
  extractionMethod?: string;
  sourceClauseIds: string[];
}

export interface IUInfo {
  id: string;
  name: string;
  kind: string;
  riskTier: string;
  canonCount: number;
  sourceCanonIds: string[];
  dependencies: string[];
  outputFiles: string[];
  evidenceRequired: string[];
  description: string;
  inputs: string[];
  outputs: string[];
  invariants: string[];
  regenMeta?: RegenMetadata;
}

export interface GenFileInfo {
  path: string;
  iuId: string;
  iuName: string;
  contentHash: string;
  size: number;
  driftStatus: string;
}

export interface Edge {
  from: string;
  to: string;
  type: 'spec→clause' | 'clause→canon' | 'canon→iu' | 'iu→file' | 'canon→canon' | 'canon→parent';
  edgeType?: string; // typed edge for canon→canon
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
}

// ─── Data collection ─────────────────────────────────────────────────────────

export function collectInspectData(
  projectName: string,
  systemState: string,
  clauses: Clause[],
  canonNodes: CanonicalNode[],
  ius: ImplementationUnit[],
  manifest: GeneratedManifest,
  driftReport: DriftReport | null,
): InspectData {
  const edges: Edge[] = [];

  // Spec files
  const docMap = new Map<string, Clause[]>();
  for (const c of clauses) {
    const list = docMap.get(c.source_doc_id) ?? [];
    list.push(c);
    docMap.set(c.source_doc_id, list);
  }
  const specFiles: SpecFileInfo[] = [...docMap.entries()].map(([docId, docClauses]) => ({
    id: `spec:${docId}`,
    path: docId,
    clauseCount: docClauses.length,
  }));

  // Clauses + spec→clause edges
  const clauseInfos: ClauseInfo[] = clauses.map(c => {
    edges.push({ from: `spec:${c.source_doc_id}`, to: `clause:${c.clause_id}`, type: 'spec→clause' });
    return {
      id: c.clause_id,
      docId: c.source_doc_id,
      sectionPath: c.section_path.join(' > '),
      lineRange: `L${c.source_line_range[0]}–${c.source_line_range[1]}`,
      preview: c.normalized_text.slice(0, 120).replace(/\n/g, ' '),
      rawText: c.raw_text,
      semhash: c.clause_semhash.slice(0, 12),
      contextHash: c.context_semhash_cold.slice(0, 12),
    };
  });

  // Canon nodes + clause→canon edges + canon→canon edges
  const canonInfos: CanonNodeInfo[] = canonNodes.map(n => {
    for (const clauseId of n.source_clause_ids) {
      edges.push({ from: `clause:${clauseId}`, to: `canon:${n.canon_id}`, type: 'clause→canon' });
    }
    for (const linkedId of n.linked_canon_ids) {
      const edgeType = n.link_types?.[linkedId];
      edges.push({ from: `canon:${n.canon_id}`, to: `canon:${linkedId}`, type: 'canon→canon', edgeType });
    }
    if (n.parent_canon_id) {
      edges.push({ from: `canon:${n.parent_canon_id}`, to: `canon:${n.canon_id}`, type: 'canon→parent' });
    }
    return {
      id: n.canon_id,
      type: n.type,
      statement: n.statement,
      tags: n.tags,
      linkedIds: n.linked_canon_ids,
      linkCount: n.linked_canon_ids.length,
      confidence: n.confidence,
      anchor: n.canon_anchor?.slice(0, 12),
      parentId: n.parent_canon_id,
      linkTypes: n.link_types,
      extractionMethod: n.extraction_method,
      sourceClauseIds: n.source_clause_ids,
    };
  });

  // IUs + canon→iu edges
  const iuInfos: IUInfo[] = ius.map(iu => {
    const iuManifest = manifest.iu_manifests[iu.iu_id];
    for (const canonId of iu.source_canon_ids) {
      edges.push({ from: `canon:${canonId}`, to: `iu:${iu.iu_id}`, type: 'canon→iu' });
    }
    return {
      id: iu.iu_id,
      name: iu.name,
      kind: iu.kind,
      riskTier: iu.risk_tier,
      canonCount: iu.source_canon_ids.length,
      sourceCanonIds: iu.source_canon_ids,
      dependencies: iu.dependencies,
      outputFiles: iu.output_files,
      evidenceRequired: iu.evidence_policy.required,
      description: iu.contract.description,
      inputs: iu.contract.inputs,
      outputs: iu.contract.outputs,
      invariants: iu.contract.invariants,
      regenMeta: iuManifest?.regen_metadata,
    };
  });

  // Generated files + iu→file edges
  const driftMap = new Map<string, DriftEntry>();
  if (driftReport) {
    for (const e of driftReport.entries) driftMap.set(e.file_path, e);
  }
  const genFiles: GenFileInfo[] = [];
  for (const iuM of Object.values(manifest.iu_manifests)) {
    for (const [fp, entry] of Object.entries(iuM.files)) {
      edges.push({ from: `iu:${iuM.iu_id}`, to: `file:${fp}`, type: 'iu→file' });
      const drift = driftMap.get(fp);
      genFiles.push({
        path: fp,
        iuId: iuM.iu_id,
        iuName: iuM.iu_name,
        contentHash: entry.content_hash.slice(0, 12),
        size: entry.size,
        driftStatus: drift?.status ?? 'UNKNOWN',
      });
    }
  }

  // Stats
  const canonByType: Record<string, number> = {};
  for (const n of canonNodes) canonByType[n.type] = (canonByType[n.type] ?? 0) + 1;
  const iusByRisk: Record<string, number> = {};
  for (const iu of ius) iusByRisk[iu.risk_tier] = (iusByRisk[iu.risk_tier] ?? 0) + 1;

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
    },
  };
}

// ─── HTML renderer ───────────────────────────────────────────────────────────

export function renderInspectHTML(data: InspectData): string {
  const json = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phoenix · ${esc(data.projectName)}</title>
<style>
:root{--bg:#0f1117;--surface:#1a1d27;--surface2:#232730;--surface3:#2a2e3a;--border:#2e3345;--border2:#3d4259;--text:#e1e4ed;--dim:#7a8194;--dim2:#535a6e;--blue:#5b9cf4;--green:#4ade80;--yellow:#fbbf24;--orange:#fb923c;--red:#f87171;--purple:#a78bfa;--cyan:#22d3ee;--pink:#f472b6;--font:system-ui,-apple-system,'Segoe UI',sans-serif;--mono:'SF Mono','Fira Code','JetBrains Mono','Cascadia Code',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font);background:var(--bg);color:var(--text);font-size:13px;line-height:1.6;overflow:hidden;height:100vh}

/* ── Header ── */
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:14px;z-index:100;height:48px}
.header h1{font-size:16px;font-weight:700;color:var(--cyan);white-space:nowrap}
.header .proj{font-size:13px;color:var(--text);font-weight:600}
.header .state{font-size:10px;padding:2px 8px;border-radius:10px;background:var(--surface2);color:var(--yellow);border:1px solid var(--border)}
.search-box{margin-left:auto;position:relative;width:260px}
.search-box input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:5px 10px 5px 30px;color:var(--text);font:inherit;font-size:12px;outline:none;transition:border-color .15s}
.search-box input:focus{border-color:var(--cyan)}
.search-box .icon{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--dim);font-size:12px;pointer-events:none}
.stats-bar{display:flex;gap:12px;font-size:10px;color:var(--dim);margin-left:16px}
.stats-bar b{color:var(--text);font-weight:600}

/* ── Layout ── */
.main{display:flex;height:calc(100vh - 48px)}
.pipeline-wrap{display:flex;flex:1;position:relative;overflow:hidden}
.pipeline{display:flex;flex:1;overflow:hidden}
.detail-panel{width:420px;min-width:420px;background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;transition:width .2s}
.detail-panel.closed{width:0;min-width:0;border-left:none}

/* ── Columns ── */
.column{flex:1;min-width:0;border-right:1px solid var(--border);display:flex;flex-direction:column}
.column:last-child{border-right:none}
.col-header{padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--dim);display:flex;justify-content:space-between;align-items:center}
.col-header .ct{color:var(--cyan);font-size:11px}
.col-body{flex:1;overflow-y:auto;padding:4px 6px}
.col-body::-webkit-scrollbar{width:6px}
.col-body::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}

/* ── Cards ── */
.card{background:var(--surface);border:1px solid transparent;border-radius:6px;padding:7px 10px;margin-bottom:3px;cursor:pointer;transition:all .12s;position:relative}
.card:hover{border-color:var(--border2);background:var(--surface2)}
.card.hl{border-color:var(--cyan);background:rgba(34,211,238,.06)}
.card.sel{border-color:var(--cyan);background:rgba(34,211,238,.1);box-shadow:0 0 0 1px var(--cyan)}
.card.dim-card{opacity:.15;pointer-events:none}
.card .t{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .s{font-size:9px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.card .edge-ct{position:absolute;top:4px;right:6px;font-size:8px;color:var(--dim2);font-weight:600}

/* ── Badges ── */
.badge{display:inline-block;font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.5px;vertical-align:middle}
.b-req{background:#1e3a5f;color:var(--blue)}.b-con{background:#3b1e1e;color:var(--red)}.b-inv{background:#2d1e3f;color:var(--purple)}.b-def{background:#1e2d1e;color:var(--green)}.b-ctx{background:#2d2d1e;color:var(--yellow)}
.b-low{background:#1e2d1e;color:var(--green)}.b-medium{background:#2d2a1e;color:var(--yellow)}.b-high{background:#2d1e1e;color:var(--orange)}.b-critical{background:#3b1e1e;color:var(--red)}
.b-clean{background:#1e2d1e;color:var(--green)}.b-drifted{background:#3b1e1e;color:var(--red)}.b-missing{background:#2d1e1e;color:var(--orange)}.b-unknown{background:var(--surface2);color:var(--dim)}
.b-rule{background:var(--surface2);color:var(--dim)}.b-llm{background:#1e2a3f;color:var(--cyan)}
.tag{display:inline-block;font-size:8px;padding:1px 5px;border-radius:2px;background:var(--surface2);color:var(--dim);margin:1px;font-family:var(--mono)}

/* ── SVG lines ── */
svg.lines{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10}
svg.lines path{fill:none;stroke-width:1.5;opacity:.5}
svg.lines path.e-s2c{stroke:var(--blue)}
svg.lines path.e-c2n{stroke:var(--purple)}
svg.lines path.e-n2i{stroke:var(--green)}
svg.lines path.e-i2f{stroke:var(--orange)}
svg.lines path.strong{stroke-width:2.5;opacity:1;filter:drop-shadow(0 0 3px currentColor)}

/* ── Detail panel ── */
.dp-header{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;background:var(--surface)}
.dp-header .dp-icon{font-size:18px}
.dp-header .dp-title{flex:1;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-header .dp-close{background:none;border:none;color:var(--dim);cursor:pointer;font-size:16px;padding:4px 8px;border-radius:4px}
.dp-header .dp-close:hover{color:var(--red);background:var(--surface2)}
.dp-body{flex:1;overflow-y:auto;padding:0}
.dp-body::-webkit-scrollbar{width:6px}
.dp-body::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.dp-section{border-bottom:1px solid var(--border);padding:12px 16px}
.dp-section:last-child{border-bottom:none}
.dp-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--dim);margin-bottom:6px}
.dp-value{font-size:12px;color:var(--text);line-height:1.5}
.dp-value.mono{font-family:var(--mono);font-size:11px}
.dp-id{font-family:var(--mono);font-size:10px;color:var(--dim);word-break:break-all}
.dp-text{font-family:var(--mono);font-size:11px;color:var(--text);white-space:pre-wrap;line-height:1.5;background:var(--surface2);padding:10px 12px;border-radius:6px;max-height:250px;overflow-y:auto;border:1px solid var(--border)}
.dp-text::-webkit-scrollbar{width:5px}
.dp-text::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}

/* ── Provenance trail ── */
.prov-chain{display:flex;flex-direction:column;gap:2px}
.prov-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;cursor:pointer;transition:background .1s;font-size:11px}
.prov-item:hover{background:var(--surface2)}
.prov-item .pi-icon{font-size:12px;flex-shrink:0;width:18px;text-align:center}
.prov-item .pi-text{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prov-item .pi-type{flex-shrink:0;font-size:9px;color:var(--dim)}
.prov-arrow{text-align:center;color:var(--dim2);font-size:10px;padding:0 0 0 8px}
.prov-dir{font-size:9px;font-weight:700;color:var(--dim2);text-transform:uppercase;letter-spacing:.5px;padding:8px 0 4px 0;display:flex;align-items:center;gap:8px}
.prov-dir::after{content:'';flex:1;height:1px;background:var(--border)}

/* ── Graph overlay ── */
.graph-overlay{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:500;display:none;flex-direction:column}
.graph-overlay.open{display:flex}
.graph-bar{padding:10px 20px;display:flex;align-items:center;gap:14px;background:var(--surface);border-bottom:1px solid var(--border)}
.graph-bar h2{font-size:14px;color:var(--cyan);font-weight:700}
.graph-bar .graph-legend{display:flex;gap:12px;margin-left:20px}
.graph-bar .gl-item{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--dim)}
.graph-bar .gl-dot{width:8px;height:8px;border-radius:50%}
.graph-bar .close{background:none;border:1px solid var(--border);color:var(--dim);padding:4px 14px;border-radius:4px;cursor:pointer;font:inherit;font-size:11px;margin-left:auto}
.graph-bar .close:hover{border-color:var(--red);color:var(--red)}
.graph-body{flex:1;overflow:auto;position:relative}
.graph-canvas{position:absolute;top:0;left:0}
.gn{position:absolute;background:var(--surface);border:2px solid var(--border);border-radius:8px;padding:10px 14px;font-size:11px;cursor:pointer;z-index:2;transition:all .15s;max-width:260px}
.gn:hover{border-color:var(--blue);transform:scale(1.02)}
.gn.gn-sel{border-color:var(--cyan);box-shadow:0 0 20px rgba(34,211,238,.4);transform:scale(1.05)}
.gn.gn-hl{border-color:var(--cyan);box-shadow:0 0 8px rgba(34,211,238,.2)}
.gn .gn-label{font-size:8px;text-transform:uppercase;color:var(--dim);letter-spacing:.5px;margin-bottom:3px;display:flex;align-items:center;gap:6px}
.gn .gn-text{font-weight:600;color:var(--text);word-break:break-word;font-size:11px;line-height:1.4}
.gn .gn-sub{font-size:9px;color:var(--dim);margin-top:3px}
svg.graph-edges{position:absolute;top:0;left:0;pointer-events:none;z-index:1}
svg.graph-edges line{stroke:var(--border);stroke-width:1.5;opacity:.4}
svg.graph-edges line.primary{stroke:var(--cyan);stroke-width:2.5;opacity:.8;filter:drop-shadow(0 0 4px rgba(34,211,238,.3))}
svg.graph-edges line.canon-link{stroke:var(--purple);stroke-width:1;opacity:.3;stroke-dasharray:4,3}
.edge-label{position:absolute;font-size:8px;color:var(--dim2);background:var(--bg);padding:0 3px;border-radius:2px;z-index:3;pointer-events:none}
</style>
</head>
<body>
<div class="header">
  <h1>🔥 Phoenix</h1>
  <span class="proj">${esc(data.projectName)}</span>
  <div class="state">${esc(data.systemState)}</div>
  <div class="search-box">
    <span class="icon">⌕</span>
    <input type="text" id="search" placeholder="Search specs, clauses, nodes, IUs…" autocomplete="off" spellcheck="false">
  </div>
  <div class="stats-bar">
    <div><b>${data.stats.specFiles}</b> specs</div>
    <div><b>${data.stats.clauses}</b> clauses</div>
    <div><b>${data.stats.canonNodes}</b> canon</div>
    <div><b>${data.stats.ius}</b> IUs</div>
    <div><b>${data.stats.generatedFiles}</b> files</div>
    <div><b>${data.stats.edgeCount}</b> edges</div>
    <div>${data.stats.driftDirty>0?`<b style="color:var(--red)">${data.stats.driftDirty} drift</b>`:'<b style="color:var(--green)">✔ clean</b>'}</div>
  </div>
</div>
<div class="main">
  <div class="pipeline-wrap">
    <svg class="lines" id="svg-lines"></svg>
    <div class="pipeline" id="pipeline"></div>
  </div>
  <div class="detail-panel closed" id="detail-panel">
    <div class="dp-header">
      <span class="dp-icon" id="dp-icon"></span>
      <span class="dp-title" id="dp-title"></span>
      <button class="dp-close" onclick="closeDetail()" title="Close (Esc)">✕</button>
    </div>
    <div class="dp-body" id="dp-body"></div>
  </div>
</div>
<div class="graph-overlay" id="graph-overlay">
  <div class="graph-bar">
    <h2 id="graph-title">Provenance Graph</h2>
    <div class="graph-legend">
      <div class="gl-item"><div class="gl-dot" style="background:var(--blue)"></div>spec→clause</div>
      <div class="gl-item"><div class="gl-dot" style="background:var(--purple)"></div>clause→canon</div>
      <div class="gl-item"><div class="gl-dot" style="background:var(--green)"></div>canon→IU</div>
      <div class="gl-item"><div class="gl-dot" style="background:var(--orange)"></div>IU→file</div>
      <div class="gl-item"><div class="gl-dot" style="background:var(--purple);opacity:.5"></div>canon↔canon</div>
    </div>
    <button class="close" onclick="closeGraph()">✕ Close</button>
  </div>
  <div class="graph-body" id="graph-body"><div class="graph-canvas" id="graph-canvas"></div></div>
</div>

<script>
const D=${json};
const COL_ORDER=['spec','clause','canon','iu','file'];
const COL_LABEL={spec:'Spec Files',clause:'Clauses',canon:'Canonical Nodes',iu:'Implementation Units',file:'Generated Files'};
const COL_ICON={spec:'📄',clause:'📋',canon:'📐',iu:'📦',file:'⚡'};
const COL_COLOR={spec:'var(--text)',clause:'var(--blue)',canon:'var(--purple)',iu:'var(--green)',file:'var(--orange)'};

// Build indices
const fwd={},bwd={},edgeTypes={};
D.edges.forEach(e=>{
  (fwd[e.from]=fwd[e.from]||[]).push(e.to);
  (bwd[e.to]=bwd[e.to]||[]).push(e.from);
  if(e.edgeType)edgeTypes[e.from+'→'+e.to]=e.edgeType;
});
const items={};
D.specFiles.forEach(s=>items['spec:'+s.path]={col:'spec',d:s,search:(s.path).toLowerCase()});
D.clauses.forEach(c=>items['clause:'+c.id]={col:'clause',d:c,search:(c.sectionPath+' '+c.rawText).toLowerCase()});
D.canonNodes.forEach(n=>items['canon:'+n.id]={col:'canon',d:n,search:(n.type+' '+n.statement+' '+n.tags.join(' ')).toLowerCase()});
D.ius.forEach(u=>items['iu:'+u.id]={col:'iu',d:u,search:(u.name+' '+u.description+' '+u.riskTier).toLowerCase()});
D.generatedFiles.forEach(f=>items['file:'+f.path]={col:'file',d:f,search:(f.path+' '+f.iuName).toLowerCase()});

function E(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// ── Traversal ──
function getConnected(id){
  const set=new Set([id]);const q=[id];
  while(q.length){const n=q.shift();
    for(const t of(fwd[n]||[])){if(!set.has(t)&&!(n.startsWith('canon:')&&t.startsWith('canon:'))){set.add(t);q.push(t)}}
    for(const t of(bwd[n]||[])){if(!set.has(t)&&!(n.startsWith('canon:')&&t.startsWith('canon:'))){set.add(t);q.push(t)}}
  }
  return set;
}

// Upstream/downstream for provenance trail
function getUpstream(id){
  const list=[];const visited=new Set([id]);
  function walk(nid,depth){
    for(const p of(bwd[nid]||[])){
      if(visited.has(p))continue;
      if(nid.startsWith('canon:')&&p.startsWith('canon:'))continue;
      visited.add(p);
      list.push({id:p,depth});
      walk(p,depth+1);
    }
  }
  walk(id,0);
  return list.sort((a,b)=>a.depth-b.depth);
}
function getDownstream(id){
  const list=[];const visited=new Set([id]);
  function walk(nid,depth){
    for(const c of(fwd[nid]||[])){
      if(visited.has(c))continue;
      if(nid.startsWith('canon:')&&c.startsWith('canon:'))continue;
      visited.add(c);
      list.push({id:c,depth});
      walk(c,depth+1);
    }
  }
  walk(id,0);
  return list.sort((a,b)=>a.depth-b.depth);
}

// ── Card rendering ──
function canonBadge(type){const m={REQUIREMENT:'req',CONSTRAINT:'con',INVARIANT:'inv',DEFINITION:'def',CONTEXT:'ctx'};return '<span class="badge b-'+(m[type]||'ctx')+'">'+type+'</span>';}
function riskBadge(r){return '<span class="badge b-'+r+'">'+r+'</span>';}
function driftBadge(s){return '<span class="badge b-'+s.toLowerCase()+'">'+s+'</span>';}

function nodeTitle(id){const it=items[id];if(!it)return id;const d=it.d;
  if(it.col==='spec')return E(d.path);
  if(it.col==='clause')return E(d.sectionPath);
  if(it.col==='canon')return canonBadge(d.type)+' '+E(d.statement.slice(0,60));
  if(it.col==='iu')return E(d.name)+' '+riskBadge(d.riskTier);
  if(it.col==='file')return E(d.path.split('/').pop())+' '+driftBadge(d.driftStatus);
  return id;
}
function nodeSub(id){const it=items[id];if(!it)return'';const d=it.d;
  if(it.col==='spec')return d.clauseCount+' clauses';
  if(it.col==='clause')return d.docId+' · '+d.lineRange;
  if(it.col==='canon'){
    let s=d.tags.slice(0,3).map(t=>'<span class="tag">'+E(t)+'</span>').join('');
    if(d.extractionMethod)s+=' <span class="badge b-'+d.extractionMethod+'">'+d.extractionMethod+'</span>';
    return s;
  }
  if(it.col==='iu')return d.canonCount+' req · '+d.outputFiles.length+' file(s)';
  if(it.col==='file')return E(d.iuName)+' · '+(d.size/1024).toFixed(1)+'KB';
  return '';
}
function edgeCount(id){return ((fwd[id]||[]).length+(bwd[id]||[]).length);}
function crd(id){
  const ec=edgeCount(id);
  return '<div class="card" data-id="'+E(id)+'">'
    +'<div class="t">'+nodeTitle(id)+'</div>'
    +'<div class="s">'+nodeSub(id)+'</div>'
    +(ec?'<div class="edge-ct">'+ec+'</div>':'')
    +'</div>';
}

// ── Render pipeline ──
function render(){
  const cols=[
    {title:'Spec Files',col:'spec',ids:D.specFiles.map(s=>'spec:'+s.path)},
    {title:'Clauses',col:'clause',ids:D.clauses.map(c=>'clause:'+c.id)},
    {title:'Canon Nodes',col:'canon',ids:D.canonNodes.map(n=>'canon:'+n.id)},
    {title:'IUs',col:'iu',ids:D.ius.map(u=>'iu:'+u.id)},
    {title:'Files',col:'file',ids:D.generatedFiles.map(f=>'file:'+f.path)},
  ];
  document.getElementById('pipeline').innerHTML=cols.map(c=>
    '<div class="column" data-col="'+c.col+'">'
    +'<div class="col-header"><span>'+COL_ICON[c.col]+' '+c.title+'</span><span class="ct">'+c.ids.length+'</span></div>'
    +'<div class="col-body">'+c.ids.map(crd).join('')+'</div></div>'
  ).join('');
  document.querySelectorAll('.card').forEach(el=>{
    el.addEventListener('click',e=>{e.stopPropagation();selectCard(el.dataset.id)});
  });
}

// ── Selection state ──
let selId=null,connected=new Set();

function selectCard(id){
  if(selId===id){openGraph();return;}
  selId=id;connected=getConnected(id);
  applyHighlight();
  showDetail(id);
  requestAnimationFrame(drawLines);
}

function applyHighlight(){
  const cards=document.querySelectorAll('.card');
  if(!selId){
    cards.forEach(el=>{el.classList.remove('hl','sel','dim-card')});
    clearLines();return;
  }
  cards.forEach(el=>{
    const cid=el.dataset.id;
    el.classList.toggle('hl',connected.has(cid)&&cid!==selId);
    el.classList.toggle('sel',cid===selId);
    el.classList.toggle('dim-card',!connected.has(cid));
  });
}

function deselect(){selId=null;connected.clear();applyHighlight();clearLines();closeDetail();}

// ── Search ──
let searchTerm='';
document.getElementById('search').addEventListener('input',e=>{
  searchTerm=e.target.value.toLowerCase();
  const cards=document.querySelectorAll('.card');
  if(!searchTerm){cards.forEach(el=>el.style.display='');return;}
  cards.forEach(el=>{
    const it=items[el.dataset.id];
    const match=it&&it.search.includes(searchTerm);
    el.style.display=match?'':'none';
  });
});

// ── SVG lines ──
function clearLines(){document.getElementById('svg-lines').innerHTML='';}
function edgeClass(from,to){
  if(from.startsWith('spec:'))return 'e-s2c';
  if(from.startsWith('clause:')&&to.startsWith('canon:'))return 'e-c2n';
  if(from.startsWith('canon:')&&to.startsWith('iu:'))return 'e-n2i';
  if(from.startsWith('iu:'))return 'e-i2f';
  return 'e-s2c';
}
function drawLines(){
  const svg=document.getElementById('svg-lines');svg.innerHTML='';
  if(!selId)return;
  const wrap=document.querySelector('.pipeline-wrap');
  const wr=wrap.getBoundingClientRect();
  const rects={};
  document.querySelectorAll('.card.hl,.card.sel').forEach(el=>{
    const r=el.getBoundingClientRect();
    rects[el.dataset.id]={x:r.left-wr.left,y:r.top-wr.top,w:r.width,h:r.height,cy:r.top-wr.top+r.height/2};
  });
  const drawn=new Set();
  for(const nid of connected){
    for(const t of(fwd[nid]||[])){
      if(!connected.has(t))continue;
      if(nid.startsWith('canon:')&&t.startsWith('canon:'))continue;
      const key=nid+'→'+t;if(drawn.has(key))continue;drawn.add(key);
      const a=rects[nid],b=rects[t];if(!a||!b)continue;
      const x1=a.x+a.w,y1=a.cy,x2=b.x,y2=b.cy;
      const dx=(x2-x1)*0.4;
      const cls=edgeClass(nid,t)+((nid===selId||t===selId)?' strong':'');
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',\`M\${x1},\${y1} C\${x1+dx},\${y1} \${x2-dx},\${y2} \${x2},\${y2}\`);
      p.setAttribute('class',cls);
      svg.appendChild(p);
    }
  }
}

// ── Detail panel ──
function showDetail(id){
  const panel=document.getElementById('detail-panel');
  panel.classList.remove('closed');
  const it=items[id];if(!it)return;
  document.getElementById('dp-icon').textContent=COL_ICON[it.col];
  document.getElementById('dp-title').innerHTML=nodeTitle(id);
  document.getElementById('dp-body').innerHTML=buildDetail(id);
  // Attach click handlers in detail panel
  document.querySelectorAll('.prov-item[data-nav]').forEach(el=>{
    el.addEventListener('click',()=>selectCard(el.dataset.nav));
  });
  requestAnimationFrame(drawLines);
}
function closeDetail(){
  document.getElementById('detail-panel').classList.add('closed');
  requestAnimationFrame(drawLines);
}

function buildDetail(id){
  const it=items[id];if(!it)return'';
  const d=it.d;
  let h='';

  // ── Identity section ──
  h+='<div class="dp-section">';
  h+='<div class="dp-label">Identity</div>';
  h+='<div class="dp-id">'+E(id.includes(':')?id.split(':').slice(1).join(':'):id)+'</div>';
  h+='</div>';

  // ── Type-specific content ──
  if(it.col==='spec'){
    h+='<div class="dp-section"><div class="dp-label">Path</div><div class="dp-value mono">'+E(d.path)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Clauses</div><div class="dp-value">'+d.clauseCount+' clauses extracted</div></div>';
  }
  else if(it.col==='clause'){
    h+='<div class="dp-section"><div class="dp-label">Document</div><div class="dp-value mono">'+E(d.docId)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Section</div><div class="dp-value">'+E(d.sectionPath)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Lines</div><div class="dp-value mono">'+E(d.lineRange)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Semantic Hash</div><div class="dp-value mono">'+E(d.semhash)+'…</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Context Hash</div><div class="dp-value mono">'+E(d.contextHash)+'…</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Raw Spec Text</div><div class="dp-text">'+E(d.rawText)+'</div></div>';
  }
  else if(it.col==='canon'){
    h+='<div class="dp-section"><div class="dp-label">Type</div><div class="dp-value">'+canonBadge(d.type)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Statement</div><div class="dp-text">'+E(d.statement)+'</div></div>';
    if(d.confidence!=null){
      const pct=Math.round(d.confidence*100);
      const col=pct>=80?'var(--green)':pct>=50?'var(--yellow)':'var(--red)';
      h+='<div class="dp-section"><div class="dp-label">Confidence</div><div class="dp-value"><span style="color:'+col+';font-weight:700">'+pct+'%</span></div></div>';
    }
    if(d.extractionMethod){
      h+='<div class="dp-section"><div class="dp-label">Extraction</div><div class="dp-value"><span class="badge b-'+d.extractionMethod+'">'+d.extractionMethod+'</span></div></div>';
    }
    if(d.anchor){
      h+='<div class="dp-section"><div class="dp-label">Anchor</div><div class="dp-value mono">'+E(d.anchor)+'…</div></div>';
    }
    if(d.tags.length){
      h+='<div class="dp-section"><div class="dp-label">Tags</div><div class="dp-value">'+d.tags.map(t=>'<span class="tag">'+E(t)+'</span>').join(' ')+'</div></div>';
    }
    if(d.linkCount>0&&d.linkTypes){
      h+='<div class="dp-section"><div class="dp-label">Canon Links ('+d.linkCount+')</div><div class="prov-chain">';
      for(const [lid,lt] of Object.entries(d.linkTypes)){
        const linked=items['canon:'+lid];
        if(linked)h+='<div class="prov-item" data-nav="canon:'+E(lid)+'"><span class="pi-icon">🔗</span><span class="pi-text">'+E(linked.d.statement.slice(0,50))+'</span><span class="pi-type">'+lt+'</span></div>';
      }
      h+='</div></div>';
    }
  }
  else if(it.col==='iu'){
    h+='<div class="dp-section"><div class="dp-label">Description</div><div class="dp-text">'+E(d.description)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Risk Tier</div><div class="dp-value">'+riskBadge(d.riskTier)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Kind</div><div class="dp-value">'+E(d.kind)+'</div></div>';
    if(d.inputs.length){
      h+='<div class="dp-section"><div class="dp-label">Inputs</div><div class="dp-value mono">'+d.inputs.map(i=>E(i)).join('<br>')+'</div></div>';
    }
    if(d.outputs.length){
      h+='<div class="dp-section"><div class="dp-label">Outputs</div><div class="dp-value mono">'+d.outputs.map(o=>E(o)).join('<br>')+'</div></div>';
    }
    if(d.invariants.length){
      h+='<div class="dp-section"><div class="dp-label">Invariants</div><div class="dp-value">'+d.invariants.map(i=>'<div style="margin-bottom:4px">• '+E(i)+'</div>').join('')+'</div></div>';
    }
    h+='<div class="dp-section"><div class="dp-label">Output Files</div><div class="dp-value mono">'+d.outputFiles.map(f=>E(f)).join('<br>')+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Evidence Required</div><div class="dp-value">'+d.evidenceRequired.map(e=>'<span class="tag">'+E(e)+'</span>').join(' ')+'</div></div>';
    if(d.regenMeta){
      h+='<div class="dp-section"><div class="dp-label">Last Generation</div>';
      h+='<div class="dp-value mono" style="font-size:10px">';
      h+='Model: '+E(d.regenMeta.model_id)+'<br>';
      h+='Toolchain: '+E(d.regenMeta.toolchain_version)+'<br>';
      h+='At: '+E(d.regenMeta.generated_at)+'<br>';
      h+='Prompt: '+E(d.regenMeta.promptpack_hash.slice(0,16))+'…';
      h+='</div></div>';
    }
  }
  else if(it.col==='file'){
    h+='<div class="dp-section"><div class="dp-label">Path</div><div class="dp-value mono">'+E(d.path)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Owner IU</div><div class="dp-value">'+E(d.iuName)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Drift</div><div class="dp-value">'+driftBadge(d.driftStatus)+'</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Size</div><div class="dp-value">'+(d.size/1024).toFixed(1)+' KB</div></div>';
    h+='<div class="dp-section"><div class="dp-label">Content Hash</div><div class="dp-value mono">'+E(d.contentHash)+'…</div></div>';
  }

  // ── Provenance trail ──
  const upstream=getUpstream(id);
  const downstream=getDownstream(id);

  if(upstream.length||downstream.length){
    h+='<div class="dp-section"><div class="dp-label">Provenance Chain</div>';

    if(upstream.length){
      h+='<div class="prov-dir">↑ Upstream (causes)</div>';
      h+='<div class="prov-chain">';
      for(const u of upstream){
        const uit=items[u.id];if(!uit)continue;
        const indent=u.depth*12;
        h+='<div class="prov-item" data-nav="'+E(u.id)+'" style="padding-left:'+(8+indent)+'px">'
          +'<span class="pi-icon">'+COL_ICON[uit.col]+'</span>'
          +'<span class="pi-text">'+shortLabel(u.id)+'</span>'
          +'<span class="pi-type">'+uit.col+'</span></div>';
      }
      h+='</div>';
    }

    h+='<div class="prov-dir" style="padding-top:12px">● Selected</div>';
    h+='<div class="prov-chain"><div class="prov-item sel" style="background:rgba(34,211,238,.1);border-radius:4px"><span class="pi-icon">'+COL_ICON[it.col]+'</span><span class="pi-text" style="font-weight:700">'+shortLabel(id)+'</span><span class="pi-type">'+it.col+'</span></div></div>';

    if(downstream.length){
      h+='<div class="prov-dir" style="padding-top:12px">↓ Downstream (effects)</div>';
      h+='<div class="prov-chain">';
      for(const d2 of downstream){
        const dit=items[d2.id];if(!dit)continue;
        const indent=d2.depth*12;
        h+='<div class="prov-item" data-nav="'+E(d2.id)+'" style="padding-left:'+(8+indent)+'px">'
          +'<span class="pi-icon">'+COL_ICON[dit.col]+'</span>'
          +'<span class="pi-text">'+shortLabel(d2.id)+'</span>'
          +'<span class="pi-type">'+dit.col+'</span></div>';
      }
      h+='</div>';
    }

    h+='</div>';
  }

  return h;
}

function shortLabel(id){
  const it=items[id];if(!it)return E(id);const d=it.d;
  if(it.col==='spec')return E(d.path);
  if(it.col==='clause')return E(d.sectionPath)+' <span style="color:var(--dim);font-size:9px">'+E(d.lineRange)+'</span>';
  if(it.col==='canon')return canonBadge(d.type)+' '+E(d.statement.slice(0,45));
  if(it.col==='iu')return E(d.name)+' '+riskBadge(d.riskTier);
  if(it.col==='file')return E(d.path.split('/').pop())+' '+driftBadge(d.driftStatus);
  return E(id);
}

// ── Graph overlay ──
function openGraph(){
  if(!selId)return;
  const overlay=document.getElementById('graph-overlay');
  overlay.classList.add('open');
  const it=items[selId];
  document.getElementById('graph-title').textContent=(it?COL_ICON[it.col]+' ':'')+'Provenance Graph — '+describeShort(selId);
  renderGraph();
}
function closeGraph(){document.getElementById('graph-overlay').classList.remove('open');}

function renderGraph(){
  const canvas=document.getElementById('graph-canvas');
  const body=document.getElementById('graph-body');
  if(!selId){canvas.innerHTML='';return;}

  // Collect all connected nodes INCLUDING canon↔canon links
  const fullConnected=new Set([selId]);
  const q=[selId];
  while(q.length){const n=q.shift();
    for(const t of(fwd[n]||[])){if(!fullConnected.has(t)){fullConnected.add(t);q.push(t)}}
    for(const t of(bwd[n]||[])){if(!fullConnected.has(t)){fullConnected.add(t);q.push(t)}}
  }

  // Organize by column
  const cols={};
  for(const nid of fullConnected){const it=items[nid];if(!it)continue;(cols[it.col]=cols[it.col]||[]).push(nid);}

  const COL_W=260,COL_GAP=120,ROW_H=80,PAD=50;
  const nodePos={};
  let cx=0;
  for(const col of COL_ORDER){
    if(!cols[col])continue;
    cols[col].forEach((nid,i)=>{nodePos[nid]={x:cx+PAD,y:i*ROW_H+PAD,col}});
    cx+=COL_W+COL_GAP;
  }
  const totalW=cx-COL_GAP+PAD*2;
  const maxRows=Math.max(1,...COL_ORDER.map(c=>(cols[c]||[]).length));
  const totalH=maxRows*ROW_H+PAD*2;

  canvas.style.width=totalW+'px';
  canvas.style.height=totalH+'px';

  let html='<svg class="graph-edges" width="'+totalW+'" height="'+totalH+'"></svg>';

  // Nodes
  for(const nid of fullConnected){
    const pos=nodePos[nid];if(!pos)continue;
    const it=items[nid];
    const isSel=nid===selId?'gn-sel':connected.has(nid)?'gn-hl':'';
    const sub=it.col==='clause'?it.d.lineRange:it.col==='canon'?it.d.tags.slice(0,3).join(', '):it.col==='iu'?it.d.outputFiles.length+' file(s)':it.col==='file'?(it.d.size/1024).toFixed(1)+'KB':'';
    html+='<div class="gn '+isSel+'" data-gid="'+E(nid)+'" style="left:'+pos.x+'px;top:'+pos.y+'px;width:'+COL_W+'px">'
      +'<div class="gn-label"><span style="color:'+COL_COLOR[pos.col]+'">'+COL_ICON[pos.col]+' '+pos.col+'</span></div>'
      +'<div class="gn-text">'+nodeTitle(nid)+'</div>'
      +(sub?'<div class="gn-sub">'+E(sub)+'</div>':'')
      +'</div>';
  }
  canvas.innerHTML=html;

  // Draw edges
  const svgEl=canvas.querySelector('svg.graph-edges');
  const drawn2=new Set();
  const edgeLabels=[];
  for(const nid of fullConnected){
    for(const t of(fwd[nid]||[])){
      if(!fullConnected.has(t))continue;
      const key=nid+'→'+t;if(drawn2.has(key))continue;drawn2.add(key);
      const a=nodePos[nid],b=nodePos[t];if(!a||!b)continue;
      const isCanonLink=nid.startsWith('canon:')&&t.startsWith('canon:');
      const isPrimary=nid===selId||t===selId;
      const x1=a.x+COL_W,y1=a.y+35,x2=b.x,y2=b.y+35;
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',x1);line.setAttribute('y1',y1);
      line.setAttribute('x2',x2);line.setAttribute('y2',y2);
      line.setAttribute('class',(isPrimary?'primary ':'')+(isCanonLink?'canon-link':''));
      if(!isCanonLink){
        const col=a.col==='spec'?'var(--blue)':a.col==='clause'?'var(--purple)':a.col==='canon'?'var(--green)':'var(--orange)';
        line.style.stroke=col;
      }
      svgEl.appendChild(line);
      // Edge label for typed canon links
      const et=edgeTypes[key];
      if(et)edgeLabels.push({x:(x1+x2)/2,y:(y1+y2)/2-6,label:et});
    }
  }
  // Add edge labels
  for(const lbl of edgeLabels){
    const el=document.createElement('div');
    el.className='edge-label';
    el.style.left=lbl.x+'px';el.style.top=lbl.y+'px';
    el.textContent=lbl.label;
    canvas.appendChild(el);
  }

  // Click handlers on graph nodes
  canvas.querySelectorAll('.gn[data-gid]').forEach(el=>{
    el.addEventListener('click',()=>{
      closeGraph();
      selectCard(el.dataset.gid);
    });
  });
}

function describeShort(id){const it=items[id];if(!it)return id;const d=it.d;
  if(it.col==='spec')return d.path;if(it.col==='clause')return d.sectionPath;
  if(it.col==='canon')return d.statement.slice(0,50)+(d.statement.length>50?'…':'');
  if(it.col==='iu')return d.name;if(it.col==='file')return d.path.split('/').pop();return id;}

// ── Keys ──
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(document.getElementById('graph-overlay').classList.contains('open'))closeGraph();
    else if(selId)deselect();
  }
  if(e.key==='g'&&selId&&!e.ctrlKey&&!e.metaKey&&document.activeElement.tagName!=='INPUT')openGraph();
  if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();document.getElementById('search').focus();}
});
document.addEventListener('click',e=>{
  if(!e.target.closest('.card')&&!e.target.closest('.detail-panel')&&!e.target.closest('.graph-overlay')&&!e.target.closest('.header')&&!e.target.closest('.gn'))deselect();
});
window.addEventListener('resize',()=>{if(selId)requestAnimationFrame(drawLines)});

render();
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
