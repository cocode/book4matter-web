import { readFile, mkdir, writeFile } from 'node:fs/promises';

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
// Filters can call os.exit(), bypassing the normal returned stderr object.
// Capture WASI fd 2 as bytes so those diagnostics survive the thrown exit.
const stderrConsole = 'ConsoleStdout.lineBuffered(msg => console.warn(`[WASI stderr] ${msg}`))';
const convertCall = 'instance.exports.convert(opts_ptr, encoded.length)';
if (core.split(stderrConsole).length !== 2 || core.split(convertCall).length !== 2) {
  throw new Error('Pandoc error boundary changed; review diagnostic capture');
}
core = core.replace('const fileSystem = new Map()', `const fileSystem = new Map()
    const runtimeStderr = new File(new Uint8Array(), {readonly: false})`)
  .replace(stderrConsole, 'new OpenFile(runtimeStderr)')
  .replace('async function convert(options, stdin, files) {', `async function convert(options, stdin, files) {
            const stderrStart = runtimeStderr.data.length`)
  .replace(convertCall, `try {
                ${convertCall}
            } catch (error) {
                const diagnostics = [err_file.data, runtimeStderr.data.subarray(stderrStart)]
                    .map(bytes => new TextDecoder().decode(bytes).trim()).filter(Boolean).join('\\n')
                if (!diagnostics) throw error
                throw new Error(diagnostics + '\\n' + (error.message || String(error)), {cause: error})
            }`);
await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/pandoc-core.js', core);
