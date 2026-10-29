import { readFile, mkdir, copyFile, writeFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pinned = JSON.parse(await readFile(new URL('./runtime-assets.json', import.meta.url), 'utf8'));
async function download(url, sha256) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error(`Integrity check failed: ${url}`);
  }
  return bytes;
}

// Prepare PyYAML in CI so the deployed browser runtime loads it from this site.
const root = new URL('../node_modules/pyodide/', import.meta.url);
const lock = JSON.parse(await readFile(new URL('pyodide-lock.json', root), 'utf8'));
const version = JSON.parse(await readFile(new URL('package.json', root), 'utf8')).version;
const pkg = lock.packages.pyyaml;
if (pkg?.file_name !== pinned.pyyaml.file_name || pkg.sha256 !== pinned.pyyaml.sha256) {
  throw new Error('PyYAML differs from the reviewed runtime pin');
}
const bytes = await download(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`, pkg.sha256);
await writeFile(new URL(pkg.file_name, root), bytes);

// Serve the complete Python runtime from this origin, without a runtime CDN.
await mkdir('public/runtime', { recursive: true });
await cp(root, 'public/runtime/pyodide', { recursive: true });
await copyFile('node_modules/pandoc-wasm/src/pandoc.wasm', 'public/runtime/pandoc.wasm');
console.log(`Prepared Pyodide ${version}, verified PyYAML, and Pandoc WASM`);

await copyFile('node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm', 'public/runtime/typst.wasm');
await mkdir('public/runtime/fonts', { recursive: true });
for (const { name, url, sha256 } of pinned.fonts) {
  await writeFile(`public/runtime/fonts/${name}`, await download(url, sha256));
}
// Use the reviewed font release, independent of the runner's system packages.
const temporary = await mkdtemp(join(tmpdir(), 'book4matter-fonts-'));
try {
  const archive = join(temporary, 'fonts.tar.gz');
  await writeFile(archive, await download(pinned.liberation.url, pinned.liberation.sha256));
  const names = ['Sans', 'Serif', 'Mono'].flatMap(family =>
    ['Regular', 'Italic', 'Bold', 'BoldItalic'].map(style => `Liberation${family}-${style}.ttf`));
  const prefix = `liberation-fonts-ttf-${pinned.liberation.version}`;
  // Extract only the expected data files, including the font license.
  execFileSync('tar', ['-xzf', archive, '-C', temporary,
    ...[...names, 'LICENSE'].map(name => `${prefix}/${name}`)]);
  for (const name of names) await copyFile(join(temporary, prefix, name), `public/runtime/fonts/${name}`);
  await copyFile(join(temporary, prefix, 'LICENSE'), 'public/runtime/fonts/Liberation-LICENSE');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
await mkdir('public/runtime/wrap-it', { recursive: true });
for (const { name, url, sha256 } of pinned.wrapIt) {
  await writeFile(`public/runtime/wrap-it/${name}`, await download(url, sha256));
}

// The upstream wrapper fixes WASI's environment to []. Make that an explicit
// factory argument so the original Lua os.getenv calls work unchanged.
let core = await readFile('node_modules/pandoc-wasm/src/core.js', 'utf8');
if (!core.includes('createPandocInstance(wasmBinary)') || !core.includes('const env = []')) {
  throw new Error('Pandoc wrapper changed: review the environment adapter');
}
core = core.replace('createPandocInstance(wasmBinary)', 'createPandocInstance(wasmBinary, environment = {})')
  .replace('const env = []', 'const env = Object.entries(environment).map(([key, value]) => `${key}=${value}`)');
// The upstream addFile puts slash-containing names in a flat Map. Build real
// directories so resources, metadata, and duplicate basenames remain usable.
const flatWrite = 'fileSystem.set(filename, file)';
if (core.split(flatWrite).length !== 2) throw new Error('Pandoc filesystem adapter changed; review nested paths');
core = core.replace(flatWrite, `
            const parts = filename.replace(/^\\/+/, '').split('/')
            if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid WASI path: ' + filename)
            let directory = fileSystem
            for (const part of parts.slice(0, -1)) {
                if (!directory.has(part)) directory.set(part, new Directory(new Map()))
                const child = directory.get(part)
                if (!(child instanceof Directory)) throw new Error('WASI file/directory conflict: ' + filename)
                directory = child.contents
            }
            directory.set(parts.at(-1), file)`);
await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/pandoc-core.js', core);
