import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import {
  SHEET_DEPTH_M, FT_TO_M, MATERIALS, uid, ftToM, mToFt, parseImperialDepth,
  formatFeetInches, sheetRanges, intersectsRange, pointInRange, blankProject,
  blankBorehole, ensureBorehole, validateBorehole, confidenceStatus, sanitizeAiPage,
  mergeBoreholePages
} from './web-core.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STORAGE_KEY = 'boreholeLogStudioWebV1';
const LEGACY_KEY = 'boreholeLogStudio';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const $ = id => document.getElementById(id);

let state = loadState();
let runtimeSources = new Map();
let activeSourceId = null;
let reviewPageIndex = 0;
let reviewDraft = null;
let reviewQueue = [];
let reviewQueueIndex = 0;
let selectedBox = null;
let evidenceBox = null;
let pointerStart = null;
let toastTimer = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeId(value='') { return String(value).replace(/[^a-zA-Z0-9_-]/g, '_'); }
function nowIso() { return new Date().toISOString(); }
function toast(message, error=false) {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = 'toast hidden', 4200);
}
function download(name, content, type='text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function migrateLegacy(raw) {
  if (!raw || !Array.isArray(raw.boreholes)) return blankProject();
  const p = blankProject();
  p.project = { ...p.project, ...(raw.project || {}) };
  p.sources = [];
  p.boreholes = raw.boreholes.map((b, i) => ensureBorehole({
    id: b.id || uid('bh'),
    name: b.name || `BH-${i+1}`,
    totalDepthM: num(b.totalDepthM ?? b.totalDepth) ?? 0,
    groundElevationM: num(b.groundElevationM ?? b.groundElevation),
    drillingMethod: b.drillingMethod || '', drillDate: b.drillDate || '',
    layers: (b.layers || []).map(r => ({
      id:r.id||uid('layer'), fromM:num(r.fromM ?? r.from), toM:num(r.toM ?? r.to),
      material:r.material||'', moisture:r.moisture||'', description:r.description||'',
      status:r.status||'manual', confidence:r.confidence??null, evidence:r.evidence||'', box:r.box||null
    })),
    samples: (b.samples || []).map(r => ({
      id:r.id||uid('sample'), fromM:num(r.fromM ?? r.from), toM:num(r.toM ?? r.to), sampleId:r.sampleId||'',
      analyses:Array.isArray(r.analyses)?r.analyses:String(r.analyses||'').split(',').map(x=>x.trim()).filter(Boolean),
      status:r.status||'manual', confidence:r.confidence??null, evidence:r.evidence||'', box:r.box||null
    })),
    tests: (b.tests || []).map(r => ({
      id:r.id||uid('test'), depthM:num(r.depthM ?? r.depth), sptBlows:r.sptBlows ?? r.blows ?? '',
      nValue:num(r.nValue ?? r.n), pidPpm:num(r.pidPpm ?? r.pid), status:r.status||'manual',
      confidence:r.confidence??null, evidence:r.evidence||'', box:r.box||null
    })),
    well: {
      enabled:!!(b.well?.enabled ?? b.monitoringWell),
      riserBottomM:num(b.well?.riserBottomM), screenTopM:num(b.well?.screenTopM ?? b.screenTop),
      screenBottomM:num(b.well?.screenBottomM ?? b.screenBottom), waterDepthM:num(b.well?.waterDepthM ?? b.waterDepth)
    },
    review:b.review || { sourceName:'', sourcePage:null, warnings:[] }
  }));
  if (!p.boreholes.length) p.boreholes = [blankBorehole('BH-1')];
  p.activeBoreholeId = raw.activeBoreholeId || raw.activeId || p.boreholes[0].id;
  if (!p.boreholes.some(b=>b.id===p.activeBoreholeId)) p.activeBoreholeId = p.boreholes[0].id;
  return p;
}
function normalizeState(raw) {
  const p = migrateLegacy(raw);
  p.schemaVersion = 5;
  p.sources = Array.isArray(raw?.sources) ? raw.sources : (p.sources || []);
  return p;
}
function loadState() {
  try {
    const web = localStorage.getItem(STORAGE_KEY);
    if (web) return normalizeState(JSON.parse(web));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return normalizeState(JSON.parse(legacy));
  } catch (e) { console.warn(e); }
  const p = blankProject(); p.sources = []; return p;
}
function saveState(render=false) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (render) renderAll();
}
function activeBorehole() {
  return state.boreholes.find(b=>b.id===state.activeBoreholeId) || state.boreholes[0];
}
function setActiveBorehole(id) {
  state.activeBoreholeId = id; state.uiSheetIndex = 0; saveState(true);
}

