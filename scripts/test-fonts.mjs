// Run in the existing browser-test image with /site, writable /results,
// and /font-fixtures containing EB Garamond and Cormorant font files.
import { chromium } from '/opt/browser-test/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

await mkdir('/results', { recursive: true });
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.goto('http://127.0.0.1:8001');
  await page.locator('#project-files').setInputFiles(file('chapter.md',
    '# Practice\n\n[[Practice hold]]\n\n[[polka hold|Practice hold>Polka]]\n\n## Index {.section}\n\n{index:term}\n'));
  await page.locator('#book-title').fill('Font and index test');
  await page.locator('#book-author').fill('Tester');
  const build = async format => {
    await page.locator(`[data-format="${format}"]`).click();
    await page.waitForFunction(() => !document.querySelector('#download').hidden || !document.querySelector('#build-error').hidden, null, { timeout: 120000 });
  };
  const checkPDF = async (name, custom = false) => {
    assert.ok(await page.locator('#download').isVisible(), await page.locator('#log').textContent());
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#download').click();
    const pdf = `/results/${name}.pdf`;
    await (await downloadEvent).saveAs(pdf);
    const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
    assert.match(text, />\s*Polka/, 'Index must contain the portable subentry marker');
    assert.doesNotMatch(text, /[↳\uFFFD\u25A1]/);
    if (custom) {
      const fonts = execFileSync('pdffonts', [pdf], { encoding: 'utf8' });
      assert.match(fonts, /EBGaramond/i);
      assert.match(fonts, /Cormorant/i);
    }
    const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
    const pages = info.match(/^Pages:\s*(\d+)/m)[1];
    execFileSync('pdftoppm', ['-f', pages, '-l', pages, '-scale-to', '1400', '-png', '-singlefile', pdf, `/results/${name}`]);
    console.log(`PASS: ${name} renders > Polka${custom ? ' with embedded uploaded fonts' : ' with bundled fonts'}`);
  };
  for (const format of ['print', 'screen']) {
    await build(format);
    await checkPDF(`default-${format}`);
  }
  await page.locator('#project-files').setInputFiles(file('book_style.yaml', 'font: EB Garamond\nheading-font: Cormorant\nfont-size: 11pt\n'));
  for (const format of ['print', 'screen']) {
    await build(format);
    assert.ok(await page.locator('#build-error').isVisible(), `Missing configured fonts must show an actionable error:\n${await page.locator('#log').textContent()}`);
    assert.match(await page.locator('#build-error-title').textContent(), /Add the fonts/);
    const families = (await page.locator('#build-error-files strong').allTextContents()).map(name => name.toLowerCase());
    assert.deepEqual(families.sort(), ['cormorant', 'eb garamond']);
    assert.match(await page.locator('#build-error-message').textContent(), /whole book folder including fonts/);
    assert.equal(await page.locator('#details').getAttribute('open'), null);
    assert.ok(await page.locator('#download').isHidden());
    assert.ok(await page.locator('#build-upload').isEnabled());
    console.log(`PASS: ${format} names missing fonts beside the build buttons`);
  }
  await page.locator('#build-error').screenshot({ path: '/results/missing-fonts.png' });
  const chooserEvent = page.waitForEvent('filechooser');
  await page.locator('#build-error-add-folder').click();
  await (await chooserEvent).setFiles('/font-fixtures');
  await page.waitForFunction(() => document.querySelector('#build-error').hidden);
  assert.equal(await page.locator('#book-title').inputValue(), 'Font and index test');
  for (const format of ['print', 'screen']) {
    await build(format);
    await checkPDF(`uploaded-${format}`, true);
  }
} finally {
  await browser?.close();
  server.close();
}
