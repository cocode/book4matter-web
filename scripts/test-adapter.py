"""Dependency-free tests of the browser adapter against the pinned engine.

Use JSON (a YAML subset) for fixtures and stub only the YAML parser and external
converter. Real PyYAML/Pandoc/Typst integration is exercised by test-formats.mjs
on CI, where the approved runtimes are installed.
"""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest

publishing = Path(sys.argv.pop(1) if len(sys.argv) > 1 else "../KindlePandocCreator").resolve()
os.environ['BF_TEMPLATES'] = str(publishing / 'templates')
sys.path.insert(0, str(publishing))
sys.modules['yaml'] = types.SimpleNamespace(safe_load=json.loads, safe_dump=lambda value, **_: json.dumps(value))
commands = []

async def dispatch(serialized):
    data = json.loads(serialized)
    commands.append(data)
    argv = data['argv']
    target = Path(argv[argv.index('-o') + 1] if argv[0] == 'pandoc' else argv[-1])
    if target.suffix == '.typ':
        target.write_text('Browser body')
    elif target.suffix == '.html':
        target.write_text('<html><head></head><body><p>Chapter</p></body></html>')
    else:
        target.write_bytes(b'%PDF-test')

sys.modules['book4matter_backend'] = types.SimpleNamespace(dispatch=dispatch)
spec = importlib.util.spec_from_file_location('browser_adapter', 'public/browser_adapter.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        commands.clear()

    def add(self, path, text='Chapter text'):
        dest = self.root / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text)
        return dest

    def test_no_config_natural_order_nested_and_uppercase(self):
        for name in ['draft/10.txt', 'draft/2.MD', 'elsewhere/1.md']:
            self.add(name)
        cfg, chapters, _ = adapter.discover_project(self.root)
        self.assertEqual(cfg, {})
        self.assertEqual([p.name for p in chapters], ['1.md', '2.MD', '10.txt'])

    def test_chapters_folder_precedence(self):
        self.add('notes.md')
        self.add('chapters/part/2.txt')
        _, chapters, _ = adapter.discover_project(self.root)
        self.assertEqual([str(p.relative_to(self.root)) for p in chapters], ['chapters/part/2.txt'])

    def test_chapters_folder_restricts_yaml_list_too(self):
        self.add('notes.md')
        self.add('chapters/2.txt')
        self.add('chapters/image.svg')
        self.add('book_metadata.yaml', json.dumps({'chapters': ['notes.md', 'chapters/2.txt', 'chapters/image.svg']}))
        _, chapters, _ = adapter.discover_project(self.root)
        self.assertEqual([str(p.relative_to(self.root)) for p in chapters], ['chapters/2.txt'])

    def test_optional_nested_configs_and_cover_paths(self):
        self.add('settings/book_style.yaml', json.dumps({'title': 'Style title', 'font-size': 12}))
        self.add('settings/book_metadata.yaml', json.dumps({'title': 'Metadata title', 'chapters': ['../draft/2.txt', '../draft/1.md'], 'cover': 'media/cover.svg'}))
        self.add('draft/1.md')
        self.add('draft/2.txt')
        self.add('loose/cover.svg', '<svg/>')
        cfg, chapters, _ = adapter.discover_project(self.root)
        self.assertEqual(cfg['title'], 'Metadata title')
        self.assertEqual(cfg['font-size'], 12)
        self.assertEqual(cfg['cover'], 'loose/cover.svg')
        self.assertEqual([p.name for p in chapters], ['1.md', '2.txt'])

    def test_yaml_chapter_list_does_not_override_uploads(self):
        self.add('book_metadata.yaml', json.dumps({'chapters': ['missing.md']}))
        self.add('1.md')
        _, chapters, _ = adapter.discover_project(self.root)
        self.assertEqual([p.name for p in chapters], ['1.md'])

    def test_ambiguous_configuration(self):
        self.add('1.md')
        self.add('book_metadata.yaml', '{}')
        self.add('nested/book_metadata.yaml', '{}')
        with self.assertRaisesRegex(ValueError, 'More than one book_metadata'):
            adapter.discover_project(self.root)

    def test_literal_text_is_opaque_in_all_formats(self):
        text = '# literal\n\n**bold** [[index]] {index:term}\n\n```\n<html>'
        self.assertIn('````{=typst}', adapter.literal_print_text(text))
        result = adapter.literal_reflow_text(text)
        self.assertIn('````{=html}', result)
        self.assertIn('&lt;html&gt;', result)
        self.assertIn('**bold** [[index]] {index:term}', result)

    def test_print_and_screen_use_distinct_engine_modes(self):
        self.add('1.txt', 'Some plain prose.')
        self.add('book_metadata.yaml', json.dumps({'title': 'Modes', 'cover': 'cover.svg'}))
        self.add('cover.svg', '<svg/>')
        asyncio.run(adapter.build_project(self.root, 'print'))
        meta = (self.root / 'out/_meta.typ').read_text()
        self.assertIn('links: "print"', meta)
        self.assertIn('cover: none', meta)
        self.assertTrue((self.root / 'out/modes-interior.pdf').exists())
        asyncio.run(adapter.build_project(self.root, 'screen'))
        meta = (self.root / 'out/_meta.typ').read_text()
        self.assertIn('links: "live"', meta)
        self.assertIn('cover: "/cover.svg"', meta)
        self.assertTrue((self.root / 'out/modes.pdf').exists())
        self.assertEqual([c['argv'][0] for c in commands], ['pandoc', 'typst', 'pandoc', 'typst'])

    def test_html_embeds_optional_style_and_removes_broken_link(self):
        self.add('1.md')
        self.add('book_metadata.yaml', '{"title":"HTML"}')
        asyncio.run(adapter.build_project(self.root, 'html'))
        self.assertNotIn('book_style.css', (self.root / 'out/html.html').read_text())
        self.add('styles/book_style.css', 'body {color: green}')
        asyncio.run(adapter.build_project(self.root, 'html'))
        self.assertIn('data:text/css;base64,', (self.root / 'out/html.html').read_text())

if __name__ == '__main__':
    unittest.main()