function renderAll() {
  renderProject(); renderBoreholes(); renderSources(); renderProperties(); renderEditor(); renderSheet();
}
function renderProject() {
  $('projectName').value = state.project.name || '';
  $('projectNumber').value = state.project.number || '';
  $('projectLocation').value = state.project.location || '';
  $('saveStateText').textContent = `Saved locally • ${state.boreholes.length} borehole(s)`;
}
function renderBoreholes() {
  const host = $('boreholeList');
  host.innerHTML = state.boreholes.map(b => {
    const pages = sheetRanges(b.totalDepthM).length;
    return `<div class="bh-card ${b.id===state.activeBoreholeId?'active':''}" data-id="${b.id}">
      <div><strong>${esc(b.name)}</strong><small>${Number(b.totalDepthM||0).toFixed(2)} m • ${pages} sheet(s)</small></div>
      <button data-delete="${b.id}" title="Delete">×</button></div>`;
  }).join('');
  host.querySelectorAll('.bh-card').forEach(card => card.onclick = e => {
    if (e.target.dataset.delete) return;
    setActiveBorehole(card.dataset.id);
  });
  host.querySelectorAll('[data-delete]').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    const b = state.boreholes.find(x=>x.id===btn.dataset.delete);
    if (!b || !confirm(`Delete ${b.name}?`)) return;
    state.boreholes = state.boreholes.filter(x=>x.id!==b.id);
    if (!state.boreholes.length) state.boreholes.push(blankBorehole('BH-1'));
    state.activeBoreholeId = state.boreholes[0].id;
    saveState(true);
  });
}
function renderSources() {
  const host = $('sourceList');
  if (!state.sources?.length) { host.innerHTML = '<small>No source files yet.</small>'; return; }
  host.innerHTML = state.sources.map(s=>`<div class="source-pill"><span title="${esc(s.name)}">${esc(s.name)}</span><button data-open="${s.id}">Review</button><button data-remove="${s.id}">×</button></div>`).join('');
  host.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openSourceById(b.dataset.open));
  host.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>removeSource(b.dataset.remove));
}
function renderProperties() {
  const b = activeBorehole();
  $('activeBoreholeTitle').textContent = b.name;
  $('bhName').value = b.name || '';
  $('bhDepth').value = b.totalDepthM ?? '';
  $('groundElevation').value = b.groundElevationM ?? '';
  $('drillingMethod').value = b.drillingMethod || '';
  $('drillDate').value = b.drillDate || '';
  $('wellEnabled').checked = !!b.well?.enabled;
  $('screenTop').value = b.well?.screenTopM ?? '';
  $('screenBottom').value = b.well?.screenBottomM ?? '';
  $('waterDepth').value = b.well?.waterDepthM ?? '';
  $('riserBottom').value = b.well?.riserBottomM ?? '';
  $('wellFields').style.display = b.well?.enabled ? 'block' : 'none';
  const issues = validateBorehole(b);
  const unresolved = [...b.layers,...b.samples,...b.tests].filter(x=>x.status==='draft').length;
  const v = $('validation');
  if (!issues.length && !unresolved) { v.textContent='Validated'; v.className='validation ok'; }
  else { v.textContent=`${issues.length} issue(s), ${unresolved} draft item(s)`; v.className='validation warn'; }
}
function statusBadge(item) {
  const s = item.status === 'manual' ? 'manual' : confidenceStatus(item.confidence);
  const label = item.status === 'accepted' ? 'Accepted' : item.status === 'ignored' ? 'Ignored' : item.status === 'manual' ? 'Manual' : `${Math.round((Number(item.confidence)||0)*100)}%`;
  return `<span class="review-tag ${s}">${label}</span>`;
}
function renderEditor() {
  const b = activeBorehole();
  $('layersBody').innerHTML = b.layers.map(r=>`<tr data-kind="layers" data-id="${r.id}"><td><input data-field="fromM" type="number" step=".01" value="${r.fromM??''}"></td><td><input data-field="toM" type="number" step=".01" value="${r.toM??''}"></td><td><select data-field="material">${materialOptions(r.material)}</select></td><td><input data-field="moisture" value="${esc(r.moisture)}"></td><td><input class="desc" data-field="description" value="${esc(r.description)}"></td><td>${statusBadge(r)}</td><td><button data-remove-row>×</button></td></tr>`).join('');
  $('samplesBody').innerHTML = b.samples.map(r=>`<tr data-kind="samples" data-id="${r.id}"><td><input data-field="fromM" type="number" step=".01" value="${r.fromM??''}"></td><td><input data-field="toM" type="number" step=".01" value="${r.toM??''}"></td><td><input data-field="sampleId" value="${esc(r.sampleId)}"></td><td><input class="desc" data-field="analyses" value="${esc((r.analyses||[]).join(', '))}"></td><td>${statusBadge(r)}</td><td><button data-remove-row>×</button></td></tr>`).join('');
  $('testsBody').innerHTML = b.tests.map(r=>`<tr data-kind="tests" data-id="${r.id}"><td><input data-field="depthM" type="number" step=".01" value="${r.depthM??''}"></td><td><input data-field="sptBlows" value="${esc(r.sptBlows)}"></td><td><input data-field="nValue" type="number" value="${r.nValue??''}"></td><td><input data-field="pidPpm" type="number" step=".1" value="${r.pidPpm??''}"></td><td>${statusBadge(r)}</td><td><button data-remove-row>×</button></td></tr>`).join('');
  bindEditorRows();
}
function materialOptions(value='') {
  const all = value && !MATERIALS.includes(value) ? [value,...MATERIALS] : MATERIALS;
  return `<option value="">Select material</option>${all.map(m=>`<option value="${esc(m)}" ${m===value?'selected':''}>${esc(m)}</option>`).join('')}`;
}
function bindEditorRows() {
  document.querySelectorAll('#layersBody tr,#samplesBody tr,#testsBody tr').forEach(row => {
    row.querySelectorAll('input,select').forEach(input => input.onchange = () => {
      const arr = activeBorehole()[row.dataset.kind];
      const item = arr.find(x=>x.id===row.dataset.id); if (!item) return;
      const f = input.dataset.field;
      if (f === 'analyses') item[f] = input.value.split(',').map(x=>x.trim()).filter(Boolean);
      else if (input.type === 'number') item[f] = num(input.value);
      else item[f] = input.value;
      item.status = 'manual'; item.confidence = null;
      saveState(); renderProperties(); renderSheet();
    });
    row.querySelector('[data-remove-row]').onclick = () => {
      const b=activeBorehole(); b[row.dataset.kind]=b[row.dataset.kind].filter(x=>x.id!==row.dataset.id); saveState(true);
    };
  });
}

