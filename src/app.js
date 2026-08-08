import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STORAGE_KEY = 'boreholeLogStudio';
const SCHEMA_VERSION = 3;
const MATERIALS = [
  'ASPHALT','CONCRETE','FILL','GRAVEL','SAND','SILTY SAND','SILT','SANDY SILT',
  'CLAYEY SILT','CLAY','SILTY CLAY','TILL','ORGANIC SOIL','BEDROCK'
];
const ANALYSIS_TERMS = ['Metals','PHCs','VOCs','PAHs','BTEX','PCBs','pH','Grain Size','Moisture'];
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
const $ = id => document.getElementById(id);

let ocrWorkerPromise;
let pendingImport = [];
let pendingSources = [];
let replaceTargetId = null;

function blankBh(name = 'BH1', depth = 1, monitoringWell = false) {
  return {
    id: uid(), name, totalDepth: Math.max(0.1, Number(depth) || 1), totalDepthKnown: true,
    groundElevation: null, drillingMethod: '', drillDate: '', monitoringWell,
    screenTop: null, screenBottom: null, waterDepth: null,
    layers: [], samples: [], tests: [], sourceFileId: null, importNotes: []
  };
}

function blankState() {
  const b = blankBh('BH1', 1, false);
  return {
    schemaVersion: SCHEMA_VERSION,
    project: { name: 'New Borehole Project', number: '', location: '' },
    activeId: b.id,
    importedFiles: [],
    boreholes: [b]
  };
}

function migrateState(raw) {
  if (!raw || !raw.project || !Array.isArray(raw.boreholes)) return blankState();
  raw.importedFiles = Array.isArray(raw.importedFiles) ? raw.importedFiles : [];
  raw.boreholes.forEach(b => {
    b.layers = Array.isArray(b.layers) ? b.layers : [];
    b.samples = Array.isArray(b.samples) ? b.samples : [];
    b.tests = Array.isArray(b.tests) ? b.tests : [];
    b.importNotes = Array.isArray(b.importNotes) ? b.importNotes : [];
    if (b.totalDepthKnown == null) b.totalDepthKnown = true;

    // v0.2 generated this exact sample/test pair for every demo borehole.
    // Remove it during migration so old local storage cannot keep showing fabricated data.
    const hasGeneratedTest = b.tests.some(t =>
      String(t.blows || '') === '4-6-8' && Number(t.n) === 14 && Number(t.pid) === 4.8 && Number(t.depth) === 1.5
    );
    if (hasGeneratedTest) {
      b.tests = b.tests.filter(t => !(String(t.blows || '') === '4-6-8' && Number(t.n) === 14 && Number(t.pid) === 4.8 && Number(t.depth) === 1.5));
      b.samples = b.samples.filter(s => String(s.analyses || '').trim() !== 'Metals, PHCs, VOCs');
    }
  });
  if (!raw.boreholes.length) {
    const b = blankBh(); raw.boreholes = [b]; raw.activeId = b.id;
  }
  if (!raw.activeId || !raw.boreholes.some(b => b.id === raw.activeId)) raw.activeId = raw.boreholes[0].id;
  raw.schemaVersion = SCHEMA_VERSION;
  return raw;
}

function loadState() {
  try { return migrateState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return blankState(); }
}

let state = loadState();

function active() { return state.boreholes.find(b => b.id === state.activeId); }
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function numOrNull(value) {
  const t = String(value ?? '').trim();
  return t === '' || !Number.isFinite(Number(t)) ? null : Number(t);
}
function save(render = true) {
  state.schemaVersion = SCHEMA_VERSION;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (render) renderAll();
}
function ensureBhShape(b) {
  b.layers ||= []; b.samples ||= []; b.tests ||= []; b.importNotes ||= [];
  return b;
}
function normalizeMaterial(value = '') {
  const u = String(value).toUpperCase().replace(/\s+/g, ' ').trim();
  const ordered = [...MATERIALS].sort((a,b) => b.length - a.length);
  return ordered.find(m => u.includes(m)) || '';
}
function wrapWords(text, maxChars = 28) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function safeSvgId(value) { return String(value || uid()).replace(/[^a-zA-Z0-9_-]/g, '_'); }

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js', corePath: '/ocr/tesseract-core.wasm.js',
      langPath: '/ocr/lang-data', gzip: true,
      logger: message => {
        if (message.status === 'recognizing text') {
          setImportStatus(`OCR: ${Math.round(message.progress * 100)}%`, Math.round(message.progress * 85));
        }
      }
    });
  }
  return ocrWorkerPromise;
}
async function recognizeOffline(input) {
  const worker = await getOcrWorker();
  return worker.recognize(input);
}

