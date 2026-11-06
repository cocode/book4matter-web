# Book4matter Web Developer Information


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
