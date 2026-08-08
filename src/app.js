import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

let ocrWorkerPromise;
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng', 1, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/tesseract-core.wasm.js',
      langPath: '/ocr/lang-data',
      gzip: true,
      logger: message => {
        if (message.status === 'recognizing text') {
          setImportStatus(`OCR: ${Math.round(message.progress * 100)}%`, Math.round(message.progress * 85));
        }
      }
    });
  }
  return ocrWorkerPromise;
}

async function recognizeOffline(input, statusPrefix = 'OCR') {
  const worker = await getOcrWorker();
  const result = await worker.recognize(input);
  return result;
}

const MATERIALS = ["ASPHALT","CONCRETE","FILL","GRAVEL","SAND","SILTY SAND","SILT","SANDY SILT","CLAYEY SILT","CLAY","SILTY CLAY","TILL","ORGANIC SOIL","BEDROCK"];
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
const demo = () => ({
  project:{name:"Demo Borehole Project",number:"BH-001",location:"Ontario, Canada"},
  activeId:null,
  boreholes:[
    makeBh("BH1(MW)",6.12,true),makeBh("BH2",3.66,false),makeBh("BH3(MW)",6.10,true),makeBh("BH4(MW)",6.12,true),makeBh("BH5",3.66,false)
  ]
});
function makeBh(name,depth,mw){const id=uid();return {id,name,totalDepth:depth,groundElevation:100,drillingMethod:"Solid Stem Split Spoon",drillDate:"2025-03-25",monitoringWell:mw,screenTop:Math.max(0,depth-3),screenBottom:depth-0.1,waterDepth:mw?Math.max(.5,depth-1.3):null,layers:[{id:uid(),from:0,to:Math.min(.9,depth),material:"FILL",moisture:"Slightly moist",description:"Brown sand and gravel"},{id:uid(),from:Math.min(.9,depth),to:Math.min(3.6,depth),material:"SILT",moisture:"Moist",description:"Brown, trace clay"},...(depth>3.6?[{id:uid(),from:3.6,to:depth,material:"CLAYEY SILT",moisture:"Moist",description:"Greyish brown to grey"}]:[])],samples:[{id:uid(),from:1,to:1.5,sampleId:`${name.replace(/\W/g,'')}-1`,analyses:"Metals, PHCs, VOCs"}],tests:[{id:uid(),depth:1.5,blows:"4-6-8",n:14,pid:4.8}]};}
let state = load() || demo();
if(!state.project||!Array.isArray(state.boreholes)||!state.boreholes.length)state=demo();
if(!state.activeId||!state.boreholes.some(b=>b.id===state.activeId))state.activeId=state.boreholes[0].id;
const $=id=>document.getElementById(id);
function active(){return state.boreholes.find(b=>b.id===state.activeId)}
function save(){localStorage.setItem("boreholeLogStudio",JSON.stringify(state));renderAll()}
function load(){try{return JSON.parse(localStorage.getItem("boreholeLogStudio"))}catch{return null}}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}
function renderAll(){renderProject();renderBoreholes();renderDetails();renderTables();renderSvg();}
function renderProject(){$("projectName").value=state.project.name||"";$("projectNumber").value=state.project.number||"";$("projectLocation").value=state.project.location||""}
function renderBoreholes(){const c=$("boreholeList");c.innerHTML="";state.boreholes.forEach(b=>{const d=document.createElement("div");d.className="borehole-item "+(b.id===state.activeId?"active":"");d.innerHTML=`<span>${esc(b.name)}</span><button class="delete" title="Delete">×</button>`;d.onclick=e=>{if(e.target.classList.contains("delete")){e.stopPropagation();if(state.boreholes.length>1&&confirm(`Delete ${b.name}?`)){state.boreholes=state.boreholes.filter(x=>x.id!==b.id);if(state.activeId===b.id)state.activeId=state.boreholes[0].id;save()}}else{state.activeId=b.id;renderAll()}};c.appendChild(d)})}
function renderDetails(){const b=active();if(!b)return;$("activeBoreholeTitle").textContent=b.name;$("bhId").value=b.name;$("bhDepth").value=b.totalDepth;$("groundElevation").value=b.groundElevation??"";$("drillingMethod").value=b.drillingMethod||"";$("drillDate").value=b.drillDate||"";$("isMonitoringWell").checked=!!b.monitoringWell;$("screenTop").value=b.screenTop??"";$("screenBottom").value=b.screenBottom??"";$("waterDepth").value=b.waterDepth??"";$("wellFields").classList.toggle("hidden",!b.monitoringWell)}
function materialOptions(sel){return MATERIALS.map(m=>`<option ${m===sel?"selected":""}>${m}</option>`).join("")}
function renderTables(){const b=active();$("layersBody").innerHTML=b.layers.map((r,i)=>`<tr data-id="${r.id}" class="${r.from<0||r.to<=r.from||r.to>b.totalDepth?'row-error':''}"><td><input data-k="from" type="number" step="0.01" value="${r.from}"></td><td><input data-k="to" type="number" step="0.01" value="${r.to}"></td><td><select data-k="material">${materialOptions(r.material)}</select></td><td><input data-k="moisture" value="${esc(r.moisture)}"></td><td><input class="description" data-k="description" value="${esc(r.description)}"></td><td><button data-del="layer">×</button></td></tr>`).join("");$("samplesBody").innerHTML=b.samples.map(r=>`<tr data-id="${r.id}"><td><input data-k="from" type="number" step="0.01" value="${r.from}"></td><td><input data-k="to" type="number" step="0.01" value="${r.to}"></td><td><input data-k="sampleId" value="${esc(r.sampleId)}"></td><td><input class="description" data-k="analyses" value="${esc(r.analyses)}"></td><td><button data-del="sample">×</button></td></tr>`).join("");$("testsBody").innerHTML=b.tests.map(r=>`<tr data-id="${r.id}"><td><input data-k="depth" type="number" step="0.01" value="${r.depth}"></td><td><input data-k="blows" value="${esc(r.blows)}"></td><td><input data-k="n" type="number" value="${r.n??''}"></td><td><input data-k="pid" type="number" step="0.1" value="${r.pid??''}"></td><td><button data-del="test">×</button></td></tr>`).join("");bindTable($("layersBody"),b.layers);bindTable($("samplesBody"),b.samples);bindTable($("testsBody"),b.tests);validate()}
function bindTable(body,arr){body.querySelectorAll("input,select").forEach(el=>el.onchange=()=>{const row=el.closest("tr"),obj=arr.find(x=>x.id===row.dataset.id),k=el.dataset.k;obj[k]=el.type==="number"?(el.value===""?null:Number(el.value)):el.value;save()});body.querySelectorAll("button[data-del]").forEach(btn=>btn.onclick=()=>{const id=btn.closest("tr").dataset.id;const b=active();if(btn.dataset.del==="layer")b.layers=b.layers.filter(x=>x.id!==id);if(btn.dataset.del==="sample")b.samples=b.samples.filter(x=>x.id!==id);if(btn.dataset.del==="test")b.tests=b.tests.filter(x=>x.id!==id);save()})}
function validate(){const b=active();const issues=[];const sorted=[...b.layers].sort((a,c)=>a.from-c.from);if(!sorted.length)issues.push("No lithology layers");for(let i=0;i<sorted.length;i++){const r=sorted[i];if(r.from<0||r.to<=r.from||r.to>b.totalDepth)issues.push(`Invalid layer ${i+1}`);if(i&&r.from<sorted[i-1].to)issues.push(`Overlap at ${r.from} m`);if(i&&r.from>sorted[i-1].to)issues.push(`Gap from ${sorted[i-1].to} to ${r.from} m`)}if(sorted.length&&sorted[0].from>0)issues.push("Gap at top");if(sorted.length&&sorted.at(-1).to<b.totalDepth)issues.push("Gap at bottom");if(b.monitoringWell&&(b.screenTop<0||b.screenBottom>b.totalDepth||b.screenBottom<=b.screenTop))issues.push("Invalid screen interval");const e=$("validationSummary");e.textContent=issues.length?`${issues.length} warning(s): ${issues.slice(0,2).join("; ")}`:"No validation warnings";e.className="validation-summary "+(issues.length?"warn":"ok")}
function renderSvg(){const b=active(),ppm=Number($("scaleSelect").value),top=120,bottom=55,h=top+b.totalDepth*ppm+bottom,w=980;const svg=$("boreholeSvg");svg.setAttribute("viewBox",`0 0 ${w} ${h}`);svg.setAttribute("width",w);svg.setAttribute("height",h);const y=d=>top+d*ppm;const patterns=`<defs><pattern id="p_FILL" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 0L12 12M12 0L0 12" stroke="#333" stroke-width="1"/></pattern><pattern id="p_SILT" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M2 0V8M6 0V8" stroke="#444" stroke-width=".8"/></pattern><pattern id="p_CLAYEY_SILT" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 10L10 0M-3 3L3-3M7 13L13 7" stroke="#444" stroke-width=".8"/></pattern><pattern id="p_SAND" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".8"/><circle cx="7" cy="7" r=".8"/></pattern><pattern id="p_GRAVEL" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2" fill="none" stroke="#444"/><circle cx="11" cy="10" r="2.5" fill="none" stroke="#444"/></pattern><pattern id="p_ASPHALT" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#333"/><circle cx="2" cy="2" r=".6" fill="#fff"/></pattern><pattern id="p_DEFAULT" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 5H10" stroke="#555" stroke-width=".7"/></pattern></defs>`;
let s=patterns+`<rect x="0" y="0" width="${w}" height="${h}" fill="white"/><text x="30" y="35" font-size="22" font-weight="700">${esc(state.project.name)}</text><text x="30" y="58" font-size="12">Project: ${esc(state.project.number)} | ${esc(state.project.location)}</text><text x="950" y="35" text-anchor="end" font-size="20" font-weight="700">${esc(b.name)}</text><text x="950" y="58" text-anchor="end" font-size="12">Depth ${b.totalDepth.toFixed(2)} m | ${esc(b.drillingMethod)}</text>`;
const cols=[40,105,180,285,365,575,805,940];cols.forEach(x=>s+=`<line x1="${x}" y1="85" x2="${x}" y2="${y(b.totalDepth)}" stroke="#222"/>`);s+=`<line x1="40" y1="85" x2="940" y2="85" stroke="#222"/><line x1="40" y1="${y(b.totalDepth)}" x2="940" y2="${y(b.totalDepth)}" stroke="#222"/>`;
const heads=[[72,"DEPTH"],[142,"SAMPLE"],[232,"ANALYSES"],[325,"PID / SPT"],[470,"LITHOLOGY & MATERIAL DESCRIPTION"],[690,"WELL CONSTRUCTION"]];heads.forEach(([x,t])=>s+=`<text x="${x}" y="105" text-anchor="middle" font-size="11" font-weight="700">${t}</text>`);
for(let d=0;d<=Math.ceil(b.totalDepth*10)/10;d+=.1){const yy=y(d),major=Math.abs(d-Math.round(d))<.001;s+=`<line x1="${major?40:52}" y1="${yy}" x2="65" y2="${yy}" stroke="#333" stroke-width="${major?1.2:.5}"/>`;if(major)s+=`<text x="36" y="${yy+4}" text-anchor="end" font-size="11">${Math.round(d)}</text>`}
[...b.layers].sort((a,c)=>a.from-c.from).forEach(r=>{const yy=y(r.from),hh=Math.max(1,(r.to-r.from)*ppm),pid=`p_${r.material.replace(/\s/g,'_')}`;s+=`<rect x="365" y="${yy}" width="45" height="${hh}" fill="url(#${["FILL","SILT","CLAYEY_SILT","SAND","GRAVEL","ASPHALT"].includes(r.material.replace(/\s/g,'_'))?pid:'p_DEFAULT'})" stroke="#222"/><rect x="410" y="${yy}" width="165" height="${hh}" fill="white" stroke="#222"/><text x="418" y="${yy+16}" font-size="11" font-weight="700">${esc(r.material)}</text><text x="418" y="${yy+31}" font-size="10">${esc(r.description)}</text><text x="418" y="${yy+44}" font-size="9">${esc(r.moisture)}</text>`});
b.samples.forEach(r=>{const yy=y(r.from),hh=Math.max(18,(r.to-r.from)*ppm);s+=`<rect x="105" y="${yy}" width="75" height="${hh}" fill="white" stroke="#222"/><text x="142" y="${yy+15}" text-anchor="middle" font-size="10">${esc(r.sampleId)}</text><rect x="180" y="${yy}" width="105" height="${hh}" fill="white" stroke="#222"/><text x="185" y="${yy+14}" font-size="9">${esc(r.analyses)}</text>`});
b.tests.forEach(r=>{const yy=y(r.depth);s+=`<line x1="285" y1="${yy}" x2="365" y2="${yy}" stroke="#777"/><text x="325" y="${yy-4}" text-anchor="middle" font-size="9">SPT ${esc(r.blows)} / N=${r.n??''}</text><text x="325" y="${yy+10}" text-anchor="middle" font-size="9">PID ${r.pid??''} ppm</text>`});
if(b.monitoringWell){const cx=700,st=y(b.screenTop),sb=y(b.screenBottom);s+=`<rect x="${cx-9}" y="${y(0)}" width="18" height="${st-y(0)}" fill="#fff" stroke="#222"/><rect x="${cx-9}" y="${st}" width="18" height="${sb-st}" fill="#fff" stroke="#222"/>`;for(let yy=st+5;yy<sb;yy+=8)s+=`<line x1="${cx-8}" y1="${yy}" x2="${cx+8}" y2="${yy}" stroke="#555"/>`;s+=`<rect x="${cx-28}" y="${Math.max(y(0),st-35)}" width="56" height="${sb-Math.max(y(0),st-35)}" fill="none" stroke="#777" stroke-dasharray="2 2"/><text x="735" y="${st+15}" font-size="10">PVC Screen</text>`;if(b.waterDepth!=null){const wy=y(b.waterDepth);s+=`<path d="M${cx-22} ${wy}h44l-22 15z" fill="#2b91d1" opacity=".8"/><text x="735" y="${wy+4}" font-size="10" fill="#1b6f9e">Water ${b.waterDepth} m</text>`}}
s+=`<text x="490" y="${y(b.totalDepth)+22}" text-anchor="middle" font-size="10">End of borehole at ${b.totalDepth.toFixed(2)} m</text>`;svg.innerHTML=s}
function download(name,content,type="text/plain"){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function exportCsv(){const rows=[["Borehole","From","To","Material","Moisture","Description"]];state.boreholes.forEach(b=>b.layers.forEach(r=>rows.push([b.name,r.from,r.to,r.material,r.moisture,r.description])));download("borehole-lithology.csv",rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(",")).join("\n"),"text/csv")}
function exportDxf(){const b=active(),scale=1000,lines=["0","SECTION","2","HEADER","0","ENDSEC","0","SECTION","2","ENTITIES"];const addLine=(x1,y1,x2,y2,layer)=>lines.push("0","LINE","8",layer,"10",String(x1),"20",String(y1),"11",String(x2),"21",String(y2));const addText=(x,y,t,h=120,layer="TEXT")=>lines.push("0","TEXT","8",layer,"10",String(x),"20",String(y),"40",String(h),"1",String(t).replace(/[^\x20-\x7E]/g,"?"));addText(0,1000,b.name,220,"HEADER");b.layers.forEach(r=>{const y1=-r.from*scale,y2=-r.to*scale;addLine(0,y1,400,y1,"LITHOLOGY");addLine(0,y2,400,y2,"LITHOLOGY");addLine(0,y1,0,y2,"LITHOLOGY");addLine(400,y1,400,y2,"LITHOLOGY");addText(430,(y1+y2)/2,r.material+" - "+r.description,100,"TEXT")});addLine(0,0,0,-b.totalDepth*scale,"DEPTH");lines.push("0","ENDSEC","0","EOF");download(`${b.name.replace(/\W/g,'_')}.dxf`,lines.join("\n"),"application/dxf")}
function bind(){["projectName","projectNumber","projectLocation"].forEach(id=>$(id).onchange=()=>{state.project[id.replace("project","").replace(/^./,c=>c.toLowerCase())]=$(id).value;save()});const map={bhId:"name",bhDepth:"totalDepth",groundElevation:"groundElevation",drillingMethod:"drillingMethod",drillDate:"drillDate",screenTop:"screenTop",screenBottom:"screenBottom",waterDepth:"waterDepth"};Object.entries(map).forEach(([id,k])=>$(id).onchange=()=>{active()[k]=$(id).type==="number"?Number($(id).value):$(id).value;save()});$("isMonitoringWell").onchange=()=>{active().monitoringWell=$("isMonitoringWell").checked;save()};$("scaleSelect").onchange=renderSvg;$("addBoreholeBtn").onclick=()=>{const b=makeBh(`BH${state.boreholes.length+1}`,6,false);state.boreholes.push(b);state.activeId=b.id;save()};$("addLayerBtn").onclick=()=>{const b=active(),from=b.layers.length?Math.max(...b.layers.map(x=>x.to)):0;b.layers.push({id:uid(),from,to:Math.min(b.totalDepth,from+1),material:"SILT",moisture:"Moist",description:""});save()};$("addSampleBtn").onclick=()=>{active().samples.push({id:uid(),from:0,to:.5,sampleId:"",analyses:""});save()};$("addTestBtn").onclick=()=>{active().tests.push({id:uid(),depth:1,blows:"",n:null,pid:null});save()};$("saveBtn").onclick=save;$("newProjectBtn").onclick=()=>{if(confirm("Start a new project?")){state=demo();save()}};$("exportJsonBtn").onclick=()=>download("borehole-project.json",JSON.stringify(state,null,2),"application/json");$("exportCsvBtn").onclick=exportCsv;$("exportDxfBtn").onclick=exportDxf;$("printBtn").onclick=()=>window.print();$("importBtn").onclick=()=>$("importFile").click();$("browseBtn").onclick=()=>$("importFile").click();$("importFile").onchange=e=>handleFiles([...e.target.files]);document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{document.querySelectorAll(".tab,.tab-content").forEach(x=>x.classList.remove("active"));t.classList.add("active");$(t.dataset.tab+"Tab").classList.add("active")})}
bind();renderAll();

