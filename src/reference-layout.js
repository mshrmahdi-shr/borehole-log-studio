import { SHEET_DEPTH_M, FT_TO_M, mToFt, formatFeetInches, intersectsRange, pointInRange } from './web-core.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sid=v=>String(v||'').replace(/[^a-zA-Z0-9_-]/g,'_');

export function materialComponents(material=''){
  const t=String(material).toUpperCase().replace(/\s+/g,' ').trim();
  if(!t)return ['DEFAULT'];
  const out=[];
  if(t.includes('TOPSOIL'))out.push('TOPSOIL');
  if(t.includes('FILL'))out.push('FILL');
  if(t.includes('GRAVEL'))out.push('GRAVEL');
  if(t.includes('SAND'))out.push('SAND');
  if(t.includes('SILT'))out.push('SILT');
  if(t.includes('CLAY'))out.push('CLAY');
  if(t.includes('TILL'))out.push('TILL');
  if(t.includes('ORGANIC')||t.includes('PEAT'))out.push('ORGANIC');
  if(t.includes('BEDROCK'))out.push('BEDROCK');
  return [...new Set(out.length?out:['DEFAULT'])];
}

export function compositeHatchKey(material=''){
  return materialComponents(material).join('+');
}

function defs(p){return `<defs>
<pattern id="${p}-TOPSOIL" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="6" r="1"/></pattern>
<pattern id="${p}-FILL" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 0L10 10M10 0L0 10" stroke="#222" stroke-width=".7"/></pattern>
<pattern id="${p}-GRAVEL" width="13" height="13" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.2" fill="none" stroke="#222" stroke-width=".8"/><circle cx="10" cy="10" r="2.5" fill="none" stroke="#222" stroke-width=".8"/></pattern>
<pattern id="${p}-SAND" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".75"/><circle cx="6" cy="5" r=".65"/><circle cx="3" cy="7" r=".45"/></pattern>
<pattern id="${p}-SILT" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M2 0V7M5 0V7" stroke="#222" stroke-width=".55"/></pattern>
<pattern id="${p}-CLAY" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 9L9 0M-3 3L3-3M6 12L12 6" stroke="#222" stroke-width=".7"/></pattern>
<pattern id="${p}-TILL" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M1 3h4M7 8h4M3 11h3" stroke="#222"/><circle cx="9" cy="3" r="1.2" fill="none" stroke="#222"/></pattern>
<pattern id="${p}-ORGANIC" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 5Q2 1 4 5T8 5T12 5" fill="none" stroke="#222" stroke-width=".8"/></pattern>
<pattern id="${p}-BEDROCK" width="14" height="10" patternUnits="userSpaceOnUse"><path d="M0 2H14M0 7H14M4 2V7M10 7V10" stroke="#222" stroke-width=".7"/></pattern>
<pattern id="${p}-DEFAULT" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4H8" stroke="#777" stroke-width=".5"/></pattern>
<pattern id="${p}-CONCRETE" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.6" fill="none" stroke="#333"/><circle cx="9" cy="8" r="2" fill="none" stroke="#333"/></pattern>
<pattern id="${p}-BENTONITE" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0L8 8M8 0L0 8" stroke="#333" stroke-width=".55"/></pattern>
<pattern id="${p}-SILICASAND" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".55"/><circle cx="5" cy="5" r=".55"/></pattern>
</defs>`;}

function hatchRects(p,material,x,y,w,h){
  const parts=materialComponents(material),n=parts.length;
  if(n===1)return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${p}-${parts[0]})"/>`;
  let out='';
  parts.forEach((part,i)=>{const sw=w/n;out+=`<rect x="${x+i*sw}" y="${y}" width="${sw+.4}" height="${h}" fill="url(#${p}-${part})"/>`;});
  return out;
}

function wrap(text,max=40){const words=String(text||'').split(/\s+/).filter(Boolean),out=[];let line='';for(const w of words){const n=line?`${line} ${w}`:w;if(n.length>max&&line){out.push(line);line=w}else line=n}if(line)out.push(line);return out;}