function renderAll() {
  renderProject(); renderBoreholes(); renderDetails(); renderTables(); renderImportedFiles(); renderSvg();
}
function renderProject() {
  $('projectName').value = state.project.name || '';
  $('projectNumber').value = state.project.number || '';
  $('projectLocation').value = state.project.location || '';
}
function renderBoreholes() {
  const c = $('boreholeList'); c.innerHTML = '';
  state.boreholes.forEach(b => {
    const row = document.createElement('div');
    row.className = `borehole-item ${b.id === state.activeId ? 'active' : ''}`;
    row.innerHTML = `<div><strong>${esc(b.name)}</strong><small>${Number(b.totalDepth || 0).toFixed(2)} m</small></div><button class="delete" title="Delete borehole">×</button>`;
    row.onclick = e => {
      if (e.target.classList.contains('delete')) {
        e.stopPropagation();
        if (confirm(`Delete ${b.name}?`)) {
          state.boreholes = state.boreholes.filter(x => x.id !== b.id);
          if (!state.boreholes.length) state.boreholes.push(blankBh('BH1'));
          if (!state.boreholes.some(x => x.id === state.activeId)) state.activeId = state.boreholes[0].id;
          save();
        }
      } else { state.activeId = b.id; renderAll(); }
    };
    c.appendChild(row);
  });
}
function renderDetails() {
  const b = active(); if (!b) return;
  $('activeBoreholeTitle').textContent = b.name;
  $('bhId').value = b.name || '';
  $('bhDepth').value = b.totalDepth ?? '';
  $('groundElevation').value = b.groundElevation ?? '';
  $('drillingMethod').value = b.drillingMethod || '';
  $('drillDate').value = b.drillDate || '';
  $('isMonitoringWell').checked = !!b.monitoringWell;
  $('screenTop').value = b.screenTop ?? '';
  $('screenBottom').value = b.screenBottom ?? '';
  $('waterDepth').value = b.waterDepth ?? '';
  $('wellFields').classList.toggle('hidden', !b.monitoringWell);
}
function materialOptions(sel) {
  return `<option value="">Select material</option>${MATERIALS.map(m => `<option ${m === sel ? 'selected' : ''}>${m}</option>`).join('')}`;
}
function renderTables() {
  const b = ensureBhShape(active());
  $('layersBody').innerHTML = b.layers.map((r,i) => `<tr data-id="${r.id}" class="${r.from < 0 || r.to <= r.from || r.to > b.totalDepth ? 'row-error' : ''}">
    <td><input data-k="from" type="number" step="0.01" value="${r.from ?? ''}"></td>
    <td><input data-k="to" type="number" step="0.01" value="${r.to ?? ''}"></td>
    <td><select data-k="material">${materialOptions(r.material)}</select></td>
    <td><input data-k="moisture" value="${esc(r.moisture)}"></td>
    <td><input class="description" data-k="description" value="${esc(r.description)}"></td>
    <td><button data-del="layer">×</button></td></tr>`).join('');
  $('samplesBody').innerHTML = b.samples.map(r => `<tr data-id="${r.id}">
    <td><input data-k="from" type="number" step="0.01" value="${r.from ?? ''}"></td>
    <td><input data-k="to" type="number" step="0.01" value="${r.to ?? ''}"></td>
    <td><input data-k="sampleId" value="${esc(r.sampleId)}"></td>
    <td><input class="description" data-k="analyses" value="${esc(r.analyses)}"></td>
    <td><button data-del="sample">×</button></td></tr>`).join('');
  $('testsBody').innerHTML = b.tests.map(r => `<tr data-id="${r.id}">
    <td><input data-k="depth" type="number" step="0.01" value="${r.depth ?? ''}"></td>
    <td><input data-k="blows" value="${esc(r.blows)}"></td>
    <td><input data-k="n" type="number" value="${r.n ?? ''}"></td>
    <td><input data-k="pid" type="number" step="0.1" value="${r.pid ?? ''}"></td>
    <td><button data-del="test">×</button></td></tr>`).join('');
  bindTable($('layersBody'), b.layers); bindTable($('samplesBody'), b.samples); bindTable($('testsBody'), b.tests);
  validate();
}
function bindTable(body, arr) {
  body.querySelectorAll('input,select').forEach(el => el.onchange = () => {
    const row = el.closest('tr'), obj = arr.find(x => x.id === row.dataset.id), k = el.dataset.k;
    obj[k] = el.type === 'number' ? numOrNull(el.value) : el.value;
    save();
  });
  body.querySelectorAll('button[data-del]').forEach(btn => btn.onclick = () => {
    const id = btn.closest('tr').dataset.id, b = active();
    if (btn.dataset.del === 'layer') b.layers = b.layers.filter(x => x.id !== id);
    if (btn.dataset.del === 'sample') b.samples = b.samples.filter(x => x.id !== id);
    if (btn.dataset.del === 'test') b.tests = b.tests.filter(x => x.id !== id);
    save();
  });
}
function validate() {
  const b = active(), issues = [], sorted = [...(b.layers || [])].sort((a,c) => Number(a.from) - Number(c.from));
  for (let i=0;i<sorted.length;i++) {
    const r=sorted[i];
    if (r.from == null || r.to == null || r.from < 0 || r.to <= r.from || r.to > b.totalDepth) issues.push(`Invalid layer ${i+1}`);
    if (i && r.from < sorted[i-1].to) issues.push(`Overlap at ${r.from} m`);
    if (i && r.from > sorted[i-1].to) issues.push(`Gap from ${sorted[i-1].to} to ${r.from} m`);
  }
  if (b.monitoringWell && (b.screenTop == null || b.screenBottom == null || b.screenTop < 0 || b.screenBottom > b.totalDepth || b.screenBottom <= b.screenTop)) issues.push('Invalid screen interval');
  if (b.importNotes?.length) issues.push(...b.importNotes.slice(0,2));
  const e = $('validationSummary');
  e.textContent = issues.length ? `${issues.length} review item(s): ${issues.slice(0,2).join('; ')}` : 'No validation warnings';
  e.className = `validation-summary ${issues.length ? 'warn' : 'ok'}`;
}

