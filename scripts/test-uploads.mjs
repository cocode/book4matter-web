import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterFiles, droppedFiles, mergeFiles, selectedFiles } from '../src/uploads.js';
import { pandocCommand } from '../src/pandoc-command.js';
import { secureAppURL, requireFileHashing } from '../src/secure-context.js';
import { describeBuildError, referencedFileProblems, missingBookSettings, missingFontFamilies } from '../src/build-errors.js';
const item = (path, content = '') => ({ path, file: new File([content], path.split('/').at(-1)) });

test('public HTTP URL upgrades to HTTPS while preserving navigation and local development', () => {
  assert.equal(secureAppURL('http://app.book4matter.com/?book=example#files'), 'https://app.book4matter.com/?book=example#files');
  for (const href of ['https://app.book4matter.com/', 'http://localhost:5173/', 'http://127.0.0.1:5173/']) {
    assert.equal(secureAppURL(href), null);
  }
});
test('missing browser cryptography gives an actionable HTTPS error', () => {
  for (const cryptoAPI of [null, {}, { subtle: {} }]) {
    assert.throws(() => requireFileHashing(cryptoAPI), /Open https:\/\/app.book4matter.com\/ and add your files again/);
  }
  assert.doesNotThrow(() => requireFileHashing({ subtle: { digest() {} } }));
});
test('build errors retain the cause and failing step when Safari stacks omit the message', () => {
  const error = { message: 'Unable to read chapter.md', stack: 'J@http://example.test/assets/build-worker.js:4:640' };
  const detail = describeBuildError(error, 'reading and fingerprinting "chapter.md"');
  assert.match(detail, /^Could not finish reading and fingerprinting "chapter.md"/);
  assert.ok(detail.includes(error.message));
  assert.ok(detail.includes(error.stack));
  const standard = new Error('Missing image');
  assert.equal(describeBuildError(standard), standard.stack);
  assert.equal(describeBuildError('Unknown failure'), 'Unknown failure');
  assert.equal(describeBuildError(null), 'null');
});

test('loose chapters need no YAML and accumulate with later settings', () => {
  let files = mergeFiles([], [item('10.txt'), item('2.MD')]);
  assert.deepEqual(chapterFiles(files).map(f => f.path), ['2.MD', '10.txt']);
  files = mergeFiles(files, [item('book_metadata.yaml'), item('art/cover.png')]);
  assert.equal(files.length, 4);
  assert.equal(chapterFiles(files).length, 2);
});
test('chapters folder takes precedence; arbitrary directories otherwise work', () => {
  assert.deepEqual(chapterFiles(mergeFiles([], [item('notes.txt'), item('chapters/1.md'), item('chapters/part/2.txt')])).map(f => f.path), ['chapters/1.md', 'chapters/part/2.txt']);
  assert.equal(chapterFiles([item('drafts/1.md'), item('other/2.txt')]).length, 2);
});
test('same paths replace earlier batches; duplicate basenames retain their paths', () => {
  const newer = item('one/chapter.md', 'new');
  const files = mergeFiles([item('one/chapter.md'), item('two/chapter.md')], [newer]);
  assert.equal(files.length, 2);
  assert.equal(files[0], newer);
});
test('invalid paths fail atomically and system files are ignored', () => {
  const original = [item('one.md')];
  for (const path of ['../oops.md', '/oops.md', 'a/../oops', 'a\\b', 'a\0b', 'a//b']) {
    assert.throws(() => mergeFiles(original, [item('two.md'), item(path)]), /Invalid file path/);
    assert.equal(original.length, 1);
  }
  assert.equal(mergeFiles([], [item('.git/config'), item('a/.DS_Store')]).length, 0);
});
test('folder picker unwraps project containers but preserves chapters batches', () => {
  const picked = path => ({ name: path.split('/').at(-1), webkitRelativePath: path });
  assert.deepEqual(selectedFiles([picked('Novel/chapters/1.md'), picked('Novel/book_metadata.yaml')]).map(f => f.path), ['chapters/1.md', 'book_metadata.yaml']);
  assert.equal(selectedFiles([picked('chapters/1.md')])[0].path, 'chapters/1.md');
});
test('directory drops read every entry batch, preserving supporting files', async () => {
  const entry = name => ({ isFile: true, name, file: resolve => resolve(new File(['text'], name)) });
  const directory = { isDirectory: true, name: 'chapters', createReader() {
    const batches = [[entry('1.md')], [entry('2.txt')], []];
    return { readEntries: resolve => resolve(batches.shift()) };
  } };
  const files = await droppedFiles({ items: [{ kind: 'file', webkitGetAsEntry: () => directory }], files: [] });
  assert.deepEqual(files.map(f => f.path), ['chapters/1.md', 'chapters/2.txt']);
});
test('drop fallback supports multiple ordinary files', async () => {
  const files = await droppedFiles({ items: [], files: [new File(['a'], '1.md'), new File(['b'], '2.txt')] });
  assert.equal(files.length, 2);
});
test('EPUB command preserves binary output, directories, CSS, metadata and cover', () => {
  const { output, options } = pandocCommand(['pandoc', '/book/project/a/1.md', '/book/project/b/1.md', '-f', 'markdown', '-t', 'epub3', '--wrap=preserve', '--toc', '--toc-depth=3', '--css=/book/templates/epub.css', '--metadata-file=/book/project/out/meta.yaml', '--epub-cover-image=/book/project/art/cover.png', '--resource-path=/book/project/a:/book/project', '--lua-filter=/book/templates/tracked.lua', '-o', '/book/project/out/my-book.epub']);
  assert.equal(output, '/book/project/out/my-book.epub');
  assert.equal(options['output-file'], 'result.epub');
  assert.deepEqual(options['input-files'], ['/book/project/a/1.md', '/book/project/b/1.md']);
  assert.deepEqual(options['metadata-files'], ['/book/project/out/meta.yaml']);
  assert.deepEqual(options.filters, ['browser-images.lua', 'tracked.lua']);
  assert.equal(options['toc-depth'], 3);
});
test('HTML uses embedded resources; unexpected engine flags fail visibly', () => {
  const { options } = pandocCommand(['pandoc', 'one.md', '-f', 'markdown', '-t', 'html5', '--standalone', '--section-divs', '--embed-resources', '--syntax-highlighting=none', '--metadata', 'title=A=B', '-o', 'book.html']);
  assert.equal(options.metadata.title, 'A=B');
  assert.equal(options['syntax-highlighting'], 'none');
  assert.equal(options['embed-resources'], true);
  assert.throws(() => pandocCommand(['pandoc', '--unknown']), /Unsupported Pandoc flag/);
});

