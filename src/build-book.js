import { pandocCommand } from './pandoc-command.js';
import { validPath } from './uploads.js';
import { requireFileHashing } from './secure-context.js';
import { createPandocInstance } from './generated/pandoc-core.js';
import { createTypstCompiler, CompileFormatEnum } from '@myriaddreamin/typst.ts/compiler';
import { loadFonts, withPackageRegistry } from '@myriaddreamin/typst.ts/dist/esm/options.init.mjs';

export async function buildBook(uploadedFiles, format, { assetURL, get, log, runtimeDirectory, onStage = () => {} }) {
  if (!['print', 'screen', 'html', 'epub'].includes(format)) throw new Error(`Unknown format: ${format}`);
  if (!uploadedFiles.length) throw new Error('Add your chapter files first.');
  onStage('checking browser support');
  requireFileHashing();
  onStage('loading Python');
  log('Loading local Python and publishing assets…');
  const runtimeURL = assetURL('runtime/pyodide/pyodide.mjs');
  const { loadPyodide } = await import(/* @vite-ignore */ runtimeURL);
  // Browsers use an HTTP URL; Pyodide's Node loader needs a filesystem path.
  const python = await loadPyodide({ indexURL: runtimeDirectory ?? assetURL('runtime/pyodide/'),
    stdout: log, stderr: log });
  await python.loadPackage('pyyaml');
  onStage('loading publishing assets');
  const manifest = JSON.parse(await get('assets.json'));
  const assetPaths = manifest.files;
  const assets = new Map(await Promise.all(assetPaths.map(async path => [path, await get(path, true)])));
  const projectRoot = '/book/project';
  const provenance = Object.fromEntries(assetPaths.map(path => [path, manifest.hashes[path]]));
  const fs = python.FS;
  const write = (path, bytes) => {
    fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    fs.writeFile(path, bytes);
  };
  for (const [path, bytes] of assets) {
    if (path.startsWith('book4matter/')) write('/book/' + path.slice('book4matter/'.length), bytes);
  }
  for (const { path, file } of uploadedFiles) {
    onStage(`reading and fingerprinting "${path}"`);
    if (!validPath(path)) {
      throw new Error(`Invalid project path: ${path}`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    write(`${projectRoot}/${path}`, bytes);
    provenance[`uploaded/${path}`] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  onStage('loading document converters');
  write('/book/browser_adapter.py', await get('browser_adapter.py', true));
  const wasm = await get('runtime/pandoc.wasm', true);
  const imageFilter = await get('browser-images.lua');
  let compiler;
  const walk = root => fs.readdir(root).filter(name => !['.', '..'].includes(name)).flatMap(name => {
    const path = `${root}/${name}`;
    return fs.isDir(fs.stat(path).mode) ? walk(path) : [path];
  });

  python.registerJsModule('book4matter_backend', {
    dispatch: async serialized => {
      const { argv, env } = JSON.parse(serialized);
      if (argv[0] === 'pandoc') {
        onStage('converting chapters with Pandoc');
        log('Applying the original Lua filters with Pandoc WASM…');
        const pandoc = await createPandocInstance(wasm, env);
        const { options, output } = pandocCommand(argv);
        const files = {};
        // Mirror the engine's actual filesystem, including original chapters
        // used by tracked.lua and image/CSS/metadata resources for EPUB/HTML.
        for (const path of walk('/book')) files[path.slice(1)] = new Blob([fs.readFile(path)]);
        for (const path of options['input-files']) files[path.slice(1)] = new Blob([fs.readFile(path)]);
        for (const path of walk('/book/templates').filter(path => path.endsWith('.lua'))) {
          files[path.split('/').at(-1)] = fs.readFile(path, { encoding: 'utf8' });
        }
        files['browser-images.lua'] = imageFilter;
        const result = await pandoc.convert(options, null, files);
        if (result.stderr) log(result.stderr);
        for (const warning of result.warnings || []) log(JSON.stringify(warning));
        const artifact = result.files[options['output-file']];
        if (!artifact?.size) throw new Error(result.stderr || 'Pandoc returned no document');
        write(output, new Uint8Array(await artifact.arrayBuffer()));
      } else if (argv[0] === 'typst') {
        onStage('compiling the PDF with Typst');
        log('Compiling the original book.typ with Typst WASM…');
        if (argv[1] !== 'compile' || argv[2] !== '--root') {
          throw new Error(`Unsupported Typst command: ${argv.join(' ')}`);
        }
        let position = 4;
        while (argv[position] === '--font-path') position += 2;
        if (argv.length !== position + 2) throw new Error(`Unsupported Typst arguments: ${argv.join(' ')}`);
        compiler = createTypstCompiler();
        const fonts = [...assets].filter(([name]) => /\.(otf|ttf)$/.test(name)).map(([, bytes]) => bytes);
        for (const path of walk(projectRoot).filter(path => /\.(otf|ttf)$/i.test(path))) fonts.push(fs.readFile(path));
        const registry = { resolve(spec) {
          if (spec.namespace === 'preview' && spec.name === 'wrap-it' && spec.version === '0.1.1') return '/packages/wrap-it';
          throw new Error(`Package not bundled: ${spec.namespace}/${spec.name}:${spec.version}`);
        } };
        await compiler.init({ getModule: () => get('runtime/typst.wasm', true),
          beforeBuild: [loadFonts(fonts, { assets: false }), withPackageRegistry(registry)] });
        for (const [name, bytes] of assets) {
          if (name.startsWith('runtime/wrap-it/')) compiler.mapShadow('/packages/wrap-it/' + name.split('/').at(-1), bytes);
        }
        for (const path of walk(projectRoot)) compiler.mapShadow(path, fs.readFile(path));
        const result = await compiler.compile({ mainFilePath: argv[position], root: argv[3],
          format: CompileFormatEnum.pdf, diagnostics: 'unix' });
        if (result.diagnostics?.length) log(result.diagnostics.join('\n'));
        if (!result.result) throw new Error(result.diagnostics?.join('\n') || 'Typst returned no PDF');
        write(argv[position + 1], result.result);
      } else throw new Error(`Unsupported external tool: ${argv[0]}`);
    },
  });
  onStage('applying publishing settings and rules');
  log('Running the existing Python publishing rules…');
  python.globals.set('browser_project_root', projectRoot);
  python.globals.set('browser_format', format);
  const documentPath = await python.runPythonAsync(`
import os, sys
os.environ['BF_TEMPLATES'] = '/book/templates'
sys.path.insert(0, '/book')
from browser_adapter import build_project
await build_project(browser_project_root, browser_format)
`);
  onStage('collecting the finished document');
  const paths = walk(`${projectRoot}/out`);
  const extension = { print: 'pdf', screen: 'pdf', html: 'html', epub: 'epub' }[format];
  if (!documentPath || !fs.analyzePath(documentPath).exists) throw new Error(`Build completed without a ${extension.toUpperCase()} file`);
  const bytes = fs.readFile(documentPath);
  const sources = Object.fromEntries(paths.filter(path => path.endsWith('.typ')).map(path => [path.split('/').at(-1), fs.readFile(path, { encoding: 'utf8' })]));
  return { name: documentPath.split('/').at(-1), bytes, sources, provenance, format,
    mime: { pdf: 'application/pdf', html: 'text/html', epub: 'application/epub+zip' }[extension] };
}