function renderBoreholeSvgString(b, ppm = 90) {
  ensureBhShape(b);
  const top=120, w=980, depth=Math.max(0.1, Number(b.totalDepth)||1), y=d=>top+Math.max(0,Number(d)||0)*ppm;
  const shortLayers=b.layers.filter(r=>r.from!=null&&r.to!=null&&(Number(r.to)-Number(r.from))*ppm<34);
  const bottomPad=75+shortLayers.length*30, h=top+depth*ppm+bottomPad, bottomY=y(depth), prefix=safeSvgId(b.id);
  const patterns=`<defs>
    <pattern id="${prefix}_FILL" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 0L12 12M12 0L0 12" stroke="#333" stroke-width="1"/></pattern>
    <pattern id="${prefix}_SILT" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M2 0V8M6 0V8" stroke="#444" stroke-width=".8"/></pattern>
    <pattern id="${prefix}_CLAYEY_SILT" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 10L10 0M-3 3L3-3M7 13L13 7" stroke="#444" stroke-width=".8"/></pattern>
    <pattern id="${prefix}_SAND" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".8"/><circle cx="7" cy="7" r=".8"/></pattern>
    <pattern id="${prefix}_GRAVEL" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2" fill="none" stroke="#444"/><circle cx="11" cy="10" r="2.5" fill="none" stroke="#444"/></pattern>
    <pattern id="${prefix}_ASPHALT" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#333"/><circle cx="2" cy="2" r=".6" fill="#fff"/></pattern>
    <pattern id="${prefix}_DEFAULT" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 5H10" stroke="#555" stroke-width=".7"/></pattern>
  </defs>`;
  let s=`<svg class="borehole-sheet-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${patterns}`;
  s+=`<rect width="${w}" height="${h}" fill="white"/><text x="30" y="35" font-size="22" font-weight="700">${esc(state.project.name)}</text><text x="30" y="58" font-size="12">Project: ${esc(state.project.number)} | ${esc(state.project.location)}</text><text x="950" y="35" text-anchor="end" font-size="20" font-weight="700">${esc(b.name)}</text><text x="950" y="58" text-anchor="end" font-size="12">Depth ${depth.toFixed(2)} m${b.drillingMethod ? ` | ${esc(b.drillingMethod)}` : ''}</text>`;
  const cols=[40,105,180,285,365,575,805,940];
  cols.forEach(x=>s+=`<line x1="${x}" y1="85" x2="${x}" y2="${bottomY}" stroke="#222"/>`);
  s+=`<line x1="40" y1="85" x2="940" y2="85" stroke="#222"/><line x1="40" y1="${bottomY}" x2="940" y2="${bottomY}" stroke="#222"/>`;
  [[72,'DEPTH'],[142,'SAMPLE'],[232,'ANALYSES'],[325,'PID / SPT'],[470,'LITHOLOGY & MATERIAL DESCRIPTION'],[690,'WELL CONSTRUCTION']].forEach(([x,t])=>s+=`<text x="${x}" y="105" text-anchor="middle" font-size="11" font-weight="700">${t}</text>`);
  for(let d=0;d<=Math.ceil(depth*10)/10;d+=.1){const yy=y(d),major=Math.abs(d-Math.round(d))<.001;s+=`<line x1="${major?40:52}" y1="${yy}" x2="65" y2="${yy}" stroke="#333" stroke-width="${major?1.2:.5}"/>`;if(major&&d<=depth+.001)s+=`<text x="36" y="${yy+4}" text-anchor="end" font-size="11">${Math.round(d)}</text>`;}

  let calloutIndex=0;
  [...b.layers].sort((a,c)=>Number(a.from)-Number(c.from)).forEach((r,i)=>{
    if(r.from==null||r.to==null||r.to<=r.from)return;
    const yy=y(r.from), hh=Math.max(1,(r.to-r.from)*ppm), key=(r.material||'DEFAULT').replace(/\s/g,'_'), known=['FILL','SILT','CLAYEY_SILT','SAND','GRAVEL','ASPHALT'].includes(key), clip=`${prefix}_layer_${i}`;
    s+=`<clipPath id="${clip}"><rect x="410" y="${yy+1}" width="164" height="${Math.max(0,hh-2)}"/></clipPath><rect x="365" y="${yy}" width="45" height="${hh}" fill="url(#${prefix}_${known?key:'DEFAULT'})" stroke="#222"/><rect x="410" y="${yy}" width="165" height="${hh}" fill="white" stroke="#222"/>`;
    if(hh>=34){
      const lines=[r.material||'',...wrapWords(r.description,28),r.moisture||''].filter(Boolean);
      const maxLines=Math.max(1,Math.floor((hh-8)/14));
      lines.slice(0,maxLines).forEach((line,idx)=>s+=`<text x="418" y="${yy+15+idx*14}" font-size="${idx===0?11:9.5}" font-weight="${idx===0?'700':'400'}" clip-path="url(#${clip})">${esc(line)}</text>`);
    } else {
      const cy=bottomY+22+calloutIndex*30; calloutIndex++;
      s+=`<path d="M410 ${yy+hh/2} L430 ${cy-4}" fill="none" stroke="#555" stroke-width=".8"/><text x="438" y="${cy}" font-size="10" font-weight="700">${esc(r.material||'Layer')} ${Number(r.from).toFixed(2)}–${Number(r.to).toFixed(2)} m</text>`;
      if(r.description)s+=`<text x="438" y="${cy+12}" font-size="9">${esc(wrapWords(r.description,55)[0]||'')}</text>`;
    }
  });

  b.samples.forEach((r,i)=>{
    const from=numOrNull(r.from),to=numOrNull(r.to);
    if(from==null||to==null||to<=from)return;
    const yy=y(from),hh=Math.max(14,(to-from)*ppm),clipA=`${prefix}_sample_${i}`,clipB=`${prefix}_analysis_${i}`;
    s+=`<clipPath id="${clipA}"><rect x="106" y="${yy+1}" width="73" height="${hh-2}"/></clipPath><clipPath id="${clipB}"><rect x="181" y="${yy+1}" width="103" height="${hh-2}"/></clipPath><rect x="105" y="${yy}" width="75" height="${hh}" fill="white" stroke="#222"/><rect x="180" y="${yy}" width="105" height="${hh}" fill="white" stroke="#222"/>`;
    if(r.sampleId)s+=`<text x="142" y="${yy+14}" text-anchor="middle" font-size="9.5" clip-path="url(#${clipA})">${esc(r.sampleId)}</text>`;
    wrapWords(r.analyses,18).slice(0,Math.max(1,Math.floor((hh-6)/12))).forEach((line,j)=>s+=`<text x="185" y="${yy+13+j*12}" font-size="8.5" clip-path="url(#${clipB})">${esc(line)}</text>`);
  });

  b.tests.forEach(r=>{
    const dd=numOrNull(r.depth); if(dd==null||dd<0||dd>depth)return;
    const yy=y(dd), parts=[];
    if(String(r.blows||'').trim())parts.push(`SPT ${esc(r.blows)}`);
    if(r.n!=null)parts.push(`N=${esc(r.n)}`);
    if(r.pid!=null)parts.push(`PID ${esc(r.pid)} ppm`);
    if(!parts.length)return;
    s+=`<line x1="285" y1="${yy}" x2="365" y2="${yy}" stroke="#777"/><text x="325" y="${Math.max(116,yy-4)}" text-anchor="middle" font-size="8.5">${parts.join(' / ')}</text>`;
  });

  if(b.monitoringWell&&b.screenTop!=null&&b.screenBottom!=null){
    const cx=700,st=y(b.screenTop),sb=y(b.screenBottom);
    s+=`<rect x="${cx-9}" y="${y(0)}" width="18" height="${Math.max(0,st-y(0))}" fill="#fff" stroke="#222"/><rect x="${cx-9}" y="${st}" width="18" height="${Math.max(1,sb-st)}" fill="#fff" stroke="#222"/>`;
    for(let yy=st+5;yy<sb;yy+=8)s+=`<line x1="${cx-8}" y1="${yy}" x2="${cx+8}" y2="${yy}" stroke="#555"/>`;
    s+=`<text x="735" y="${Math.min(bottomY-6,st+15)}" font-size="9.5">PVC Screen</text>`;
    if(b.waterDepth!=null){const wy=y(b.waterDepth);s+=`<path d="M${cx-22} ${wy}h44l-22 15z" fill="#2b91d1" opacity=".8"/><text x="735" y="${Math.min(bottomY-4,wy+4)}" font-size="9" fill="#1b6f9e">Water ${esc(b.waterDepth)} m</text>`;}
  }
  s+=`<text x="490" y="${h-18}" text-anchor="middle" font-size="10" font-weight="700">End of borehole at ${depth.toFixed(2)} m</text></svg>`;
  return s;
}
function renderSvg(){ $('boreholeSvgHost').innerHTML=renderBoreholeSvgString(active(),Number($('scaleSelect').value)); }