test('Word chapters mix with text in natural order and respect the chapters folder', () => {
  const files = mergeFiles([], [item('10.docx'), item('2.MD'), item('1.DOCX'), item('3.txt'), item('old.doc')]);
  assert.deepEqual(chapterFiles(files).map(f => f.path), ['1.DOCX', '2.MD', '3.txt', '10.docx']);
  assert.deepEqual(chapterFiles(mergeFiles(files, [item('chapters/1.docx')])).map(f => f.path), ['chapters/1.docx']);
});

test('referenced file errors retain paths without exposing tracebacks as guidance', () => {
  const problems = [{ kind: 'missing', reference: 'media/a "quoted" image.png' }, { kind: 'ambiguous', reference: 'cover.png' }, { kind: 'remote', reference: 'https://example.com/photo.png' }];
  assert.deepEqual(referencedFileProblems(`PythonError: ERROR: filter.lua:5: BOOK4MATTER_FILES:${JSON.stringify({ problems })}\nstack traceback:\nother details`), problems);
  assert.deepEqual(referencedFileProblems('Unrelated runtime failure'), []);
  assert.deepEqual(referencedFileProblems('BOOK4MATTER_FILES:invalid'), []);
  assert.deepEqual(referencedFileProblems('BOOK4MATTER_FILES:{"problems":[null,{"kind":"missing","reference":42}]}'), []);
});

test('missing numbering settings get actionable guidance instead of a bare exit code', () => {
  assert.equal(missingBookSettings("tracked.lua: tracked definition {exercise:one:def One} uses kind 'exercise', which is not registered in book_metadata.yaml `tracked:`. Add it there.\nexit with exit code 1"), 'exercise');
  assert.equal(missingBookSettings("tracked.lua: unknown tracked kind in {index:figure}; add 'figure' to book_metadata.yaml `tracked:`"), 'figure');
  assert.equal(missingBookSettings('exit with exit code 1'), null);
});

test('missing font families are collected from compiler diagnostics without duplicates', () => {
  assert.deepEqual(missingFontFamilies(['/book/project/out/book.typ:1:1: warning: unknown font family: eb garamond', 'warning: unknown font family: cormorant', 'warning: unknown font family: eb garamond']), ['eb garamond', 'cormorant']);
  assert.deepEqual(missingFontFamilies('Other compilation error'), []);
  assert.deepEqual(missingFontFamilies(undefined), []);
});
