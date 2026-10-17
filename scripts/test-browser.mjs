import { chromium } from '/opt/browser-test/node_modules/playwright-core/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  await page.getByRole('button', { name: /Build sample PDF/ }).click();
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
  console.log(`PASS: browser-generated PDF (${pdf.length} bytes), no external requests`);
} finally { await browser?.close(); server.kill('SIGTERM'); }
