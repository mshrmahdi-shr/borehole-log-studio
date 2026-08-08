import { sheetRanges } from './web-core.js';
import { renderReferenceSheet } from './reference-layout.js';

const STORAGE_KEY='boreholeLogStudioWebV1';
const $=id=>document.getElementById(id);
let renderQueued=false;
let internalWrite=false;

function readState(){
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch{return null;}
}
function activeBorehole(state){return state?.boreholes?.find(b=>b.id===state.activeBoreholeId)||state?.boreholes?.[0]||null;}
function currentSheetIndex(state,b){
  const ranges=sheetRanges(b?.totalDepthM||0);return Math.max(0,Math.min(Number(state?.uiSheetIndex)||0,ranges.length-1));
}
function referenceRender(){
  if(internalWrite)return;
  const host=$('sheetHost'),state=readState(),b=activeBorehole(state);if(!host||!state||!b)return;
  const ranges=sheetRanges(b.totalDepthM||0),idx=currentSheetIndex(state,b),range=ranges[idx];
  const html=`<div class="sheet-card reference-layout-card">${renderReferenceSheet({project:state.project,borehole:b,range,sheetIndex:idx,sheetTotal:ranges.length})}</div>`;
  if(host.dataset.referenceKey===`${b.id}:${idx}:${JSON.stringify(b.layers)}:${JSON.stringify(b.samples)}:${JSON.stringify(b.tests)}:${JSON.stringify(b.well)}`)return;
  internalWrite=true;host.innerHTML=html;host.dataset.referenceKey=`${b.id}:${idx}:${JSON.stringify(b.layers)}:${JSON.stringify(b.samples)}:${JSON.stringify(b.tests)}:${JSON.stringify(b.well)}`;internalWrite=false;
  const counter=$('sheetCounter');if(counter)counter.textContent=`Sheet ${idx+1} of ${ranges.length} • ${range.fromM.toFixed(0)}–${range.toM.toFixed(0)} m • Reference layout`;
}
function queueRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;referenceRender();});}

function addReferenceBadge(){
  const version=document.querySelector('.version');if(version)version.textContent='Web v0.6';
  const status=document.querySelector('.statusbar span');if(status)status.innerHTML='<strong>Web v0.6:</strong> reference-log layout • fixed 11 m sheets • composite soil hatches • AI/manual review.';
}

function addQueueTools(){
  const footer=document.querySelector('.review-footer');if(!footer||$('applyAllReady'))return;
  const btn=document.createElement('button');btn.id='applyAllReady';btn.textContent='Apply All Ready Drafts';btn.title='Adds every reviewed draft that has no unresolved Draft items.';
  footer.insertBefore(btn,$('applyReview'));
  btn.onclick=()=>applyAllReady();
}

function reviewHasUnresolved(){
  const summary=$('reviewSummary')?.textContent||'';
  const m=summary.match(/(\d+)\s+unresolved/i);return m?Number(m[1])>0:false;
}
async function applyAllReady(){
  const apply=$('applyReview');if(!apply)return;
  let guard=0,applied=0;
  while(!$('reviewModal')?.classList.contains('hidden')&&guard++<100){
    if(apply.disabled||reviewHasUnresolved())break;
    const before=$('draftNav')?.textContent||'';apply.click();applied++;
    await new Promise(r=>setTimeout(r,40));
    const after=$('draftNav')?.textContent||'';
    if(before===after&&(!$('reviewModal')||$('reviewModal').classList.contains('hidden')))break;
    if(before===after&&!after)break;
  }
  if(applied){queueRender();const toast=$('toast');if(toast){toast.textContent=`${applied} reviewed borehole draft(s) added.`;toast.className='toast';setTimeout(()=>toast.className='toast hidden',3200);}}
}

function patchPrint(){
  const btn=$('printAll');if(!btn||btn.dataset.v06)return;btn.dataset.v06='1';
  btn.addEventListener('click',e=>{
    e.stopImmediatePropagation();e.preventDefault();
    const state=readState();if(!state?.boreholes?.length)return;
    const area=$('printArea');let html='';
    state.boreholes.forEach(b=>{const ranges=sheetRanges(b.totalDepthM||0);ranges.forEach((range,i)=>{html+=`<section class="print-sheet">${renderReferenceSheet({project:state.project,borehole:b,range,sheetIndex:i,sheetTotal:ranges.length})}<div class="print-caption">${b.name} — Sheet ${i+1} of ${ranges.length}</div></section>`;});});
    area.innerHTML=html;setTimeout(()=>window.print(),80);
  },true);
}

function enhanceReview(){
  addQueueTools();
  const analyzeAll=$('analyzeAll');if(analyzeAll&&!analyzeAll.dataset.v06){analyzeAll.dataset.v06='1';analyzeAll.insertAdjacentHTML('afterend','<span id="allPagesHint" style="font-size:10px;color:#526776;align-self:center">Analyze All → review queue → Apply All Ready Drafts</span>');}
}

function setupObservers(){
  const root=document.body;const observer=new MutationObserver(muts=>{if(internalWrite)return;let needs=false;for(const m of muts){if(m.target?.id==='sheetHost')continue;needs=true;break;}if(needs){enhanceReview();queueRender();}});observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class','value']});
  window.addEventListener('storage',queueRender);document.addEventListener('change',()=>setTimeout(queueRender,0));document.addEventListener('click',()=>setTimeout(queueRender,20));
}

addReferenceBadge();addQueueTools();patchPrint();enhanceReview();setupObservers();setTimeout(referenceRender,100);
