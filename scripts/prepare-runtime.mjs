import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Download PyYAML at image-build time so Pyodide can load it locally.
const root = new URL('../node_modules/pyodide/', import.meta.url);
const lock = JSON.parse(await readFile(new URL('pyodide-lock.json', root), 'utf8'));
const version = JSON.parse(await readFile(new URL('package.json', root), 'utf8')).version;
const pkg = lock.packages.pyyaml;
if (!pkg?.file_name || !pkg.sha256) throw new Error('PyYAML missing from Pyodide lock');
const response = await fetch(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${pkg.file_name}`);
if (!response.ok) throw new Error(`PyYAML download: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== pkg.sha256) {
  throw new Error('PyYAML integrity check failed');
}
await writeFile(new URL(pkg.file_name, root), bytes);

// Serve the complete Python runtime from this origin, without a runtime CDN.
const { cp } = await import('node:fs/promises');
await mkdir('public/runtime', { recursive: true });
await cp(root, 'public/runtime/pyodide', { recursive: true });
await copyFile('node_modules/pandoc-wasm/src/pandoc.wasm', 'public/runtime/pandoc.wasm');
console.log(`Prepared Pyodide ${version}, verified PyYAML, and Pandoc WASM`);

await copyFile('node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm', 'public/runtime/typst.wasm');
await mkdir('public/runtime/fonts', { recursive: true });
for (const style of ['Regular', 'Italic', 'Bold', 'BoldItalic', 'Semibold', 'SemiboldItalic']) {
  const name = `LibertinusSerif-${style}.otf`;
  const result = await fetch(`https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.13.1/files/fonts/${name}`);
  if (!result.ok) throw new Error(`Font ${name}: HTTP ${result.status}`);
  await writeFile(`public/runtime/fonts/${name}`, Buffer.from(await result.arrayBuffer()));
}
await cp('/usr/share/fonts/truetype/liberation2', 'public/runtime/fonts', { recursive: true });
await mkdir('public/runtime/wrap-it', { recursive: true });
for (const name of ['typst.toml', 'wrap-it.typ', 'LICENSE', 'README.md']) {
  const result = await fetch(`https://raw.githubusercontent.com/typst/packages/main/packages/preview/wrap-it/0.1.1/${name}`);
  if (!result.ok) throw new Error(`wrap-it ${name}: HTTP ${result.status}`);
  await writeFile(`public/runtime/wrap-it/${name}`, Buffer.from(await result.arrayBuffer()));
}

// The upstream wrapper fixes WASI's environment to []. Make that an explicit
// factory argument so the original Lua os.getenv calls work unchanged.
let core = await readFile('node_modules/pandoc-wasm/src/core.js', 'utf8');
if (!core.includes('createPandocInstance(wasmBinary)') || !core.includes('const env = []')) {
  throw new Error('Pandoc wrapper changed: review the environment adapter');
}
core = core.replace('createPandocInstance(wasmBinary)', 'createPandocInstance(wasmBinary, environment = {})')
  .replace('const env = []', 'const env = Object.entries(environment).map(([key, value]) => `${key}=${value}`)');
await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/pandoc-core.js', core);
