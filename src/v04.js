import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STORAGE_KEY = 'boreholeLogStudio';
const AI_KEY_SESSION = 'blsGeminiKeySession';
const AI_KEY_LOCAL = 'blsGeminiKeyLocal';
const UNIT_KEY = 'blsDepthUnitMode';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const FT_TO_M = 0.3048;
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

let aiPages = [];
let aiResults = [];
let aiSourceName = '';
let axisRendering = false;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
}
function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function ftToM(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value) * FT_TO_M;
}
function mToFt(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value) / FT_TO_M;
}
function parseFeetValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).trim();
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches))?/i);
  if (!m) return null;
  const feet = Number(m[1] || 0), inches = Number(m[2] || 0);
  return feet + inches / 12;
}
function normalizeMaterial(value = '') {
  const u = String(value).toUpperCase().replace(/\s+/g, ' ').trim();
  const materials = ['ASPHALT','CONCRETE','FILL','GRAVEL','SAND','SILTY SAND','SILT','SANDY SILT','CLAYEY SILT','CLAY','SILTY CLAY','TILL','ORGANIC SOIL','BEDROCK'];
  return [...materials].sort((a,b)=>b.length-a.length).find(m=>u.includes(m)) || u;
}

function installVersionBadge() {
  const h1 = document.querySelector('.topbar h1');
  if (!h1) return;
  const existing = h1.querySelector('.version');
  if (existing) existing.textContent = 'v0.4';
  else h1.insertAdjacentHTML('beforeend', ' <span class="version">v0.4</span>');
}

function installUnitControl() {
  const header = document.querySelector('.workspace-header');
  if (!header || $('v04UnitMode')) return;
  const holder = document.createElement('div');
  holder.className = 'v04-unit-holder';
  holder.innerHTML = `<label>Depth Axis
    <select id="v04UnitMode">
      <option value="dual">Metres + Feet</option>
      <option value="metric">Metres</option>
      <option value="imperial">Feet</option>
    </select>
  </label>`;
  header.appendChild(holder);
  const select = $('v04UnitMode');
  select.value = localStorage.getItem(UNIT_KEY) || 'dual';
  select.onchange = () => { localStorage.setItem(UNIT_KEY, select.value); applyDepthAxis(); };
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, String(v)));
  return el;
}
function applyDepthAxis() {
  if (axisRendering) return;
  const host = $('boreholeSvgHost');
  const svg = host?.querySelector('svg');
  if (!svg) return;
  axisRendering = true;
  try {
    svg.querySelector('#v04-depth-axis')?.remove();
    const mode = localStorage.getItem(UNIT_KEY) || 'dual';
    const state = loadState();
    const b = state?.boreholes?.find(x => x.id === state.activeId) || state?.boreholes?.[0];
    if (!b) return;
    const depthM = Math.max(0.1, Number(b.totalDepth) || 0.1);
    const ppm = Number($('scaleSelect')?.value) || 90;
    const top = 120;
    const g = svgEl('g', { id: 'v04-depth-axis', 'font-family': 'Segoe UI, Arial, sans-serif' });

    const metricLabels = [...svg.querySelectorAll('text')].filter(t => t.getAttribute('x') === '36');
    metricLabels.forEach(t => t.setAttribute('visibility', mode === 'imperial' ? 'hidden' : 'visible'));

    if (mode !== 'imperial') {
      const label = svgEl('text', { x: 36, y: 116, 'text-anchor': 'end', 'font-size': 8.5, 'font-weight': 700, fill: '#334155' });
      label.textContent = 'm'; g.appendChild(label);
    }

    if (mode !== 'metric') {
      const ftLabel = svgEl('text', { x: 101, y: 116, 'text-anchor': 'end', 'font-size': 8.5, 'font-weight': 700, fill: '#334155' });
      ftLabel.textContent = 'ft'; g.appendChild(ftLabel);
      const maxFt = Math.ceil(mToFt(depthM));
      for (let ft = 0; ft <= maxFt; ft += 1) {
        const m = ft * FT_TO_M;
        if (m > depthM + 0.001) break;
        const y = top + m * ppm;
        const major = ft % 5 === 0;
        g.appendChild(svgEl('line', {
          x1: major ? 79 : 91, y1: y, x2: 104, y2: y,
          stroke: '#475569', 'stroke-width': major ? 1 : 0.55
        }));
        if (major) {
          const txt = svgEl('text', { x: 76, y: y + 3, 'text-anchor': 'end', 'font-size': 8.5, fill: '#334155' });
          txt.textContent = String(ft); g.appendChild(txt);
        }
      }
    }
    svg.appendChild(g);
  } finally {
    axisRendering = false;
  }
}

