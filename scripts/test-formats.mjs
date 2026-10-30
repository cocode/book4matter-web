// Run in CI after runtime preparation. Each build uses a fresh process, just as
// the browser uses a fresh worker, so WASM heaps are released between builds.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const format = process.argv[2];
if (!format) {
  const failed = [];
  for (const target of ['print', 'screen', 'html', 'epub', 'defaults']) {
    try {
      execFileSync(process.execPath, [import.meta.filename, target], { stdio: 'inherit', timeout: 180000 });
    } catch (error) {
      failed.push(target);
      console.error(`FAIL: ${target} (${error.code || error.signal || `exit ${error.status}`})`);
    }
  }
  assert.deepEqual(failed, [], `Format checks failed: ${failed.join(', ')}`);
} else {
  const { buildBook } = await import('../src/build-book.js');
  const root = new URL('../public/', import.meta.url);
  const files = [
    ['drafts/02.md', '# Garden\n\nMARKDOWN_CONTENT **formatted**.\n\n![Garden](../art/garden.svg)\n\n'
      + '## [[Practice hold]]\n\n## [[polka hold|Practice hold>polka;Polka grip]]\n\n'
      + '[[[another hold|Practice hold>polka]]](https://example.com/hold)\n\n'
      + '## [[Tempo|Tempo;BPM;Beats per minute]]\n\n'
      + '[[[Musical speed|Tempo;BPM]]](https://example.com/tempo)\n\n'
      + '[[Richard Powers|Powers, Richard]]\n\n'
      + (format === 'defaults' ? '' : '{exercise:steps Practice steps}\n\nTry {exercise:steps}.\n\n{index:exercise}\n\n')
      + '## Index {.section}\n\n{index:term}\n'],
    ['drafts/10.txt', 'LITERAL_CONTENT\n\n# literal heading\n\n**literal bold** [[literal index]] {index:term}\n'],
    ['settings/book_metadata.yaml', 'title: Browser Formats\nauthor: Test Writer\ncover: art/garden.svg\ntracked:\n  exercise: Exercise\n'],
    ['settings/book_style.yaml', 'font-size: 12\ntoc: true\n'],
    ['styles/book_style.css', 'body { color: #233d34; }'],
    ['art/garden.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="green"/></svg>'],
  ].filter(([path]) => format !== 'defaults' || !path.endsWith('.yaml'))
    .map(([path, text]) => ({ path, file: new File([text], path.split('/').at(-1)) }));
  const logs = [];
  const result = await buildBook(files, format === 'defaults' ? 'print' : format, {
    assetURL: path => new URL(path, root).href,
    runtimeDirectory: fileURLToPath(new URL('runtime/pyodide/', root)),
    get: async (path, binary = false) => {
      const bytes = await readFile(new URL(path, root));
      return binary ? new Uint8Array(bytes) : bytes.toString('utf8');
    },
    log: message => { logs.push(message); console.log(message); },
  });
  assert.ok(result.bytes.length > 1000);
  assert.doesNotMatch(logs.join('\n'), /Could not fetch resource|Could not load include file|unknown font family/i);
  if (['print', 'screen', 'defaults'].includes(format)) {
    assert.equal(new TextDecoder().decode(result.bytes.slice(0, 5)), '%PDF-');
    assert.match(result.sources['_body.typ'], /LITERAL_CONTENT/);
    // Pandoc escapes Markdown's underscore in Typst source. Literal TXT is
    // emitted as #text("...") above, where the underscore stays unescaped.
    assert.match(result.sources['_body.typ'], /MARKDOWN\\_CONTENT/);
    assert.match(result.sources['_body.typ'], /\/art\/garden.svg/);
    assert.match(result.sources['_body.typ'], /#termdef\("practice hold>polka", "polka", "idx-practice-hold-polka-1".*parent: "Practice hold", aliases: \("Polka grip",\)/);
    assert.match(result.sources['_body.typ'], /aliases: \("BPM", "Beats per minute",\)/);
    assert.match(result.sources['_body.typ'], /#termindex\(\)/);
    if (format !== 'defaults') assert.match(result.sources['_body.typ'], /#tindex\("exercise"\)/);
    assert.match(result.sources['_meta.typ'], format === 'screen' ? /links: "live"/ : /links: "print"/);
    assert.match(result.sources['_meta.typ'], format === 'screen' ? /cover: "\/art\/garden.svg"/ : /cover: none/);
    assert.equal(result.name, format === 'screen' ? 'browser-formats.pdf' : format === 'defaults' ? 'project-interior.pdf' : 'browser-formats-interior.pdf');
  } else if (format === 'html') {
    const text = new TextDecoder().decode(result.bytes);
    assert.match(text, /<html/);
    assert.match(text, /Browser Formats/);
    assert.match(text, /MARKDOWN_CONTENT/);
    assert.match(text, /LITERAL_CONTENT/);
    assert.match(text, /\*\*literal bold\*\*/);
    assert.match(text, /\[\[literal index\]\]/);
    assert.match(text, /data:image\/svg\+xml/);
    assert.match(text, /data:text\/css;base64,/);
    assert.doesNotMatch(text, /href="book_style.css"/);
    checkIndex(text);
  } else {
    const entries = unzip(Buffer.from(result.bytes));
    assert.equal(entries.get('mimetype')?.toString(), 'application/epub+zip');
    assert.ok(entries.has('META-INF/container.xml'));
    const content = [...entries].filter(([name]) => /\.(xhtml|opf)$/.test(name)).map(([, bytes]) => bytes.toString()).join('\n');
    assert.match(content, /Browser Formats/);
    assert.match(content, /MARKDOWN_CONTENT/);
    assert.match(content, /LITERAL_CONTENT/);
    assert.match(content, /\*\*literal bold\*\*/);
    assert.match(content, /\[\[literal index\]\]/);
    assert.ok([...entries.keys()].some(name => name.endsWith('.svg')));
    checkIndex(content);
  }
  console.log(`PASS: ${format} build with loose chapters, literal TXT, optional YAML, images, index aliases, subentries and tracked lists`);
}

function checkIndex(markup) {
  const text = markup.replace(/\s+/g, ' ');
  for (const id of ['idx-practice-hold-1', 'idx-practice-hold-polka-1', 'idx-practice-hold-polka-2', 'idx-tempo-1', 'idx-tempo-2', 'idx-powers-richard-1']) {
    assert.equal(text.split(`id="${id}"`).length - 1, 1, `Definition ${id} must occur once, outside navigation`);
    assert.match(text, new RegExp(`href="[^"]*#${id}"`));
    for (const nav of text.matchAll(/<nav\b[^>]*>.*?<\/nav>/g)) assert.ok(!nav[0].includes(`id="${id}"`));
  }
  assert.equal(text.split('BPM. <em>see</em>').length - 1, 1, 'Repeated aliases must be deduplicated');
  assert.match(text, /BPM\. <em>see<\/em> <a href="[^"]*#idx-tempo-1">Tempo<\/a>/);
  assert.match(text, /Polka grip\. <em>see<\/em> <a href="[^"]*#idx-practice-hold-polka-1">Practice hold, polka<\/a>/);
  assert.match(text, /class="index-leader"/);
  assert.match(text, /↳/);
  assert.match(text, /href="https:\/\/example.com\/hold"/);
  assert.match(text, /id="trk-exercise-steps"/);
  assert.match(text, /href="[^"]*#trk-exercise-steps"/);
}

function unzip(bytes) {
  // Read the ZIP central directory, including archives using data descriptors.
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'EPUB is not a ZIP archive');
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + size);
    assert.ok(method === 0 || method === 8, `Unsupported ZIP compression ${method}`);
    entries.set(name, method === 8 ? inflateRawSync(data) : data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
