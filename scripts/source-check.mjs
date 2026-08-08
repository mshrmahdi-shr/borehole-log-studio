import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';

const root = process.cwd();
const skip = new Set(['node_modules', 'dist', 'target', '.git', 'test-fixtures']);
const textExt = new Set(['.js', '.mjs', '.json', '.html', '.css', '.md', '.toml', '.yml', '.yaml', '.rs']);
let failures = 0;

async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = resolve(dir, e.name);
    if (e.isDirectory()) {
      await walk(p);
      continue;
    }

    if (!textExt.has(extname(e.name).toLowerCase())) continue;

    const text = await readFile(p, 'utf8');
    const cleaned = text
      .replace(/https:\/\/schema\.tauri\.app\/config\/2/g, '')
      .replace(/http:\/\/localhost:1420/g, '')
      .replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')
      .replace(/http:\/\/ipc\.localhost/g, '');

    if (/https?:\/\//i.test(cleaned) && !e.name.endsWith('.md') && !e.name.endsWith('.yml')) {
      console.error(`External URL found in runtime source: ${relative(root, p)}`);
      failures++;
    }

    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(text)) {
      console.error(`Arabic/Persian script found: ${relative(root, p)}`);
      failures++;
    }
  }
}

await walk(root);

if (failures) process.exit(1);

console.log('PASS: English-only runtime source and no external runtime URLs.');
console.log(`Project root: ${root}`);
