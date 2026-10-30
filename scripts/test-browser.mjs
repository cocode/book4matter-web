import { chromium } from '/opt/browser-test/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, cp, mkdtemp } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const output = process.env.OUTPUT_DIR || '/tmp/book4matter-output';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort', '--configLoader', 'native'], { stdio: 'inherit' });
let browser;
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:5173')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 250)); }
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
  // Public HTTP used to fail inside the worker at crypto.subtle.digest.
  // Proxy the built site through a real insecure origin to cover both recovery
  // paths without relying on localhost's secure-context exemption.
  const insecure = await browser.newContext();
  await insecure.route('http://book4matter.test/**', async route => {
    const url = new URL(route.request().url());
    const response = await insecure.request.get(`http://127.0.0.1:5173${url.pathname}${url.search}`);
    await route.fulfill({ response });
  });
  const insecurePage = await insecure.newPage();
  await insecurePage.goto('http://book4matter.test/');
  assert.equal(await insecurePage.evaluate(() => isSecureContext), false);
  await insecurePage.locator('#project-files').setInputFiles({ name: 'chapter.md', mimeType: 'text/plain', buffer: Buffer.from('# Test') });
  await insecurePage.locator('#build-upload').click();
  await insecurePage.waitForFunction(() => document.querySelector('#status').textContent.includes('could not finish'));
  assert.match(await insecurePage.locator('#log').innerText(), /Could not finish checking browser support/);
  assert.match(await insecurePage.locator('#log').innerText(), /Open https:\/\/app.book4matter.com\/ and add your files again/);
  assert.ok(await insecurePage.locator('#details').getAttribute('open') !== null);
  await insecure.route('http://app.book4matter.com/**', async route => {
    const url = new URL(route.request().url());
    const response = await insecure.request.get(`http://127.0.0.1:5173${url.pathname}${url.search}`);
    await route.fulfill({ response });
  });
  await insecure.route('https://app.book4matter.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Secure site reached</p>' }));
  await insecurePage.goto('http://app.book4matter.com/?book=example#files');
  await insecurePage.waitForURL('https://app.book4matter.com/?book=example#files');
  await insecure.close();
  console.log('PASS: public HTTP redirects to HTTPS; insecure builds explain the cause and recovery');
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'America/Los_Angeles', viewport: { width: 1200, height: 1100 } });
  const externalRequests = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:5173/')) { externalRequests.push(url); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('console', message => console.log(`[browser ${message.type()}] ${message.text()}`));
  page.on('pageerror', error => console.error('[pageerror]', error));
  page.on('requestfailed', request => console.error('[requestfailed]', request.url(), request.failure()));
  page.on('response', response => { if (response.status() >= 400) console.error('[http]', response.status(), response.url()); });
  await page.goto('http://127.0.0.1:5173');
  assert.equal(await page.getByRole('button', { name: /Build sample PDF/ }).count(), 0);
  assert.match(await page.locator('.lede').innerText(), /Book4matter turns plain text and Markdown/);
  await page.locator('#project-folder').setInputFiles('/app/fixtures/novel');
  await page.locator('#build-upload').click();
  const downloadLink = page.locator('#download');
  await page.waitForFunction(() => !document.querySelector('#download').hidden || document.querySelector('#status').textContent.includes('could not finish'), null, { timeout: 180000 });
  if (!(await downloadLink.isVisible())) throw new Error(await page.locator('#log').innerText());
  const downloadEvent = page.waitForEvent('download'); await downloadLink.click(); const download = await downloadEvent;
  await download.saveAs(`${output}/${download.suggestedFilename()}`);
  const pdf = await readFile(`${output}/${download.suggestedFilename()}`);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 10000);
  await page.locator('#details').evaluate(element => { element.open = true; });
  const sourceEvent = page.waitForEvent('download'); await page.locator('#sources').click();
  await (await sourceEvent).saveAs(`${output}/book4matter-build.json`);
  const buildLog = await page.locator('#log').innerText(); await writeFile(`${output}/browser-build.log`, buildLog);
  assert.doesNotMatch(buildLog, /unknown font family|error:/i); assert.deepEqual(externalRequests, [], 'Browser requested an external service');
  const pdfPath = `${output}/${download.suggestedFilename()}`;
  const info = (await exec('pdfinfo', [pdfPath])).stdout;
  await writeFile(`${output}/pdfinfo.txt`, info);
  assert.match(info, /Page size:\s+432 x 648 pts/);
  assert.match(info, /Pages:\s+7\b/);
  const fonts = (await exec('pdffonts', [pdfPath])).stdout;
  await writeFile(`${output}/fonts.txt`, fonts);
  assert.match(fonts, /LibertinusSerif/);
  assert.match(fonts, /LiberationSans/);
  await exec('pdftotext', ['-layout', pdfPath, `${output}/novel.txt`]);
  const text = await readFile(`${output}/novel.txt`, 'utf8');
  assert.match(text, /The Smallest Fire/);
  assert.match(text, /M\. R\. Vale/);
  const pageTexts = text.split('\f');
  for (let chapter = 1; chapter <= 5; chapter++) {
    assert.match(pageTexts[chapter + 1], new RegExp(`^\\s*${chapter}\\s`));
    assert.match(pageTexts[chapter + 1].trim(), new RegExp(`${chapter}$`));
  }
  const buildData = JSON.parse(await readFile(`${output}/book4matter-build.json`, 'utf8'));
  assert.equal((buildData.sources['_body.typ'].match(/^==\s*$/gm) || []).length, 5);
  assert.match(buildData.sources['_meta.typ'], /toc: false/);
  await exec('pdftoppm', ['-scale-to', '1100', '-png', pdfPath, `${output}/page`]);
  // Optional local native reference; no native converter is used by the app.
  try {
    await readFile(`${output}/native-reference.pdf`);
    const reference = (await exec('pdftotext', ['-layout', `${output}/native-reference.pdf`, '-'])).stdout;
    const normalize = value => value.replace(/Produced:.*$/gm, 'Produced: [local date]').replace(/\s+/g, ' ').trim();
    assert.equal(normalize(text), normalize(reference), 'Native and browser PDF content differs');
    const nativeInfo = (await exec('pdfinfo', [`${output}/native-reference.pdf`])).stdout;
    assert.match(nativeInfo, /Pages:\s+7\b/);
    assert.match(nativeInfo, /Page size:\s+432 x 648 pts/);
    await writeFile(`${output}/native-comparison.txt`, 'PASS: all manuscript text, chapter folios, 7 pages, and 6x9 trim match the native CLI PDF. Local build dates normalized.\n');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await page.screenshot({ path: `${output}/browser.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page overflows horizontally');
  await page.screenshot({ path: `${output}/browser-mobile.png`, fullPage: true });
  // Upload a real folder with distinct content, a media asset, and local fonts.
  const fixture = await mkdtemp('/tmp/book4matter-upload-');
  await cp('fixtures/novel/chapters', `${fixture}/chapters`, { recursive: true });
  await mkdir(`${fixture}/media`);
  await mkdir(`${fixture}/fonts`);
  await writeFile(`${fixture}/book_metadata.yaml`, 'title: Uploaded Garden\nauthor: Upload Tester\n');
  await writeFile(`${fixture}/book_style.yaml`, 'font: Liberation Serif\n');
  await cp('public/runtime/fonts/LiberationSerif-Regular.ttf', `${fixture}/fonts/LocalSerif.ttf`);
  await writeFile(`${fixture}/media/garden.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#304b3e"/></svg>');
  const chapter = await readFile(`${fixture}/chapters/01.txt`, 'utf8');
  await writeFile(`${fixture}/chapters/01.txt`, `${chapter}\n\nThis passage exists only in the uploaded project.\n\n# Literal heading\n\n**literal bold** and _literal emphasis_\n\n[literal link](https://example.com)\n\n[[literal term]]\n\n{index:term}\n\n    indented literal prose\n`);
  // Markdown chapters still support formatting and media in the same project.
  await writeFile(`${fixture}/chapters/06.md`, '# Markdown chapter\n\n**Formatted Markdown**\n\n![](../media/garden.svg){width="1in"}\n');
  const invalid = await mkdtemp('/tmp/book4matter-no-config-');
  await writeFile(`${invalid}/chapter.md`, '# Missing configuration');
  async function clearUploads() {
    await page.locator('#added-files').evaluate(element => { element.open = true; });
    await page.locator('#clear-files').click();
    assert.equal(await page.locator('#file-list li').count(), 0);
  }
  await clearUploads();
  await page.locator('#project-folder').setInputFiles(invalid);
  assert.ok(await page.locator('#build-upload').isEnabled(), 'YAML must be optional');
  assert.match(await page.locator('#project-info').innerText(), /1 chapter files/);
  // A second batch adds settings without replacing the chapter.
  await page.locator('#project-files').setInputFiles(`${fixture}/book_metadata.yaml`);
  assert.match(await page.locator('#project-info').innerText(), /2 files added/);
  // Two drops exercise the same UI handler used by native drag and drop.
  await page.locator('#drop-zone').evaluate(element => {
    for (const [name, content] of [['02.txt', 'Dropped text'], ['book_style.yaml', 'font-size: 12']]) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], name, { type: 'text/plain' }));
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
  });
  await page.waitForFunction(() => document.querySelector('#project-info').textContent.includes('4 files added'));
  assert.match(await page.locator('#project-info').innerText(), /2 chapter files/);
  await clearUploads();
  await page.locator('#project-folder').setInputFiles(fixture);
  assert.ok(await page.locator('#build-upload').isEnabled());
  const requests = [];
  page.on('request', request => { if (request.method() !== 'GET') requests.push(`${request.method()} ${request.url()}`); });
  await page.locator('#build-upload').click();
  await page.waitForFunction(() => !document.querySelector('#download').hidden || document.querySelector('#status').textContent.includes('could not finish'), null, { timeout: 180000 });
  if (!(await downloadLink.isVisible())) throw new Error(await page.locator('#log').innerText());
  const uploadedEvent = page.waitForEvent('download');
  await downloadLink.click();
  const uploaded = await uploadedEvent;
  assert.equal(uploaded.suggestedFilename(), 'uploaded-garden-interior.pdf');
  await uploaded.saveAs(`${output}/${uploaded.suggestedFilename()}`);
  const uploadedText = (await exec('pdftotext', [`${output}/${uploaded.suggestedFilename()}`, '-'])).stdout;
  assert.match(uploadedText, /Uploaded Garden/);
  assert.match(uploadedText, /Upload Tester/);
  assert.match(uploadedText, /This passage exists only in the uploaded project/);
  assert.match(uploadedText, /# Literal heading/);
  assert.match(uploadedText, /\*\*literal bold\*\* and _literal emphasis_/);
  assert.match(uploadedText, /\[literal link\]\(https:\/\/example.com\)/);
  assert.match(uploadedText, /\[\[literal term\]\]/);
  assert.match(uploadedText, /\{index:term\}/);
  assert.match(uploadedText, /indented literal prose/);
  assert.match(uploadedText, /Formatted Markdown/);
  assert.doesNotMatch(uploadedText, /\*\*Formatted Markdown\*\*|!\[\]/);
  const uploadedFonts = (await exec('pdffonts', [`${output}/${uploaded.suggestedFilename()}`])).stdout;
  assert.match(uploadedFonts, /LiberationSerif/);
  assert.deepEqual(requests, [], 'Uploading the folder sent data to the server');
  assert.deepEqual(externalRequests, [], 'Uploaded project requested an external service');
  await page.setViewportSize({ width: 1200, height: 1100 });
  await page.screenshot({ path: `${output}/upload-browser.png`, fullPage: true });
  await exec('pdftoppm', ['-f', '3', '-l', '3', '-scale-to', '1100', '-png', `${output}/${uploaded.suggestedFilename()}`, `${output}/upload-page`]);
  // Terms coexist with tracked items, including aliases, nested entries,
  // repeated definitions, heading terms (also copied into the TOC), and links.
  const indexed = await mkdtemp('/tmp/book4matter-index-');
  await mkdir(`${indexed}/chapters`);
  await writeFile(`${indexed}/book_metadata.yaml`, 'title: Indexed Book\nauthor: Index Tester\ntoc: true\ntracked:\n  exercise: Exercise\n');
  await writeFile(`${indexed}/chapters/01.md`, [
    '# Index examples', '', '## [[Frame]]', '',
    '[[zebra]] [[Alpha]] [[alpha]] [[Richard Powers|Powers, Richard]]', '',
    '[[polka hold|Practice hold>polka]] [[waltz hold|Practice hold>waltz]]', '',
    '## [[Tempo|Tempo;BPM;Beats per minute]]', '',
    '[[[R. Powers|Powers, Richard]]](https://www.richardpowers.com)', '',
    '{exercise:first:def First exercise}', '', '{exercise:first}', '',
    '## Index {.section}', '', '{index:term}', '', '{index:exercise}', '',
  ].join('\n'));
  await clearUploads();
  await page.locator('#project-folder').setInputFiles(indexed);
  await page.waitForFunction(() => document.querySelector('#project-info').textContent.includes('Ready to build'));
  assert.equal(await page.locator('#file-list li').count(), 2);
  await page.locator('#build-upload').click();
  await page.waitForFunction(() => !document.querySelector('#download').hidden || document.querySelector('#status').textContent.includes('could not finish'), null, { timeout: 180000 });
  if (!(await downloadLink.isVisible())) throw new Error(await page.locator('#log').innerText());
  const indexDownloadEvent = page.waitForEvent('download');
  await downloadLink.click();
  const indexDownload = await indexDownloadEvent;
  assert.equal(indexDownload.suggestedFilename(), 'indexed-book-interior.pdf');
  const indexPdf = `${output}/${indexDownload.suggestedFilename()}`;
  await indexDownload.saveAs(indexPdf);
  const indexText = (await exec('pdftotext', ['-layout', indexPdf, '-'])).stdout;
  await writeFile(`${output}/index.txt`, indexText);
  const indexSection = indexText.slice(indexText.lastIndexOf('Alpha'));
  assert.match(indexSection, /Alpha\s*\.+\s*\d/);
  assert.match(indexSection, /Frame\s*\.+\s*\d/);
  assert.match(indexSection, /BPM\.\s*see\s*Tempo/);
  assert.match(indexSection, /Beats per minute\.\s*see\s*Tempo/);
  assert.match(indexSection, /Powers, Richard\s*\.+\s*\d/);
  assert.match(indexSection, /Practice hold/);
  assert.ok(indexSection.indexOf('polka') < indexSection.indexOf('waltz'));
  assert.ok(indexSection.indexOf('Powers, Richard') < indexSection.indexOf('zebra'));
  assert.match(indexSection, /First exercise/);
  assert.doesNotMatch(indexText, /\[\[|\{index:|\{exercise:/);
  await page.locator('#details').evaluate(element => { element.open = true; });
  const indexSourcesEvent = page.waitForEvent('download');
  await page.locator('#sources').click();
  await (await indexSourcesEvent).saveAs(`${output}/index-build.json`);
  const indexBuild = JSON.parse(await readFile(`${output}/index-build.json`, 'utf8'));
  assert.match(indexBuild.sources['_body.typ'], /termdef, termindex/);
  assert.match(indexBuild.sources['_body.typ'], /#termindex\(\)/);
  assert.match(indexBuild.sources['_body.typ'], /#termdef\("powers, richard"/);
  assert.deepEqual(externalRequests, [], 'Indexed project requested an external service');
  assert.deepEqual(requests, [], 'Indexed project sent data to the server');
  console.log('PASS: term index PDF, aliases, subentries, heading/TOC terms, repeated terms, outbound links, tracked items');
  console.log('PASS: folder selection, optional YAML, additive picks and drops, literal TXT alongside Markdown/media/fonts, no data upload');
  console.log(`PASS: browser-generated PDF (${pdf.length} bytes), no external requests`);
} finally { await browser?.close(); server.kill('SIGTERM'); }