function observeSvg() {
  const host = $('boreholeSvgHost');
  if (!host) return;
  const observer = new MutationObserver(() => setTimeout(applyDepthAxis, 0));
  observer.observe(host, { childList: true, subtree: false });
  $('scaleSelect')?.addEventListener('change', () => setTimeout(applyDepthAxis, 0));
  setTimeout(applyDepthAxis, 50);
}

function installAiButton() {
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar || $('v04AiBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'v04AiBtn'; btn.className = 'primary'; btn.textContent = 'AI Handwriting Assistant';
  btn.onclick = openAiModal;
  toolbar.appendChild(btn);
}

function installAiModal() {
  if ($('v04AiModal')) return;
  const modal = document.createElement('section');
  modal.id = 'v04AiModal';
  modal.className = 'v04-ai-modal hidden';
  modal.innerHTML = `
    <div class="v04-ai-card">
      <div class="v04-ai-head">
        <div>
          <h2>AI Handwriting Assistant</h2>
          <p>For difficult handwritten field logs. Offline OCR remains available in the normal Import workflow.</p>
        </div>
        <button id="v04AiClose">×</button>
      </div>
      <div class="v04-ai-privacy">
        <strong>Optional online mode.</strong> No file is sent anywhere until you click <b>Analyze with Vision AI</b>.
        When used, each selected page image is sent directly to Google Gemini using your API key. The app has no relay server.
      </div>
      <div class="v04-ai-grid">
        <label>PDF or image
          <input id="v04AiFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" />
        </label>
        <label>Gemini API key
          <input id="v04AiKey" type="password" autocomplete="off" placeholder="Paste your API key" />
        </label>
        <label>Model
          <input id="v04AiModel" value="gemini-2.5-flash" />
        </label>
        <label class="v04-check"><input id="v04RememberKey" type="checkbox" /> Remember key on this computer</label>
      </div>
      <div class="v04-ai-actions">
        <button id="v04PrepareFile">Prepare Pages</button>
        <button id="v04Analyze" class="primary">Analyze with Vision AI</button>
        <button id="v04Apply" disabled>Add Results to Project</button>
      </div>
      <div class="v04-ai-status"><span id="v04AiStatus">Select a PDF or image.</span><div class="v04-ai-progress"><div id="v04AiBar"></div></div></div>
      <div id="v04AiPreview" class="v04-ai-preview"></div>
      <div id="v04AiResults" class="v04-ai-results"></div>
      <details><summary>Structured AI JSON</summary><textarea id="v04AiRaw" rows="14" spellcheck="false"></textarea></details>
    </div>`;
  document.body.appendChild(modal);

  $('v04AiClose').onclick = closeAiModal;
  $('v04PrepareFile').onclick = prepareAiFile;
  $('v04Analyze').onclick = analyzeWithAi;
  $('v04Apply').onclick = applyAiResults;
  $('v04AiFile').onchange = () => { aiPages = []; aiResults = []; $('v04Apply').disabled = true; setAiStatus('File selected. Click Prepare Pages.', 0); };
}

function openAiModal() {
  $('v04AiModal').classList.remove('hidden');
  $('v04AiKey').value = sessionStorage.getItem(AI_KEY_SESSION) || localStorage.getItem(AI_KEY_LOCAL) || '';
  $('v04RememberKey').checked = !!localStorage.getItem(AI_KEY_LOCAL);
}
function closeAiModal() { $('v04AiModal').classList.add('hidden'); }
function setAiStatus(text, pct = 0) {
  $('v04AiStatus').textContent = text;
  $('v04AiBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
function fileToDataUrl(file) {
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
}
async function renderPdfToPages(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i=1;i<=pdf.numPages;i++) {
    setAiStatus(`Rendering page ${i} of ${pdf.numPages}…`, Math.round(i/pdf.numPages*30));
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const targetWidth = 1800;
    const scale = Math.max(1.6, targetWidth / base.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    pages.push({ pageNumber:i, mimeType:'image/jpeg', dataUrl:canvas.toDataURL('image/jpeg',0.9), width:canvas.width, height:canvas.height });
  }
  return pages;
}
async function prepareAiFile() {
  const file = $('v04AiFile').files?.[0];
  if (!file) return alert('Choose a PDF or image first.');
  aiSourceName = file.name; aiResults = []; $('v04Apply').disabled = true; $('v04AiRaw').value = ''; $('v04AiResults').innerHTML = '';
  try {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) aiPages = await renderPdfToPages(file);
    else aiPages = [{ pageNumber:1, mimeType:file.type || 'image/jpeg', dataUrl:await fileToDataUrl(file) }];
    $('v04AiPreview').innerHTML = aiPages.slice(0,3).map(p=>`<figure><img src="${p.dataUrl}" alt="Page ${p.pageNumber}"><figcaption>Page ${p.pageNumber}</figcaption></figure>`).join('');
    setAiStatus(`${aiPages.length} page(s) prepared. Ready for Vision AI.`, 30);
  } catch (err) { setAiStatus(`Prepare failed: ${err.message}`, 0); }
}

function buildPrompt(pageNumber) {
  return `You are a careful geotechnical/environmental borehole field-log transcription assistant.
This is page ${pageNumber} of a scanned handwritten field log. The form may contain printed grid lines, cursive handwriting, soil descriptions, sample boxes, SPT blow counts, groundwater notes, and a monitoring-well sketch.

Rules:
1. Transcribe only information that is actually visible. Never invent missing values.
2. If a value is uncertain or illegible, use null and explain it in warnings.
3. Depths on this type of field log are commonly handwritten in feet and inches. Convert any feet/inches depth to DECIMAL FEET in the JSON. Example: 2 ft 7 in = 2.5833.
4. Do not invent laboratory analyses such as Metals, PHCs, VOCs, PAHs, BTEX, pH, or Grain Size. Include an analysis only when those exact words/abbreviations are visibly written.
5. Recognize common soil terms when genuinely legible: TOPSOIL, FILL, SAND, SILT, SILTY SAND, SANDY SILT, CLAYEY SILT, CLAY, GRAVEL, TILL, BEDROCK.
6. For each layer, use the written depth range. Do not split the borehole into equal intervals.
7. For monitoring wells, only return riser/screen/water depths that are visibly indicated.
8. Preserve the borehole/page identifier from the form if readable. If not readable, use null.
9. Confidence is 0.0 to 1.0 and should reflect visual certainty.
10. Return ONLY valid JSON, no markdown fences and no prose outside JSON.

Return exactly this shape:
{
  "borehole_id": null,
  "total_depth_ft": null,
  "ground_elevation": null,
  "layers": [
    {"from_ft": null, "to_ft": null, "material": null, "description": null, "moisture": null, "confidence": 0.0, "evidence": null}
  ],
  "samples": [
    {"sample_id": null, "from_ft": null, "to_ft": null, "analyses": [], "confidence": 0.0, "evidence": null}
  ],
  "tests": [
    {"depth_ft": null, "spt_blows": null, "n_value": null, "pid_ppm": null, "confidence": 0.0, "evidence": null}
  ],
  "well": {"monitoring_well": null, "screen_top_ft": null, "screen_bottom_ft": null, "water_depth_ft": null, "confidence": 0.0, "evidence": null},
  "warnings": []
}`;
}
function dataUrlPayload(dataUrl) {
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid page image data.');
  return { mimeType:m[1], data:m[2] };
}
function extractJsonText(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try { return JSON.parse(trimmed); } catch {}
  const first = trimmed.indexOf('{'), last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first,last+1));
  throw new Error('AI response was not valid JSON.');
}
async function callGemini(page, key, model) {
  const img = dataUrlPayload(page.dataUrl);
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({
      contents:[{parts:[{text:buildPrompt(page.pageNumber)},{inline_data:{mime_type:img.mimeType,data:img.data}}]}],
      generationConfig:{temperature:0,responseMimeType:'application/json'}
    })
  });
  if (!response.ok) throw new Error(`Vision AI HTTP ${response.status}: ${await response.text()}`);
  const body = await response.json();
  const text = body?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
  return extractJsonText(text);
}

