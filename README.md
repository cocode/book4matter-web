# Book4matter Web

Book4matter turns Markdown and plain-text manuscripts into formatted books in
your browser. Files stay on your device; there is no server-side conversion.
The app is available at [app.book4matter.com](https://app.book4matter.com/), with
more about the publishing engine at [book4matter.com](https://book4matter.com/).

Add files with the file picker, select a folder, or drag files and folders into
the drop area. Add as many batches as you need: chapters first, then settings,
images, or fonts. New files with the same relative path replace earlier copies.
Review the list to remove individual files or clear it to start another book.

- With a `chapters/` folder, only its `.md` and `.txt` files are chapters,
  including files in its subfolders. Text files elsewhere are ignored.
- Without `chapters/`, all uploaded `.md` and `.txt` files are chapters.
- Chapters use natural filename order (2 before 10). The uploaded files determine
  the chapter set; a CLI `chapters:` list in YAML does not exclude uploaded
  chapters or require files you did not add.
- `book_metadata.yaml` and `book_style.yaml` are optional and may be anywhere in
  the upload. Metadata overrides style settings when the same key appears in
  both. More than one copy of either settings file produces an error.
- Keep relative image paths when adding folders. For loose files, a reference
  such as `media/cover.png` can also resolve to a uniquely named `cover.png`.
  Ambiguous or missing image references produce an error. Upload fonts anywhere
  and select their family names in the YAML settings.

Choose **Print PDF** for the print interior, **Screen PDF** for clickable links
and an optional cover, **HTML** for a standalone browser document, or **EPUB** for
an e-reader. Plain `.txt` content is kept literal in each output; Markdown
formatting applies only to `.md` chapters. PDF output has an in-page preview;
HTML and EPUB are downloads. An optional `book_style.css` is embedded in HTML.

Book indexes support `[[term]]`, alternate index wording such as
`[[Richard Powers|Powers, Richard]]`, and subentries such as
`[[polka hold|Practice hold>polka]]`. Add “see” aliases with
`[[Tempo|Tempo;BPM;Beats per minute]]`, then place `{index:term}` on its own line
where the index belongs. Aliases and subentries also work in headings and
outbound links. Print indexes show page numbers; screen PDF, HTML, and EPUB
link to definitions. Numbered exercises, figures, and other configured tracked
items can have their own lists, such as `{index:exercise}`.

GitHub Actions prepares the pinned publishing runtimes, checks dependencies,
tests all four output formats, and deploys the static site to GitHub Pages at
the custom-domain root. No local installation or Docker is required. EPUB
builds use the engine's navigation checks; the native Java `epubcheck` tool is
not run in the browser.

Dependency-free checks, using existing Node and Python installations:

```sh
node --test scripts/test-uploads.mjs
PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-adapter.py ../KindlePandocCreator
```

The adapter tests isolate the YAML parser and converter to test file discovery
and engine dispatch. CI additionally runs `node scripts/test-formats.mjs` against
the real pinned PyYAML, Pandoc WASM and Typst WASM runtimes before deployment.

Publishing sources are pinned to `ab72b88de720853b283185c63f1434c791f4260c`,
which includes index “see” aliases. The engine and templates are copied directly
from that upstream revision.
