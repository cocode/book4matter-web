import { chapterFiles, droppedFiles, mergeFiles, selectedFiles } from './uploads.js';
import { secureAppURL } from './secure-context.js';
import { describeBuildError } from './build-errors.js';

const secureURL = secureAppURL(window.location.href);
if (secureURL) window.location.replace(secureURL);

const status = document.querySelector('#status');
const download = document.querySelector('#download');
const sourceLink = document.querySelector('#sources');
const output = document.querySelector('#log');
const folder = document.querySelector('#project-folder');
const fileInput = document.querySelector('#project-files');
const dropZone = document.querySelector('#drop-zone');
const projectInfo = document.querySelector('#project-info');
const uploadMessage = document.querySelector('#upload-message');
const fileList = document.querySelector('#file-list');
const clear = document.querySelector('#clear-files');
const buttons = [...document.querySelectorAll('[data-format]')];
const labels = { print: 'Print PDF', screen: 'Screen PDF', html: 'HTML', epub: 'EPUB' };
let urls = [];
let projectFiles = [];
let building = false;
let reading = 0;
let queue = Promise.resolve();

function clearResult() {
  document.querySelector('#preview-section').hidden = true;
  document.querySelector('#preview').removeAttribute('src');
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  download.hidden = sourceLink.hidden = true;
}

function renderFiles() {
  const chapters = chapterFiles(projectFiles);
  projectInfo.textContent = reading ? 'Reading added files…' : projectFiles.length
    ? `${projectFiles.length} files added · ${chapters.length} chapter files${chapters.length ? ' · Ready to build.' : ' · Add .md or .txt chapters to continue.'}`
    : 'No files added yet.';
  dropZone.setAttribute('aria-busy', String(building || reading > 0));
  folder.disabled = fileInput.disabled = building;
  clear.disabled = building || reading > 0 || !projectFiles.length;
  for (const button of buttons) button.disabled = building || reading > 0 || !chapters.length;
  const chapterPaths = new Set(chapters.map(({ path }) => path));
  fileList.replaceChildren(...projectFiles.map(({ path }) => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = path;
    const kind = document.createElement('small');
    kind.textContent = chapterPaths.has(path) ? 'Chapter' : /book_(metadata|style)\.yaml$/.test(path) ? 'Settings' : 'Supporting file';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-file';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${path}`);
    remove.disabled = building || reading > 0;
    remove.addEventListener('click', () => {
      projectFiles = projectFiles.filter(item => item.path !== path);
      clearResult();
      renderFiles();
      status.textContent = 'Files changed. Choose a format to build again.';
    });
    row.append(name, kind, remove);
    return row;
  }));
  document.querySelector('#added-files').hidden = !projectFiles.length;
}

function addBatch(pending) {
  if (building) return;
  reading++;
  renderFiles();
  // Attach rejection handling immediately while earlier batches finish.
  const settled = Promise.resolve(pending).then(files => ({ files }), error => ({ error }));
  queue = queue.then(async () => {
    try {
      const { files, error } = await settled;
      if (error) throw error;
      projectFiles = mergeFiles(projectFiles, files);
      clearResult();
      uploadMessage.textContent = files.length ? 'Files added. Add another batch whenever you like. Matching paths replace earlier files.' : 'No readable files were found. Try Add files or Add a folder.';
      status.textContent = 'Choose an output format when your files are ready.';
    } catch (error) {
      uploadMessage.textContent = `Could not add these files: ${error.message}`;
    } finally {
      reading--;
      renderFiles();
    }
  });
}

for (const input of [folder, fileInput]) input.addEventListener('change', () => {
  addBatch(selectedFiles(input.files));
  input.value = ''; // Selecting an edited file again must fire change.
});
clear.addEventListener('click', () => {
  projectFiles = [];
  clearResult();
  uploadMessage.textContent = '';
  status.textContent = 'Add your chapters to get started.';
  renderFiles();
});
let dragDepth = 0;
dropZone.addEventListener('dragenter', event => {
  event.preventDefault();
  if (!building) { dragDepth++; dropZone.classList.add('drag-over'); }
});
dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  event.dataTransfer.dropEffect = building ? 'none' : 'copy';
});
dropZone.addEventListener('dragleave', event => {
  event.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; dropZone.classList.remove('drag-over'); }
});
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('drag-over');
  if (!building) addBatch(droppedFiles(event.dataTransfer));
});
// Dropping outside the target must not navigate away and discard the book.
for (const type of ['dragover', 'drop']) window.addEventListener(type, event => {
  if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
});
for (const button of buttons) button.addEventListener('click', () => build(button.dataset.format));

function build(format) {
  if (building || reading || !chapterFiles(projectFiles).length) return;
  clearResult();
  output.textContent = '';
  document.querySelector('#details').open = false;
  building = true;
  renderFiles();
  status.textContent = `Building your ${labels[format]}…`;
  const started = performance.now();
  let worker;
  const finish = () => { building = false; worker?.terminate(); renderFiles(); };
  const fail = message => {
    status.textContent = 'The build could not finish. See build details below.';
    output.textContent += `\n${message}`;
    document.querySelector('#details').open = true;
    finish();
  };
  try {
    worker = new Worker(new URL('./build-worker.js', import.meta.url), { type: 'module' });
    worker.onerror = event => fail(event.error ? describeBuildError(event.error) : event.message || 'The publishing engine could not load.');
    worker.onmessage = ({ data }) => {
      if (data.type === 'log') { output.textContent += `${data.message}\n`; status.textContent = data.message; }
      else if (data.type === 'error') fail(data.message);
      else if (data.type === 'complete') {
        const documentURL = URL.createObjectURL(new Blob([data.bytes], { type: data.mime }));
        const sourcesURL = URL.createObjectURL(new Blob([JSON.stringify({ format, sources: data.sources, provenance: data.provenance }, null, 2)], { type: 'application/json' }));
        urls.push(documentURL, sourcesURL);
        download.href = documentURL;
        download.download = data.name;
        download.textContent = `Download ${labels[format]} ↓`;
        download.hidden = false;
        sourceLink.href = sourcesURL;
        sourceLink.download = 'book4matter-build.json';
        sourceLink.hidden = false;
        status.textContent = `${labels[format]} ready · ${(data.bytes.byteLength / 1024).toFixed(0)} KB · ${((performance.now() - started) / 1000).toFixed(1)} seconds`;
        if (data.mime === 'application/pdf') {
          document.querySelector('#preview').src = documentURL;
          document.querySelector('#preview-section').hidden = false;
        }
        finish();
      }
    };
    worker.postMessage({ type: 'build', files: projectFiles, format });
  } catch (error) { fail(describeBuildError(error)); }
}
renderFiles();
