import { cp, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const out = resolve(root, 'public/ocr');
await mkdir(resolve(out, 'lang-data'), { recursive: true });

async function firstExisting(paths) {
  for (const path of paths) {
    try { await access(path); return path; } catch {}
  }
  throw new Error(`OCR asset not found. Checked:\n${paths.join('\n')}`);
}

const worker = await firstExisting([
  resolve(root, 'node_modules/tesseract.js/dist/worker.min.js'),
  resolve(root, 'node_modules/tesseract.js/dist/worker.min.js.map')
]);
const core = await firstExisting([
  resolve(root, 'node_modules/tesseract.js-core/tesseract-core.wasm.js'),
  resolve(root, 'node_modules/tesseract.js-core/tesseract-core-simd.wasm.js')
]);
const wasm = await firstExisting([
  resolve(root, 'node_modules/tesseract.js-core/tesseract-core.wasm'),
  resolve(root, 'node_modules/tesseract.js-core/tesseract-core-simd.wasm')
]);
const eng = await firstExisting([
  resolve(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  resolve(root, 'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'),
  resolve(root, 'node_modules/@tesseract.js-data/eng/eng.traineddata.gz')
]);

await cp(worker, resolve(out, 'worker.min.js'));
await cp(core, resolve(out, 'tesseract-core.wasm.js'));
await cp(wasm, resolve(out, 'tesseract-core.wasm'));
await cp(eng, resolve(out, 'lang-data/eng.traineddata.gz'));
console.log('Offline OCR assets copied.');
