import { sheetRanges } from './web-core.js';

const STORAGE_KEY='boreholeLogStudioWebV1';
const $=id=>document.getElementById(id);
let busy=false;

function readState(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch{return null;}}
function writeState(state){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function active(state){return state?.boreholes?.find(b=>b.id===state.activeBoreholeId)||state?.boreholes?.[0]||null;}
function rowDepth(item){return Math.max(n(item?.toM)??-1,n(item?.fromM)??-1,n(item?.depthM)??-1);}
function inferredDepth(b){
  let d=Math.max(0,n(b?.totalDepthM)||0);
  for(const x of b?.layers||[]) d=Math.max(d,n(x?.toM)||0,n(x?.fromM)||0);
  for(const x of b?.samples||[]) d=Math.max(d,n(x?.toM)||0,n(x?.fromM)||0);
  for(const x of b?.tests||[]) d=Math.max(d,n(x?.depthM)||0);
  const w=b?.well||{};
  for(const x of [w.riserBottomM,w.screenTopM,w.screenBottomM,w.waterDepthM]) d=Math.max(d,n(x)||0);
  return d;
}
function normalizeDeepBoreholes(){
  if(busy)return false;const state=readState();if(!state?.boreholes)return false;let changed=false;
  for(const b of state.boreholes){const d=inferredDepth(b);if(d>(n(b.totalDepthM)||0)+1e-6){b.totalDepthM=d;changed=true;}}
  if(changed){busy=true;writeState(state);busy=false;return true;}return false;
}

function parseReviewRows(selector,kind){
  return [...document.querySelectorAll(selector+' .review-row')].filter(row=>row.querySelector('[data-field="status"]')?.value!=='ignored').map(row=>{
    const val=f=>row.querySelector(`[data-field="${f}"]`)?.value??'';
    const base={kind,status:val('status')||'manual'};
    if(kind==='layers')return {...base,fromM:n(val('fromM')),toM:n(val('toM')),material:val('material'),description:val('description'),moisture:val('moisture')};
    if(kind==='samples')return {...base,fromM:n(val('fromM')),toM:n(val('toM')),sampleId:val('sampleId'),analyses:String(val('analyses')).split(',').map(x=>x.trim()).filter(Boolean)};
    return {...base,depthM:n(val('depthM')),sptBlows:val('sptBlows'),nValue:n(val('nValue')),pidPpm:n(val('pidPpm'))};
  });
}
function snapshotReview(){
  return {name:$('reviewBhName')?.value?.trim()||'',depth:n($('reviewBhDepth')?.value),elevation:n($('reviewElevation')?.value),
    layers:parseReviewRows('#reviewLayers','layers'),samples:parseReviewRows('#reviewSamples','samples'),tests:parseReviewRows('#reviewTests','tests')};
}
function sameLayer(a,b){return Math.abs((n(a.fromM)||0)-(n(b.fromM)||0))<1e-4&&Math.abs((n(a.toM)||0)-(n(b.toM)||0))<1e-4&&String(a.material||'')===String(b.material||'');}
function sameSample(a,b){return String(a.sampleId||'')===String(b.sampleId||'')&&Math.abs((n(a.fromM)||0)-(n(b.fromM)||0))<1e-4;}
function sameTest(a,b){return Math.abs((n(a.depthM)||0)-(n(b.depthM)||0))<1e-4&&String(a.sptBlows||'')===String(b.sptBlows||'')&&String(a.nValue??'')===String(b.nValue??'');}
function repairTransfer(snap){
  const state=readState(),b=active(state);if(!state||!b||!snap)return;
  b.layers ||= []; b.samples ||= []; b.tests ||= [];
  let repaired=0;
  for(const x of snap.layers)if(!b.layers.some(y=>sameLayer(x,y))){b.layers.push({id:`layer-recovered-${Date.now()}-${repaired++}`,...x,status:x.status==='draft'?'manual':x.status,confidence:null,evidence:'Recovered from reviewed AI draft',box:null});}
  for(const x of snap.samples)if(!b.samples.some(y=>sameSample(x,y))){b.samples.push({id:`sample-recovered-${Date.now()}-${repaired++}`,...x,status:x.status==='draft'?'manual':x.status,confidence:null,evidence:'Recovered from reviewed AI draft',box:null});}
  for(const x of snap.tests)if(!b.tests.some(y=>sameTest(x,y))){b.tests.push({id:`test-recovered-${Date.now()}-${repaired++}`,...x,status:x.status==='draft'?'manual':x.status,confidence:null,evidence:'Recovered from reviewed AI draft',box:null});}
  const inferred=inferredDepth(b);if(inferred>(n(b.totalDepthM)||0))b.totalDepthM=inferred;
  if(snap.depth!=null&&snap.depth>b.totalDepthM)b.totalDepthM=snap.depth;
  if(snap.elevation!=null&&b.groundElevationM==null)b.groundElevationM=snap.elevation;
  if(repaired){writeState(state);const t=$('toast');if(t){t.textContent=`Transfer audit recovered ${repaired} reviewed AI item(s).`;t.className='toast';setTimeout(()=>t.className='toast hidden',4200);}setTimeout(()=>location.reload(),250);}
}
function installTransferAudit(){
  const btn=$('applyReview');if(!btn||btn.dataset.v07)return;btn.dataset.v07='1';
  btn.addEventListener('click',()=>{const snap=snapshotReview();setTimeout(()=>repairTransfer(snap),120);},true);
}

function sourceForBorehole(state,b){return state?.sources?.find(s=>s.name===b?.review?.sourceName)||null;}
function inferredPage(b,item){
  const base=n(b?.review?.sourcePage)||1;
  if(n(item?.sourcePage)!=null)return Number(item.sourcePage);
  const d=Math.max(0,rowDepth(item));
  return base+Math.floor(d/11);
}
function gotoPage(page){
  let guard=0;const tick=()=>{if(guard++>40)return;const txt=$('reviewPageText')?.textContent||'';const m=txt.match(/Page\s+(\d+)\//i);const cur=m?Number(m[1]):null;if(cur==null){setTimeout(tick,60);return;}if(cur===page)return;const btn=cur<page?$('sourceNext'):$('sourcePrev');if(!btn||btn.disabled)return;btn.click();setTimeout(tick,45);};tick();
}
function showExternalBox(box){
  if(!Array.isArray(box)||box.length!==4)return;let tries=0;const draw=()=>{const img=$('reviewImage'),wrap=$('reviewImageWrap');if(!img||!wrap||!img.clientWidth){if(tries++<30)setTimeout(draw,80);return;}let el=$('v07LocateBox');if(!el){el=document.createElement('div');el.id='v07LocateBox';el.style.cssText='position:absolute;border:3px solid #e53935;background:rgba(229,57,53,.12);pointer-events:none;z-index:20;box-shadow:0 0 0 2px white';wrap.appendChild(el);}const [x1,y1,x2,y2]=box;el.style.left=`${img.offsetLeft+x1/1000*img.clientWidth}px`;el.style.top=`${img.offsetTop+y1/1000*img.clientHeight}px`;el.style.width=`${Math.max(4,(x2-x1)/1000*img.clientWidth)}px`;el.style.height=`${Math.max(4,(y2-y1)/1000*img.clientHeight)}px`;el.scrollIntoView({block:'center',behavior:'smooth'});};setTimeout(draw,100);
}
function openLocate(b,item){
  const state=readState(),source=sourceForBorehole(state,b);if(!source){alert('Source file is not linked to this borehole.');return;}
  const srcBtn=document.querySelector(`[data-open="${CSS.escape(source.id)}"]`);if(!srcBtn){alert('Source file must be re-imported in this browser session before it can be reopened.');return;}
  srcBtn.click();const page=inferredPage(b,item);setTimeout(()=>{gotoPage(page);if(item?.box)setTimeout(()=>showExternalBox(item.box),220);},120);
}
function addLocateButtons(){
  const state=readState(),b=active(state);if(!state||!b)return;
  const map=[['#layersBody','layers'],['#samplesBody','samples'],['#testsBody','tests']];
  for(const [sel,kind] of map){document.querySelectorAll(`${sel} tr`).forEach(row=>{if(row.querySelector('.v07-locate'))return;const item=(b[kind]||[]).find(x=>x.id===row.dataset.id);if(!item||(!item.box&&!b.review?.sourceName))return;const td=row.lastElementChild;if(!td)return;const btn=document.createElement('button');btn.className='v07-locate';btn.textContent='↗';btn.title='Locate this AI item in the source PDF';btn.style.cssText='margin-left:4px;padding:3px 6px;font-size:11px';btn.onclick=e=>{e.stopPropagation();openLocate(b,item);};td.appendChild(btn);});}
  document.querySelectorAll('.bh-card').forEach(card=>{if(card.querySelector('.v07-review-bh'))return;const bb=state.boreholes.find(x=>x.id===card.dataset.id);if(!bb?.review?.sourceName)return;const btn=document.createElement('button');btn.className='v07-review-bh';btn.textContent='AI';btn.title='Return to source / AI review';btn.style.cssText='margin-left:4px;padding:3px 6px;font-size:10px';btn.onclick=e=>{e.stopPropagation();openLocate(bb,{sourcePage:bb.review.sourcePage,box:null,depthM:0});};card.appendChild(btn);});
}
function addSheetTabs(){
  const state=readState(),b=active(state),head=document.querySelector('.sheet-controls');if(!state||!b||!head)return;
  let bar=$('v07SheetTabs');if(!bar){bar=document.createElement('span');bar.id='v07SheetTabs';bar.style.cssText='display:inline-flex;gap:4px;margin-right:6px';head.insertBefore(bar,head.firstChild);}
  const ranges=sheetRanges(inferredDepth(b));bar.innerHTML=ranges.map((r,i)=>`<button data-sheet="${i}" style="padding:4px 7px;font-size:10px">${r.fromM.toFixed(0)}–${r.toM.toFixed(0)} m</button>`).join('');
  bar.querySelectorAll('button').forEach(btn=>btn.onclick=()=>{const state2=readState();state2.uiSheetIndex=Number(btn.dataset.sheet);writeState(state2);const current=Number(document.querySelector('#sheetCounter')?.textContent?.match(/Sheet\s+(\d+)/)?.[1]||1)-1;const delta=Number(btn.dataset.sheet)-current;const nav=delta>0?$('nextSheet'):$('prevSheet');for(let i=0;i<Math.abs(delta);i++)nav?.click();});
}
function addDepthBadge(){
  const state=readState(),b=active(state);if(!b)return;const ranges=sheetRanges(inferredDepth(b));const v=document.querySelector('.version');if(v)v.textContent='Web v0.7';const s=document.querySelector('.statusbar span');if(s)s.innerHTML=`<strong>Web v0.7:</strong> lossless AI transfer audit • source locate • ${ranges.length>1?'multi-sheet deep boreholes':'fixed 11 m sheets'} • reference layout.`;
}
function refresh(){if(normalizeDeepBoreholes())setTimeout(()=>location.reload(),80);installTransferAudit();addLocateButtons();addSheetTabs();addDepthBadge();}

const observer=new MutationObserver(()=>{if(!busy)requestAnimationFrame(refresh);});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
window.addEventListener('storage',refresh);document.addEventListener('change',()=>setTimeout(refresh,20));document.addEventListener('click',()=>setTimeout(refresh,50));setTimeout(refresh,160);
