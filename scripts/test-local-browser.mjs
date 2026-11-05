// Run in the prepared book4matter-web:test image with the built site at /site.
import { chromium } from '/opt/browser-test/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

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
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8001');
  await page.locator('#project-files').setInputFiles({ name: 'chapter.md', mimeType: 'text/plain', buffer: Buffer.from('# Chapter One\n\nHello world.') });
  assert.ok(await page.locator('#build-upload').isDisabled());
  await page.locator('#book-title').fill('New Book');
  await page.locator('#book-author').fill('New Author');
  assert.ok(await page.locator('#metadata-reminder').isVisible());
  // An inert worker reproduces the startup stall without relying on networking.
  await page.route('**/build-worker-*.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.locator('#build-upload').click();
  assert.match(await page.locator('#log').textContent(), /Starting the publishing engine/);
  await page.locator('#cancel-build').click();
  assert.ok(await page.locator('#build-upload').isEnabled());
  assert.match(await page.locator('#status').innerText(), /Build cancelled/);
  await page.locator('#build-upload').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('could not finish'), null, { timeout: 35000 });
  assert.match(await page.locator('#log').textContent(), /did not start within 30 seconds/);
  assert.ok(await page.locator('#build-upload').isEnabled());
  console.log('PASS: stalled worker times out; cancellation and failure restore controls');
  await page.unroute('**/build-worker-*.js');
  await page.locator('#build-upload').click();
  await page.waitForFunction(() => !document.querySelector('#download').hidden || document.querySelector('#status').textContent.includes('could not finish'), null, { timeout: 120000 });
  assert.ok(await page.locator('#download').isVisible(), await page.locator('#log').textContent());
  const header = await page.locator('#download').evaluate(async link => (await (await fetch(link.href)).text()).slice(0, 5));
  assert.equal(header, '%PDF-');
  assert.ok(await page.locator('#build-upload').isEnabled());
  assert.ok(await page.locator('#cancel-build').isHidden());
  console.log('PASS:', await page.locator('#status').innerText());
} finally {
  await browser?.close();
  server.close();
}