function renderSheet() {
  const b = activeBorehole();
  const ranges = sheetRanges(b.totalDepthM);
  let idx = Math.max(0, Math.min(Number(state.uiSheetIndex)||0, ranges.length-1));
  state.uiSheetIndex = idx;
  const range = ranges[idx];
  $('sheetCounter').textContent = `Sheet ${idx+1} of ${ranges.length} • ${range.fromM.toFixed(0)}–${range.toM.toFixed(0)} m`;
  $('prevSheet').disabled = idx===0; $('nextSheet').disabled = idx===ranges.length-1;
  $('sheetHost').innerHTML = `<div class="sheet-card">${renderSheetSvg(b,range,idx,ranges.length)}</div>`;
}
function patternDefs(prefix) {
  return `<defs>
  <pattern id="${prefix}-TOPSOIL" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="6" r="1"/></pattern>
  <pattern id="${prefix}-FILL" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 0L10 10M10 0L0 10" stroke="#333" stroke-width=".7"/></pattern>
  <pattern id="${prefix}-SAND" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7"/><circle cx="7" cy="7" r=".7"/></pattern>
  <pattern id="${prefix}-SILT" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M2 0V7M5 0V7" stroke="#444" stroke-width=".65"/></pattern>
  <pattern id="${prefix}-CLAY" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 9L9 0M-3 3L3-3M6 12L12 6" stroke="#444" stroke-width=".65"/></pattern>
  <pattern id="${prefix}-GRAVEL" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2" fill="none" stroke="#333"/><circle cx="11" cy="10" r="2.5" fill="none" stroke="#333"/></pattern>
  <pattern id="${prefix}-DEFAULT" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4H8" stroke="#777" stroke-width=".6"/></pattern>
  <clipPath id="${prefix}-desc"><rect x="132" y="110" width="296" height="770"/></clipPath></defs>`;
}
function patternFor(material='') {
  const m = String(material).toUpperCase();
  if (m.includes('TOPSOIL')) return 'TOPSOIL';
  if (m.includes('FILL')) return 'FILL';
  if (m.includes('GRAVEL')) return 'GRAVEL';
  if (m.includes('SAND')) return 'SAND';
  if (m.includes('CLAY')) return 'CLAY';
  if (m.includes('SILT')) return 'SILT';
  return 'DEFAULT';
}
function wrapText(text,max=38) {
  const words=String(text||'').split(/\s+/).filter(Boolean),lines=[];let line='';
  for(const w of words){const n=line?`${line} ${w}`:w;if(n.length>max&&line){lines.push(line);line=w}else line=n}if(line)lines.push(line);return lines;
}
function renderSheetSvg(b, range, sheetIndex=0, sheetTotal=1) {
  const W=1080, top=110, ppm=70, contentH=SHEET_DEPTH_M*ppm, bottom=top+contentH, H=bottom+62, p=safeId(`${b.id}-${sheetIndex}`);
  const y=d=>top+(Number(d)-range.fromM)*ppm;
  let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Borehole log ${esc(b.name)}">${patternDefs(p)}<rect width="${W}" height="${H}" fill="#fff"/>`;
  s+=`<text x="24" y="28" font-size="20" font-weight="700">${esc(state.project.name)}</text><text x="24" y="48" font-size="10">Project ${esc(state.project.number)} • ${esc(state.project.location)}</text>`;
  s+=`<text x="1052" y="28" text-anchor="end" font-size="18" font-weight="700">${esc(b.name)}</text><text x="1052" y="48" text-anchor="end" font-size="10">Sheet ${sheetIndex+1}/${sheetTotal} • EOH ${Number(b.totalDepthM||0).toFixed(2)} m (${formatFeetInches(b.totalDepthM)})</text>`;
  const cols=[24,76,130,430,490,575,625,700,825,1054]; cols.forEach(x=>s+=`<line x1="${x}" y1="78" x2="${x}" y2="${bottom}" stroke="#1d2935" stroke-width="1"/>`);
  s+=`<line x1="24" y1="78" x2="1054" y2="78" stroke="#1d2935"/><line x1="24" y1="${top}" x2="1054" y2="${top}" stroke="#1d2935"/><line x1="24" y1="${bottom}" x2="1054" y2="${bottom}" stroke="#1d2935"/>`;
  [['m',50],['ft',103],['DESCRIPTION',280],['STRAT',460],['SAMPLE',532],['N',600],['PID',663],['ANALYSES',762],['WELL CONSTRUCTION',940]].forEach(([t,x])=>s+=`<text x="${x}" y="99" text-anchor="middle" font-size="9" font-weight="700">${t}</text>`);
  for(let m=Math.ceil(range.fromM*2)/2;m<=range.toM+.001;m+=.5){const yy=y(m),major=Math.abs(m-Math.round(m))<.001;s+=`<line x1="${major?24:36}" y1="${yy}" x2="75" y2="${yy}" stroke="#596774" stroke-width="${major?1:.5}"/>`;if(major)s+=`<text x="20" y="${yy+3}" text-anchor="end" font-size="8">${m.toFixed(0)}</text>`;}
  const fromFt=Math.ceil(mToFt(range.fromM)),toFt=Math.floor(mToFt(range.toM));
  for(let ft=fromFt;ft<=toFt;ft++){const yy=y(ft*FT_TO_M);s+=`<line x1="${ft%5===0?77:91}" y1="${yy}" x2="129" y2="${yy}" stroke="#7a8791" stroke-width="${ft%5===0?1:.45}"/><text x="88" y="${yy+3}" text-anchor="end" font-size="7">${ft}</text>`;}
  b.layers.filter(r=>r.status!=='ignored'&&intersectsRange(r.fromM,r.toM,range)).forEach((r,i)=>{
    const a=Math.max(Number(r.fromM),range.fromM),z=Math.min(Number(r.toM),range.toM),yy=y(a),hh=Math.max(1,y(z)-yy),pat=patternFor(r.material);
    s+=`<rect x="430" y="${yy}" width="60" height="${hh}" fill="url(#${p}-${pat})" stroke="#222" stroke-width=".7"/>`;
    s+=`<line x1="130" y1="${yy}" x2="430" y2="${yy}" stroke="#444" stroke-width=".65"/>`;
    const lines=[r.material||'',r.description||'',r.moisture||''].filter(Boolean).flatMap((v,j)=>j===1?wrapText(v,45):[v]);
    const max=Math.max(1,Math.floor((hh-5)/12));lines.slice(0,max).forEach((line,j)=>s+=`<text x="137" y="${yy+13+j*12}" font-size="${j===0?9:8}" font-weight="${j===0?'700':'400'}" clip-path="url(#${p}-desc)">${esc(line)}</text>`);
  });
  b.samples.filter(r=>r.status!=='ignored'&&intersectsRange(r.fromM,r.toM,range)).forEach(r=>{
    const a=Math.max(Number(r.fromM),range.fromM),z=Math.min(Number(r.toM),range.toM),yy=y(a),hh=Math.max(12,y(z)-yy);
    s+=`<rect x="490" y="${yy}" width="85" height="${hh}" fill="#fff" stroke="#444" stroke-width=".7"/><text x="532" y="${yy+12}" text-anchor="middle" font-size="8">${esc(r.sampleId)}</text>`;
    const analyses=(r.analyses||[]).join(', ');if(analyses)s+=`<text x="706" y="${yy+12}" font-size="7.5">${esc(analyses.slice(0,28))}</text>`;
  });
  b.tests.filter(r=>r.status!=='ignored'&&pointInRange(r.depthM,range,true)).forEach(r=>{const yy=y(r.depthM);if(r.nValue!=null)s+=`<text x="600" y="${yy+3}" text-anchor="middle" font-size="8.5" font-weight="700">${esc(r.nValue)}</text>`;if(r.pidPpm!=null)s+=`<text x="663" y="${yy+3}" text-anchor="middle" font-size="7.5">${esc(r.pidPpm)}</text>`;if(r.sptBlows)s+=`<text x="532" y="${yy-3}" text-anchor="middle" font-size="6.5">${esc(r.sptBlows)}</text>`;});
  if(b.well?.enabled){const cx=930,st=b.well.screenTopM,sb=b.well.screenBottomM,rb=b.well.riserBottomM??st;const pipeTop=Math.max(range.fromM,0),pipeBottom=Math.min(range.toM,Number(sb??b.totalDepthM));if(pipeBottom>range.fromM&&pipeTop<range.toM){const yy=y(Math.max(pipeTop,range.fromM)),zz=y(Math.min(pipeBottom,range.toM));s+=`<rect x="${cx-10}" y="${yy}" width="20" height="${Math.max(1,zz-yy)}" fill="#fff" stroke="#222"/>`;if(st!=null&&sb!=null&&intersectsRange(st,sb,range)){const sy=y(Math.max(st,range.fromM)),sz=y(Math.min(sb,range.toM));for(let q=sy+4;q<sz;q+=7)s+=`<line x1="${cx-9}" y1="${q}" x2="${cx+9}" y2="${q}" stroke="#555"/>`;s+=`<text x="955" y="${Math.min(bottom-5,sy+12)}" font-size="8">SCREEN</text>`;}if(rb!=null&&pointInRange(rb,range,true))s+=`<text x="955" y="${y(rb)+3}" font-size="7">Riser ${Number(rb).toFixed(2)} m</text>`;if(b.well.waterDepthM!=null&&pointInRange(b.well.waterDepthM,range,true)){const wy=y(b.well.waterDepthM);s+=`<path d="M${cx-15} ${wy}h30l-15 12z" fill="#2a8bc5"/><text x="955" y="${wy+4}" font-size="7" fill="#176894">Water</text>`;}}}
  if(b.totalDepthM>=range.fromM&&b.totalDepthM<=range.toM){const ey=y(b.totalDepthM);s+=`<line x1="130" y1="${ey}" x2="825" y2="${ey}" stroke="#111" stroke-width="1.5"/><text x="280" y="${Math.min(bottom-4,ey+14)}" font-size="8.5" font-weight="700">End of Borehole at ${Number(b.totalDepthM).toFixed(2)} m (${formatFeetInches(b.totalDepthM)})</text>`;}
  s+=`<text x="24" y="${H-24}" font-size="8">Fixed sheet depth range: ${range.fromM.toFixed(0)}–${range.toM.toFixed(0)} m</text><text x="1054" y="${H-24}" text-anchor="end" font-size="8">Generated by Borehole Log Studio Web</text></svg>`;
  return s;
}

