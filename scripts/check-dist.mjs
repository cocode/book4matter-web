import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = process.env.VITE_BASE_PATH || '/';
assert.ok(base.startsWith('/') && base.endsWith('/'), 'VITE_BASE_PATH must be an absolute path ending in /');
const html = await readFile('dist/index.html', 'utf8');
assert.ok(html.includes(`href="${base}" class="brand"`), 'Home link does not use the deployment base');
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
for (const url of references.filter(url => url !== base)) {
  assert.ok(url.startsWith(base), `Asset URL escapes the deployment base: ${url}`);
  assert.ok((await stat(`dist/${url.slice(base.length)}`)).isFile(), `Missing built asset: ${url}`);
}
assert.ok(references.some(url => url.endsWith('.js')), 'Missing application bundle');
assert.ok(references.some(url => url.endsWith('.css')), 'Missing stylesheet');
const manifest = JSON.parse(await readFile('dist/assets.json', 'utf8'));
assert.ok(manifest.files.includes('book4matter/bf/__main__.py'));
assert.ok(manifest.files.includes('book4matter/templates/book.typ'));
for (const path of manifest.files) {
  assert.ok(!path.startsWith('/') && !path.split('/').includes('..'), `Invalid manifest path: ${path}`);
  const bytes = await readFile(`dist/${path}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.hashes[path], `Stale asset: ${path}`);
}
for (const path of ['runtime/pandoc.wasm', 'runtime/typst.wasm', 'runtime/pyodide/pyodide.asm.wasm']) {
  const bytes = await readFile(`dist/${path}`);
  assert.equal(bytes.subarray(0, 4).toString('hex'), '0061736d', `Invalid WASM file: ${path}`);
}
for (const path of ['browser_adapter.py', 'runtime/pyodide/pyodide.mjs']) await stat(`dist/${path}`);
console.log(`PASS: static HTML URLs and ${manifest.files.length} publishing assets are ready at ${base}`);
