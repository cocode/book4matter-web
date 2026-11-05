#!/bin/sh
# Build current sources with existing container tools; never install on the host.
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
publishing_dir=${BOOK4MATTER_PUBLISHING_DIR:-"$project_dir/../KindlePandocCreator"}
[ -f "$publishing_dir/bf/__main__.py" ] || { echo "Publishing checkout missing: $publishing_dir" >&2; exit 1; }
publishing_dir=$(CDPATH= cd -- "$publishing_dir" && pwd)
image=${BOOK4MATTER_WEB_IMAGE:-book4matter-web:dev}
command -v docker >/dev/null 2>&1 || { echo 'Docker must already be available.' >&2; exit 1; }
docker image inspect "$image" >/dev/null 2>&1 || {
  echo "Prepared image unavailable: $image. Set BOOK4MATTER_WEB_IMAGE to an existing development image." >&2
  exit 1
}
mkdir -p "$project_dir/dist"

docker run --rm --pull never --network none --user 0:0 \
  --mount "type=bind,src=$project_dir,dst=/source,readonly" \
  --mount "type=bind,src=$project_dir/dist,dst=/output" \
  --mount "type=bind,src=$publishing_dir,dst=/publishing,readonly" \
  --env "VITE_BASE_PATH=${VITE_BASE_PATH:-/}" \
  --entrypoint sh "$image" -eu -c '
    cd /app
    test -d node_modules && test -f src/generated/pandoc-core.js && test -f public/assets.json || {
      echo "Image lacks prepared dependencies or publishing assets." >&2; exit 1;
    }
    # Retain prepared dependencies, generated modules and publishing runtimes.
    # Overlay the current checkout inside this disposable container only.
    node --input-type=module -e '\''
      import fs from "node:fs";
      const current = JSON.parse(fs.readFileSync("/source/package.json"));
      const prepared = JSON.parse(fs.readFileSync("package.json"));
      for (const section of ["dependencies", "devDependencies"]) {
        for (const [name, version] of Object.entries(current[section] || {})) {
          if (prepared[section]?.[name] !== version)
            console.warn(`Warning: prepared image declares ${name}@${prepared[section]?.[name] || "missing"}; checkout requests ${version}. No packages will be installed.`);
        }
      }
    '\''
    cp -R /source/src/. src/
    cp -R /source/public/. public/
    cp -R /source/scripts/. scripts/
    cp /source/index.html /source/vite.config.js /source/package.json ./
    node scripts/prepare-pandoc.mjs
    node scripts/prepare-project.mjs /publishing
    node scripts/check-runtime.mjs
    node --test scripts/test-uploads.mjs
    node scripts/test-formats.mjs defaults
    npm run build
    node scripts/check-dist.mjs
    # Copy only after all build checks succeed.
    cp -R dist/. /output/
  '
printf '\nBuilt current sources into %s/dist\n' "$project_dir"
printf 'Serve with: python3 -m http.server 8001 --directory "%s/dist"\n' "$project_dir"