export function renderReferenceSheet({project,borehole,range,sheetIndex=0,sheetTotal=1}){
  const b=borehole,p=sid(`${b.id}-${sheetIndex}`),W=1180,top=128,ppm=66,bottom=top+SHEET_DEPTH_M*ppm,H=bottom+72;
  const y=d=>top+(Number(d)-range.fromM)*ppm;
  const cols={left:28,ft:78,m:126,desc:380,strat:432,sample:505,n:550,plot1:735,plot2:915,well:1148};
  let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="reference-sheet">${defs(p)}<rect width="${W}" height="${H}" fill="#fff"/>`;
  s+=`<text x="28" y="28" font-size="20" font-weight="700">${esc(project?.name||'')}</text><text x="28" y="49" font-size="10">Project ${esc(project?.number||'')} • ${esc(project?.location||'')}</text>`;
  s+=`<text x="1150" y="28" text-anchor="end" font-size="19" font-weight="700">${esc(b.name)}</text><text x="1150" y="49" text-anchor="end" font-size="10">Sheet ${sheetIndex+1}/${sheetTotal} • EOH ${Number(b.totalDepthM||0).toFixed(2)} m (${formatFeetInches(b.totalDepthM)})</text>`;
  Object.values(cols).forEach(x=>s+=`<line x1="${x}" y1="82" x2="${x}" y2="${bottom}" stroke="#111" stroke-width="1"/>`);
  s+=`<line x1="28" y1="82" x2="1148" y2="82" stroke="#111"/><line x1="28" y1="${top}" x2="1148" y2="${top}" stroke="#111"/><line x1="28" y1="${bottom}" x2="1148" y2="${bottom}" stroke="#111"/>`;
  const heads=[['DEPTH\n(feet)',53],['DEPTH\n(metre)',102],['DESCRIPTION',252],['STRAT',406],['SAMPLE',468],['N',528],['SHEAR / N PROFILE',642],['MOISTURE / FIELD',825],['WELL CONSTRUCTION',1032]];
  heads.forEach(([t,x])=>{const ls=t.split('\n');ls.forEach((q,i)=>s+=`<text x="${x}" y="${103+i*11}" text-anchor="middle" font-size="8.5" font-weight="700">${q}</text>`);});
  for(let m=Math.ceil(range.fromM*2)/2;m<=range.toM+.001;m+=.5){const yy=y(m),major=Math.abs(m-Math.round(m))<.001;s+=`<line x1="${major?78:91}" y1="${yy}" x2="125" y2="${yy}" stroke="#444" stroke-width="${major?1:.45}"/>`;if(major)s+=`<text x="74" y="${yy+3}" text-anchor="end" font-size="8">${m.toFixed(0)}</text>`;}
  const aFt=Math.ceil(mToFt(range.fromM)||0),zFt=Math.floor(mToFt(range.toM)||0);for(let ft=aFt;ft<=zFt;ft++){const yy=y(ft*FT_TO_M);s+=`<line x1="${ft%5===0?28:40}" y1="${yy}" x2="77" y2="${yy}" stroke="#555" stroke-width="${ft%5===0?1:.4}"/><text x="39" y="${yy+3}" text-anchor="end" font-size="7.5">${ft}</text>`;}

  (b.layers||[]).filter(r=>r.status!=='ignored'&&intersectsRange(r.fromM,r.toM,range)).forEach(r=>{
    const a=Math.max(Number(r.fromM),range.fromM),z=Math.min(Number(r.toM),range.toM),yy=y(a),hh=Math.max(1,y(z)-yy);
    s+=`<rect x="${cols.desc}" y="${yy}" width="52" height="${hh}" fill="#fff" stroke="#222" stroke-width=".6"/>${hatchRects(p,r.material,cols.desc,yy,52,hh)}`;
    s+=`<line x1="${cols.m+5}" y1="${yy}" x2="${cols.desc}" y2="${yy}" stroke="#333" stroke-width=".65"/>`;
    const text=[String(r.material||'').toUpperCase(),r.description||'',r.moisture||''].filter(Boolean).flatMap((v,i)=>i===1?wrap(v,39):[v]);const max=Math.max(1,Math.floor((hh-5)/11));text.slice(0,max).forEach((q,i)=>s+=`<text x="${cols.m+10}" y="${yy+12+i*11}" font-size="${i===0?8.5:7.4}" font-weight="${i===0?'700':'400'}">${esc(q)}</text>`);
  });

  (b.samples||[]).filter(r=>r.status!=='ignored'&&intersectsRange(r.fromM,r.toM,range)).forEach(r=>{const a=Math.max(Number(r.fromM),range.fromM),z=Math.min(Number(r.toM),range.toM),yy=y(a),hh=Math.max(10,y(z)-yy);s+=`<rect x="${cols.strat}" y="${yy}" width="73" height="${hh}" fill="#fff" stroke="#333" stroke-width=".6"/><text x="${(cols.strat+cols.sample)/2}" y="${yy+12}" text-anchor="middle" font-size="7.5">${esc(r.sampleId||'')}</text>`;});

  const tests=(b.tests||[]).filter(r=>r.status!=='ignored'&&pointInRange(r.depthM,range,true)).sort((a,c)=>a.depthM-c.depthM);
  tests.forEach(r=>{const yy=y(r.depthM);if(r.nValue!=null)s+=`<text x="${(cols.sample+cols.n)/2}" y="${yy+3}" text-anchor="middle" font-size="8" font-weight="700">${esc(r.nValue)}</text>`;});
  const graphX0=cols.n+18,graphX1=cols.plot1-10,maxN=100;for(let v=0;v<=maxN;v+=20){const x=graphX0+(graphX1-graphX0)*v/maxN;s+=`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#777" stroke-dasharray="8 8" stroke-width=".55"/><text x="${x}" y="121" text-anchor="middle" font-size="7">${v}</text>`;}
  const pts=tests.filter(t=>t.nValue!=null).map(t=>[graphX0+(graphX1-graphX0)*Math.min(maxN,Number(t.nValue))/maxN,y(t.depthM)]);if(pts.length>1)s+=`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#b33" stroke-width="1.3"/>`;pts.forEach(([x,yy])=>s+=`<path d="M${x} ${yy-4}l4 8h-8z" fill="#b33"/>`);

  const moistX0=cols.plot1+18,moistX1=cols.plot2-10;for(let v=0;v<=40;v+=10){const x=moistX0+(moistX1-moistX0)*v/40;s+=`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#777" stroke-dasharray="8 8" stroke-width=".55"/><text x="${x}" y="121" text-anchor="middle" font-size="7">${v}</text>`;}
  tests.forEach(t=>{if(t.pidPpm!=null){const val=Math.max(0,Math.min(40,Number(t.pidPpm))),x=moistX0+(moistX1-moistX0)*val/40,yy=y(t.depthM);s+=`<circle cx="${x}" cy="${yy}" r="3.2" fill="#1565d8"/><text x="${x+5}" y="${yy+3}" font-size="6.5" fill="#1565d8">${val}</text>`;}});

  if(b.well?.enabled){
    const cx=1035,outerL=cx-42,outerR=cx+42,pipeL=cx-9,pipeR=cx+9,st=b.well.screenTopM,sb=b.well.screenBottomM,rb=b.well.riserBottomM??st,wd=b.well.waterDepthM;
    const topD=range.fromM,endD=Math.min(range.toM,Number(sb ?? b.totalDepthM ?? range.toM));
    const yy=y(topD),zz=y(endD);
    s+=`<rect x="${outerL}" y="${yy}" width="84" height="${Math.max(1,zz-yy)}" fill="url(#${p}-BENTONITE)" stroke="#222"/><rect x="${outerL+8}" y="${yy}" width="68" height="${Math.max(1,zz-yy)}" fill="url(#${p}-SILICASAND)" stroke="none"/><rect x="${pipeL}" y="${yy}" width="18" height="${Math.max(1,zz-yy)}" fill="#fff" stroke="#111"/>`;
    if(st!=null&&sb!=null&&intersectsRange(st,sb,range)){const sy=y(Math.max(st,range.fromM)),sz=y(Math.min(sb,range.toM));for(let q=sy+4;q<sz;q+=7)s+=`<line x1="${pipeL+1}" y1="${q}" x2="${pipeR-1}" y2="${q}" stroke="#333"/>`;s+=`<text x="${outerL-5}" y="${sy+10}" text-anchor="end" font-size="7">2\" Slotted Pipe</text><text x="${outerR+5}" y="${sy+10}" font-size="7">Silica Sand</text>`;}
    if(rb!=null&&pointInRange(rb,range,true)){const ry=y(rb);s+=`<text x="${outerL-5}" y="${ry}" text-anchor="end" font-size="7">2\" blank PVC</text>`;}
    if(wd!=null&&pointInRange(wd,range,true)){const wy=y(wd);s+=`<path d="M${cx-18} ${wy}h36l-18 11z" fill="#168bd2"/><text x="${cx}" y="${wy-4}" text-anchor="middle" font-size="7" fill="#168bd2">GW ${Number(wd).toFixed(2)}m</text>`;}
  }

  if(b.totalDepthM>=range.fromM&&b.totalDepthM<=range.toM){const ey=y(b.totalDepthM);s+=`<line x1="${cols.m+5}" y1="${ey}" x2="${cols.plot2}" y2="${ey}" stroke="#111" stroke-width="1.2"/><text x="${cols.m+45}" y="${Math.min(bottom-3,ey+13)}" font-size="8" font-weight="700">End of Borehole at ${Number(b.totalDepthM).toFixed(2)}m</text>`;}
  s+=`<text x="28" y="${H-28}" font-size="8">Depth window ${range.fromM.toFixed(0)}–${range.toM.toFixed(0)} m / ${(mToFt(range.fromM)||0).toFixed(0)}–${(mToFt(range.toM)||0).toFixed(0)} ft</text><text x="1148" y="${H-28}" text-anchor="end" font-size="8">Borehole Log Studio • Reference Layout</text></svg>`;
  return s;
}
