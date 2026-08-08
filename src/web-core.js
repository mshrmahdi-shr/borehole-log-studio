export const SHEET_DEPTH_M = 11;
export const FT_TO_M = 0.3048;

export const MATERIALS = [
  'TOPSOIL','ASPHALT','CONCRETE','FILL','GRAVEL','SAND','SILTY SAND','SANDY SILT',
  'SILT','CLAYEY SILT','SILTY CLAY','CLAY','TILL','ORGANIC SOIL','BEDROCK'
];

export function uid(prefix='id') {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

export function mToFt(m) {
  const n = Number(m);
  return Number.isFinite(n) ? n / FT_TO_M : null;
}

export function ftToM(ft) {
  const n = Number(ft);
  return Number.isFinite(n) ? n * FT_TO_M : null;
}

export function feetInchesToFeet(feet, inches=0) {
  const f = Number(feet), i = Number(inches);
  if (!Number.isFinite(f) || !Number.isFinite(i)) return null;
  return f + i / 12;
}

export function parseImperialDepth(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?\s*(?:(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"))?/i);
  if (!match) return null;
  return feetInchesToFeet(Number(match[1]), Number(match[2] || 0));
}

export function formatFeetInches(metres) {
  const ft = mToFt(metres);
  if (ft == null) return '';
  let whole = Math.floor(Math.abs(ft));
  let inches = Math.round((Math.abs(ft) - whole) * 12);
  if (inches === 12) { whole += 1; inches = 0; }
  return `${ft < 0 ? '-' : ''}${whole}'-${inches}\"`;
}

export function normalizeMaterial(value='') {
  const text = String(value).toUpperCase().replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return [...MATERIALS].sort((a,b)=>b.length-a.length).find(m=>text.includes(m)) || text;
}

export function sheetCount(totalDepthM) {
  const d = Math.max(0, Number(totalDepthM) || 0);
  return Math.max(1, Math.ceil(d / SHEET_DEPTH_M));
}

export function sheetRanges(totalDepthM) {
  return Array.from({ length: sheetCount(totalDepthM) }, (_, i) => ({
    index: i,
    fromM: i * SHEET_DEPTH_M,
    toM: (i + 1) * SHEET_DEPTH_M
  }));
}

export function intersectsRange(from, to, range) {
  const a = Number(from), b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return b > range.fromM && a < range.toM;
}

export function pointInRange(depth, range, includeEnd=false) {
  const d = Number(depth);
  if (!Number.isFinite(d)) return false;
  return d >= range.fromM && (includeEnd ? d <= range.toM : d < range.toM);
}

export function blankBorehole(name='BH-1') {
  return {
    id: uid('bh'), name, totalDepthM: 0, groundElevationM: null,
    drillingMethod: '', drillDate: '',
    layers: [], samples: [], tests: [],
    well: { enabled:false, riserBottomM:null, screenTopM:null, screenBottomM:null, waterDepthM:null },
    review: { sourceName:'', sourcePage:null, warnings:[] }
  };
}

export function blankProject() {
  const bh = blankBorehole();
  return {
    schemaVersion: 5,
    project: { name:'New Borehole Project', number:'', location:'' },
    activeBoreholeId: bh.id,
    boreholes: [bh]
  };
}

export function ensureBorehole(input={}) {
  const b = { ...blankBorehole(input.name || 'BH'), ...input };
  b.layers = Array.isArray(input.layers) ? input.layers : [];
  b.samples = Array.isArray(input.samples) ? input.samples : [];
  b.tests = Array.isArray(input.tests) ? input.tests : [];
  b.well = { ...blankBorehole().well, ...(input.well || {}) };
  b.review = { ...blankBorehole().review, ...(input.review || {}) };
  return b;
}

export function validateBorehole(borehole) {
  const b = ensureBorehole(borehole);
  const issues = [];
  if (!b.name.trim()) issues.push({ level:'error', code:'missing-name', message:'Borehole ID is required.' });
  if (!Number.isFinite(Number(b.totalDepthM)) || Number(b.totalDepthM) < 0) issues.push({ level:'error', code:'depth', message:'Total depth must be zero or greater.' });
  const layers = [...b.layers].filter(x=>x.fromM != null && x.toM != null).sort((a,c)=>Number(a.fromM)-Number(c.fromM));
  layers.forEach((layer,i)=>{
    const from=Number(layer.fromM), to=Number(layer.toM);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) issues.push({ level:'error', code:'layer-range', itemId:layer.id, message:`Invalid layer range ${i+1}.` });
    if (Number.isFinite(Number(b.totalDepthM)) && to > Number(b.totalDepthM) + 1e-6) issues.push({ level:'warning', code:'layer-below-eoh', itemId:layer.id, message:`Layer ${i+1} extends below end of borehole.` });
    if (i && Number(layers[i-1].toM) > from + 1e-6) issues.push({ level:'warning', code:'layer-overlap', itemId:layer.id, message:`Layer overlap near ${from.toFixed(2)} m.` });
  });
  if (b.well.enabled) {
    const st=Number(b.well.screenTopM), sb=Number(b.well.screenBottomM);
    if (!Number.isFinite(st) || !Number.isFinite(sb) || sb <= st) issues.push({ level:'warning', code:'screen-range', message:'Monitoring-well screen interval needs review.' });
  }
  return issues;
}

export function confidenceStatus(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return 'manual';
  if (c >= 0.85) return 'high';
  if (c >= 0.6) return 'review';
  return 'low';
}

export function normalizedBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const nums = box.map(Number);
  if (nums.some(x=>!Number.isFinite(x))) return null;
  const [x1,y1,x2,y2]=nums;
  return [clamp(x1,0,1000),clamp(y1,0,1000),clamp(x2,0,1000),clamp(y2,0,1000)];
}

export function sanitizeAiPage(raw, pageNumber=1, sourceName='') {
  const data = raw && typeof raw === 'object' ? raw : {};
  const borehole = blankBorehole(String(data.borehole_id || `Page-${pageNumber}`));
  const totalFt = parseImperialDepth(data.total_depth_ft);
  borehole.totalDepthM = totalFt == null ? 0 : ftToM(totalFt);
  borehole.groundElevationM = data.ground_elevation_m == null ? null : Number(data.ground_elevation_m);
  borehole.review = { sourceName, sourcePage:pageNumber, warnings:Array.isArray(data.warnings)?data.warnings.map(String):[] };

  borehole.layers = (Array.isArray(data.layers)?data.layers:[]).map(row=>{
    const fromFt=parseImperialDepth(row.from_ft), toFt=parseImperialDepth(row.to_ft);
    return {
      id:uid('layer'), fromM:fromFt==null?null:ftToM(fromFt), toM:toFt==null?null:ftToM(toFt),
      material:normalizeMaterial(row.material || ''), description:String(row.description || ''), moisture:String(row.moisture || ''),
      confidence:Number.isFinite(Number(row.confidence))?clamp(row.confidence,0,1):null,
      evidence:String(row.evidence || ''), box:normalizedBox(row.box), status:'draft'
    };
  });
  borehole.samples = (Array.isArray(data.samples)?data.samples:[]).map(row=>{
    const fromFt=parseImperialDepth(row.from_ft), toFt=parseImperialDepth(row.to_ft);
    return {
      id:uid('sample'), sampleId:String(row.sample_id || ''), fromM:fromFt==null?null:ftToM(fromFt), toM:toFt==null?null:ftToM(toFt),
      analyses:Array.isArray(row.analyses)?row.analyses.map(String):[], confidence:Number.isFinite(Number(row.confidence))?clamp(row.confidence,0,1):null,
      evidence:String(row.evidence || ''), box:normalizedBox(row.box), status:'draft'
    };
  });
  borehole.tests = (Array.isArray(data.tests)?data.tests:[]).map(row=>{
    const dFt=parseImperialDepth(row.depth_ft);
    return {
      id:uid('test'), depthM:dFt==null?null:ftToM(dFt), sptBlows:String(row.spt_blows || ''),
      nValue:row.n_value==null?null:Number(row.n_value), pidPpm:row.pid_ppm==null?null:Number(row.pid_ppm),
      confidence:Number.isFinite(Number(row.confidence))?clamp(row.confidence,0,1):null,
      evidence:String(row.evidence || ''), box:normalizedBox(row.box), status:'draft'
    };
  });
  const well=data.well||{};
  const st=parseImperialDepth(well.screen_top_ft), sb=parseImperialDepth(well.screen_bottom_ft), wd=parseImperialDepth(well.water_depth_ft), rb=parseImperialDepth(well.riser_bottom_ft);
  borehole.well={
    enabled:well.monitoring_well===true || st!=null || sb!=null,
    riserBottomM:rb==null?null:ftToM(rb), screenTopM:st==null?null:ftToM(st), screenBottomM:sb==null?null:ftToM(sb), waterDepthM:wd==null?null:ftToM(wd),
    confidence:Number.isFinite(Number(well.confidence))?clamp(well.confidence,0,1):null,
    evidence:String(well.evidence || ''), box:normalizedBox(well.box)
  };
  return borehole;
}

export function mergeBoreholePages(pages=[]) {
  if (!pages.length) return blankBorehole();
  const first=ensureBorehole(pages[0]);
  const merged=ensureBorehole({ ...first, id:uid('bh'), layers:[], samples:[], tests:[] });
  for (const p of pages.map(ensureBorehole)) {
    if (p.name && /^page-/i.test(merged.name) && !/^page-/i.test(p.name)) merged.name=p.name;
    merged.totalDepthM=Math.max(Number(merged.totalDepthM)||0, Number(p.totalDepthM)||0);
    merged.layers.push(...p.layers);
    merged.samples.push(...p.samples);
    merged.tests.push(...p.tests);
    if (p.well.enabled) merged.well={...merged.well,...p.well,enabled:true};
    merged.review.warnings.push(...(p.review.warnings||[]));
  }
  return merged;
}
