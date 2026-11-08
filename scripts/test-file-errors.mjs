// Run in the prepared browser-test image with /site and writable /results.
import { chromium } from '/opt/browser-test/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
  page.on('dialog', dialog => dialog.accept());
  const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  const setup = async (text, settings = []) => {
    await page.goto('http://127.0.0.1:8001');
    await page.locator('#project-files').setInputFiles([file('chapter.md', text), ...settings]);
    if (!settings.some(item => item.name === 'book_metadata.yaml')) {
      await page.locator('#book-title').fill('Image Test');
      await page.locator('#book-author').fill('Tester');
    }
  };
  const failBuild = async (format = 'print') => {
    await page.locator(`[data-format="${format}"]`).click();
    await page.waitForFunction(() => !document.querySelector('#build-error').hidden || !document.querySelector('#download').hidden, null, { timeout: 120000 });
    assert.ok(await page.locator('#build-error').isVisible(), 'Expected visible error message');
    assert.ok(await page.locator('#build-upload').isEnabled());
    assert.equal(await page.locator('#details').getAttribute('open'), null, 'Missing files should not require reading the build log');
  };
  const source = '# Images\n\n![One](media/first.svg)\n\n![Two](media/second.svg)\n\n![Again](media/first.svg)';
  await setup(source);
  for (const format of ['print', 'screen', 'html', 'epub']) {
    await failBuild(format);
    assert.deepEqual(await page.locator('#build-error-files strong').allTextContents(), ['media/first.svg', 'media/second.svg']);
    assert.match(await page.locator('#build-error-file-help').textContent(), /add the whole book folder/);
    assert.equal(await page.locator('#build-error').evaluate(el => document.activeElement === el), true);
    console.log(`PASS: ${format} shows missing filenames and folder advice beside the build buttons`);
  }
  await page.locator('#build-error').screenshot({ path: '/results/missing-images.png' });
  const chooserEvent = page.waitForEvent('filechooser');
  await page.locator('#build-error-add-files').click();
  const chooser = await chooserEvent;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="green"/></svg>';
  await chooser.setFiles([file('first.svg', svg), file('second.svg', svg)]);
  await page.waitForFunction(() => document.querySelector('#build-error').hidden);
  assert.equal(await page.locator('#book-title').inputValue(), 'Image Test');
  await page.locator('#build-upload').click();
  await page.waitForFunction(() => !document.querySelector('#download').hidden || !document.querySelector('#build-error').hidden, null, { timeout: 120000 });
  assert.ok(await page.locator('#download').isVisible(), await page.locator('#log').textContent());
  assert.ok(await page.locator('#build-error').isHidden());
  console.log('PASS: Add files action preserves details, clears the error and builds successfully');
  await setup('# A chapter', [file('book_metadata.yaml', 'title: Cover test\nauthor: Tester\ncover: media/cover.png\n')]);
  await failBuild();
  assert.deepEqual(await page.locator('#build-error-files strong').allTextContents(), ['media/cover.png']);
  console.log('PASS: missing cover file appears in the same clear message');
  await setup('# A chapter', [file('book_metadata.yaml', 'title: Include test\nauthor: Tester\nhtml-body-end: includes/end.html\n')]);
  await failBuild('html');
  assert.deepEqual(await page.locator('#build-error-files strong').allTextContents(), ['includes/end.html']);
  console.log('PASS: missing included HTML file is named');
  await setup('# Remote image\n\n![](https://example.invalid/photo.png)');
  await failBuild();
  assert.match(await page.locator('#build-error-files').textContent(), /web address.*Save it locally/);
  console.log('PASS: remote image gets instructions to save and reference a local file');
  await setup('# Ambiguous\n\n![](picture.svg)');
  await page.locator('#drop-zone').evaluate((el, svg) => {
    const transfer = new DataTransfer();
    // webkitRelativePath is supplied on File objects for the fallback drop path.
    for (const path of ['a/picture.svg', 'b/picture.svg']) {
      const file = new File([svg], 'picture.svg');
      Object.defineProperty(file, 'webkitRelativePath', { value: path });
      transfer.items.add(file);
    }
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, svg);
  await page.waitForFunction(() => document.querySelector('.count-media .file-list').textContent.includes('b/picture.svg'));
  await failBuild();
  assert.match(await page.locator('#build-error-files').textContent(), /More than one file matches/);
  console.log('PASS: duplicate basenames get precise-path guidance');
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#build-error').screenshot({ path: '/results/mobile-file-error.png' });
  const exercises = '# Exercises\n\n{exercise:practice:def Practice}\n\nSee {exercise:practice}.\n\n{figure:sketch:def Sketch}';
  await setup(exercises, [file('book_style.yaml', 'tracked:\n  table: Custom Table\n')]);
  await page.locator('[data-format="screen"]').click();
  await page.waitForFunction(() => !document.querySelector('#download').hidden || !document.querySelector('#build-error').hidden, null, { timeout: 120000 });
  assert.ok(await page.locator('#download').isVisible(), await page.locator('#log').textContent());
  const metadata = await page.locator('#download-metadata').evaluate(async link => (await fetch(link.href)).text());
  for (const setting of ['exercise: Exercise', 'figure: Figure', 'table: Custom Table']) assert.ok(metadata.includes(setting), metadata);
  const warnsOnLeave = () => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  assert.ok(await warnsOnLeave());
  await page.locator('.brand').click();
  assert.ok(await page.locator('#leave-book').isVisible());
  const saving = page.waitForEvent('download');
  await page.locator('#save-before-leaving').click();
  assert.equal((await saving).suggestedFilename(), 'book_metadata.yaml');
  assert.equal(await warnsOnLeave(), false);
  await page.locator('#book-subtitle').fill('New subtitle');
  assert.ok(await warnsOnLeave());
  await setup(exercises.split('{figure:')[0], [file('book_metadata.yaml', 'title: Exercises\nauthor: Tester\n')]);
  assert.equal(await warnsOnLeave(), false);
  await failBuild('screen');
  assert.match(await page.locator('#build-error-message').textContent(), /numbered “exercise”.*book_metadata.yaml/);
  const exerciseLog = await page.locator('#log').textContent();
  assert.match(exerciseLog, /not registered in book_metadata.yaml/);
  assert.match(exerciseLog, /offending markup/);
  await page.locator('#project-files').setInputFiles(file('book_metadata.yaml', 'title: Exercises\nauthor: Tester\ntracked:\n  exercise: {label: Exercise}\n'));
  await page.locator('[data-format="screen"]').click();
  await page.waitForFunction(() => !document.querySelector('#download').hidden || !document.querySelector('#build-error').hidden, null, { timeout: 120000 });
  assert.ok(await page.locator('#download').isVisible(), await page.locator('#log').textContent());
  console.log('PASS: os.exit diagnostics explain missing numbering settings; adding metadata builds successfully');

} finally {
  await browser?.close();
  server.close();
}
