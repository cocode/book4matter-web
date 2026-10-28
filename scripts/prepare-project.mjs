import { readdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Refresh the shared engine and templates without rebuilding/installing runtimes.
// Docker builds already copy these from their named publishing context.
const publishing = process.argv[2];
if (publishing) {
  for (const directory of ['bf', 'templates']) {
    await readdir(`${publishing}/${directory}`);
  }
  for (const directory of ['bf', 'templates']) {
    const destination = `public/book4matter/${directory}`;
    await rm(destination, { recursive: true, force: true });
    await cp(`${publishing}/${directory}`, destination, { recursive: true,
      filter: path => !['__pycache__', 'out'].includes(path.split('/').at(-1)) });
  }
}

async function walk(root) {
  const files = [];
  for (const entry of await readdir(`public/${root}`, { withFileTypes: true })) {
    if (['out', '__pycache__'].includes(entry.name)) continue;
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files.sort();
}
const files = [];
for (const root of ['book4matter/bf', 'book4matter/templates', 'runtime/fonts', 'runtime/wrap-it']) {
  files.push(...await walk(root));
}
const hashes = {};
for (const path of files) hashes[path] = createHash('sha256').update(await readFile(`public/${path}`)).digest('hex');
await writeFile('public/assets.json', JSON.stringify({ files, hashes }, null, 2));
