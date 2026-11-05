// Existing Docker browser-test image: mount dist at /site, publishing checkout
// at /publishing, and a writable results directory at /results.
import { chromium } from '/opt/browser-test/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const results = [];
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
  for (const example of ['docs', 'novel', 'example', 'web']) {
    const fixture = `/tmp/example-fixtures/${example}`;
    await cp(`/publishing/${example}`, fixture, { recursive: true, filter: path => !['out', '.DS_Store', '__pycache__', '.git'].includes(path.split('/').at(-1)) });
    await mkdir(`/results/${example}`, { recursive: true });
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto('http://127.0.0.1:8001');
    await page.locator('#project-folder').setInputFiles(fixture);
    await page.waitForFunction(() => !document.querySelector('#build-upload').disabled);
    const files = await page.locator('#project-info').innerText();
    for (const format of ['print', 'screen', 'html', 'epub']) {
      const started = Date.now();
      const result = { example, format, files };
      try {
        await page.locator(`[data-format="${format}"]`).click();
        await page.waitForFunction(() => !document.querySelector('#download').hidden || document.querySelector('#status').textContent.includes('could not finish'), null, { timeout: 300000 });
        const log = await page.locator('#log').textContent();
        await writeFile(`/results/${example}/${format}.log`, log);
        assert.ok(await page.locator('#download').isVisible(), log);
        const pending = page.waitForEvent('download');
        await page.locator('#download').click();
        const download = await pending;
        const path = `/results/${example}/${download.suggestedFilename()}`;
        await download.saveAs(path);
        const bytes = await readFile(path);
        assert.ok(bytes.length > 1000, 'Output unexpectedly small');
        if (format === 'print' || format === 'screen') {
          assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
          const { stdout: info } = await exec('pdfinfo', [path]);
          result.pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
          assert.ok(result.pages > 0, info);
          const { stdout: text } = await exec('pdftotext', [path, '-']);
          assert.ok(text.trim().length > 100, 'PDF has no meaningful text');
          await writeFile(`/results/${example}/${format}.txt`, text);
        } else if (format === 'epub') assert.equal(bytes.subarray(0, 2).toString(), 'PK');
        else assert.match(bytes.toString(), /<html[\s>]/i);
        Object.assign(result, { status: 'PASS', bytes: bytes.length, filename: download.suggestedFilename() });
      } catch (error) {
        Object.assign(result, { status: 'FAIL', error: error.message });
        await writeFile(`/results/${example}/${format}.log`, await page.locator('#log').textContent());
        if (await page.locator('#cancel-build').isVisible()) await page.locator('#cancel-build').click();
      }
      result.seconds = +((Date.now() - started) / 1000).toFixed(1);
      results.push(result);
      await writeFile('/results/results.json', JSON.stringify(results, null, 2));
      console.log(`${result.status}: ${example} / ${format} (${result.seconds}s${result.pages ? `, ${result.pages} pages` : ''})${result.error ? `\n${result.error}` : ''}`);
    }
    await page.close();
  }
} finally {
  await browser?.close();
  server.close();
}
assert.equal(results.filter(result => result.status === 'FAIL').length, 0, 'Some example builds failed; see results.json');