// ---------- Multi-format file import (PDF / image / Excel / CSV / JSON) ----------
let pendingImport = [];
const dropZone = $("dropZone");
["dragenter","dragover"].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.add("dragover")}));
["dragleave","drop"].forEach(n=>dropZone.addEventListener(n,e=>{e.preventDefault();dropZone.classList.remove("dragover")}));
dropZone.addEventListener("drop",e=>handleFiles([...e.dataTransfer.files]));
$("closeImportBtn").onclick=$("cancelImportBtn").onclick=()=>$("importPanel").classList.add("hidden");
$("applyImportBtn").onclick=()=>applyPendingImport();

function setImportStatus(text,pct=0){$("importStatus").textContent=text;$("progressBar").style.width=`${Math.max(0,Math.min(100,pct))}%`}
function normalizeMaterial(s=""){
  const u=String(s||"").toUpperCase().replace(/\s+/g," ").trim();
  // Match compound names before generic words such as SAND or SILT.
  const ordered=[...MATERIALS].sort((a,b)=>b.length-a.length);
  const hit=ordered.find(m=>u.includes(m));
  if(hit)return hit;
  if(/CLAY.*SILT|SILT.*CLAY/.test(u))return "CLAYEY SILT";
  if(/SAND.*SILT|SILT.*SAND/.test(u))return "SANDY SILT";
  return "SILT";
}
function blankImportedBh(name="Imported BH",depth=6){
  const b=makeBh(name,Math.max(.1,Number(depth)||6),/\bMW\b|\(MW\)/i.test(name));
  b.layers=[];b.samples=[];b.tests=[];return b;
}
async function handleFiles(files){
  if(!files.length)return;
  pendingImport=[];$("importPanel").classList.remove("hidden");$("extractedList").innerHTML="";$("rawText").value="";$("sourcePreview").innerHTML="No preview";
  for(let i=0;i<files.length;i++){
    const f=files[i], base=Math.round(i/files.length*100);
    try{
      setImportStatus(`Reading ${f.name}…`,base);
      const ext=f.name.split('.').pop().toLowerCase();
      let result;
      if(ext==='json')result=await importJsonFile(f);
      else if(['xlsx','xls','csv'].includes(ext))result=await importSpreadsheet(f);
      else if(ext==='pdf')result=await importPdf(f);
      else if(['png','jpg','jpeg','webp'].includes(ext))result=await importImage(f);
      else throw new Error('Unsupported file type');
      pendingImport.push(...result.boreholes);
      $("rawText").value += `\n--- ${f.name} ---\n${result.rawText||''}\n`;
    }catch(err){
      $("rawText").value += `\n${f.name}: ERROR - ${err.message}\n`;
    }
  }
  renderExtractedReview();setImportStatus(`${pendingImport.length} borehole(s) ready for review`,100);
}
async function importJsonFile(file){
  const obj=JSON.parse(await file.text());
  if(!obj.boreholes)throw new Error('Invalid Borehole Log Studio JSON');
  return {boreholes:obj.boreholes.map(b=>({...b,id:uid()})),rawText:'Structured project JSON loaded.'};
}
async function importSpreadsheet(file){
  setImportStatus(`Parsing spreadsheet ${file.name}…`,30);
  const data=await file.arrayBuffer();
  const wb=XLSX.read(data,{type:'array'});let rows=[];
  wb.SheetNames.forEach(sn=>rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''}).map(r=>({...r,__sheet:sn}))));
  if(!rows.length)throw new Error('No rows found');
  const key=(row,names)=>{const keys=Object.keys(row);const k=keys.find(k=>names.some(n=>k.toLowerCase().replace(/[^a-z0-9]/g,'').includes(n)));return k?row[k]:''};
  const groups=new Map();
  rows.forEach(r=>{
    const bh=String(key(r,['borehole','bhid','wellid','locationid'])||r.__sheet||'Imported BH').trim();
    if(!groups.has(bh))groups.set(bh,[]);groups.get(bh).push(r);
  });
  const boreholes=[];
  for(const [name,rs] of groups){
    let depth=Math.max(...rs.map(r=>Number(key(r,['todepth','bottomdepth','enddepth','depthto','totaldepth']))||0),6);
    const b=blankImportedBh(name,depth);
    rs.forEach(r=>{
      const from=Number(key(r,['fromdepth','topdepth','depthfrom','from']))||0;
      const to=Number(key(r,['todepth','bottomdepth','depthto','to']))||0;
      const desc=String(key(r,['description','materialdescription','soil_description','lithology']));
      const mat=String(key(r,['material','soiltype','uscs','lithology']))||desc;
      const sid=String(key(r,['sampleid','labsample','sampleno']));
      const analyses=String(key(r,['analyses','analysis','testsrequested','parameters']));
      const numericOrNull=value=>{const t=String(value??'').trim();return t===''?null:(Number.isFinite(Number(t))?Number(t):null)};
      const pid=numericOrNull(key(r,['pid','headspace']));
      const n=numericOrNull(key(r,['nvalue','sptn']));
      const blows=String(key(r,['blows','sptblows']));
      if(to>from&&(String(mat).trim()||String(desc).trim()))b.layers.push({id:uid(),from,to,material:normalizeMaterial(mat),moisture:String(key(r,['moisture','condition'])),description:desc||mat});
      if(sid)b.samples.push({id:uid(),from,to:to>from?to:from+.5,sampleId:sid,analyses});
      if(pid!==null||n!==null||blows)b.tests.push({id:uid(),depth:to||from,blows,n,pid});
    });
    if(!b.layers.length)b.layers=[{id:uid(),from:0,to:b.totalDepth,material:'SILT',moisture:'',description:'Review imported spreadsheet mapping'}];
    boreholes.push(b);
  }
  return {boreholes,rawText:`Sheets: ${wb.SheetNames.join(', ')}\nRows: ${rows.length}`};
}
async function importPdf(file){
  setImportStatus(`Extracting PDF text from ${file.name}…`,15);
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  let all=''; let firstCanvas=null;
  for(let p=1;p<=pdf.numPages;p++){
    setImportStatus(`Reading PDF page ${p} of ${pdf.numPages}…`,15+55*p/pdf.numPages);
    const page=await pdf.getPage(p);const tc=await page.getTextContent();
    let text=tc.items.map(i=>i.str).join(' ');
    if(text.trim().length<30){
      const cv=document.createElement('canvas'),vp=page.getViewport({scale:1.7});cv.width=vp.width;cv.height=vp.height;await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
      const o=await recognizeOffline(cv, `OCR page ${p}`);text=o.data.text;
      if(!firstCanvas)firstCanvas=cv;
    } else if(p===1){const cv=document.createElement('canvas'),vp=page.getViewport({scale:1.1});cv.width=vp.width;cv.height=vp.height;await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;firstCanvas=cv;}
    all+=`\n[PAGE ${p}]\n${text}`;
  }
  if(firstCanvas){$("sourcePreview").innerHTML='';$("sourcePreview").appendChild(firstCanvas)}
  return {boreholes:parseBoreholeText(all),rawText:all};
}
async function importImage(file){
  const url=URL.createObjectURL(file);$("sourcePreview").innerHTML=`<img src="${url}" alt="source">`;
  const result=await recognizeOffline(file, `OCR ${file.name}`);
  return {boreholes:parseBoreholeText(result.data.text),rawText:result.data.text};
}
function parseBoreholeText(text){
  const flat=text.replace(/\r/g,' ');
  const ids=[...flat.matchAll(/\b(?:BH|MW|TP)\s*[-#]?\s*\d+[A-Z]?(?:\s*\(MW\))?/gi)].map(m=>m[0].replace(/\s+/g,''));
  const unique=[...new Set(ids)];
  if(!unique.length)unique.push('Imported BH1');
  const chunks=[];
  unique.forEach((id,i)=>{const start=flat.search(new RegExp(id.replace(/[()]/g,'\\$&').replace(/\s*/g,'\\s*'),'i'));const next=i+1<unique.length?flat.search(new RegExp(unique[i+1].replace(/[()]/g,'\\$&').replace(/\s*/g,'\\s*'),'i')):-1;chunks.push({id,text:start>=0?flat.slice(start,next>start?next:undefined):flat})});
  return chunks.map(({id,text:t})=>{
    const dm=t.match(/(?:End of borehole at|Total Depth|Termination Depth)\s*[:@]?\s*(\d+(?:\.\d+)?)\s*m?/i);
    const depth=dm?Number(dm[1]):Math.max(...[...t.matchAll(/\b(\d+(?:\.\d+)?)\s*m\b/g)].map(m=>Number(m[1])),6);
    const b=blankImportedBh(id,Math.min(Math.max(depth,.1),300));
    const water=t.match(/(?:water depth|groundwater|gwl)\s*[:@]?\s*(\d+(?:\.\d+)?)/i);if(water)b.waterDepth=Number(water[1]);
    const screen=t.match(/screen[^\d]{0,25}(\d+(?:\.\d+)?)[^\d]{1,12}(\d+(?:\.\d+)?)/i);if(screen){b.monitoringWell=true;b.screenTop=Number(screen[1]);b.screenBottom=Number(screen[2])}
    const candidates=[];
    const re=/(FILL|ASPHALT|CONCRETE|CLAYEY\s+SILT|SANDY\s+SILT|SILTY\s+SAND|SILTY\s+CLAY|GRAVEL|SAND|SILT|CLAY|TILL|BEDROCK)\s*[:\-]?\s*([^\n]{0,120})/gi;
    for(const m of t.matchAll(re))candidates.push({material:normalizeMaterial(m[1]),description:(m[1]+': '+m[2]).trim()});
    const step=b.totalDepth/Math.max(1,candidates.length);
    b.layers=(candidates.length?candidates:[{material:'SILT',description:'OCR import—review material and depths'}]).map((c,i)=>({id:uid(),from:Number((i*step).toFixed(2)),to:Number(((i+1)*step).toFixed(2)),material:c.material,moisture:/very moist/i.test(c.description)?'Very moist':/moist/i.test(c.description)?'Moist':/dry/i.test(c.description)?'Dry':'',description:c.description}));
    const labs=[...t.matchAll(/\b\d{2}-\d{3,6}-\d+\b/g)].map(m=>m[0]);
    labs.slice(0,20).forEach((sid,i)=>b.samples.push({id:uid(),from:Number(Math.min(b.totalDepth-.1,i*.5).toFixed(2)),to:Number(Math.min(b.totalDepth,i*.5+.5).toFixed(2)),sampleId:sid,analyses:(t.match(/Metals[^\n]{0,80}/i)||[''])[0]}));
    b.importConfidence=candidates.length?'medium':'low';return b;
  });
}
function renderExtractedReview(){
  $("extractedList").innerHTML=pendingImport.map((b,i)=>`<div class="extract-card" data-i="${i}"><div><strong>${esc(b.name)}</strong> <span class="confidence ${b.importConfidence||'high'}">${b.importConfidence||'high'} confidence</span></div><div class="extract-card-grid"><label>Borehole ID<input data-k="name" value="${esc(b.name)}"></label><label>Total depth (m)<input data-k="totalDepth" type="number" step=".01" value="${b.totalDepth}"></label><label>Layers<input disabled value="${b.layers.length}"></label></div></div>`).join('');
  $("extractedList").querySelectorAll('input[data-k]').forEach(inp=>inp.onchange=()=>{const b=pendingImport[Number(inp.closest('.extract-card').dataset.i)];b[inp.dataset.k]=inp.type==='number'?Number(inp.value):inp.value});
}
function applyPendingImport(){
  if(!pendingImport.length)return alert('No boreholes were extracted. Review the raw text or use manual entry.');
  pendingImport.forEach(b=>{b.id=uid();b.layers=(b.layers||[]).map(x=>({...x,id:uid()}));b.samples=(b.samples||[]).map(x=>({...x,id:uid()}));b.tests=(b.tests||[]).map(x=>({...x,id:uid()}));state.boreholes.push(b)});
  state.activeId=state.boreholes.at(-pendingImport.length).id;save();$("importPanel").classList.add('hidden');pendingImport=[];
}
