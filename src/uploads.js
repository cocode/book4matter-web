const ignored = new Set(['.git', 'node_modules', '.DS_Store', '__MACOSX']);
const order = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function validPath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
    !path.includes('\\') && !/[\x00-\x1f]/.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..');
}

export function mergeFiles(current, added) {
  const files = new Map(current.map(item => [item.path, item]));
  for (const item of added) {
    if (!validPath(item.path)) throw new Error(`Invalid file path: ${item.path}`);
    if (item.path.split('/').some(part => ignored.has(part))) continue;
    files.set(item.path, item);
  }
  return [...files.values()].sort((a, b) => order.compare(a.path, b.path));
}

export function chapterFiles(files) {
  const hasChapters = files.some(({ path }) => path.startsWith('chapters/'));
  return files.filter(({ path }) => /\.(md|txt)$/i.test(path) &&
    (!hasChapters || path.startsWith('chapters/')));
}

// A selected project folder is a container, not part of the book's paths.
// Keep these conventional subfolders when added as separate batches.
function unwrap(files) {
  const roots = new Set(files.map(({ path }) => path.split('/')[0]));
  if (roots.size !== 1 || files.some(({ path }) => !path.includes('/'))) return files;
  const [root] = roots;
  if (['chapters', 'media', 'fonts'].includes(root)) return files;
  return files.map(item => ({ ...item, path: item.path.slice(root.length + 1) }));
}

export function selectedFiles(files) {
  return unwrap([...files].map(file => ({ file, path: file.webkitRelativePath || file.name })));
}

async function readEntry(entry, prefix = '') {
  const path = prefix + entry.name;
  if (ignored.has(entry.name)) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ path, file }];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const files = [];
  // Chromium returns directory entries in batches (often 100 at a time).
  while (true) {
    const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!entries.length) break;
    for (const child of entries) files.push(...await readEntry(child, `${path}/`));
  }
  return files;
}

export function droppedFiles(transfer) {
  // Capture handles synchronously: the browser clears DataTransfer after drop.
  const items = [...(transfer.items || [])].filter(item => item.kind === 'file');
  const entries = items.map(item => item.webkitGetAsEntry?.());
  const fallback = [...transfer.files];
  if (entries.length && entries.every(Boolean)) {
    return Promise.all(entries.map(entry => readEntry(entry))).then(groups => unwrap(groups.flat()));
  }
  return Promise.resolve(selectedFiles(fallback));
}
