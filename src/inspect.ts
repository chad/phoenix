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
:root{--bg:#0f1117;--surface:#1a1d27;--surface2:#232730;--border:#2e3345;--text:#e1e4ed;--dim:#7a8194;--blue:#5b9cf4;--green:#4ade80;--yellow:#fbbf24;--orange:#fb923c;--red:#f87171;--purple:#a78bfa;--cyan:#22d3ee;--font:'SF Mono','Fira Code','JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font);background:var(--bg);color:var(--text);font-size:13px;line-height:1.6;overflow:hidden;height:100vh}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:16px;z-index:100}
.header h1{font-size:18px;font-weight:700;color:var(--blue)}
.header .state{font-size:11px;padding:3px 8px;border-radius:4px;background:var(--surface2);color:var(--yellow);border:1px solid var(--border)}
.header .stats{margin-left:auto;display:flex;gap:16px;font-size:11px;color:var(--dim)}
.header .stats b{color:var(--text);font-weight:600}
.mode-btns{display:flex;gap:4px}
.mode-btn{background:var(--surface2);border:1px solid var(--border);color:var(--dim);padding:4px 12px;border-radius:4px;cursor:pointer;font:inherit;font-size:11px}
.mode-btn:hover{border-color:var(--blue);color:var(--text)}
.mode-btn.active{background:var(--blue);color:#fff;border-color:var(--blue)}

/* ── Pipeline columns ── */
.pipeline-wrap{display:flex;height:calc(100vh - 52px);position:relative}
.pipeline{display:flex;flex:1;overflow:hidden}
.column{flex:1;min-width:0;border-right:1px solid var(--border);display:flex;flex-direction:column}
.column:last-child{border-right:none}
.col-header{padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--dim);display:flex;justify-content:space-between}
.col-header .ct{color:var(--blue)}
.col-body{flex:1;overflow-y:auto;padding:6px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:4px;cursor:pointer;transition:all .15s;position:relative}
.card:hover{border-color:var(--blue);background:var(--surface2)}
.card.hl{border-color:var(--cyan);background:#142535;box-shadow:0 0 8px rgba(34,211,238,.2)}
.card.sel{border-color:var(--cyan);background:#1a3040;box-shadow:0 0 16px rgba(34,211,238,.35);ring:2px solid var(--cyan)}
.card.hide{display:none}
.card .t{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .s{font-size:9px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.badge{display:inline-block;font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.5px;vertical-align:middle}
.b-req{background:#1e3a5f;color:var(--blue)}.b-con{background:#3b1e1e;color:var(--red)}.b-inv{background:#2d1e3f;color:var(--purple)}.b-def{background:#1e2d1e;color:var(--green)}
.b-low{background:#1e2d1e;color:var(--green)}.b-medium{background:#2d2a1e;color:var(--yellow)}.b-high{background:#2d1e1e;color:var(--orange)}.b-critical{background:#3b1e1e;color:var(--red)}
.b-clean{background:#1e2d1e;color:var(--green)}.b-drifted{background:#3b1e1e;color:var(--red)}.b-missing{background:#2d1e1e;color:var(--orange)}.b-unknown{background:var(--surface2);color:var(--dim)}
.tag{display:inline-block;font-size:8px;padding:1px 4px;border-radius:2px;background:var(--surface2);color:var(--dim);margin:1px}

/* ── SVG overlay for connection lines ── */
svg.lines{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10}
svg.lines path{fill:none;stroke:var(--cyan);stroke-width:1.5;opacity:.6}
svg.lines path.strong{stroke-width:2.5;opacity:1;filter:drop-shadow(0 0 4px rgba(34,211,238,.5))}

/* ── Graph overlay ── */
.graph-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:500;display:none;flex-direction:column}
.graph-overlay.open{display:flex}
.graph-bar{padding:12px 24px;display:flex;align-items:center;gap:16px;background:var(--surface);border-bottom:1px solid var(--border)}
.graph-bar h2{font-size:15px;color:var(--cyan)}
.graph-bar .close{background:none;border:1px solid var(--border);color:var(--dim);padding:4px 12px;border-radius:4px;cursor:pointer;font:inherit;font-size:11px;margin-left:auto}
.graph-bar .close:hover{border-color:var(--red);color:var(--red)}
.graph-body{flex:1;overflow:auto;display:flex;justify-content:center;padding:40px}
.graph-canvas{position:relative}
.gn{position:absolute;background:var(--surface);border:2px solid var(--border);border-radius:8px;padding:10px 14px;font-size:11px;max-width:220px;cursor:default;z-index:2;transition:border-color .15s}
.gn:hover{border-color:var(--blue)}
.gn.gn-sel{border-color:var(--cyan);box-shadow:0 0 16px rgba(34,211,238,.4)}
.gn .gn-label{font-size:9px;text-transform:uppercase;color:var(--dim);letter-spacing:.5px;margin-bottom:3px}
.gn .gn-text{font-weight:600;color:var(--text);word-break:break-word}
svg.graph-edges{position:absolute;top:0;left:0;pointer-events:none;z-index:1}
svg.graph-edges path{fill:none;stroke:var(--cyan);stroke-width:2;opacity:.5}
svg.graph-edges path.primary{stroke-width:3;opacity:.9;filter:drop-shadow(0 0 4px rgba(34,211,238,.4))}
.graph-hint{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--dim);text-align:center}
</style>
</head>
<body>
<div class="header">
  <h1>🔥 Phoenix</h1>
  <div class="state">${esc(data.systemState)}</div>
  <div class="mode-btns">
    <button class="mode-btn active" onclick="setMode('all')" id="btn-all">All</button>
    <button class="mode-btn" onclick="setMode('focus')" id="btn-focus">Focus</button>
    <button class="mode-btn" onclick="openGraph()" id="btn-graph">⬡ Graph</button>
  </div>
  <div class="stats">
    <div><b>${data.stats.specFiles}</b> specs</div>
    <div><b>${data.stats.clauses}</b> clauses</div>
    <div><b>${data.stats.canonNodes}</b> canon</div>
    <div><b>${data.stats.ius}</b> IUs</div>
    <div><b>${data.stats.generatedFiles}</b> files</div>
    <div>${data.stats.driftDirty>0?`<b style="color:var(--red)">${data.stats.driftDirty} drift</b>`:'<b style="color:var(--green)">clean</b>'}</div>
  </div>
</div>
<div class="pipeline-wrap">
  <svg class="lines" id="svg-lines"></svg>
  <div class="pipeline" id="pipeline"></div>
</div>
<div class="graph-overlay" id="graph-overlay">
  <div class="graph-bar">
    <h2 id="graph-title">Provenance Graph</h2>
    <button class="close" onclick="closeGraph()">✕ Close</button>
  </div>
  <div class="graph-body"><div class="graph-canvas" id="graph-canvas"></div></div>
</div>

<script>
const D=${json};
const COL_ORDER=['spec','clause','canon','iu','file'];
const COL_ICON={spec:'📄',clause:'📋',canon:'📐',iu:'📦',file:'⚡'};

// indices
const fwd={},bwd={};
D.edges.forEach(e=>{(fwd[e.from]=fwd[e.from]||[]).push(e.to);(bwd[e.to]=bwd[e.to]||[]).push(e.from)});
const items={};
D.specFiles.forEach(s=>items['spec:'+s.path]={col:'spec',d:s});
D.clauses.forEach(c=>items['clause:'+c.id]={col:'clause',d:c});
D.canonNodes.forEach(n=>items['canon:'+n.id]={col:'canon',d:n});
D.ius.forEach(u=>items['iu:'+u.id]={col:'iu',d:u});
D.generatedFiles.forEach(f=>items['file:'+f.path]={col:'file',d:f});

function E(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// ── Traversal (skip canon↔canon to keep pipeline linear) ──
function getConnected(id){
  const set=new Set([id]);
  const q=[id];
  while(q.length){const n=q.shift();
    for(const t of(fwd[n]||[])){if(!set.has(t)&&!(n.startsWith('canon:')&&t.startsWith('canon:'))){set.add(t);q.push(t)}}
    for(const t of(bwd[n]||[])){if(!set.has(t)&&!(n.startsWith('canon:')&&t.startsWith('canon:'))){set.add(t);q.push(t)}}
  }
  return set;
}

// ── Card HTML ──
function nodeTitle(id){const it=items[id];if(!it)return id;const d=it.d;
  if(it.col==='spec')return E(d.path.split('/').pop());
  if(it.col==='clause')return E(d.sectionPath);
  if(it.col==='canon')return'<span class="badge b-'+d.type.slice(0,3).toLowerCase()+'">'+d.type+'</span> '+E(d.statement.slice(0,55));
  if(it.col==='iu')return E(d.name)+' <span class="badge b-'+d.riskTier+'">'+d.riskTier+'</span>';
  if(it.col==='file')return E(d.path.split('/').pop())+' <span class="badge b-'+d.driftStatus.toLowerCase()+'">'+d.driftStatus+'</span>';
  return id;}
function nodeSub(id){const it=items[id];if(!it)return'';const d=it.d;
  if(it.col==='spec')return d.clauseCount+' clauses';
  if(it.col==='clause')return d.lineRange+' · '+d.semhash+'…';
  if(it.col==='canon')return d.tags.slice(0,4).map(t=>'<span class="tag">'+E(t)+'</span>').join('')+(d.linkCount?' · '+d.linkCount+' links':'');
  if(it.col==='iu')return d.canonCount+' nodes · '+d.outputFiles.length+' file(s)';
  if(it.col==='file')return E(d.iuName)+' · '+(d.size/1024).toFixed(1)+'KB';
  return'';}
function crd(id){return'<div class="card" data-id="'+E(id)+'"><div class="t">'+nodeTitle(id)+'</div><div class="s">'+nodeSub(id)+'</div></div>';}

// ── Render pipeline ──
function render(){
  const cols=[
    {title:'Spec Files',col:'spec',ids:D.specFiles.map(s=>'spec:'+s.path)},
    {title:'Clauses',col:'clause',ids:D.clauses.map(c=>'clause:'+c.id)},
    {title:'Canonical Nodes',col:'canon',ids:D.canonNodes.map(n=>'canon:'+n.id)},
    {title:'Implementation Units',col:'iu',ids:D.ius.map(u=>'iu:'+u.id)},
    {title:'Generated Files',col:'file',ids:D.generatedFiles.map(f=>'file:'+f.path)},
  ];
  document.getElementById('pipeline').innerHTML=cols.map(c=>
    '<div class="column" data-col="'+c.col+'"><div class="col-header"><span>'+c.title+'</span><span class="ct">'+c.ids.length+'</span></div><div class="col-body">'+c.ids.map(crd).join('')+'</div></div>'
  ).join('');
  document.querySelectorAll('.card').forEach(el=>{el.addEventListener('click',()=>selectCard(el.dataset.id))});
}

// ── Mode + selection ──
let mode='all',selId=null,connected=new Set();

function setMode(m){
  mode=m;
  document.getElementById('btn-all').classList.toggle('active',m==='all');
  document.getElementById('btn-focus').classList.toggle('active',m==='focus');
  applyView();
}

function selectCard(id){
  selId=id;connected=getConnected(id);
  if(mode==='all')setMode('focus');
  else applyView();
}

function applyView(){
  const cards=document.querySelectorAll('.card');
  if(!selId||mode==='all'){
    cards.forEach(el=>{el.classList.remove('hl','sel','hide')});
    clearLines();return;
  }
  cards.forEach(el=>{
    const cid=el.dataset.id;
    el.classList.toggle('hl',connected.has(cid)&&cid!==selId);
    el.classList.toggle('sel',cid===selId);
    el.classList.toggle('hide',!connected.has(cid));
  });
  requestAnimationFrame(drawLines);
}

function deselect(){selId=null;connected.clear();setMode('all');}

// ── SVG connection lines ──
function clearLines(){document.getElementById('svg-lines').innerHTML='';}
function drawLines(){
  const svg=document.getElementById('svg-lines');svg.innerHTML='';
  if(!selId)return;
  const wrap=document.querySelector('.pipeline-wrap');
  const wr=wrap.getBoundingClientRect();
  // collect visible card rects
  const rects={};
  document.querySelectorAll('.card:not(.hide)').forEach(el=>{
    const r=el.getBoundingClientRect();
    rects[el.dataset.id]={x:r.left-wr.left,y:r.top-wr.top,w:r.width,h:r.height,cx:r.left-wr.left+r.width/2,cy:r.top-wr.top+r.height/2};
  });
  // draw edges between connected nodes that are both visible
  const drawn=new Set();
  for(const nid of connected){
    for(const t of(fwd[nid]||[])){
      if(!connected.has(t))continue;
      if(nid.startsWith('canon:')&&t.startsWith('canon:'))continue;
      const key=nid+'→'+t;if(drawn.has(key))continue;drawn.add(key);
      const a=rects[nid],b=rects[t];if(!a||!b)continue;
      const x1=a.x+a.w,y1=a.cy,x2=b.x,y2=b.cy;
      const dx=(x2-x1)*0.45;
      const strong=(nid===selId||t===selId)?'strong':'';
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d','M'+x1+','+y1+' C'+(x1+dx)+','+y1+' '+(x2-dx)+','+y2+' '+x2+','+y2);
      path.setAttribute('class',strong);
      svg.appendChild(path);
    }
  }
}

// ── Graph overlay ──
function openGraph(){
  if(!selId)return;
  const overlay=document.getElementById('graph-overlay');
  overlay.classList.add('open');
  document.getElementById('graph-title').textContent=COL_ICON[items[selId]?.col||'spec']+' Provenance Graph — '+describeShort(selId);
  renderGraph();
}
function closeGraph(){document.getElementById('graph-overlay').classList.remove('open');}

function renderGraph(){
  const canvas=document.getElementById('graph-canvas');
  if(!selId){canvas.innerHTML='';return;}
  // Organize connected nodes by column
  const cols={};
  for(const nid of connected){const it=items[nid];if(!it)continue;(cols[it.col]=cols[it.col]||[]).push(nid);}
  // Layout: columns left→right, nodes top→bottom within column
  const colX={};let cx=0;
  const nodePos={};
  const COL_W=240,COL_GAP=100,ROW_H=70,PAD=40;
  for(const col of COL_ORDER){
    if(!cols[col])continue;
    colX[col]=cx;
    cols[col].forEach((nid,i)=>{nodePos[nid]={x:cx,y:i*ROW_H}});
    cx+=COL_W+COL_GAP;
  }
  const totalW=cx-COL_GAP+PAD*2;
  const maxRows=Math.max(...COL_ORDER.map(c=>(cols[c]||[]).length));
  const totalH=maxRows*ROW_H+PAD*2;
  canvas.style.width=totalW+'px';canvas.style.height=totalH+'px';
  let html='<svg class="graph-edges" width="'+totalW+'" height="'+totalH+'"></svg>';
  // Nodes
  for(const nid of connected){
    const pos=nodePos[nid];if(!pos)continue;
    const it=items[nid];
    const isSel=nid===selId?'gn-sel':'';
    html+='<div class="gn '+isSel+'" style="left:'+(pos.x+PAD)+'px;top:'+(pos.y+PAD)+'px;width:'+COL_W+'px">'
      +'<div class="gn-label">'+COL_ICON[it.col]+' '+it.col+'</div>'
      +'<div class="gn-text">'+nodeTitle(nid)+'</div></div>';
  }
  canvas.innerHTML=html;
  // Draw edges
  const svgEl=canvas.querySelector('svg.graph-edges');
  const drawn2=new Set();
  for(const nid of connected){
    for(const t of(fwd[nid]||[])){
      if(!connected.has(t))continue;
      if(nid.startsWith('canon:')&&t.startsWith('canon:'))continue;
      const key=nid+'→'+t;if(drawn2.has(key))continue;drawn2.add(key);
      const a=nodePos[nid],b=nodePos[t];if(!a||!b)continue;
      const x1=a.x+PAD+COL_W,y1=a.y+PAD+30,x2=b.x+PAD,y2=b.y+PAD+30;
      const dx=(x2-x1)*0.4;
      const cls=(nid===selId||t===selId)?'primary':'';
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d','M'+x1+','+y1+' C'+(x1+dx)+','+y1+' '+(x2-dx)+','+y2+' '+x2+','+y2);
      p.setAttribute('class',cls);
      svgEl.appendChild(p);
    }
  }
}

function describeShort(id){const it=items[id];if(!it)return id;const d=it.d;
  if(it.col==='spec')return d.path;if(it.col==='clause')return d.sectionPath;
  if(it.col==='canon')return d.statement.slice(0,50)+'…';
  if(it.col==='iu')return d.name;if(it.col==='file')return d.path.split('/').pop();return id;}

// ── Keys ──
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(document.getElementById('graph-overlay').classList.contains('open'))closeGraph();else deselect();}
  if(e.key==='g'&&selId&&!document.getElementById('graph-overlay').classList.contains('open'))openGraph();
});
document.addEventListener('click',e=>{
  if(!e.target.closest('.card')&&!e.target.closest('.graph-overlay')&&!e.target.closest('.header'))deselect();
});
window.addEventListener('resize',()=>{if(selId&&mode==='focus')requestAnimationFrame(drawLines)});

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
