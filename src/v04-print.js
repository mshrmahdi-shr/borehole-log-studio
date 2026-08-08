const STORAGE_KEY='boreholeLogStudio';
const UNIT_KEY='blsDepthUnitMode';
const FT_TO_M=0.3048;
const NS='http://www.w3.org/2000/svg';

function loadState(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||null}catch{return null}}
function el(name,attrs={}){const n=document.createElementNS(NS,name);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));return n}
function addAxis(svg,b,ppm){
  if(!svg||!b)return;
  svg.querySelector('#v04-print-depth-axis')?.remove();
  const mode=localStorage.getItem(UNIT_KEY)||'dual';
  const depthM=Math.max(.1,Number(b.totalDepth)||.1),top=120,g=el('g',{id:'v04-print-depth-axis','font-family':'Segoe UI, Arial, sans-serif'});
  const metricLabels=[...svg.querySelectorAll('text')].filter(t=>t.getAttribute('x')==='36');
  metricLabels.forEach(t=>t.setAttribute('visibility',mode==='imperial'?'hidden':'visible'));
  if(mode!=='imperial'){
    const t=el('text',{x:36,y:116,'text-anchor':'end','font-size':8.5,'font-weight':700,fill:'#334155'});t.textContent='m';g.appendChild(t);
  }
  if(mode!=='metric'){
    const h=el('text',{x:101,y:116,'text-anchor':'end','font-size':8.5,'font-weight':700,fill:'#334155'});h.textContent='ft';g.appendChild(h);
    const maxFt=Math.ceil(depthM/FT_TO_M);
    for(let ft=0;ft<=maxFt;ft++){
      const m=ft*FT_TO_M;if(m>depthM+.001)break;const y=top+m*ppm,major=ft%5===0;
      g.appendChild(el('line',{x1:major?79:91,y1:y,x2:104,y2:y,stroke:'#475569','stroke-width':major?1:.55}));
      if(major){const tx=el('text',{x:76,y:y+3,'text-anchor':'end','font-size':8.5,fill:'#334155'});tx.textContent=String(ft);g.appendChild(tx)}
    }
  }
  svg.appendChild(g);
}
function decoratePrintSheets(){
  const state=loadState();if(!state?.boreholes)return;
  const ppm=Number(document.getElementById('printScale')?.value)||70;
  document.querySelectorAll('#printSheetArea .print-sheet').forEach(section=>{
    const svg=section.querySelector('svg');const label=section.querySelector('.page-number')?.textContent||'';
    const name=label.split('—').pop()?.trim();
    const b=state.boreholes.find(x=>x.name===name);
    addAxis(svg,b,ppm);
  });
}
window.addEventListener('beforeprint',decoratePrintSheets);
