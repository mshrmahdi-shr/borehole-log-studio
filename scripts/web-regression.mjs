import assert from 'node:assert/strict';
import {
  SHEET_DEPTH_M, sheetCount, sheetRanges, ftToM, mToFt, parseImperialDepth,
  formatFeetInches, sanitizeAiPage, mergeBoreholePages, validateBorehole
} from '../src/web-core.js';

assert.equal(SHEET_DEPTH_M, 11);
assert.equal(sheetCount(0), 1);
assert.equal(sheetCount(3.2), 1);
assert.equal(sheetCount(8.08), 1);
assert.equal(sheetCount(11), 1);
assert.equal(sheetCount(11.01), 2);
assert.equal(sheetCount(18.75), 2);
assert.equal(sheetCount(28), 3);
assert.deepEqual(sheetRanges(18.75), [
  { index:0, fromM:0, toM:11 },
  { index:1, fromM:11, toM:22 }
]);

assert.ok(Math.abs(ftToM(10) - 3.048) < 1e-9);
assert.ok(Math.abs(mToFt(3.048) - 10) < 1e-9);
assert.equal(parseImperialDepth("7'-6\""), 7.5);
assert.equal(parseImperialDepth('15 ft 3 in'), 15.25);
assert.equal(formatFeetInches(3.048), "10'-0\"");

const ai = sanitizeAiPage({
  borehole_id:'BH-7',
  total_depth_ft:"26'-4\"",
  layers:[
    { from_ft:0, to_ft:2.5, material:'TOPSOIL', description:'dark brown', confidence:.95, box:[10,20,300,80] },
    { from_ft:2.5, to_ft:8, material:'SILTY SAND', description:'trace gravel', confidence:.7 }
  ],
  samples:[{ sample_id:'SS-1', from_ft:1, to_ft:2.5, analyses:[], confidence:.9 }],
  tests:[{ depth_ft:2.5, spt_blows:'2-3-4', n_value:7, pid_ppm:null, confidence:.8 }],
  well:{ monitoring_well:true, screen_top_ft:10, screen_bottom_ft:15, confidence:.9 },
  warnings:[]
}, 1, 'sample.pdf');

assert.equal(ai.name, 'BH-7');
assert.equal(ai.layers.length, 2);
assert.deepEqual(ai.samples[0].analyses, []);
assert.equal(ai.layers[0].status, 'draft');
assert.ok(ai.totalDepthM > 8 && ai.totalDepthM < 8.1);
assert.equal(validateBorehole(ai).filter(x=>x.level==='error').length, 0);

const p2 = sanitizeAiPage({ borehole_id:'BH-7', total_depth_ft:61.5, layers:[{from_ft:36,to_ft:61.5,material:'SAND',confidence:.9}], warnings:[] }, 2, 'sample.pdf');
const merged = mergeBoreholePages([ai,p2]);
assert.equal(merged.layers.length, 3);
assert.ok(merged.totalDepthM > 18.7 && merged.totalDepthM < 18.8);
assert.equal(sheetCount(merged.totalDepthM), 2);

console.log('PASS web regression: fixed 11 m sheets, dual-unit conversion, AI sanitization, no fabricated analyses.');
