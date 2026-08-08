const GEMINI_MODELS_ENDPOINT='https://generativelanguage.googleapis.com/v1beta/models';
const nativeFetch=window.fetch.bind(window);
let cache={key:'',models:[]};
const nameOf=m=>String(m?.name||m||'').replace(/^models\//,'');
const supports=m=>Array.isArray(m?.supportedGenerationMethods)&&m.supportedGenerationMethods.includes('generateContent');
const excluded=n=>/(embedding|aqa|imagen|veo|tts|live|robotics|nano|gemma)/i.test(n);
function status(t){const e=document.getElementById('aiStatus');if(e)e.textContent=t;}
function score(m){const n=nameOf(m).toLowerCase();if(!n.includes('gemini')||excluded(n))return-999;let s=100;if(n.includes('flash'))s+=80;if(n.includes('pro'))s+=60;if(n.includes('vision'))s+=30;if(n.includes('latest'))s+=25;if(n.includes('preview'))s-=5;if(n.includes('exp'))s-=20;return s;}
async function listModels(key,force=false){
 if(!key)throw new Error('Enter a Gemini API key first.');
 if(!force&&cache.key===key&&cache.models.length)return cache.models;
 const r=await nativeFetch(`${GEMINI_MODELS_ENDPOINT}?pageSize=1000&key=${encodeURIComponent(key)}`);
 if(!r.ok)throw new Error(`Model discovery ${r.status}: ${(await r.text()).slice(0,220)}`);
 const p=await r.json();
 const models=(p.models||[]).filter(supports).filter(m=>score(m)>0).sort((a,b)=>score(b)-score(a));
 if(!models.length)throw new Error('No Gemini generateContent model is available for this API key.');
 cache={key,models};
 const dl=document.getElementById('aiModelOptions');if(dl)dl.innerHTML=models.map(m=>`<option value="${nameOf(m)}"></option>`).join('');
 return models;
}
function parse(url){try{const u=new URL(url,location.href);if(u.hostname!=='generativelanguage.googleapis.com')return null;const m=u.pathname.match(/\/v1beta\/models\/([^/:]+):generateContent$/i);if(!m)return null;return{u,key:u.searchParams.get('key')||'',requested:decodeURIComponent(m[1])};}catch{return null;}}
function replace(u,model){return u.toString().replace(/\/models\/[^/:?]+:generateContent/i,`/models/${encodeURIComponent(model)}:generateContent`);}
async function tryCandidates(info,init,skip=[]){
 const models=await listModels(info.key,true);const names=models.map(nameOf).filter(n=>!skip.includes(n));
 const requested=String(info.requested||'').trim();const candidates=[];
 if(requested&&requested.toLowerCase()!=='auto'&&names.includes(requested))candidates.push(requested);
 names.forEach(n=>{if(!candidates.includes(n))candidates.push(n);});
 let last=null;const errors=[];
 for(const model of candidates){
   status(`Trying ${model}…`);
   const r=await nativeFetch(replace(info.u,model),init);last=r;
   if(r.ok){const f=document.getElementById('aiModel');if(f)f.value=model;sessionStorage.setItem('blsGeminiResolvedModelV2',model);status(`Connected to ${model}.`);return r;}
   let body='';try{body=await r.clone().text();}catch{}
   errors.push(`${model}: ${r.status}`);
   if([401,403,429].includes(r.status)){status(`Gemini ${r.status}: check API key, permission or quota.`);return r;}
   if(![400,404].includes(r.status))return r;
 }
 status(`No compatible model succeeded (${errors.join(', ')}).`);
 return last||nativeFetch(info.u.toString(),init);
}
window.fetch=async function(input,init){
 const url=typeof input==='string'?input:input?.url;const info=parse(url);if(!info)return nativeFetch(input,init);
 if(info.requested.toLowerCase()==='auto')return tryCandidates(info,init);
 const first=await nativeFetch(input,init);
 if(first.ok||![400,404].includes(first.status))return first;
 status(`${info.requested} is unavailable. Searching current models…`);
 return tryCandidates(info,init,[info.requested]);
};
async function refresh(){const key=document.getElementById('aiKey')?.value.trim(),b=document.getElementById('refreshAiModels');if(b)b.disabled=true;try{status('Checking models available to this API key…');const ms=await listModels(key,true),r=nameOf(ms[0]),f=document.getElementById('aiModel');if(f)f.value=r;status(`${ms.length} compatible model(s) found. Recommended: ${r}.`);}catch(e){console.error(e);status(e.message);}finally{if(b)b.disabled=false;}}
document.addEventListener('DOMContentLoaded',()=>{const f=document.getElementById('aiModel');if(f)f.value='auto';document.getElementById('refreshAiModels')?.addEventListener('click',refresh);status('AI router v2 loaded. Model selection is automatic.');});
