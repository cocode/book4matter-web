# Book4matter Web

Book4matter turns Word (.docx), Markdown, and plain-text manuscripts into formatted books in
your browser. Files stay on your device; there is no server-side conversion.
The web app is available at [app.book4matter.com](https://app.book4matter.com/), with
a command line version available at [book4matter.com](https://book4matter.com/).

Add files with the file picker, select a folder, or drag files and folders into
the drop area. Add as many batches as you need: chapters first, then settings,
images, or fonts. New files with the same relative path replace earlier copies.
Review the list to remove individual files or clear it to start another book.

If a referenced image, cover, or included file is missing, a message beside the
build buttons names it and offers **Add a folder** and **Add files**. Adding the
whole book folder preserves relative paths. Duplicate filenames and web-hosted
images get specific guidance; technical details remain available separately.
Books with numbered exercises or figures also need their numbering definitions
from the original `book_metadata.yaml`. The title/author form supplies basic
book details; missing numbering settings are explained beside the build buttons.
PDF builds also name missing font families beside the build buttons. Add the
referenced `.ttf` or `.otf` files (including bold and italic styles), or add the
whole book folder including its fonts, then retry. Fonts installed on your
computer are not automatically available to the browser's PDF engine.

- With a `chapters/` folder, only its `.docx`, `.md`, and `.txt` files are chapters,
  including files in its subfolders. Text files elsewhere are ignored.
- Without `chapters/`, all uploaded `.docx`, `.md`, and `.txt` files are chapters.
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

Word files are imported with headings, text formatting, and embedded images.
They can be mixed with Markdown and text chapters in filename order. Word page
layout is replaced by the book’s styling. Legacy `.doc` files are not supported;
save them as `.docx` first.

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
Subentries use a plain `>` marker, such as `> Polka`, in every output format.

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
which includes index “see” aliases. The engine and templates come from that
revision; preparation replaces its bent-arrow subentry marker with `>`.

## Build locally with the prepared Docker image

Use the existing `book4matter-web:dev` image to build the current checkout:

```sh
./scripts/build-local.sh
python3 -m http.server 8001 --directory dist
```

Open <http://localhost:8001>. Serve `dist/`, rather than the project root:
source modules require bundling before a static server can run the engine.

The script runs offline, never pulls images or installs packages, and uses the
image’s prepared tools and publishing runtimes. It overlays current web sources
inside a disposable container, runs runtime/upload/build checks, then copies the
finished site to `dist/`. It warns if requested dependency versions differ from
the prepared image; it does not update them. Publishing sources are copied from the adjacent `../KindlePandocCreator`
checkout. Set `BOOK4MATTER_PUBLISHING_DIR` to use a different existing checkout.

To select another already prepared development image:

```sh
BOOK4MATTER_WEB_IMAGE=book4matter-web:test ./scripts/build-local.sh
```

To test all four sample projects (`docs`, `novel`, `example`, and `web`) in all
four browser output formats, use the already prepared browser-test image:

```sh
docker run --rm --pull never --network none \
  --mount "type=bind,src=$PWD/dist,dst=/site,readonly" \
  --mount "type=bind,src=$PWD/../KindlePandocCreator,dst=/publishing,readonly" \
  --mount "type=bind,src=$PWD/scripts/test-examples.mjs,dst=/tmp/test-examples.mjs,readonly" \
  --mount "type=bind,src=$PWD/output/examples,dst=/results" \
  --entrypoint node book4matter-web:test /tmp/test-examples.mjs
```

Create `output/examples` first (`mkdir -p output/examples`). Results, build logs,
and generated books are saved there. The test uploads source folders through
the browser, skips existing `out/` artifacts, and checks downloaded outputs.