function renderImportedFiles(){
  const wrap=$('importedFilesList');
  if(!state.importedFiles.length){wrap.innerHTML='<span class="file-empty">No imported source files in this project.</span>';return;}
  wrap.innerHTML=state.importedFiles.map(f=>{
    const count=state.boreholes.filter(b=>b.sourceFileId===f.id).length;
    return `<div class="file-chip" data-id="${f.id}"><div><strong>${esc(f.name)}</strong><small>${count} borehole(s)</small></div><button data-act="replace">Replace</button><button data-act="remove" class="danger-btn">Remove</button></div>`;
  }).join('');
  wrap.querySelectorAll('button').forEach(btn=>btn.onclick=()=>{
    const id=btn.closest('.file-chip').dataset.id;
    if(btn.dataset.act==='remove') removeImportedFile(id,true);
    else {replaceTargetId=id;$('replaceFile').value='';$('replaceFile').click();}
  });
}
function removeImportedFile(id,ask=false){
  const f=state.importedFiles.find(x=>x.id===id); if(!f)return;
  if(ask&&!confirm(`Remove ${f.name} and its imported boreholes?`))return;
  state.importedFiles=state.importedFiles.filter(x=>x.id!==id);
  state.boreholes=state.boreholes.filter(b=>b.sourceFileId!==id);
  if(!state.boreholes.length)state.boreholes.push(blankBh('BH1'));
  state.activeId=state.boreholes[0].id; save();
}

