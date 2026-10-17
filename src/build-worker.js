import { createPandocInstance } from './generated/pandoc-core.js';
import { createTypstCompiler, CompileFormatEnum } from '@myriaddreamin/typst.ts/compiler';
import { loadFonts, withPackageRegistry } from '@myriaddreamin/typst.ts/dist/esm/options.init.mjs';

const encoder = new TextEncoder();
const log = message => postMessage({ type: 'log', message });
async function get(path, binary = false) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.text();
}

async function build() {
  log('Loading local Python and publishing assets…');
  const runtimeURL = new URL('/runtime/pyodide/pyodide.mjs', self.location).href;
  const { loadPyodide } = await import(/* @vite-ignore */ runtimeURL);
  const python = await loadPyodide({ indexURL: new URL('/runtime/pyodide/', self.location).href,
    stdout: log, stderr: log });
  await python.loadPackage('pyyaml');
  const manifest = JSON.parse(await get('/assets.json'));
  const assets = new Map(await Promise.all(manifest.files.map(async path => [path, await get(`/${path}`, true)])));
  const fs = python.FS;
  const write = (path, bytes) => {
    fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    fs.writeFile(path, bytes);
  };
  for (const [path, bytes] of assets) {
    if (path.startsWith('book4matter/')) write('/book/' + path.slice('book4matter/'.length), bytes);
  }
  write('/book/browser_adapter.py', await get('/browser_adapter.py', true));
  const wasm = await get('/runtime/pandoc.wasm', true);
  let compiler;
  const walk = root => fs.readdir(root).filter(name => !['.', '..'].includes(name)).flatMap(name => {
    const path = `${root}/${name}`;
    return fs.isDir(fs.stat(path).mode) ? walk(path) : [path];
  });

  python.registerJsModule('book4matter_backend', {
    dispatch: async serialized => {
      const { argv, env } = JSON.parse(serialized);
      if (argv[0] === 'pandoc') {
        log('Applying the original Lua filters with Pandoc WASM…');
        const pandoc = await createPandocInstance(wasm, env);
        const files = {};
        const input = [];
        const filters = [];
        let output;
        // This adapter intentionally accepts only the existing print command.
        // Unknown flags fail rather than silently changing publishing behavior.
        for (let i = 1; i < argv.length; i++) {
          const arg = argv[i];
          if (arg === '-f' || arg === '-t') {
            const value = argv[++i];
            if (value !== (arg === '-f' ? 'markdown' : 'typst')) throw new Error(`Unsupported format: ${value}`);
          } else if (arg === '-o') output = argv[++i];
          else if (arg === '--wrap=preserve') { /* represented below */ }
          else if (arg.startsWith('--lua-filter=')) filters.push(arg.slice('--lua-filter='.length).split('/').at(-1));
          else if (arg.startsWith('-')) throw new Error(`Unsupported Pandoc flag: ${arg}`);
          else {
            const name = arg.split('/').at(-1);
            if (files[name]) throw new Error(`Duplicate input basename: ${name}`);
            files[name] = fs.readFile(arg, { encoding: 'utf8' });
            input.push(name);
          }
        }
        for (const path of walk('/book/templates').filter(path => path.endsWith('.lua'))) {
          files[path.split('/').at(-1)] = fs.readFile(path, { encoding: 'utf8' });
        }
        // Flat names match the WASI wrapper's flat virtual filesystem. Lua files
        // remain together, so the original require('_common') works.
        const result = await pandoc.convert({ from: 'markdown', to: 'typst', wrap: 'preserve',
          'input-files': input, filters }, null, files);
        if (result.stderr) log(result.stderr);
        if (!result.stdout) throw new Error(result.stderr || 'Pandoc returned no Typst source');
        write(output, encoder.encode(result.stdout));
      } else if (argv[0] === 'typst') {
        log('Compiling the original book.typ with Typst WASM…');
        if (argv[1] !== 'compile' || argv[2] !== '--root' || argv.length !== 6) {
          throw new Error(`Unsupported Typst command: ${argv.join(' ')}`);
        }
        compiler = createTypstCompiler();
        const fonts = [...assets].filter(([name]) => /\.(otf|ttf)$/.test(name)).map(([, bytes]) => bytes);
        const registry = { resolve(spec) {
          if (spec.namespace === 'preview' && spec.name === 'wrap-it' && spec.version === '0.1.1') return '/packages/wrap-it';
          throw new Error(`Package not bundled: ${spec.namespace}/${spec.name}:${spec.version}`);
        } };
        await compiler.init({ getModule: () => get('/runtime/typst.wasm', true),
          beforeBuild: [loadFonts(fonts, { assets: false }), withPackageRegistry(registry)] });
        for (const [name, bytes] of assets) {
          if (name.startsWith('runtime/wrap-it/')) compiler.mapShadow('/packages/wrap-it/' + name.split('/').at(-1), bytes);
        }
        for (const path of walk('/book/novel')) compiler.mapShadow(path, fs.readFile(path));
        const result = await compiler.compile({ mainFilePath: argv[4], root: argv[3],
          format: CompileFormatEnum.pdf, diagnostics: 'unix' });
        if (result.diagnostics?.length) log(result.diagnostics.join('\n'));
        if (!result.result) throw new Error(result.diagnostics?.join('\n') || 'Typst returned no PDF');
        write(argv[5], result.result);
      } else throw new Error(`Unsupported external tool: ${argv[0]}`);
    },
  });
  log('Running the existing Python novel publishing rules…');
  await python.runPythonAsync(`
import os, sys
os.environ['BF_TEMPLATES'] = '/book/templates'
sys.path.insert(0, '/book')
from browser_adapter import build_novel
await build_novel()
`);
  const paths = walk('/book/novel/out');
  const pdfPath = paths.find(path => path.endsWith('.pdf'));
  if (!pdfPath) throw new Error('Python build completed without a PDF');
  const pdf = fs.readFile(pdfPath);
  const sources = Object.fromEntries(paths.filter(path => path.endsWith('.typ')).map(path => [path.split('/').at(-1), fs.readFile(path, { encoding: 'utf8' })]));
  postMessage({ type: 'complete', name: pdfPath.split('/').at(-1), pdf, sources,
    provenance: manifest.hashes }, [pdf.buffer]);
}

self.onmessage = async () => {
  try { await build(); } catch (error) { postMessage({ type: 'error', message: error.stack || String(error) }); }
};
