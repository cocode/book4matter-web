# Book4matter Web

Book4matter turns plain text and Markdown manuscripts into formatted books,
handling typography, chapter layout, and page numbering. This browser proof of
concept creates print-interior PDFs from a selected Book4matter project folder,
with a preview and build log. Publishing runs in a Web Worker on the user's
device. The server serves static files only.

GitHub Actions builds the static site on a disposable GitHub-hosted runner and
deploys it to GitHub Pages. No local installation or Docker build is needed for
deployment. The browser loads its engines, fonts, Python wheel, templates, and
sources from the app's own origin.

## GitHub Pages deployment

The site URL is [https://cocode.github.io/book4matter-web/](https://cocode.github.io/book4matter-web/).
In repository **Settings → Pages → Build and deployment**, select **GitHub
Actions** as the source. Allow the `main` branch in the `github-pages`
environment's deployment rules. Commit the workflow, lockfile, and supporting
files together, then push to `main`; subsequent pushes rebuild and deploy.
The workflow can also be started from **Actions → Build and deploy GitHub
Pages → Run workflow**. Only `main` may deploy.

`.github/workflows/pages.yml` runs these steps entirely on GitHub:

1. Check out the app and the pinned `cocode/Book4matter` publishing sources.
2. Set up the exact Node/npm versions and validate the reviewed dependency pins.
3. Run `npm audit` against the lockfile, then `npm ci --ignore-scripts`.
4. Prepare checksum-verified runtimes, fonts, and templates, then run the runtime smoke checks.
5. Build with Vite using the base path supplied by Pages and verify the generated assets.
6. Upload `dist/` and deploy it using the Pages environment.

The deployed site is static; Node and the build tools run only during CI.
The base path also applies to the Web Worker, Pyodide, WASM, asset manifest,
and home link. Local development still defaults to `/`. A repository rename
or Pages custom domain is reflected by the next build's Pages metadata.

## Dependency review

The review dated **October 28, 2026** is recorded in
`scripts/dependency-review.json`. It contains exact versions, release dates,
registry integrity values, Action commit SHAs, and advisory-check sources.
The normal release cutoff is **September 28, 2026**. The approved exceptions
are security fixes:

| Component | Pin | Reason for newer release |
| --- | --- | --- |
| Node.js | 24.22.1 | [October Node.js security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) |
| Vite | 8.3.3 | [October Vite security fixes](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22) |
| source-map-js | 1.2.2 | [Indexed source-map denial-of-service fix](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |

The final checks found no matching npm advisories for the 69 locked package
versions or bundled npm 11.19.1, no matching GitHub Actions advisories for the
selected releases (including the nested upload action), and no OSV advisories
for PyYAML 6.0.3. Pyodide and typst.ts returned no published repository
security advisories. These checks do not independently audit every native
library embedded in WASM or establish the absence of unknown vulnerabilities.

CI fails if dependency pins differ from the review, asset checksums differ,
or the current npm audit reports any severity of vulnerability. Node, Actions,
and non-npm runtime advisory checks are recorded as of the review date and
should be repeated when updating pins. `npm run check:pins` is a read-only
metadata check and does not install dependencies. The hosted Ubuntu image and
GitHub's action runtime are maintained by GitHub; the workflow installs no apt
packages and pins all explicitly selected build dependencies.

`scripts/runtime-assets.json` pins the PyYAML wheel, Libertinus fonts,
Liberation fonts 2.1.5, and wrap-it 0.1.1 with SHA-256 checksums. Template/font
sources use immutable commits or a fixed release archive. The publishing
checkout is first-party application source pinned to commit
`643c927d6a49b8c5a60d4764d535cdda5f2e485c`; local uncommitted publishing changes
are not included in deployment. Updating it is a separate source change.

## Existing Docker development setup

The following setup is separate from the GitHub Pages workflow. Deployment
does not run these commands.

From this checkout, with the existing publishing repository beside it:

```sh
docker build --build-context publishing=../KindlePandocCreator -t book4matter-web:dev .
docker run --rm -p 127.0.0.1:5173:5173 book4matter-web:dev
```

Open http://localhost:5173. The container serves the production static build.
Use **Choose project folder** and select the folder whose
root contains `book_metadata.yaml` or `book_style.yaml`. Then click **Build my
PDF**. Chapter paths are resolved by the existing Python engine, including an
explicit `chapters:` list. Local `media/` files and `.ttf`/`.otf` files in `fonts/`
are included. Existing `out/`, `.git/`, and `node_modules/` directories are ignored.
Chapters ending in `.txt` are literal text: headings, emphasis, links, and index
markup print as written, with blank lines separating paragraphs. Use `.md` for
Markdown formatting, images, and index markup. Both types can share a project.
Folder selection reads files into browser memory; it does not send them to the
server. ZIP and Word imports are not part of this upload interface.

The build-details section also offers the generated Typst files and source
SHA-256 hashes as JSON. A fresh worker is used for each build.

To develop against the sources already copied into the image:

```sh
docker run --rm -p 127.0.0.1:5173:5173 book4matter-web:dev npm run dev -- --port 5173 --strictPort
```

Rebuild the image after source changes. The sibling publishing checkout is a
read-only build context; this project does not modify it. Generated PDFs from
that checkout are not copied into the image.

If the runtime dependencies are already available, refresh the shared publishing
sources without installing software, then rebuild the static app:

```sh
node scripts/prepare-project.mjs ../KindlePandocCreator
npm run build
```

This copies the current `bf/` and `templates/` and regenerates asset hashes.
The Docker build performs the same source refresh through its publishing context.
Index support uses the shared Python engine, `tracked.lua`, and `book.typ`:
mark terms with `[[Frame]]`, use `[[Richard Powers|Powers, Richard]]` for an
alphabetized alias or `[[polka hold|Practice hold>polka]]` for a subentry, and
put `{index:term}` on its own line where the index should appear. Page numbers
are resolved during PDF layout. No `tracked:` configuration is needed for terms.

## What is reused

`public/browser_adapter.py` imports the original `bf.__main__` engine under
Pyodide. Its checked AST transformation makes `build_print` async and awaits
its two `run()` calls. All other statements in that function, and all publishing
helpers, remain the original implementation except for literal TXT protection:
the browser adapter emits escaped Typst text so Lua filters cannot interpret
index tokens in `.txt` prose. The shared engine handles YAML config merging, chapter
sorting, novel preprocessing, trim/gutter rules, metadata, scaffolding, and
output naming. This avoids a JavaScript rewrite of the publishing rules.

`src/build-worker.js` implements the two external-tool calls:

1. Pandoc WASM converts the Python-preprocessed chapters to Typst using the
   unmodified filters in order: `tracked.lua`, `wrap.lua`, `parts.lua`, with
   `_common.lua` beside them.
2. Typst WASM compiles the original `book.typ`, Python-generated `_meta.typ`,
   `_body.typ`, and `main.typ`. Libertinus Serif, Liberation Sans, and
   `@preview/wrap-it:0.1.1` are bundled locally.

The Pandoc wrapper originally hardcodes an empty WASI environment. At image
build time, a guarded adaptation adds an explicit environment argument so the
original Lua `os.getenv` calls receive the engine's `BF_*` settings. Lua source
is unchanged. The wrapper has a flat filesystem, so the adapter gives the
processed chapters and filter files unique basenames. Unknown command flags
fail explicitly; this adapter supports the print PDF command, including project font paths.

The build produces a static `dist/` directory suitable for static hosting.
Set `VITE_BASE_PATH` at build time to serve it beneath a subdirectory such as
`/book4matter-web/`; GitHub Actions sets this from the Pages configuration.

## Verification in Docker

Build the separate test target, which installs Chromium, Playwright, and Poppler
inside Docker only:

```sh
docker build --build-context publishing=../KindlePandocCreator --target browser-test -t book4matter-web:test .
mkdir -p output/pdf
docker run --rm --network none --shm-size=1g -e OUTPUT_DIR=/output \
  -v "$PWD/output/pdf:/output" book4matter-web:test
```

The test opens the production app in Chromium, selects a project folder, saves
the real browser download, and checks:

- No external HTTP requests, with container networking disabled.
- PDF title/author, seven pages, and 432 × 648 pt (6 × 9 in) trim.
- Five automatic chapter headings and matching body folios, without a TOC.
- Libertinus Serif and Liberation Sans in the generated PDF.
- Downloadable Typst sources, successful build log, and mobile page width.
- All sample pages rendered to PNG for visual inspection.
- A selected project folder with distinct text, a local image, and a local font.
- Literal `.txt` headings, emphasis, links, and index tokens alongside a `.md`
  chapter whose formatting and image are still interpreted.
- Invalid-folder feedback and no file data sent to the server.
- A generated term index with page numbers, aliases, alphabetical order,
  subentries, repeated terms, heading terms included in the TOC, outbound links,
  and numbered tracked items in the same book.

With the existing test tools and prepared production build, the suite is also
available as `npm run test:browser`. It currently expects the Linux image's
Chromium, Playwright, Poppler, and `/app/fixtures/novel` paths. There is no
separate unit-test suite; `npm run check:runtime` provides engine smoke checks.

Artifacts are written under `output/pdf/` (ignored by Git). If
`output/pdf/native-reference.pdf` exists, the test also compares manuscript text,
chapter folios, page count, and trim with that native reference. Build dates are
normalized because browser and native runtimes can use different timezones.

The sample was also built with the already available native Book4matter image
using the same source checkout. `book.typ`, `_body.typ`, and `main.typ` matched
exactly; `_meta.typ` differed only in the local build date. This is a content and
layout check, not a claim that the two PDFs are byte-identical.

## Scope

This prototype builds print PDFs from a selected project folder. EPUB/HTML, ZIP/Word import, comprehensive image-format coverage, and
cross-browser parity remain future work. The upload path is tested in Chromium
with text, an SVG image, and a local TrueType font; larger and more complex
projects still need broader compatibility testing. Browser PDF preview depends on the browser's PDF viewer; the
download works independently. The known PDF-only novel/no-parts preprocessing
limitation is unchanged.

The existing Docker Node base is pinned by digest and npm dependencies by
lockfile. Its Debian packages follow the configured mirrors. GitHub Pages
uses the separate, reviewed CI pins and checksum-verified assets described
above, without building either Docker image.
