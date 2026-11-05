import { chapterFiles, droppedFiles, mergeFiles, selectedFiles } from './uploads.js';
import { secureAppURL } from './secure-context.js';
import { describeBuildError, referencedFileProblems, missingBookSettings, missingFontFamilies } from './build-errors.js';

const secureURL = secureAppURL(window.location.href);
if (secureURL) window.location.replace(secureURL);

const status = document.querySelector('#status');
const buildError = document.querySelector('#build-error');
const cancelBuild = document.querySelector('#cancel-build');
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
const metadataForm = document.querySelector('#metadata-form');
const metadataInputs = [...metadataForm.querySelectorAll('input')];
const metadataDownload = document.querySelector('#download-metadata');
let metadataURL;
const hasSettings = name => projectFiles.some(({ path }) => path.split('/').at(-1) === name);
const needsMetadata = () => !hasSettings('book_metadata.yaml');
const metadataReady = () => metadataInputs.slice(0, 2).every(input => input.value.trim());
function metadataText() {
  return metadataInputs.filter(input => input.value.trim()).map(input => `${input.name}: ${JSON.stringify(input.value.trim())}`).join('\n') + '\n';
}
function refreshMetadata() {
  if (metadataURL) URL.revokeObjectURL(metadataURL);
  metadataURL = undefined;
  const generated = projectFiles.length > 0 && needsMetadata() && metadataReady();
  document.querySelector('#metadata-reminder').hidden = !generated;
  metadataDownload.removeAttribute('href');
  if (generated) {
    metadataURL = URL.createObjectURL(new Blob([metadataText()], { type: 'application/yaml' }));
    metadataDownload.href = metadataURL;
  }
}
metadataForm.addEventListener('submit', event => event.preventDefault());
for (const input of metadataInputs) input.addEventListener('input', () => {
  clearResult();
  renderFiles();
  status.textContent = 'Book details changed. Choose an output format when ready.';
});
const buttons = [...document.querySelectorAll('[data-format]')];
const labels = { print: 'Print PDF', screen: 'Screen PDF', html: 'HTML', epub: 'EPUB' };
let urls = [];
let projectFiles = [];
let building = false;
let reading = 0;
let queue = Promise.resolve();

function clearResult() {
  buildError.hidden = true;
  document.querySelector('#preview-section').hidden = true;
  document.querySelector('#preview').removeAttribute('src');
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  download.hidden = sourceLink.hidden = true;
}

