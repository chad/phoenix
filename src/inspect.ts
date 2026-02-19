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
  semhash: string;
}

export interface CanonNodeInfo {
  id: string;
  type: string;
  statement: string;
  tags: string[];
  linkCount: number;
}

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
  type: 'spec→clause' | 'clause→canon' | 'canon→iu' | 'iu→file' | 'canon→canon';
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
      semhash: c.clause_semhash.slice(0, 12),
    };
  });

  // Canon nodes + clause→canon edges + canon→canon edges
  const canonInfos: CanonNodeInfo[] = canonNodes.map(n => {
    for (const clauseId of n.source_clause_ids) {
      edges.push({ from: `clause:${clauseId}`, to: `canon:${n.canon_id}`, type: 'clause→canon' });
    }
    for (const linkedId of n.linked_canon_ids) {
      edges.push({ from: `canon:${n.canon_id}`, to: `canon:${linkedId}`, type: 'canon→canon' });
    }
    return {
      id: n.canon_id,
      type: n.type,
      statement: n.statement,
      tags: n.tags,
      linkCount: n.linked_canon_ids.length,
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
      outputFiles: iu.output_files,
      evidenceRequired: iu.evidence_policy.required,
      description: iu.contract.description,
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
:root {
  --bg: #0f1117; --surface: #1a1d27; --surface2: #232730;
  --border: #2e3345; --text: #e1e4ed; --dim: #7a8194;
  --blue: #5b9cf4; --green: #4ade80; --yellow: #fbbf24;
  --orange: #fb923c; --red: #f87171; --purple: #a78bfa;
  --cyan: #22d3ee;
  --font: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:var(--font); background:var(--bg); color:var(--text); font-size:13px; line-height:1.6; }

/* Header */
.header { background:var(--surface); border-bottom:1px solid var(--border); padding:16px 24px; display:flex; align-items:center; gap:16px; position:sticky; top:0; z-index:100; }
.header h1 { font-size:18px; font-weight:700; color:var(--blue); }
.header .state { font-size:11px; padding:3px 8px; border-radius:4px; background:var(--surface2); color:var(--yellow); border:1px solid var(--border); }
.header .stats { margin-left:auto; display:flex; gap:16px; font-size:11px; color:var(--dim); }
.header .stats span { color:var(--text); font-weight:600; }

/* Pipeline */
.pipeline { display:flex; min-height:calc(100vh - 56px); }
.column { flex:1; min-width:0; border-right:1px solid var(--border); display:flex; flex-direction:column; }
.column:last-child { border-right:none; }
.col-header { padding:10px 14px; background:var(--surface); border-bottom:1px solid var(--border); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--dim); display:flex; justify-content:space-between; position:sticky; top:56px; z-index:50; }
.col-header .count { color:var(--blue); }
.col-body { flex:1; overflow-y:auto; padding:8px; }

/* Cards */
.card { background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:10px 12px; margin-bottom:6px; cursor:pointer; transition:border-color .15s, background .15s; position:relative; }
.card:hover { border-color:var(--blue); background:var(--surface2); }
.card.highlighted { border-color:var(--cyan); background:#1a2a3a; box-shadow:0 0 12px rgba(34,211,238,.15); }
.card.dimmed { opacity:.25; }
.card-title { font-size:12px; font-weight:600; margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.card-sub { font-size:10px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.card-body { font-size:11px; color:var(--dim); margin-top:4px; display:none; }
.card.expanded .card-body { display:block; }

/* Tags / badges */
.badge { display:inline-block; font-size:9px; font-weight:600; padding:1px 6px; border-radius:3px; text-transform:uppercase; letter-spacing:.5px; }
.badge-req { background:#1e3a5f; color:var(--blue); }
.badge-con { background:#3b1e1e; color:var(--red); }
.badge-inv { background:#2d1e3f; color:var(--purple); }
.badge-def { background:#1e2d1e; color:var(--green); }
.badge-low { background:#1e2d1e; color:var(--green); }
.badge-medium { background:#2d2a1e; color:var(--yellow); }
.badge-high { background:#2d1e1e; color:var(--orange); }
.badge-critical { background:#3b1e1e; color:var(--red); }
.badge-clean { background:#1e2d1e; color:var(--green); }
.badge-drifted { background:#3b1e1e; color:var(--red); }
.badge-missing { background:#2d1e1e; color:var(--orange); }
.tag { display:inline-block; font-size:9px; padding:1px 5px; border-radius:2px; background:var(--surface2); color:var(--dim); margin:1px; }

/* Detail panel */
.detail-panel { position:fixed; right:0; top:56px; width:380px; height:calc(100vh - 56px); background:var(--surface); border-left:2px solid var(--blue); z-index:200; overflow-y:auto; padding:20px; transform:translateX(100%); transition:transform .2s ease; }
.detail-panel.open { transform:translateX(0); }
.detail-panel h2 { font-size:14px; margin-bottom:12px; color:var(--blue); }
.detail-panel .close { position:absolute; top:12px; right:14px; background:none; border:none; color:var(--dim); cursor:pointer; font-size:16px; }
.detail-panel .close:hover { color:var(--text); }
.detail-section { margin-bottom:14px; }
.detail-section h3 { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:var(--dim); margin-bottom:4px; }
.detail-section p, .detail-section li { font-size:12px; color:var(--text); line-height:1.5; }
.detail-section ul { padding-left:16px; }
.detail-section .mono { font-family:var(--font); font-size:11px; color:var(--cyan); word-break:break-all; }
.provenance-chain { margin-top:8px; }
.provenance-step { display:flex; align-items:flex-start; gap:8px; margin-bottom:8px; padding:6px 8px; background:var(--surface2); border-radius:4px; font-size:11px; }
.provenance-step .arrow { color:var(--blue); font-weight:bold; flex-shrink:0; }
.provenance-step .label { color:var(--dim); font-size:10px; }
.provenance-step .value { color:var(--text); }

/* Connection lines (CSS, no canvas) */
.flow-indicator { position:absolute; right:-4px; top:50%; width:8px; height:8px; border-radius:50%; background:var(--border); transform:translateY(-50%); }
.card.highlighted .flow-indicator { background:var(--cyan); box-shadow:0 0 6px var(--cyan); }

/* Search */
.search { padding:8px; border-bottom:1px solid var(--border); position:sticky; top:56px; z-index:50; background:var(--surface); }
.search input { width:100%; background:var(--surface2); border:1px solid var(--border); color:var(--text); padding:6px 10px; border-radius:4px; font-size:12px; font-family:var(--font); }
.search input:focus { outline:none; border-color:var(--blue); }
</style>
</head>
<body>

<div class="header">
  <h1>🔥 Phoenix</h1>
  <div class="state">${esc(data.systemState)}</div>
  <div class="stats">
    <div><span>${data.stats.specFiles}</span> specs</div>
    <div><span>${data.stats.clauses}</span> clauses</div>
    <div><span>${data.stats.canonNodes}</span> canon</div>
    <div><span>${data.stats.ius}</span> IUs</div>
    <div><span>${data.stats.generatedFiles}</span> files</div>
    <div><span>${data.stats.edgeCount}</span> edges</div>
    <div>${data.stats.driftDirty > 0 ? `<span style="color:var(--red)">${data.stats.driftDirty} drift</span>` : '<span style="color:var(--green)">clean</span>'}</div>
  </div>
</div>

<div class="pipeline" id="pipeline">
  <!-- Columns rendered by JS -->
</div>

<div class="detail-panel" id="detail">
  <button class="close" onclick="closeDetail()">✕</button>
  <div id="detail-content"></div>
</div>

<script>
const DATA = ${json};

// Build lookup indices
const edgeIndex = { forward: {}, backward: {} };
DATA.edges.forEach(e => {
  (edgeIndex.forward[e.from] = edgeIndex.forward[e.from] || []).push(e.to);
  (edgeIndex.backward[e.to] = edgeIndex.backward[e.to] || []).push(e.from);
});

const allItems = {};
DATA.specFiles.forEach(s => allItems['spec:'+s.path] = { col:'spec', data:s });
DATA.clauses.forEach(c => allItems['clause:'+c.id] = { col:'clause', data:c });
DATA.canonNodes.forEach(n => allItems['canon:'+n.id] = { col:'canon', data:n });
DATA.ius.forEach(u => allItems['iu:'+u.id] = { col:'iu', data:u });
DATA.generatedFiles.forEach(f => allItems['file:'+f.path] = { col:'file', data:f });

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Render columns
function renderPipeline() {
  const p = document.getElementById('pipeline');
  p.innerHTML = [
    renderColumn('Spec Files', 'spec', DATA.specFiles.map(s =>
      card('spec:'+s.path, s.path.split('/').pop(), s.clauseCount+' clauses', '')
    )),
    renderColumn('Clauses', 'clause', DATA.clauses.map(c =>
      card('clause:'+c.id, c.sectionPath, c.lineRange+' · '+c.semhash+'…', c.preview)
    )),
    renderColumn('Canonical Nodes', 'canon', DATA.canonNodes.map(n =>
      card('canon:'+n.id,
        '<span class="badge badge-'+n.type.toLowerCase().slice(0,3)+'">'+n.type+'</span> '+esc(n.statement.slice(0,60)),
        n.tags.slice(0,5).map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+(n.linkCount?' · '+n.linkCount+' links':''),
        esc(n.statement))
    )),
    renderColumn('Implementation Units', 'iu', DATA.ius.map(u =>
      card('iu:'+u.id,
        esc(u.name)+' <span class="badge badge-'+u.riskTier+'">'+u.riskTier+'</span>',
        u.canonCount+' nodes · '+u.outputFiles.length+' file(s)',
        esc(u.description.slice(0,200)))
    )),
    renderColumn('Generated Files', 'file', DATA.generatedFiles.map(f =>
      card('file:'+f.path,
        esc(f.path.split('/').pop())+' <span class="badge badge-'+f.driftStatus.toLowerCase()+'">'+f.driftStatus+'</span>',
        esc(f.iuName)+' · '+f.contentHash+'… · '+(f.size/1024).toFixed(1)+'KB',
        esc(f.path))
    )),
  ].join('');
}

function renderColumn(title, type, cards) {
  return '<div class="column"><div class="col-header"><span>'+title+'</span><span class="count">'+cards.length+'</span></div>'
    +'<div class="search"><input type="text" placeholder="Filter '+title.toLowerCase()+'…" oninput="filterColumn(this,\\''+type+'\\')"></div>'
    +'<div class="col-body" data-col="'+type+'">'+cards.join('')+'</div></div>';
}

function card(id, title, sub, body) {
  return '<div class="card" data-id="'+esc(id)+'" onclick="selectCard(\\''+esc(id).replace(/'/g,"\\\\'")+'\\')">'
    +'<div class="card-title">'+title+'</div>'
    +'<div class="card-sub">'+sub+'</div>'
    +(body ? '<div class="card-body">'+body+'</div>' : '')
    +'<div class="flow-indicator"></div>'
    +'</div>';
}

// Selection + highlighting
let selectedId = null;

function selectCard(id) {
  selectedId = id;
  // Collect all connected nodes (forward + backward, 2 hops)
  const connected = new Set([id]);
  const queue = [id];
  for (let depth = 0; depth < 6; depth++) {
    const next = [];
    for (const n of queue) {
      for (const t of (edgeIndex.forward[n]||[])) { if (!connected.has(t)) { connected.add(t); next.push(t); } }
      for (const t of (edgeIndex.backward[n]||[])) { if (!connected.has(t)) { connected.add(t); next.push(t); } }
    }
    queue.length = 0;
    queue.push(...next);
  }

  document.querySelectorAll('.card').forEach(el => {
    const cid = el.dataset.id;
    el.classList.toggle('highlighted', connected.has(cid));
    el.classList.toggle('dimmed', !connected.has(cid));
  });

  showDetail(id);
}

function clearSelection() {
  selectedId = null;
  document.querySelectorAll('.card').forEach(el => {
    el.classList.remove('highlighted','dimmed');
  });
}

// Filtering
function filterColumn(input, colType) {
  const q = input.value.toLowerCase();
  const col = document.querySelector('[data-col="'+colType+'"]');
  col.querySelectorAll('.card').forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = text.includes(q) ? '' : 'none';
  });
}

// Detail panel
function showDetail(id) {
  const panel = document.getElementById('detail');
  const content = document.getElementById('detail-content');
  const item = allItems[id];
  if (!item) return;

  let html = '';
  const d = item.data;

  if (item.col === 'spec') {
    html = '<h2>📄 '+esc(d.path)+'</h2>'
      +'<div class="detail-section"><h3>Clauses</h3><p>'+d.clauseCount+' clauses extracted</p></div>';
  }
  else if (item.col === 'clause') {
    html = '<h2>📋 Clause</h2>'
      +'<div class="detail-section"><h3>Section</h3><p>'+esc(d.sectionPath)+'</p></div>'
      +'<div class="detail-section"><h3>Source</h3><p>'+esc(d.docId)+' '+d.lineRange+'</p></div>'
      +'<div class="detail-section"><h3>Content</h3><p>'+esc(d.preview)+'</p></div>'
      +'<div class="detail-section"><h3>Semhash</h3><p class="mono">'+esc(d.semhash)+'…</p></div>';
  }
  else if (item.col === 'canon') {
    html = '<h2>'+canonBadge(d.type)+' Canonical Node</h2>'
      +'<div class="detail-section"><h3>Statement</h3><p>'+esc(d.statement)+'</p></div>'
      +'<div class="detail-section"><h3>Tags</h3><p>'+d.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join(' ')+'</p></div>'
      +'<div class="detail-section"><h3>Links</h3><p>'+d.linkCount+' cross-references</p></div>'
      +'<div class="detail-section"><h3>ID</h3><p class="mono">'+esc(d.id)+'</p></div>';
  }
  else if (item.col === 'iu') {
    html = '<h2>📦 '+esc(d.name)+'</h2>'
      +'<div class="detail-section"><h3>Risk Tier</h3><p><span class="badge badge-'+d.riskTier+'">'+d.riskTier+'</span></p></div>'
      +'<div class="detail-section"><h3>Description</h3><p>'+esc(d.description)+'</p></div>'
      +(d.invariants.length ? '<div class="detail-section"><h3>Invariants</h3><ul>'+d.invariants.map(i=>'<li>'+esc(i)+'</li>').join('')+'</ul></div>' : '')
      +'<div class="detail-section"><h3>Evidence Required</h3><p>'+d.evidenceRequired.join(', ')+'</p></div>'
      +'<div class="detail-section"><h3>Output</h3><p class="mono">'+d.outputFiles.map(esc).join('<br>')+'</p></div>'
      +'<div class="detail-section"><h3>Canon Nodes</h3><p>'+d.canonCount+' source nodes</p></div>'
      +(d.regenMeta ? '<div class="detail-section"><h3>Generation</h3><p>Model: '+esc(d.regenMeta.model_id)+'<br>Generated: '+esc(d.regenMeta.generated_at)+'</p></div>' : '')
      +'<div class="detail-section"><h3>ID</h3><p class="mono">'+esc(d.id)+'</p></div>';
  }
  else if (item.col === 'file') {
    html = '<h2>📄 '+esc(d.path.split('/').pop())+'</h2>'
      +'<div class="detail-section"><h3>Path</h3><p class="mono">'+esc(d.path)+'</p></div>'
      +'<div class="detail-section"><h3>Status</h3><p><span class="badge badge-'+d.driftStatus.toLowerCase()+'">'+d.driftStatus+'</span></p></div>'
      +'<div class="detail-section"><h3>Source IU</h3><p>'+esc(d.iuName)+'</p></div>'
      +'<div class="detail-section"><h3>Content Hash</h3><p class="mono">'+esc(d.contentHash)+'…</p></div>'
      +'<div class="detail-section"><h3>Size</h3><p>'+(d.size/1024).toFixed(1)+' KB</p></div>';
  }

  // Provenance chain
  html += renderProvenance(id);

  content.innerHTML = html;
  panel.classList.add('open');
}

function renderProvenance(id) {
  // Trace backward to spec
  const chain = [];
  const visited = new Set();
  function traceBack(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const parents = edgeIndex.backward[nodeId] || [];
    for (const p of parents) {
      const pItem = allItems[p];
      if (pItem) chain.push({ id: p, col: pItem.col, label: describeNode(p) });
      traceBack(p);
    }
  }
  // Trace forward to files
  function traceForward(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const children = edgeIndex.forward[nodeId] || [];
    for (const c of children) {
      if (c.startsWith('canon:') && id.startsWith('canon:')) continue; // skip canon→canon
      const cItem = allItems[c];
      if (cItem) chain.push({ id: c, col: cItem.col, label: describeNode(c) });
      traceForward(c);
    }
  }

  const backChain = [];
  const fwdChain = [];
  const bVisited = new Set([id]);
  function tb(nid) { for (const p of (edgeIndex.backward[nid]||[])) { if (!bVisited.has(p)) { bVisited.add(p); const it = allItems[p]; if(it) backChain.push({id:p,col:it.col,label:describeNode(p)}); tb(p); } } }
  const fVisited = new Set([id]);
  function tf(nid) { for (const c of (edgeIndex.forward[nid]||[])) { if (!fVisited.has(c) && !(c.startsWith('canon:')&&id.startsWith('canon:'))) { fVisited.add(c); const it = allItems[c]; if(it) fwdChain.push({id:c,col:it.col,label:describeNode(c)}); tf(c); } } }
  tb(id); tf(id);

  if (backChain.length === 0 && fwdChain.length === 0) return '';

  let html = '<div class="detail-section"><h3>Provenance Chain</h3><div class="provenance-chain">';
  const colIcon = { spec:'📄', clause:'📋', canon:'📐', iu:'📦', file:'⚡' };
  for (const step of backChain.reverse()) {
    html += '<div class="provenance-step"><span class="arrow">↑</span><div><div class="label">'+(colIcon[step.col]||'')+' '+step.col+'</div><div class="value">'+esc(step.label)+'</div></div></div>';
  }
  html += '<div class="provenance-step" style="border-left:2px solid var(--cyan);"><span class="arrow">●</span><div><div class="label" style="color:var(--cyan)">selected</div><div class="value">'+esc(describeNode(id))+'</div></div></div>';
  for (const step of fwdChain) {
    html += '<div class="provenance-step"><span class="arrow">↓</span><div><div class="label">'+(colIcon[step.col]||'')+' '+step.col+'</div><div class="value">'+esc(step.label)+'</div></div></div>';
  }
  html += '</div></div>';
  return html;
}

function describeNode(id) {
  const item = allItems[id];
  if (!item) return id;
  const d = item.data;
  if (item.col === 'spec') return d.path;
  if (item.col === 'clause') return d.sectionPath + ' ' + d.lineRange;
  if (item.col === 'canon') return d.statement.slice(0,80);
  if (item.col === 'iu') return d.name + ' (' + d.riskTier + ')';
  if (item.col === 'file') return d.path;
  return id;
}

function canonBadge(type) {
  const cls = {REQUIREMENT:'req',CONSTRAINT:'con',INVARIANT:'inv',DEFINITION:'def'}[type]||'req';
  return '<span class="badge badge-'+cls+'">'+type+'</span>';
}

function closeDetail() {
  document.getElementById('detail').classList.remove('open');
  clearSelection();
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
document.addEventListener('click', e => {
  if (!e.target.closest('.card') && !e.target.closest('.detail-panel')) closeDetail();
});

renderPipeline();
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
): { server: ReturnType<typeof createServer>; port: number; ready: Promise<void> } {
  const server = createServer((req, res) => {
    if (req.url === '/data.json') {
      // Also expose raw JSON for external tools
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const match = html.match(/const DATA = ({.*?});/s);
      res.end(match?.[1] ?? '{}');
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
