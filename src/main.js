const button = document.querySelector('#build');
const status = document.querySelector('#status');
const download = document.querySelector('#download');
const sourceLink = document.querySelector('#sources');
const output = document.querySelector('#log');
let urls = [];
button.addEventListener('click', () => {
  urls.forEach(URL.revokeObjectURL); urls = [];
  download.hidden = sourceLink.hidden = true;
  document.querySelector('#preview-section').hidden = true;
  output.textContent = ''; button.disabled = true; button.textContent = 'Building your book…';
  status.textContent = 'Starting the publishing engines…';
  const started = performance.now();
  const worker = new Worker(new URL('./build-worker.js', import.meta.url), { type: 'module' });
  const finish = () => { button.disabled = false; button.textContent = 'Build sample PDF ↗'; worker.terminate(); };
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
  worker.postMessage({ type: 'build' });
});