function download(name,content,type='text/plain'){
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function exportCsv(){
  const rows=[['Borehole','From','To','Material','Moisture','Description']];
  state.boreholes.forEach(b=>b.layers.forEach(r=>rows.push([b.name,r.from,r.to,r.material,r.moisture,r.description])));
  download('borehole-lithology.csv',rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n'),'text/csv');
}
function exportDxf(){
  const b=active(),scale=1000,lines=['0','SECTION','2','HEADER','0','ENDSEC','0','SECTION','2','ENTITIES'];
  const addLine=(x1,y1,x2,y2,layer)=>lines.push('0','LINE','8',layer,'10',String(x1),'20',String(y1),'11',String(x2),'21',String(y2));
  const addText=(x,y,t,h=120,layer='TEXT')=>lines.push('0','TEXT','8',layer,'10',String(x),'20',String(y),'40',String(h),'1',String(t).replace(/[^\x20-\x7E]/g,'?'));
  addText(0,1000,b.name,220,'HEADER');
  b.layers.forEach(r=>{if(r.from==null||r.to==null)return;const y1=-r.from*scale,y2=-r.to*scale;addLine(0,y1,400,y1,'LITHOLOGY');addLine(0,y2,400,y2,'LITHOLOGY');addLine(0,y1,0,y2,'LITHOLOGY');addLine(400,y1,400,y2,'LITHOLOGY');addText(430,(y1+y2)/2,`${r.material||''}${r.description?` - ${r.description}`:''}`,100,'TEXT');});
  addLine(0,0,0,-b.totalDepth*scale,'DEPTH');lines.push('0','ENDSEC','0','EOF');download(`${b.name.replace(/\W/g,'_')}.dxf`,lines.join('\n'),'application/dxf');
}

function openPublish(){
  $('publishModal').classList.remove('hidden');
  $('publishList').innerHTML=state.boreholes.map((b,i)=>`<label class="publish-item"><input type="checkbox" value="${b.id}" checked><span>${esc(b.name)}</span><small>${Number(b.totalDepth).toFixed(2)} m</small></label>`).join('');
  updatePublishCount();
  $('publishList').querySelectorAll('input').forEach(x=>x.onchange=updatePublishCount);
}
function updatePublishCount(){const n=$('publishList').querySelectorAll('input:checked').length;$('publishCount').textContent=`${n} sheet(s) selected`;}
function executePublish(){
  const ids=[...$('publishList').querySelectorAll('input:checked')].map(x=>x.value);if(!ids.length)return alert('Select at least one sheet.');
  const sheets=ids.map(id=>state.boreholes.find(b=>b.id===id)).filter(Boolean);
  $('printSheetArea').innerHTML=sheets.map((b,i)=>`<section class="print-sheet">${renderBoreholeSvgString(b,Number($('printScale').value))}<div class="page-number">Sheet ${i+1} of ${sheets.length} — ${esc(b.name)}</div></section>`).join('');
  const size=$('paperSize').value,orientation=$('paperOrientation').value;
  $('dynamicPrintStyle').textContent=`@page { size: ${size} ${orientation}; margin: 8mm; }`;
  $('publishModal').classList.add('hidden');setTimeout(()=>window.print(),120);
}

function bind(){
  ['projectName','projectNumber','projectLocation'].forEach(id=>$(id).onchange=()=>{const key={projectName:'name',projectNumber:'number',projectLocation:'location'}[id];state.project[key]=$(id).value;save();});
  const map={bhId:'name',bhDepth:'totalDepth',groundElevation:'groundElevation',drillingMethod:'drillingMethod',drillDate:'drillDate',screenTop:'screenTop',screenBottom:'screenBottom',waterDepth:'waterDepth'};
  Object.entries(map).forEach(([id,k])=>$(id).onchange=()=>{active()[k]=$(id).type==='number'?numOrNull($(id).value):$(id).value;if(k==='totalDepth'){active().totalDepth=Math.max(.1,active().totalDepth||1);active().totalDepthKnown=true;}save();});
  $('isMonitoringWell').onchange=()=>{active().monitoringWell=$('isMonitoringWell').checked;save();};
  $('scaleSelect').onchange=renderSvg;
  $('addBoreholeBtn').onclick=()=>{const b=blankBh(`BH${state.boreholes.length+1}`,1,false);state.boreholes.push(b);state.activeId=b.id;save();};
  $('addLayerBtn').onclick=()=>{const b=active(),from=b.layers.length?Math.max(...b.layers.map(x=>Number(x.to)||0)):0;b.layers.push({id:uid(),from,to:Math.min(b.totalDepth,from+1),material:'',moisture:'',description:''});save();};
  $('addSampleBtn').onclick=()=>{active().samples.push({id:uid(),from:null,to:null,sampleId:'',analyses:''});save();};
  $('addTestBtn').onclick=()=>{active().tests.push({id:uid(),depth:null,blows:'',n:null,pid:null});save();};
  $('saveBtn').onclick=()=>save();
  $('newProjectBtn').onclick=()=>{if(confirm('Start a new blank project? This clears the current local project.')){state=blankState();save();}};
  $('exportJsonBtn').onclick=()=>download('borehole-project.json',JSON.stringify(state,null,2),'application/json');
  $('exportCsvBtn').onclick=exportCsv;$('exportDxfBtn').onclick=exportDxf;
  $('printBtn').onclick=openPublish;$('browseBtn').onclick=()=>$('importFile').click();$('importBtn').onclick=()=>$('importFile').click();
  $('importFile').onchange=e=>{const files=[...e.target.files];e.target.value='';handleFiles(files);};
  $('replaceFile').onchange=e=>{const files=[...e.target.files];e.target.value='';if(files.length)handleFiles([files[0]],replaceTargetId);};
  $('clearImportedBtn').onclick=()=>{if(!state.importedFiles.length)return;if(confirm('Remove all imported source files and all boreholes created from them?')){const ids=new Set(state.importedFiles.map(f=>f.id));state.importedFiles=[];state.boreholes=state.boreholes.filter(b=>!ids.has(b.sourceFileId));if(!state.boreholes.length)state.boreholes.push(blankBh('BH1'));state.activeId=state.boreholes[0].id;save();}};
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab,.tab-content').forEach(x=>x.classList.remove('active'));t.classList.add('active');$(t.dataset.tab+'Tab').classList.add('active');});
  $('closePublishBtn').onclick=()=>$('publishModal').classList.add('hidden');$('cancelPublishBtn').onclick=()=>$('publishModal').classList.add('hidden');
  $('selectAllSheetsBtn').onclick=()=>{$('publishList').querySelectorAll('input').forEach(x=>x.checked=true);updatePublishCount();};
  $('selectNoSheetsBtn').onclick=()=>{$('publishList').querySelectorAll('input').forEach(x=>x.checked=false);updatePublishCount();};
  $('runPublishBtn').onclick=executePublish;
}

// ---------- Multi-format import ----------
const dropZone=$('dropZone');
['dragenter','dragover'].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.add('dragover');}));
['dragleave','drop'].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.remove('dragover');}));
dropZone.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
$('closeImportBtn').onclick=$('cancelImportBtn').onclick=()=>{$('importPanel').classList.add('hidden');pendingImport=[];pendingSources=[];replaceTargetId=null;};
$('applyImportBtn').onclick=applyPendingImport;
function setImportStatus(text,pct=0){$('importStatus').textContent=text;$('progressBar').style.width=`${Math.max(0,Math.min(100,pct))}%`;}
function blankImportedBh(name='Imported BH',depth=1,known=false){const b=blankBh(name,Math.max(.1,Number(depth)||1),/\bMW\b|\(MW\)/i.test(name));b.totalDepthKnown=known;b.layers=[];b.samples=[];b.tests=[];b.importConfidence='low';return b;}