function addBorehole() {
  const b=blankBorehole(`BH-${state.boreholes.length+1}`);state.boreholes.push(b);state.activeBoreholeId=b.id;state.uiSheetIndex=0;saveState(true);
}
function addManualRow(kind) {
  const b=activeBorehole();
  if(kind==='layers') b.layers.push({id:uid('layer'),fromM:null,toM:null,material:'',moisture:'',description:'',status:'manual',confidence:null,evidence:'',box:null});
  if(kind==='samples') b.samples.push({id:uid('sample'),fromM:null,toM:null,sampleId:'',analyses:[],status:'manual',confidence:null,evidence:'',box:null});
  if(kind==='tests') b.tests.push({id:uid('test'),depthM:null,sptBlows:'',nValue:null,pidPpm:null,status:'manual',confidence:null,evidence:'',box:null});
  saveState(true);
}

async function handleFiles(files) {
  for (const file of files) {
    try {
      const ext=file.name.split('.').pop().toLowerCase();
      if(ext==='json'){await importJson(file);continue;}
      if(['xlsx','xls','csv'].includes(ext)){await importSpreadsheet(file);continue;}
      if(ext==='pdf'){await importPdf(file);continue;}
      if(['png','jpg','jpeg','webp'].includes(ext)){await importImage(file);continue;}
      toast(`Unsupported file: ${file.name}`,true);
    } catch (err) { console.error(err); toast(`${file.name}: ${err.message}`,true); }
  }
}
function addSourceMeta(source) {
  state.sources ||= [];
  const existing=state.sources.find(s=>s.id===source.id);if(!existing)state.sources.push({id:source.id,name:source.name,type:source.type,pageCount:source.pages?.length||1,addedAt:nowIso()});
  runtimeSources.set(source.id,source);activeSourceId=source.id;saveState();renderSources();
}
async function importPdf(file) {
  toast(`Preparing ${file.name}…`);
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise,pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i),tc=await page.getTextContent(),text=tc.items.map(x=>x.str).join(' ').replace(/\s+/g,' ').trim();
    const base=page.getViewport({scale:1}),scale=Math.max(1.35,1500/base.width),vp=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.round(vp.width);canvas.height=Math.round(vp.height);await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    pages.push({pageNumber:i,text,dataUrl:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height});
  }
  const source={id:uid('src'),name:file.name,type:'pdf',pages};addSourceMeta(source);openReview(source.id,0);
  toast(`${file.name}: ${pages.length} page(s) prepared. Native text is used when available; AI is optional.`);
}
async function importImage(file) {
  const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  const source={id:uid('src'),name:file.name,type:'image',pages:[{pageNumber:1,text:'',dataUrl}]};addSourceMeta(source);openReview(source.id,0);
}
async function importJson(file) {
  const raw=JSON.parse(await file.text());
  const imported=normalizeState(raw);
  if(!confirm(`Replace the current project with ${imported.boreholes.length} imported borehole(s)?`))return;
  state=imported;saveState(true);toast('Project JSON imported.');
}
function normKey(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function pickWithKey(row, aliases){for(const k of Object.keys(row)){const nk=normKey(k);if(aliases.some(a=>nk===a||nk.includes(a)))return {key:k,value:row[k]};}return {key:'',value:''};}
function sheetDepthValue(row,aliases){const p=pickWithKey(row,aliases);const n=num(p.value);if(n==null)return null;return /ft|feet/.test(normKey(p.key))?ftToM(n):n;}
async function importSpreadsheet(file) {
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),rows=[];wb.SheetNames.forEach(sn=>XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''}).forEach(r=>rows.push({...r,__sheet:sn})));
  if(!rows.length)throw new Error('No spreadsheet rows found.');
  const groups=new Map();for(const row of rows){const name=String(pickWithKey(row,['borehole','bhid','wellid','locationid']).value||row.__sheet||'Imported BH').trim();if(!groups.has(name))groups.set(name,[]);groups.get(name).push(row);}
  reviewQueue=[];
  for(const [name,rs] of groups){const b=blankBorehole(name);b.review={sourceName:file.name,sourcePage:null,warnings:[]};let max=0;
    for(const r of rs){const from=sheetDepthValue(r,['fromdepth','topdepth','depthfrom','from']),to=sheetDepthValue(r,['todepth','bottomdepth','depthto','to']),mat=String(pickWithKey(r,['material','soiltype','lithology','uscs']).value||''),desc=String(pickWithKey(r,['description','soildescription','materialdescription']).value||''),moist=String(pickWithKey(r,['moisture','condition']).value||''),sid=String(pickWithKey(r,['sampleid','sampleno','labsample']).value||''),anal=String(pickWithKey(r,['analyses','analysis','testsrequested','parameters']).value||''),n=num(pickWithKey(r,['nvalue','sptn']).value),pid=num(pickWithKey(r,['pid','headspace']).value),blows=String(pickWithKey(r,['blows','sptblows']).value||'');
      if(to!=null)max=Math.max(max,to);if(from!=null&&to!=null&&to>from&&(mat||desc))b.layers.push({id:uid('layer'),fromM:from,toM:to,material:mat,description:desc,moisture:moist,status:'manual',confidence:null,evidence:'Spreadsheet row',box:null});
      if(sid)b.samples.push({id:uid('sample'),fromM:from,toM:to,sampleId:sid,analyses:anal.split(',').map(x=>x.trim()).filter(Boolean),status:'manual',confidence:null,evidence:'Spreadsheet row',box:null});
      if(n!=null||pid!=null||blows)b.tests.push({id:uid('test'),depthM:to??from,sptBlows:blows,nValue:n,pidPpm:pid,status:'manual',confidence:null,evidence:'Spreadsheet row',box:null});
    }
    b.totalDepthM=max;b.review.warnings.push('Spreadsheet import uses explicit headers only. Review mapped columns before applying.');reviewQueue.push(b);
  }
  const source={id:uid('src'),name:file.name,type:'spreadsheet',pages:[]};addSourceMeta(source);activeSourceId=source.id;reviewQueueIndex=0;reviewDraft=reviewQueue[0];openReviewModal();renderReview();toast(`${reviewQueue.length} spreadsheet borehole(s) ready for review.`);
}
function removeSource(id) {
  const meta=state.sources.find(s=>s.id===id);if(!meta)return;
  const related=state.boreholes.filter(b=>b.review?.sourceName===meta.name).length;
  const msg=related?`Remove ${meta.name}? ${related} imported borehole(s) reference this source but will remain in the project.`:`Remove ${meta.name}?`;
  if(!confirm(msg))return;state.sources=state.sources.filter(s=>s.id!==id);runtimeSources.delete(id);if(activeSourceId===id)activeSourceId=null;saveState(true);
}
function openSourceById(id) {
  if(!runtimeSources.has(id)){toast('The source image is not stored after a browser reload. Re-import the file to review it again.',true);return;}openReview(id,0);
}
function safeNativeDraft(page,sourceName) {
  const text=page.text||'',b=blankBorehole(`Page-${page.pageNumber}`);b.review={sourceName,sourcePage:page.pageNumber,warnings:[]};
  const id=text.match(/\b(?:BH|MW|TP)\s*[-#]?\s*\d+[A-Z]?\b/i);if(id)b.name=id[0].replace(/\s+/g,'');
  const eoh=text.match(/End\s+of\s+Borehole\s+at\s+(\d+(?:\.\d+)?)\s*m/i);if(eoh)b.totalDepthM=Number(eoh[1]);
  else b.review.warnings.push('Total depth was not safely identified from the native PDF text. Enter it manually or use Vision AI.');
  if(text.length<40)b.review.warnings.push('This page has little or no machine-readable text. It is likely a scan; use Vision AI or manual entry.');
  else b.review.warnings.push('Native PDF text detected. No lithology is inferred without reliable depth geometry; use Vision AI or enter layers manually.');
  return b;
}

function openReview(sourceId,pageIndex=0) {
  activeSourceId=sourceId;reviewPageIndex=pageIndex;reviewQueue=[];reviewQueueIndex=0;selectedBox=null;evidenceBox=null;
  const source=runtimeSources.get(sourceId);if(!source)return;
  reviewDraft=source.pages?.length?safeNativeDraft(source.pages[pageIndex],source.name):blankBorehole('Imported BH');
  openReviewModal();renderReview();
}
function openReviewModal() { $('reviewModal').classList.remove('hidden'); }
function closeReviewModal() { $('reviewModal').classList.add('hidden'); selectedBox=null;evidenceBox=null; }
function currentSource(){return runtimeSources.get(activeSourceId);}
function currentPage(){return currentSource()?.pages?.[reviewPageIndex]||null;}
function renderReview() {
  renderReviewSource();renderReviewDraft();
}
function renderReviewSource() {
  const page=currentPage(),source=currentSource(),wrap=$('reviewImageWrap');
  $('reviewSourceName').textContent=source?source.name:(reviewDraft?.review?.sourceName||'Structured import');
  if(!page){wrap.innerHTML='<div style="color:white;padding:30px">Structured source: no page image available.</div>'; $('reviewPageText').textContent='';return;}
  wrap.innerHTML=`<img id="reviewImage" src="${page.dataUrl}" alt="Source page ${page.pageNumber}"><div id="evidenceBox" class="evidence-box" style="display:none"></div><div id="selectionBox" class="selection-box" style="display:none"></div>`;
  $('reviewPageText').textContent=`Page ${page.pageNumber}/${source.pages.length} • ${page.text?.length||0} native text characters`;
  bindSelection();drawBoxes();
}
function reviewDepthValue(v){return v==null?'':Number(v).toFixed(3);}
function confidenceText(item){return item.confidence==null?'Manual':`${Math.round(item.confidence*100)}%`;}
function reviewStatusOptions(s='draft'){return ['draft','accepted','manual','ignored'].map(v=>`<option value="${v}" ${v===s?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('');}
function renderReviewDraft() {
  const b=reviewDraft;if(!b)return;
  $('reviewBhName').value=b.name||'';$('reviewBhDepth').value=reviewDepthValue(b.totalDepthM);$('reviewElevation').value=b.groundElevationM??'';
  const items=[...b.layers,...b.samples,...b.tests],unresolved=items.filter(x=>x.status==='draft').length,low=items.filter(x=>x.status==='draft'&&(x.confidence==null||x.confidence<.6)).length;
  $('reviewSummary').innerHTML=`<strong>${esc(b.name)}</strong><span>${b.layers.length} layer(s)</span><span>${b.samples.length} sample(s)</span><span>${b.tests.length} test(s)</span><span class="warn">${unresolved} unresolved • ${low} low-confidence</span>`;
  $('reviewWarnings').innerHTML=(b.review?.warnings||[]).map(w=>`<div>• ${esc(w)}</div>`).join('')||'<div>No parser warnings.</div>';
  $('reviewLayers').innerHTML=b.layers.map(r=>reviewRow('layers',r)).join('');
  $('reviewSamples').innerHTML=b.samples.map(r=>reviewRow('samples',r)).join('');
  $('reviewTests').innerHTML=b.tests.map(r=>reviewRow('tests',r)).join('');
  $('applyReview').disabled=unresolved>0;
  $('applyReview').title=unresolved?`${unresolved} draft item(s) must be accepted, edited, or ignored first.`:'';
  $('draftNav').textContent=reviewQueue.length?`Draft ${reviewQueueIndex+1}/${reviewQueue.length}`:'';
  bindReviewRows();
}
function reviewRow(kind,r) {
  const cls=`review-row ${kind==='samples'?'samples':kind==='tests'?'tests':''} status-${r.status||'draft'}`;
  const common=`<select data-field="status">${reviewStatusOptions(r.status||'draft')}</select><button data-highlight title="Show evidence">${r.box?'Locate':'—'}</button>`;
  if(kind==='layers')return `<div class="${cls}" data-kind="layers" data-id="${r.id}"><input data-field="fromM" value="${reviewDepthValue(r.fromM)}" placeholder="m or 7'-5\""><input data-field="toM" value="${reviewDepthValue(r.toM)}"><select data-field="material">${materialOptions(r.material)}</select><input data-field="description" value="${esc(r.description)}" placeholder="Description"><span class="review-tag ${confidenceStatus(r.confidence)}">${confidenceText(r)}</span>${common}</div>`;
  if(kind==='samples')return `<div class="${cls}" data-kind="samples" data-id="${r.id}"><input data-field="sampleId" value="${esc(r.sampleId)}" placeholder="SS-1"><input data-field="fromM" value="${reviewDepthValue(r.fromM)}"><input data-field="toM" value="${reviewDepthValue(r.toM)}"><input data-field="analyses" value="${esc((r.analyses||[]).join(', '))}" placeholder="Only if visible"><span class="review-tag ${confidenceStatus(r.confidence)}">${confidenceText(r)}</span>${common}</div>`;
  return `<div class="${cls}" data-kind="tests" data-id="${r.id}"><input data-field="depthM" value="${reviewDepthValue(r.depthM)}"><input data-field="sptBlows" value="${esc(r.sptBlows)}" placeholder="2-3-4"><input data-field="nValue" value="${r.nValue??''}" placeholder="N"><input data-field="pidPpm" value="${r.pidPpm??''}" placeholder="ppm"><span class="review-tag ${confidenceStatus(r.confidence)}">${confidenceText(r)}</span>${common}</div>`;
}
function parseReviewDepth(value){const s=String(value||'').trim();if(!s)return null;if(/["']|\b(?:ft|feet|in|inch)/i.test(s)){const ft=parseImperialDepth(s);return ft==null?null:ftToM(ft);}return num(s);}
function bindReviewRows() {
  document.querySelectorAll('#reviewLayers .review-row,#reviewSamples .review-row,#reviewTests .review-row').forEach(row=>{
    const arr=reviewDraft[row.dataset.kind],item=arr.find(x=>x.id===row.dataset.id);if(!item)return;
    row.querySelectorAll('input,select').forEach(input=>input.onchange=()=>{
      const f=input.dataset.field;if(f==='status'){item.status=input.value;renderReviewDraft();return;}
      if(['fromM','toM','depthM'].includes(f))item[f]=parseReviewDepth(input.value);
      else if(f==='analyses')item[f]=input.value.split(',').map(x=>x.trim()).filter(Boolean);
      else if(['nValue','pidPpm'].includes(f))item[f]=num(input.value);
      else item[f]=input.value;
      item.status='manual';item.confidence=null;renderReviewDraft();
    });
    const hi=row.querySelector('[data-highlight]');if(hi)hi.onclick=()=>{evidenceBox=item.box;selectedBox=null;drawBoxes();};
  });
}
function drawBoxes(){const img=$('reviewImage'),ev=$('evidenceBox'),sel=$('selectionBox');if(!img||!ev||!sel)return;requestAnimationFrame(()=>{const rect=img.getBoundingClientRect(),parent=img.parentElement.getBoundingClientRect(),place=(el,box)=>{if(!box){el.style.display='none';return;}const [x1,y1,x2,y2]=box;el.style.display='block';el.style.left=`${img.offsetLeft+x1/1000*img.clientWidth}px`;el.style.top=`${img.offsetTop+y1/1000*img.clientHeight}px`;el.style.width=`${Math.max(2,(x2-x1)/1000*img.clientWidth)}px`;el.style.height=`${Math.max(2,(y2-y1)/1000*img.clientHeight)}px`;};place(ev,evidenceBox);place(sel,selectedBox);});}
function bindSelection(){const wrap=$('reviewImageWrap'),img=$('reviewImage');if(!wrap||!img)return;wrap.onpointerdown=e=>{if(e.target!==img)return;const r=img.getBoundingClientRect();pointerStart={x:(e.clientX-r.left)/r.width*1000,y:(e.clientY-r.top)/r.height*1000};selectedBox=[pointerStart.x,pointerStart.y,pointerStart.x,pointerStart.y];drawBoxes();};wrap.onpointermove=e=>{if(!pointerStart)return;const r=img.getBoundingClientRect(),x=Math.max(0,Math.min(1000,(e.clientX-r.left)/r.width*1000)),y=Math.max(0,Math.min(1000,(e.clientY-r.top)/r.height*1000));selectedBox=[Math.min(pointerStart.x,x),Math.min(pointerStart.y,y),Math.max(pointerStart.x,x),Math.max(pointerStart.y,y)];drawBoxes();};wrap.onpointerup=()=>{pointerStart=null;};}

function aiPrompt(pageNumber,region=false) {
  return `You are a careful geotechnical/environmental borehole field-log transcription assistant. Analyze ${region?'only the cropped selected region':'the complete page'} from page ${pageNumber}.
The source may be a printed borehole log, a scanned field form, or difficult handwriting over grid lines.
STRICT RULES:
- Transcribe only values that are visually supported. Never invent missing text, depths, laboratory analyses, SPT values, PID values, groundwater, or well construction.
- If uncertain, use null or an empty string and add a warning. Low confidence is expected for ambiguous handwriting.
- Laboratory analyses such as Metals, PHCs, VOCs, PAHs, BTEX, PCBs, pH, Grain Size, or Moisture may appear only when those words/abbreviations are visibly present next to the sample.
- Depths may be metres or feet/inches. Return depth fields in decimal feet only when the source is imperial. If a clearly labelled metre value is visible, convert it to feet using 1 m = 3.280839895 ft before returning.
- Use actual written layer boundaries; never divide the borehole into artificial equal layers.
- A bounding box must be [x1,y1,x2,y2] normalized from 0 to 1000 relative to the supplied image. If a box is not reliable, use null.
- confidence is 0.0 to 1.0. Evidence is a short literal phrase or visual cue from the page.
- Return ONLY valid JSON without markdown.
JSON shape:
{"borehole_id":null,"total_depth_ft":null,"ground_elevation_m":null,"layers":[{"from_ft":null,"to_ft":null,"material":null,"description":"","moisture":"","confidence":0,"evidence":"","box":null}],"samples":[{"sample_id":"","from_ft":null,"to_ft":null,"analyses":[],"confidence":0,"evidence":"","box":null}],"tests":[{"depth_ft":null,"spt_blows":"","n_value":null,"pid_ppm":null,"confidence":0,"evidence":"","box":null}],"well":{"monitoring_well":false,"riser_bottom_ft":null,"screen_top_ft":null,"screen_bottom_ft":null,"water_depth_ft":null,"confidence":0,"evidence":"","box":null},"warnings":[]}`;
}
async function callGemini(pageDataUrl,prompt) {
  const key=$('aiKey').value.trim(),model=$('aiModel').value.trim();if(!key)throw new Error('Enter a Gemini API key.');if(!model)throw new Error('Enter a Gemini model name.');
  sessionStorage.setItem('blsGeminiKeySession',key);if($('rememberKey').checked)localStorage.setItem('blsGeminiKeyLocal',key);else localStorage.removeItem('blsGeminiKeyLocal');
  const m=String(pageDataUrl).match(/^data:([^;]+);base64,(.+)$/);if(!m)throw new Error('Invalid source image.');
  const res=await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt},{inline_data:{mime_type:m[1],data:m[2]}}]}],generationConfig:{temperature:0,response_mime_type:'application/json'}})});
  if(!res.ok){const t=await res.text();throw new Error(`Vision API ${res.status}: ${t.slice(0,240)}`);}const payload=await res.json(),text=payload?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';if(!text)throw new Error('Vision AI returned no text.');return JSON.parse(text.replace(/^```json\s*|```$/g,'').trim());
}
function setAiProgress(text,pct){$('aiStatus').textContent=text;$('aiBar').style.width=`${Math.max(0,Math.min(100,pct))}%`;}
async function analyzeCurrentPage() {
  const page=currentPage();if(!page)return toast('Open a PDF or image source first.',true);
  try{setAiProgress(`Analyzing page ${page.pageNumber}…`,20);const raw=await callGemini(page.dataUrl,aiPrompt(page.pageNumber,false));reviewDraft=sanitizeAiPage(raw,page.pageNumber,currentSource().name);reviewQueue=[];setAiProgress('AI draft ready. Review every uncertain field before applying.',100);renderReview();}catch(e){console.error(e);setAiProgress(e.message,0);toast(e.message,true);}
}
async function analyzeAllPages() {
  const source=currentSource();if(!source?.pages?.length)return toast('Open a PDF or image source first.',true);
  try{const pages=[];for(let i=0;i<source.pages.length;i++){reviewPageIndex=i;renderReviewSource();setAiProgress(`Analyzing page ${i+1}/${source.pages.length}…`,Math.round(i/source.pages.length*90));const raw=await callGemini(source.pages[i].dataUrl,aiPrompt(i+1,false));pages.push(sanitizeAiPage(raw,i+1,source.name));}
    const groups=new Map();for(const p of pages){const key=(p.name||`Page-${p.review.sourcePage}`).toUpperCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}reviewQueue=[...groups.values()].map(g=>mergeBoreholePages(g));reviewQueueIndex=0;reviewDraft=reviewQueue[0];setAiProgress(`${reviewQueue.length} borehole draft(s) ready for review.`,100);renderReview();}catch(e){console.error(e);setAiProgress(e.message,0);toast(e.message,true);}
}
async function cropSelectionDataUrl() {
  const page=currentPage();if(!page||!selectedBox)return null;const img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=page.dataUrl;});const [x1,y1,x2,y2]=selectedBox,w=Math.max(1,Math.round((x2-x1)/1000*img.naturalWidth)),h=Math.max(1,Math.round((y2-y1)/1000*img.naturalHeight)),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,x1/1000*img.naturalWidth,y1/1000*img.naturalHeight,w,h,0,0,w,h);return c.toDataURL('image/jpeg',.95);
}
async function analyzeSelectedRegion() {
  if(!selectedBox)return toast('Drag a rectangle over the source image first.',true);
  try{setAiProgress('Reading selected region…',25);const raw=await callGemini(await cropSelectionDataUrl(),aiPrompt(currentPage()?.pageNumber||1,true));const extra=sanitizeAiPage(raw,currentPage()?.pageNumber||1,currentSource()?.name||'');if(!reviewDraft)reviewDraft=extra;else{reviewDraft.layers.push(...extra.layers);reviewDraft.samples.push(...extra.samples);reviewDraft.tests.push(...extra.tests);reviewDraft.review.warnings.push(...extra.review.warnings);if(extra.totalDepthM>reviewDraft.totalDepthM)reviewDraft.totalDepthM=extra.totalDepthM;if(extra.well.enabled)reviewDraft.well={...reviewDraft.well,...extra.well,enabled:true};}selectedBox=null;setAiProgress('Region result added as draft. Review duplicates and uncertain values.',100);renderReview();}catch(e){console.error(e);setAiProgress(e.message,0);toast(e.message,true);}
}
function acceptHighConfidence(){if(!reviewDraft)return;[...reviewDraft.layers,...reviewDraft.samples,...reviewDraft.tests].forEach(x=>{if(x.status==='draft'&&Number(x.confidence)>=.85)x.status='accepted';});renderReviewDraft();}
function addReviewRow(kind){if(!reviewDraft)return;if(kind==='layers')reviewDraft.layers.push({id:uid('layer'),fromM:null,toM:null,material:'',description:'',moisture:'',status:'manual',confidence:null,evidence:'Manual entry',box:null});if(kind==='samples')reviewDraft.samples.push({id:uid('sample'),fromM:null,toM:null,sampleId:'',analyses:[],status:'manual',confidence:null,evidence:'Manual entry',box:null});if(kind==='tests')reviewDraft.tests.push({id:uid('test'),depthM:null,sptBlows:'',nValue:null,pidPpm:null,status:'manual',confidence:null,evidence:'Manual entry',box:null});renderReviewDraft();}
function applyReviewDraft() {
  if(!reviewDraft)return;const unresolved=[...reviewDraft.layers,...reviewDraft.samples,...reviewDraft.tests].filter(x=>x.status==='draft').length;if(unresolved)return toast(`Resolve ${unresolved} draft item(s) first.`,true);
  reviewDraft.name=$('reviewBhName').value.trim()||reviewDraft.name;reviewDraft.totalDepthM=parseReviewDepth($('reviewBhDepth').value)??reviewDraft.totalDepthM;reviewDraft.groundElevationM=num($('reviewElevation').value);
  reviewDraft.layers=reviewDraft.layers.filter(x=>x.status!=='ignored');reviewDraft.samples=reviewDraft.samples.filter(x=>x.status!=='ignored');reviewDraft.tests=reviewDraft.tests.filter(x=>x.status!=='ignored');
  const copy=ensureBorehole(clone(reviewDraft));copy.id=uid('bh');copy.layers.forEach(x=>x.id=uid('layer'));copy.samples.forEach(x=>x.id=uid('sample'));copy.tests.forEach(x=>x.id=uid('test'));
  state.boreholes.push(copy);state.activeBoreholeId=copy.id;state.uiSheetIndex=0;saveState(true);toast(`${copy.name} added to project.`);
  if(reviewQueue.length&&reviewQueueIndex<reviewQueue.length-1){reviewQueueIndex++;reviewDraft=reviewQueue[reviewQueueIndex];renderReview();}else closeReviewModal();
}
function reviewQueueMove(delta){if(!reviewQueue.length)return;reviewQueueIndex=Math.max(0,Math.min(reviewQueue.length-1,reviewQueueIndex+delta));reviewDraft=reviewQueue[reviewQueueIndex];renderReview();}

function exportJson(){download(`${safeId(state.project.name||'borehole-project')}.json`,JSON.stringify(state,null,2),'application/json');}
function exportCsv(){const rows=[['Borehole','From_m','To_m','Material','Moisture','Description','Sample_ID','Analyses','SPT_Blows','N','PID_ppm']];for(const b of state.boreholes){const n=Math.max(b.layers.length,b.samples.length,b.tests.length,1);for(let i=0;i<n;i++){const l=b.layers[i]||{},s=b.samples[i]||{},t=b.tests[i]||{};rows.push([b.name,l.fromM??s.fromM??'',l.toM??s.toM??'',l.material||'',l.moisture||'',l.description||'',s.sampleId||'',(s.analyses||[]).join('; '),t.sptBlows||'',t.nValue??'',t.pidPpm??'']);}}download('borehole-data.csv',rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'),'text/csv');}
function exportDxf(){const b=activeBorehole(),scale=1000,out=['0','SECTION','2','ENTITIES'];const line=(x1,y1,x2,y2,layer)=>out.push('0','LINE','8',layer,'10',String(x1),'20',String(y1),'11',String(x2),'21',String(y2));const text=(x,y,v,h=100)=>out.push('0','TEXT','8','TEXT','10',String(x),'20',String(y),'40',String(h),'1',String(v).replace(/[^\x20-\x7E]/g,'?'));text(0,400,b.name,180);b.layers.filter(x=>x.status!=='ignored').forEach(r=>{if(r.fromM==null||r.toM==null)return;const a=-r.fromM*scale,z=-r.toM*scale;line(0,a,400,a,'LITHOLOGY');line(0,z,400,z,'LITHOLOGY');line(0,a,0,z,'LITHOLOGY');line(400,a,400,z,'LITHOLOGY');text(430,(a+z)/2,`${r.material||''} ${r.description||''}`,85);});out.push('0','ENDSEC','0','EOF');download(`${safeId(b.name)}.dxf`,out.join('\n'),'application/dxf');}
function printAll(){const area=$('printArea');let html='';for(const b of state.boreholes){const ranges=sheetRanges(b.totalDepthM);ranges.forEach((r,i)=>html+=`<section class="print-sheet">${renderSheetSvg(b,r,i,ranges.length)}<div class="print-caption">${esc(b.name)} — Sheet ${i+1} of ${ranges.length}</div></section>`);}area.innerHTML=html;setTimeout(()=>window.print(),100);}

function bindStatic() {
  $('projectName').onchange=e=>{state.project.name=e.target.value;saveState();renderSheet();};$('projectNumber').onchange=e=>{state.project.number=e.target.value;saveState();renderSheet();};$('projectLocation').onchange=e=>{state.project.location=e.target.value;saveState();renderSheet();};
  $('newProject').onclick=()=>{if(confirm('Start a new blank project?')){state=blankProject();state.sources=[];runtimeSources.clear();saveState(true);}};$('saveProject').onclick=()=>{saveState();toast('Project saved locally in this browser.');};$('addBorehole').onclick=addBorehole;
  const prop={bhName:'name',bhDepth:'totalDepthM',groundElevation:'groundElevationM',drillingMethod:'drillingMethod',drillDate:'drillDate'};Object.entries(prop).forEach(([id,key])=>$(id).onchange=e=>{const b=activeBorehole();b[key]=e.target.type==='number'?num(e.target.value):e.target.value;if(key==='totalDepthM')state.uiSheetIndex=0;saveState(true);});
  $('wellEnabled').onchange=e=>{activeBorehole().well.enabled=e.target.checked;saveState(true);};[['screenTop','screenTopM'],['screenBottom','screenBottomM'],['waterDepth','waterDepthM'],['riserBottom','riserBottomM']].forEach(([id,key])=>$(id).onchange=e=>{activeBorehole().well[key]=num(e.target.value);saveState(true);});
  $('prevSheet').onclick=()=>{state.uiSheetIndex=Math.max(0,(state.uiSheetIndex||0)-1);renderSheet();};$('nextSheet').onclick=()=>{state.uiSheetIndex=(state.uiSheetIndex||0)+1;renderSheet();};
  $('addLayer').onclick=()=>addManualRow('layers');$('addSample').onclick=()=>addManualRow('samples');$('addTest').onclick=()=>addManualRow('tests');
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab,.tab-pane').forEach(x=>x.classList.remove('active'));t.classList.add('active');$(t.dataset.tab).classList.add('active');});
  $('importFiles').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>{const files=[...e.target.files];e.target.value='';handleFiles(files);};
  $('exportJson').onclick=exportJson;$('exportCsv').onclick=exportCsv;$('exportDxf').onclick=exportDxf;$('printAll').onclick=printAll;
  const drop=$('dropZone');['dragenter','dragover'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.style.outline='2px solid #1b83c4';}));['dragleave','drop'].forEach(n=>drop.addEventListener(n,e=>{e.preventDefault();drop.style.outline='';}));drop.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
  $('closeReview').onclick=closeReviewModal;$('analyzePage').onclick=analyzeCurrentPage;$('analyzeAll').onclick=analyzeAllPages;$('analyzeRegion').onclick=analyzeSelectedRegion;$('acceptHigh').onclick=acceptHighConfidence;$('addReviewLayer').onclick=()=>addReviewRow('layers');$('addReviewSample').onclick=()=>addReviewRow('samples');$('addReviewTest').onclick=()=>addReviewRow('tests');$('applyReview').onclick=applyReviewDraft;$('draftPrev').onclick=()=>reviewQueueMove(-1);$('draftNext').onclick=()=>reviewQueueMove(1);
  $('reviewBhName').onchange=e=>{if(reviewDraft){reviewDraft.name=e.target.value;renderReviewDraft();}};$('reviewBhDepth').onchange=e=>{if(reviewDraft){reviewDraft.totalDepthM=parseReviewDepth(e.target.value)??0;renderReviewDraft();}};$('reviewElevation').onchange=e=>{if(reviewDraft){reviewDraft.groundElevationM=num(e.target.value);renderReviewDraft();}};
  $('aiKey').value=sessionStorage.getItem('blsGeminiKeySession')||localStorage.getItem('blsGeminiKeyLocal')||'';$('rememberKey').checked=!!localStorage.getItem('blsGeminiKeyLocal');
}

bindStatic();renderAll();
