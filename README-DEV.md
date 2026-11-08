# Book4matter Web Developer Information

The build produces a static site in `dist/`.
Run commands in a POSIX shell (Linux, macOS, or WSL).

## Build

1. Have Git, Node.js **24.22.1** (also recorded in `.nvmrc`), npm **11.19.1**,
   Python 3, and `tar` available. Python runs the adapter checks and the local
   static server. Native Pandoc, Typst, Java, and a Python virtual environment
   are not needed: conversion uses the bundled browser runtimes. Initial
   dependency and runtime preparation needs internet access.

2. Check out the web app and publishing sources into sibling directories. The
   publishing revision below matches GitHub Actions. For existing checkouts,
   use their paths instead; do not clone over them.

   ```sh
   git clone https://github.com/cocode/book4matter-web.git
   git clone https://github.com/cocode/Book4matter.git
   cd Book4matter
   git checkout 46590eba829f1d6a8fd1bb6bc72dfd42934097a5
   cd ../book4matter-web
   ```

3. Verify the dependency pins, then install the locked npm dependencies:

   ```sh
   node scripts/check-dependency-policy.mjs
   npm ci --ignore-scripts --no-audit --no-fund
   ```

4. Prepare the browser runtimes and fonts, then copy the publishing engine and
   templates and generate their asset hashes:

   ```sh
   node scripts/prepare-runtime.mjs
   node scripts/prepare-project.mjs ../Book4matter
   ```

   Runtime preparation downloads integrity-checked assets, including PyYAML,
   fonts, and Typst packages. It also generates the Pandoc JavaScript module.
   Project preparation replaces the pinned templates' bent-arrow index subentry
   marker with `>`. If your publishing checkout is elsewhere, pass its path to
   `prepare-project.mjs` instead.

5. Check the prepared runtimes and test file handling and all four output formats:

   ```sh
   npm run check:runtime
   node --test scripts/test-uploads.mjs
   PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-adapter.py ../Book4matter
   node scripts/test-formats.mjs
   ```

   Use the same publishing path as step 4 for the adapter test. EPUB tests use
   the engine's navigation checks; native Java `epubcheck` is not run in the
   browser.

6. Build and check the static site:

   ```sh
   npm run build
   npm run check:dist
   ```

   The default base path is `/`. For hosting under a subdirectory, set it when
   building, for example `VITE_BASE_PATH=/books/ npm run build`.

7. Serve the finished site and open <http://localhost:8001>:

   ```sh
   python3 -m http.server 8001 --directory dist
   ```

   Serve `dist/`; source modules require bundling before a static server can run
   the engine. Stop the server with Ctrl+C. For development with live reload,
   stop the static server and run `npm run dev` after completing preparation.
   Rebuild after source changes; repeat preparation when dependencies, runtime
   pins, or publishing sources change.

## Build a Docker image

1. Have Docker with BuildKit/named build context support and Git available.
   Start Docker and check out both repositories using step 2 above. Run the
   following commands from `book4matter-web/`. The initial image build needs
   internet access and installs dependencies inside the image.

2. Build the development image, supplying the publishing checkout as the named
   `publishing` context:

   ```sh
   docker build --target development \
     --build-context publishing=../Book4matter \
     -t book4matter-web:dev .
   ```

   Replace the context path if your publishing checkout is elsewhere. The image
   prepares the browser runtimes, copies the publishing engine and templates,
   checks the runtimes, builds the site, and checks that the development server runs.
   Node, npm, and Python do not need to be installed on the host for this build.

3. Run the site built into the image and open <http://localhost:5173>:

   ```sh
   docker run --rm --pull never -p 127.0.0.1:5173:5173 book4matter-web:dev
   ```

   Stop it with Ctrl+C. This serves the sources captured when you built the image.

4. To build your current checkout into the host's `dist/` using that prepared
   image, run:

   ```sh
   BOOK4MATTER_PUBLISHING_DIR=../Book4matter ./scripts/build-local.sh
   ```

   This runs offline without pulling images or installing packages. It copies
   current web sources into a disposable container, refreshes publishing sources
   from the specified `../Book4matter` checkout, runs runtime/upload/default-format/
   build checks, and copies the finished site to `dist/`. It warns if dependency versions
   differ from the image; rebuild the image to update its dependencies.

   Set `BOOK4MATTER_PUBLISHING_DIR` for a different publishing checkout or
   `BOOK4MATTER_WEB_IMAGE` for a different prepared development image:

   ```sh
   BOOK4MATTER_PUBLISHING_DIR=/path/to/Book4matter \
     BOOK4MATTER_WEB_IMAGE=book4matter-web:dev ./scripts/build-local.sh
   ```

   If Python 3 is available on the host, serve this output with
   `python3 -m http.server 8001 --directory dist` and open
   <http://localhost:8001>.

## Optional browser tests with Docker

1. Build the browser-test image using the same publishing checkout. This adds
   Chromium, PDF inspection tools, and the browser test driver inside the image:

   ```sh
   docker build --target browser-test \
     --build-context publishing=../Book4matter \
     -t book4matter-web:test .
   ```

2. Run its browser smoke tests against the site built into that image:

   ```sh
   docker run --rm --pull never --network none book4matter-web:test
   ```

3. To run the sample-project tests below, first generate `dist/` with step 4 of
   the Docker build instructions (or complete the non-Docker build).

To test all four sample projects (`docs`, `novel`, `example`, and `web`) in all
four browser output formats, use the already prepared browser-test image:

```sh
mkdir -p output/examples
docker run --rm --pull never --network none \
  --mount "type=bind,src=$PWD/dist,dst=/site,readonly" \
  --mount "type=bind,src=$PWD/../Book4matter,dst=/publishing,readonly" \
  --mount "type=bind,src=$PWD/scripts/test-examples.mjs,dst=/tmp/test-examples.mjs,readonly" \
  --mount "type=bind,src=$PWD/output/examples,dst=/results" \
  --entrypoint node book4matter-web:test /tmp/test-examples.mjs
```

Results, build logs, and generated books are saved in `output/examples`. The test uploads source folders through
the browser, skips existing `out/` artifacts, and checks downloaded outputs.


## Continuous integration

GitHub Actions uses the pinned publishing revision above, prepares the browser
runtimes, tests all four output formats, and deploys `dist/` to GitHub Pages at
the custom-domain root. Using the hosted app requires no local build.