function renderFiles() {
  const chapters = chapterFiles(projectFiles);
  const missingMetadata = needsMetadata();
  document.querySelector('#book-details').hidden = !projectFiles.length || !missingMetadata;
  for (const input of metadataInputs) input.disabled = building;
  const settingsInfo = document.querySelector('#settings-info');
  settingsInfo.hidden = !projectFiles.length;
  settingsInfo.textContent = `${missingMetadata ? 'We’ll create book_metadata.yaml from your details.' : 'Using your uploaded book_metadata.yaml.'} ${hasSettings('book_style.yaml') ? 'Using your uploaded book_style.yaml.' : 'Using default book styling.'}`;
  refreshMetadata();
  projectInfo.textContent = reading ? 'Reading added files…' : projectFiles.length
    ? `${projectFiles.length} files added · ${chapters.length} chapter files${chapters.length ? missingMetadata && !metadataReady() ? ' · Enter book details below to continue.' : ' · Ready to build.' : ' · Add .docx, .md, or .txt chapters to continue.'}`
    : 'No files added yet.';
  dropZone.setAttribute('aria-busy', String(building || reading > 0));
  folder.disabled = fileInput.disabled = building;
  clear.disabled = building || reading > 0 || !projectFiles.length;
  clear.hidden = !projectFiles.length;
  for (const button of buttons) button.disabled = building || reading > 0 || !chapters.length || (missingMetadata && !metadataReady());
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
  metadataForm.reset();
  clearResult();
  uploadMessage.textContent = '';
  output.textContent = '';
  document.querySelector('#details').open = false;
  document.querySelector('#added-files').open = false;
  status.textContent = 'Add your chapters to get started.';
  renderFiles();
  fileInput.focus();
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
  if (needsMetadata() && (!metadataReady() || !metadataForm.reportValidity())) return;
  clearResult();
  output.textContent = 'Starting the publishing engine…\n';
  document.querySelector('#details').open = false;
  building = true;
  cancelBuild.hidden = false;
  renderFiles();
  status.textContent = `Building your ${labels[format]}…`;
  const started = performance.now();
  let worker;
  let startupTimer;
  let finished = false;
  const finish = () => { cancelBuild.hidden = true; cancelBuild.onclick = null; finished = true; clearTimeout(startupTimer); building = false; worker?.terminate(); renderFiles(); };
  const fail = message => {
    if (finished) return;
    status.textContent = 'The build could not finish. See build details below.';
    output.textContent += `\n${message}`;
    const problems = referencedFileProblems(message);
    const missingSettings = missingBookSettings(message);
    const missingFonts = missingFontFamilies(message);
    const canAddFiles = problems.length > 0 || Boolean(missingSettings) || missingFonts.length > 0;
    if (canAddFiles) status.textContent = 'The build could not finish. See the message above the build buttons.';
    document.querySelector('#build-error-title').textContent = problems.length
      ? 'Some referenced files need your attention' : missingFonts.length ? 'Add the fonts used by your book' : missingSettings ? 'Add your book’s numbering settings' : 'Your book could not be built';
    document.querySelector('#build-error-message').textContent = problems.length
      ? 'Check the files below, then choose a build format to try again.'
      : missingFonts.length
        ? 'The fonts below are named in your book settings but were not available. Add their .ttf or .otf files, or add the whole book folder including fonts, then build again. You can also choose an available font in book_style.yaml.'
      : missingSettings
        ? `Your manuscript uses numbered “${missingSettings}” items, but their settings are missing. Add the book_metadata.yaml that belongs to this manuscript, or add the whole book folder, then build again. If you already added that file, check that it defines this item type under tracked:.`
        : 'Try building again. If it still fails, open the build details for more information.';
    const reasons = {
      missing: 'Not found in the files you added.',
      ambiguous: 'More than one file matches. Add the whole book folder and use the exact relative path in your manuscript or settings.',
      remote: 'This image uses a web address. Save it locally, add it to your book, and update the image reference to its local path.',
    };
    const listedProblems = [...problems, ...missingFonts.map(reference => ({ kind: 'font', reference }))];
    reasons.font = 'Required font family — add its font files, including any bold and italic styles you use.';
    document.querySelector('#build-error-files').replaceChildren(...listedProblems.map(problem => {
      const item = document.createElement('li');
      const reference = document.createElement('strong');
      reference.textContent = problem.reference;
      const reason = document.createElement('span');
      reason.textContent = reasons[problem.kind];
      item.append(reference, reason);
      return item;
    }));
    document.querySelector('#build-error-file-help').hidden = !problems.length;
    document.querySelector('#build-error-add-files').hidden = !canAddFiles;
    document.querySelector('#build-error-add-folder').hidden = !canAddFiles;
    document.querySelector('#details').open = !canAddFiles;
    finish();
    buildError.hidden = false;
    buildError.focus({ preventScroll: true });
    buildError.scrollIntoView({ block: 'nearest' });
  };
  cancelBuild.onclick = () => { finish(); status.textContent = 'Build cancelled. You can edit your files or try again.'; output.textContent += '\nBuild cancelled.'; };
  try {
    worker = new Worker(new URL('./build-worker.js', import.meta.url), { type: 'module' });
    startupTimer = setTimeout(() => fail('The publishing engine did not start within 30 seconds. Reload this page and try again. If this keeps happening, try another up-to-date browser and check that the local server is still running.'), 30000);
    worker.onmessageerror = () => fail('The browser could not read a message from the publishing engine. Reload the page and try again.');
    worker.onerror = event => fail(event.error ? describeBuildError(event.error) : event.message || 'The publishing engine could not load.');
    worker.onmessage = ({ data }) => {
      if (finished) return;
      clearTimeout(startupTimer);
      if (data.type === 'ready') return;
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
    worker.postMessage({ type: 'build', files: needsMetadata() ? [...projectFiles, { path: 'book_metadata.yaml', file: new File([metadataText()], 'book_metadata.yaml', { type: 'application/yaml' }) }] : projectFiles, format });
  } catch (error) { fail(describeBuildError(error)); }
}
renderFiles();

document.querySelector('#build-error-add-files').addEventListener('click', () => fileInput.click());
document.querySelector('#build-error-add-folder').addEventListener('click', () => folder.click());
document.querySelector('#build-error-details').addEventListener('click', () => {
  const details = document.querySelector('#details');
  details.open = true;
  details.querySelector('summary').focus();
  details.scrollIntoView({ block: 'nearest' });
});
