const status = document.querySelector('#status');
const download = document.querySelector('#download');
const sourceLink = document.querySelector('#sources');
const output = document.querySelector('#log');
let urls = [];
const folder = document.querySelector('#project-folder');
const uploadButton = document.querySelector('#build-upload');
const projectInfo = document.querySelector('#project-info');
let projectFiles = [];
folder.addEventListener('change', () => {
  projectFiles = [...folder.files].map(file => ({ file, path: file.webkitRelativePath.split('/').slice(1).join('/') }))
    .filter(({ path }) => path && !path.split('/').some(part => ['out', '.git', 'node_modules', '.DS_Store'].includes(part)));
  const hasConfig = projectFiles.some(({ path }) => ['book_metadata.yaml', 'book_style.yaml'].includes(path));
  uploadButton.disabled = !hasConfig;
  const name = folder.files[0]?.webkitRelativePath.split('/')[0];
  projectInfo.textContent = hasConfig ? `${name} · ${projectFiles.length} files selected. Ready to build.`
    : projectFiles.length ? 'Choose the project folder itself: book_metadata.yaml or book_style.yaml must be directly inside it.' : 'No project selected.';
});
uploadButton.addEventListener('click', () => build(projectFiles));
function build(files) {
  urls.forEach(URL.revokeObjectURL); urls = [];
  download.hidden = sourceLink.hidden = true;
  document.querySelector('#preview-section').hidden = true;
  output.textContent = '';
  uploadButton.textContent = 'Building your book…';
  uploadButton.disabled = true;
  folder.disabled = true;
  status.textContent = 'Starting the publishing engines…';
  const started = performance.now();
  const worker = new Worker(new URL('./build-worker.js', import.meta.url), { type: 'module' });
  const finish = () => { uploadButton.textContent = 'Build my PDF ↗'; uploadButton.disabled = !projectFiles.some(({ path }) => ['book_metadata.yaml', 'book_style.yaml'].includes(path)); folder.disabled = false; worker.terminate(); };
  const fail = message => { status.textContent = 'The build could not finish. See build details below.'; output.textContent += `\n${message}`; document.querySelector('#details').open = true; finish(); };
  worker.onerror = event => fail(event.message || `Worker could not load (${event.filename || 'module initialization'}).`);
  worker.onmessage = ({ data }) => {
    if (data.type === 'log') { output.textContent += `${data.message}\n`; status.textContent = data.message; }
    else if (data.type === 'error') fail(data.message);
    else if (data.type === 'complete') {
      const pdfURL = URL.createObjectURL(new Blob([data.pdf], { type: 'application/pdf' }));
      const sourcesURL = URL.createObjectURL(new Blob([JSON.stringify({ sources: data.sources, provenance: data.provenance }, null, 2)], { type: 'application/json' }));
      urls.push(pdfURL, sourcesURL); download.href = pdfURL; download.download = data.name; download.hidden = false;
      sourceLink.href = sourcesURL; sourceLink.download = 'book4matter-build.json'; sourceLink.hidden = false;
      status.textContent = `PDF ready · ${(data.pdf.byteLength / 1024).toFixed(0)} KB · ${((performance.now() - started) / 1000).toFixed(1)} seconds`;
      document.querySelector('#preview').src = pdfURL; document.querySelector('#preview-section').hidden = false; finish();
    }
  };
  worker.postMessage({ type: 'build', files });
}