async function handleFiles(files,replaceId=null){
  if(!files.length)return;
  pendingImport=[];pendingSources=[];replaceTargetId=replaceId||null;
  $('importPanel').classList.remove('hidden');$('extractedList').innerHTML='';$('rawText').value='';$('sourcePreview').innerHTML='No preview';
  for(let i=0;i<files.length;i++){
    const f=files[i],sourceId=uid(),base=Math.round(i/files.length*100);
    try{
      setImportStatus(`Reading ${f.name}…`,base);const ext=f.name.split('.').pop().toLowerCase();let result;
      if(ext==='json')result=await importJsonFile(f);else if(['xlsx','xls','csv'].includes(ext))result=await importSpreadsheet(f);else if(ext==='pdf')result=await importPdf(f);else if(['png','jpg','jpeg','webp'].includes(ext))result=await importImage(f);else throw new Error('Unsupported file type');
      result.boreholes.forEach(b=>b.sourceFileId=sourceId);pendingImport.push(...result.boreholes);pendingSources.push({id:sourceId,name:f.name,type:ext,importedAt:new Date().toISOString()});
      $('rawText').value+=`\n--- ${f.name} ---\n${result.rawText||''}\n`;
    }catch(err){$('rawText').value+=`\n${f.name}: ERROR - ${err.message}\n`;}
  }
  renderExtractedReview();setImportStatus(`${pendingImport.length} borehole(s) ready for review`,100);
}
async function importJsonFile(file){
  const obj=JSON.parse(await file.text());if(!Array.isArray(obj.boreholes))throw new Error('Invalid Borehole Log Studio JSON');
  return {boreholes:obj.boreholes.map(b=>ensureBhShape({...b,id:uid()})),rawText:'Structured project JSON loaded.'};
}
async function importSpreadsheet(file){
  setImportStatus(`Parsing spreadsheet ${file.name}…`,30);const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array'});let rows=[];
  wb.SheetNames.forEach(sn=>rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''}).map(r=>({...r,__sheet:sn}))));if(!rows.length)throw new Error('No rows found');
  const key=(row,names)=>{const keys=Object.keys(row);const k=keys.find(k=>names.some(n=>k.toLowerCase().replace(/[^a-z0-9]/g,'').includes(n)));return k?row[k]:'';};
  const groups=new Map();rows.forEach(r=>{const name=String(key(r,['borehole','bhid','wellid','locationid'])||r.__sheet||'Imported BH').trim();if(!groups.has(name))groups.set(name,[]);groups.get(name).push(r);});
  const boreholes=[];
  for(const [name,rs] of groups){
    const explicitDepths=rs.flatMap(r=>[numOrNull(key(r,['todepth','bottomdepth','enddepth','depthto','totaldepth'])),numOrNull(key(r,['fromdepth','topdepth','depthfrom']))]).filter(v=>v!=null&&v>0),depth=explicitDepths.length?Math.max(...explicitDepths):1,b=blankImportedBh(name,depth,explicitDepths.length>0);
    rs.forEach(r=>{
      const from=numOrNull(key(r,['fromdepth','topdepth','depthfrom','from'])),to=numOrNull(key(r,['todepth','bottomdepth','depthto','to'])),desc=String(key(r,['description','materialdescription','soildescription','lithology'])||'').trim(),matRaw=String(key(r,['material','soiltype','uscs','lithology'])||'').trim(),mat=normalizeMaterial(matRaw||desc),sid=String(key(r,['sampleid','labsample','sampleno'])||'').trim(),analyses=String(key(r,['analyses','analysis','testsrequested','parameters'])||'').trim(),pid=numOrNull(key(r,['pid','headspace'])),n=numOrNull(key(r,['nvalue','sptn'])),blows=String(key(r,['blows','sptblows'])||'').trim();
      if(from!=null&&to!=null&&to>from&&(mat||desc))b.layers.push({id:uid(),from,to,material:mat,moisture:String(key(r,['moisture','condition'])||'').trim(),description:desc});
      if(sid)b.samples.push({id:uid(),from,to,sampleId:sid,analyses});
      if(pid!=null||n!=null||blows)b.tests.push({id:uid(),depth:to??from,blows,n,pid});
    });
    if(!b.layers.length)b.importNotes.push('No explicit lithology depth intervals were mapped from this spreadsheet.');
    b.importConfidence=b.layers.length?'high':'medium';boreholes.push(b);
  }
  return {boreholes,rawText:`Sheets: ${wb.SheetNames.join(', ')}\nRows: ${rows.length}`};
}
async function importPdf(file){
  setImportStatus(`Extracting PDF text from ${file.name}…`,15);const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;let all='',firstCanvas=null;
  for(let p=1;p<=pdf.numPages;p++){
    setImportStatus(`Reading PDF page ${p} of ${pdf.numPages}…`,15+55*p/pdf.numPages);const page=await pdf.getPage(p),tc=await page.getTextContent();let text=tc.items.map(i=>i.str).join(' ');
    if(text.trim().length<30){const cv=document.createElement('canvas'),vp=page.getViewport({scale:1.7});cv.width=vp.width;cv.height=vp.height;await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;const o=await recognizeOffline(cv);text=o.data.text;if(!firstCanvas)firstCanvas=cv;}
    else if(p===1){const cv=document.createElement('canvas'),vp=page.getViewport({scale:1.1});cv.width=vp.width;cv.height=vp.height;await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;firstCanvas=cv;}
    all+=`\n[PAGE ${p}]\n${text}`;
  }
  if(firstCanvas){$('sourcePreview').innerHTML='';$('sourcePreview').appendChild(firstCanvas);}return {boreholes:parseBoreholeText(all),rawText:all};
}
async function importImage(file){const url=URL.createObjectURL(file);$('sourcePreview').innerHTML=`<img src="${url}" alt="source">`;const result=await recognizeOffline(file);return {boreholes:parseBoreholeText(result.data.text),rawText:result.data.text};}

