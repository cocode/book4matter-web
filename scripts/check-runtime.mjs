import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { convert } from 'pandoc-wasm';
import { loadPyodide } from 'pyodide';

const html = await convert({ from: 'markdown', to: 'html' }, '# Book4matter', {});
assert.match(html.stdout, /<h1[^>]*>Book4matter<\/h1>/);
const python = await loadPyodide();
await python.loadPackage('pyyaml');
assert.equal(python.runPython('import yaml; yaml.safe_load("title: Book4matter")["title"]'), 'Book4matter');
await access('public/book4matter/templates/book.typ');
await access('public/book4matter/bf/__main__.py');
await import('@myriaddreamin/typst-ts-web-compiler');
console.log('PASS: Pandoc conversion, Pyodide/PyYAML, Typst module, publishing assets');
