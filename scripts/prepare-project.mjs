import { readdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

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
for (const root of ['book4matter/bf', 'book4matter/templates', 'book4matter/novel', 'runtime/fonts', 'runtime/wrap-it']) {
  files.push(...await walk(root));
}
const hashes = {};
for (const path of files) hashes[path] = createHash('sha256').update(await readFile(`public/${path}`)).digest('hex');
await writeFile('public/assets.json', JSON.stringify({ files, hashes }, null, 2));