function parseBoreholeText(text){
  const clean=String(text||'').replace(/\r/g,'\n'),idRe=/\b(?:BH|MW|TP)\s*[-#]?\s*\d+[A-Z]?(?:\s*\(MW\))?/gi,matches=[...clean.matchAll(idRe)],groups=new Map();
  if(matches.length){matches.forEach((m,i)=>{const id=m[0].replace(/\s+/g,''),chunk=clean.slice(m.index,i+1<matches.length?matches[i+1].index:undefined);groups.set(id,(groups.get(id)||'')+'\n'+chunk);});}else groups.set('Imported BH1',clean);
  const materialPattern='ASPHALT|CONCRETE|CLAYEY\\s+SILT|SANDY\\s+SILT|SILTY\\s+SAND|SILTY\\s+CLAY|ORGANIC\\s+SOIL|GRAVEL|SAND|SILT|CLAY|TILL|BEDROCK|FILL';
  return [...groups.entries()].map(([id,t])=>{
    const endMatch=t.match(/(?:End of borehole at|Total Depth|Termination Depth)\s*[:@]?\s*(\d+(?:\.\d+)?)\s*m?/i),rangeRe=new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:-|–|—|to)\\s*(\\d+(?:\\.\\d+)?)\\s*m?\\s*[:\\-]?\\s*(${materialPattern})\\b([^\\n]{0,120})`,'gi'),ranges=[...t.matchAll(rangeRe)],rangeDepth=ranges.length?Math.max(...ranges.map(m=>Number(m[2]))):null,depth=endMatch?Number(endMatch[1]):rangeDepth,b=blankImportedBh(id,depth||1,!!depth);
    const water=t.match(/(?:water depth|groundwater|gwl)\s*[:@]?\s*(\d+(?:\.\d+)?)/i);if(water)b.waterDepth=Number(water[1]);
    const screen=t.match(/screen[^\d]{0,25}(\d+(?:\.\d+)?)[^\d]{1,12}(\d+(?:\.\d+)?)/i);if(screen){b.monitoringWell=true;b.screenTop=Number(screen[1]);b.screenBottom=Number(screen[2]);}
    ranges.forEach(m=>{const from=Number(m[1]),to=Number(m[2]),material=normalizeMaterial(m[3]);if(to>from)b.layers.push({id:uid(),from,to,material,moisture:/very moist/i.test(m[4])?'Very moist':/moist/i.test(m[4])?'Moist':/dry/i.test(m[4])?'Dry':'',description:String(m[4]||'').trim().replace(/^[:\-\s]+/,'')});});
    if(!b.layers.length){const found=[...new Set([...t.matchAll(new RegExp(`\\b(${materialPattern})\\b`,'gi'))].map(m=>normalizeMaterial(m[1])).filter(Boolean))];if(found.length)b.importNotes.push(`Materials detected but no explicit depth intervals were mapped: ${found.join(', ')}.`);else b.importNotes.push('No explicit lithology intervals were detected.');}
    if(!depth)b.importNotes.push('Total depth was not explicitly detected; review the placeholder depth.');

    const sampleRe=/\b(?:BH|MW|TP)\s*\d+[A-Z]?\s*[-_]\s*(?:SS\s*)?\d+\b/gi,seen=new Set();
    for(const sm of t.matchAll(sampleRe)){
      const sid=sm[0].replace(/\s+/g,''),key=sid.toUpperCase();if(seen.has(key)||key===id.toUpperCase())continue;seen.add(key);
      const context=t.slice(Math.max(0,sm.index-90),Math.min(t.length,sm.index+180)),analyses=ANALYSIS_TERMS.filter(term=>new RegExp(`\\b${term.replace(/\s+/g,'\\s*')}\\b`,'i').test(context)).join(', '),dm=context.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/i);
      b.samples.push({id:uid(),from:dm?Number(dm[1]):null,to:dm?Number(dm[2]):null,sampleId:sid,analyses});
    }
    const sptRe=/SPT[^\n]{0,60}?(?:N\s*[=:]?\s*(\d+))?/gi;for(const m of t.matchAll(sptRe)){const context=m[0],blow=context.match(/(\d+\s*[-\/]\s*\d+\s*[-\/]\s*\d+)/),n=context.match(/N\s*[=:]?\s*(\d+)/i),near=t.slice(Math.max(0,m.index-40),m.index+100).match(/(\d+(?:\.\d+)?)\s*m\b/i);if(blow||n)b.tests.push({id:uid(),depth:near?Number(near[1]):null,blows:blow?blow[1]:'',n:n?Number(n[1]):null,pid:null});}
    const pidRe=/PID\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:ppm)?/gi;for(const m of t.matchAll(pidRe)){const near=t.slice(Math.max(0,m.index-40),m.index+80).match(/(\d+(?:\.\d+)?)\s*m\b/i);b.tests.push({id:uid(),depth:near?Number(near[1]):null,blows:'',n:null,pid:Number(m[1])});}
    b.importConfidence=b.layers.length&&b.totalDepthKnown?'high':(b.layers.length||b.samples.length?'medium':'low');return b;
  });
}
function renderExtractedReview(){
  $('extractedList').innerHTML=pendingImport.map((b,i)=>`<div class="extract-card" data-i="${i}"><div><strong>${esc(b.name)}</strong> <span class="confidence ${b.importConfidence||'low'}">${b.importConfidence||'low'} confidence</span></div><div class="extract-card-grid"><label>Borehole ID<input data-k="name" value="${esc(b.name)}"></label><label>Total depth (m)<input data-k="totalDepth" type="number" step=".01" value="${b.totalDepth}"></label><label>Mapped layers<input disabled value="${b.layers.length}"></label></div>${b.importNotes?.length?`<div class="extract-notes">${b.importNotes.map(x=>esc(x)).join('<br>')}</div>`:''}</div>`).join('');
  $('extractedList').querySelectorAll('input[data-k]').forEach(inp=>inp.onchange=()=>{const b=pendingImport[Number(inp.closest('.extract-card').dataset.i)];b[inp.dataset.k]=inp.type==='number'?Number(inp.value):inp.value;if(inp.dataset.k==='totalDepth')b.totalDepthKnown=true;});
}
function applyPendingImport(){
  if(!pendingImport.length)return alert('No boreholes were extracted. Review the raw text or use manual entry.');
  if(replaceTargetId)removeImportedFile(replaceTargetId,false);
  const sourceIds=new Set(pendingSources.map(s=>s.id));
  state.boreholes=state.boreholes.filter(b=>!(state.boreholes.length===1&&!b.sourceFileId&&!b.layers.length&&!b.samples.length&&!b.tests.length&&b.name==='BH1'));
  pendingImport.forEach(b=>{b.id=uid();b.layers=(b.layers||[]).map(x=>({...x,id:uid()}));b.samples=(b.samples||[]).map(x=>({...x,id:uid()}));b.tests=(b.tests||[]).map(x=>({...x,id:uid()}));state.boreholes.push(b);});
  state.importedFiles.push(...pendingSources.filter(s=>sourceIds.has(s.id)));
  if(!state.boreholes.length)state.boreholes.push(blankBh('BH1'));
  state.activeId=state.boreholes[Math.max(0,state.boreholes.length-pendingImport.length)].id;pendingImport=[];pendingSources=[];replaceTargetId=null;$('importPanel').classList.add('hidden');save();
}

bind();renderAll();