function aiPageToBorehole(ai, pageNumber, sourceId) {
  const layerDepths = (ai.layers || []).flatMap(x=>[parseFeetValue(x.from_ft),parseFeetValue(x.to_ft)]).filter(v=>v!=null&&v>=0);
  const explicitTotal = parseFeetValue(ai.total_depth_ft);
  const totalFt = explicitTotal ?? (layerDepths.length ? Math.max(...layerDepths) : null);
  const totalM = totalFt != null ? ftToM(totalFt) : 1;
  const b = {
    id:uid(),
    name:String(ai.borehole_id || `AI-Page-${pageNumber}`),
    totalDepth:Math.max(0.1,totalM || 1), totalDepthKnown:totalFt!=null,
    groundElevation:ai.ground_elevation ?? null, drillingMethod:'', drillDate:'',
    monitoringWell:!!ai.well?.monitoring_well,
    screenTop:ftToM(parseFeetValue(ai.well?.screen_top_ft)),
    screenBottom:ftToM(parseFeetValue(ai.well?.screen_bottom_ft)),
    waterDepth:ftToM(parseFeetValue(ai.well?.water_depth_ft)),
    layers:[], samples:[], tests:[], sourceFileId:sourceId,
    importConfidence:'medium',
    importNotes:[...(ai.warnings || []).map(String), 'AI-assisted handwriting extraction: verify low-confidence values against the source image.']
  };
  for (const r of ai.layers || []) {
    const f=parseFeetValue(r.from_ft),t=parseFeetValue(r.to_ft);
    if (f==null||t==null||t<=f) continue;
    b.layers.push({id:uid(),from:ftToM(f),to:ftToM(t),material:normalizeMaterial(r.material||''),moisture:String(r.moisture||''),description:String(r.description||''),confidence:Number(r.confidence)||0,evidence:String(r.evidence||'')});
  }
  for (const r of ai.samples || []) {
    const f=parseFeetValue(r.from_ft),t=parseFeetValue(r.to_ft);
    const analyses=Array.isArray(r.analyses)?r.analyses.filter(Boolean).join(', '):String(r.analyses||'');
    if (!r.sample_id && !analyses) continue;
    b.samples.push({id:uid(),from:ftToM(f),to:ftToM(t),sampleId:String(r.sample_id||''),analyses,confidence:Number(r.confidence)||0,evidence:String(r.evidence||'')});
  }
  for (const r of ai.tests || []) {
    const d=parseFeetValue(r.depth_ft);
    if (d==null && r.spt_blows==null && r.n_value==null && r.pid_ppm==null) continue;
    b.tests.push({id:uid(),depth:ftToM(d),blows:String(r.spt_blows||''),n:r.n_value==null?null:Number(r.n_value),pid:r.pid_ppm==null?null:Number(r.pid_ppm),confidence:Number(r.confidence)||0,evidence:String(r.evidence||'')});
  }
  const confs=[...b.layers,...b.samples,...b.tests].map(x=>Number(x.confidence)).filter(Number.isFinite);
  if (confs.length) {
    const avg=confs.reduce((a,c)=>a+c,0)/confs.length;
    b.importConfidence=avg>=.82?'high':avg>=.6?'medium':'low';
  } else b.importConfidence='low';
  return b;
}

