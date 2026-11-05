// Run in the existing browser-test image with /site and writable /results.
import { chromium } from '/opt/browser-test/node_modules/playwright-core/index.mjs';
import { convert } from '/app/node_modules/pandoc-wasm/index.js';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
await mkdir('/tmp/word-fixture/chapters', { recursive: true });
await mkdir('/results', { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGMw8LYDIgYIBQAUEgLlLdDZ+wAAAABJRU5ErkJggg==', 'base64');
for (const [filename, heading] of [['2.docx', 'Word First'], ['10.DOCX', 'Word Last']]) {
  const result = await convert({ from: 'markdown', to: 'docx', 'output-file': 'fixture.docx' },
    `# ${heading}\n\nImported **bold words** and *italic words*.\n\n1. First item\n2. Second item\n\n| Name | Value |\n|------|-------|\n| Table cell | 42 |\n\nA footnote[^note].\n\n[^note]: ${heading} footnote.\n\n![Embedded image](image.png){width=1in}\n`, { 'image.png': new Blob([png]) });
  assert.ok(result.files['fixture.docx']?.size, result.stderr);
  await writeFile(`/tmp/word-fixture/chapters/${filename}`, Buffer.from(await result.files['fixture.docx'].arrayBuffer()));
}
await writeFile('/tmp/word-fixture/chapters/3.md', '# Markdown Middle\n\nMarkdown chapter remains.');
await writeFile('/tmp/word-fixture/chapters/4.txt', 'Text Middle\n\n**Keep literal asterisks**');
// A Word file outside chapters must not become a chapter.
await writeFile('/tmp/word-fixture/ignored.docx', 'Not a valid Word file');
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  try {
    const bytes = await readFile('/site' + (path === '/' ? '/index.html' : path));
    response.setHeader('Content-Type', /\.m?js$/.test(path) ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
}).listen(8001, '127.0.0.1');
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto('http://127.0.0.1:8001');
  await page.locator('#project-folder').setInputFiles('/tmp/word-fixture');
  await page.locator('#book-title').fill('Word Import Test');
  await page.locator('#book-author').fill('Import Tester');
  assert.match(await page.locator('#project-info').textContent(), /4 chapter files/);
  for (const format of ['print', 'screen', 'html', 'epub']) {
    await page.locator(`[data-format="${format}"]`).click();
    await page.waitForFunction(() => !document.querySelector('#download').hidden || document.querySelector('#status').textContent.includes('could not finish'), null, { timeout: 120000 });
    const log = await page.locator('#log').textContent();
    await writeFile(`/results/${format}.log`, log);
    assert.ok(await page.locator('#download').isVisible(), log);
    assert.doesNotMatch(log, /Could not fetch resource|Cannot find a unique|could not decode|Duplicate note reference|Error:/i);
    const pending = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await pending;
    const path = `/results/${download.suggestedFilename()}`;
    await download.saveAs(path);
    const bytes = await readFile(path);
    assert.ok(bytes.length > 1000);
    if (format === 'print' || format === 'screen') {
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      const { stdout: text } = await exec('pdftotext', [path, '-']);
      for (const phrase of ['Word First', 'Word Last', 'Markdown Middle', 'Text Middle', 'bold words', 'italic words', 'Table cell', 'Word First footnote', 'Word Last footnote']) assert.ok(text.includes(phrase), phrase);
      const { stdout: images } = await exec('pdfimages', ['-list', path]);
      assert.ok(images.split('\n').filter(line => /^\s*\d+\s+\d+\s+image\s/.test(line)).length >= 2, images);
    } else if (format === 'html') {
      const html = bytes.toString();
      assert.match(html, /<strong>bold words<\/strong>/);
      assert.match(html, /<em>italic words<\/em>/);
      assert.match(html, /data:image\/png/);
      assert.match(html, /Word First footnote/);
      assert.match(html, /\*\*Keep literal asterisks\*\*/);
      const body = html.slice(html.indexOf('</nav>') + 6);
      const order = ['Word First', 'Markdown Middle', 'Text Middle', 'Word Last'].map(text => body.indexOf(text));
      assert.ok(order.every((position, i) => position >= 0 && (!i || position > order[i - 1])), order);
    } else assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    console.log('PASS:', format, 'mixed Word/Markdown/TXT chapters with embedded images');
  }
  // A malformed selected Word file must fail clearly and release the controls.
  await page.goto('http://127.0.0.1:8001');
  await page.locator('#project-files').setInputFiles({ name: 'broken.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('invalid') });
  await page.locator('#book-title').fill('Invalid file test');
  await page.locator('#book-author').fill('Tester');
  await page.locator('#build-upload').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('could not finish'), null, { timeout: 120000 });
  assert.match(await page.locator('#log').textContent(), /importing Word document "broken.docx"/);
  assert.ok(await page.locator('#build-upload').isEnabled());
  console.log('PASS: malformed DOCX reports the failing file and restores build controls');
} finally {
  await browser?.close();
  server.close();
}