async function analyzeWithAi() {
  if (!aiPages.length) await prepareAiFile();
  if (!aiPages.length) return;
  const key=$('v04AiKey').value.trim(),model=$('v04AiModel').value.trim();
  if (!key) return alert('Enter a Gemini API key.');
  if (!model) return alert('Enter a Gemini model name.');
  if ($('v04RememberKey').checked) { localStorage.setItem(AI_KEY_LOCAL,key); sessionStorage.removeItem(AI_KEY_SESSION); }
  else { sessionStorage.setItem(AI_KEY_SESSION,key); localStorage.removeItem(AI_KEY_LOCAL); }
  aiResults=[];$('v04AiResults').innerHTML='';$('v04AiRaw').value='';$('v04Apply').disabled=true;
  try {
    for (let i=0;i<aiPages.length;i++) {
      setAiStatus(`Analyzing page ${i+1} of ${aiPages.length}…`,30+Math.round((i/aiPages.length)*60));
      const result=await callGemini(aiPages[i],key,model);aiResults.push({pageNumber:aiPages[i].pageNumber,result});
    }
    $('v04AiRaw').value=JSON.stringify(aiResults,null,2);
    renderAiResultSummary();$('v04Apply').disabled=!aiResults.length;setAiStatus(`AI analysis complete: ${aiResults.length} page(s). Review before adding.`,100);
  } catch (err) { setAiStatus(`AI analysis failed: ${err.message}`,30); }
}
function renderAiResultSummary() {
  $('v04AiResults').innerHTML=aiResults.map(({pageNumber,result})=>{
    const layers=result.layers?.length||0,samples=result.samples?.length||0,tests=result.tests?.length||0,warnings=result.warnings||[];
    return `<div class="v04-ai-result"><div><strong>Page ${pageNumber}: ${esc(result.borehole_id||'ID not confidently read')}</strong><span>${layers} layer(s) • ${samples} sample(s) • ${tests} test(s)</span></div>${warnings.length?`<ul>${warnings.slice(0,4).map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}</div>`;
  }).join('');
}
function applyAiResults() {
  if (!aiResults.length) return;
  const state=loadState();
  if (!state || !Array.isArray(state.boreholes)) return alert('Project state is unavailable.');
  state.importedFiles=Array.isArray(state.importedFiles)?state.importedFiles:[];
  const sourceId=uid();
  const boreholes=aiResults.map(x=>aiPageToBorehole(x.result,x.pageNumber,sourceId));
  const placeholder=state.boreholes.length===1 && state.boreholes[0].name==='BH1' && !(state.boreholes[0].layers||[]).length && !(state.boreholes[0].samples||[]).length && !(state.boreholes[0].tests||[]).length;
  if (placeholder) state.boreholes=[];
  state.boreholes.push(...boreholes);
  state.importedFiles.push({id:sourceId,name:aiSourceName||'AI Handwriting Import',type:'ai-vision',importedAt:new Date().toISOString(),assistant:'Gemini Vision'});
  state.activeId=boreholes[0]?.id||state.activeId;state.schemaVersion=Math.max(4,Number(state.schemaVersion)||0);saveState(state);location.reload();
}

function installStyles() {
  if ($('v04Styles')) return;
  const style=document.createElement('style');style.id='v04Styles';style.textContent=`
    .v04-unit-holder{margin-left:auto;margin-right:8px;min-width:145px}.v04-unit-holder label{margin:0}.v04-unit-holder select{margin-top:3px}
    .v04-ai-modal{position:fixed;inset:0;z-index:120;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:22px}.v04-ai-card{width:min(1040px,97vw);max-height:94vh;overflow:auto;background:#fff;border-radius:16px;padding:18px;box-shadow:0 24px 80px rgba(0,0,0,.38)}.v04-ai-head{display:flex;justify-content:space-between;align-items:flex-start}.v04-ai-head h2{margin:0}.v04-ai-head p{margin:4px 0;color:#5e6b76}.v04-ai-head>button{font-size:24px}.v04-ai-privacy{margin:12px 0;padding:10px 12px;background:#fff8e7;border:1px solid #ecd69a;border-radius:9px;font-size:12px;color:#6a4b06}.v04-ai-grid{display:grid;grid-template-columns:1.5fr 1.2fr 1fr;gap:10px;align-items:end}.v04-ai-grid label{margin:0}.v04-ai-grid .v04-check{display:flex;gap:7px;align-items:center}.v04-ai-grid .v04-check input{width:auto;margin:0}.v04-ai-actions{display:flex;gap:8px;margin:14px 0}.v04-ai-status{font-size:12px}.v04-ai-progress{height:8px;background:#e7edf3;border-radius:999px;overflow:hidden;margin-top:6px}.v04-ai-progress>div{height:100%;width:0;background:#2469a2;transition:width .2s}.v04-ai-preview{display:flex;gap:8px;overflow:auto;margin-top:12px}.v04-ai-preview figure{margin:0;min-width:160px}.v04-ai-preview img{width:160px;max-height:220px;object-fit:contain;border:1px solid #d5dde5;border-radius:7px;background:#f8fafc}.v04-ai-preview figcaption{text-align:center;font-size:10px;color:#64748b}.v04-ai-results{display:grid;gap:8px;margin:12px 0}.v04-ai-result{border:1px solid #d8e1e8;border-radius:9px;padding:10px;background:#fbfdff}.v04-ai-result strong{display:block}.v04-ai-result span{font-size:11px;color:#64748b}.v04-ai-result ul{margin:7px 0 0;padding-left:18px;color:#7a4d00;font-size:11px}.v04-ai-card details textarea{width:100%;font-family:Consolas,monospace;font-size:11px}.v04-ai-card .hidden{display:none!important}
    @media(max-width:820px){.v04-ai-grid{grid-template-columns:1fr}.v04-ai-actions{flex-wrap:wrap}}
  `;document.head.appendChild(style);
}

function init() {
  installVersionBadge();installStyles();installUnitControl();installAiButton();installAiModal();observeSvg();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
