# syntax=docker/dockerfile:1
# All software installation happens in this image, never on the host.
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS development

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-liberation2 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY scripts ./scripts
RUN node scripts/prepare-runtime.mjs

# Supply the existing checkout as a named, read-only build context.
COPY --from=publishing /bf ./public/book4matter/bf
COPY --from=publishing /templates ./public/book4matter/templates
COPY --from=publishing /novel/book_metadata.yaml ./public/book4matter/novel/book_metadata.yaml
COPY --from=publishing /novel/chapters ./public/book4matter/novel/chapters
COPY --from=publishing /example/book_metadata.yaml /example/book_style.yaml ./public/book4matter/example/
COPY --from=publishing /example/chapters ./public/book4matter/example/chapters
COPY . .
RUN node scripts/prepare-project.mjs
RUN npm run check:runtime
RUN npm run build

USER node
RUN node scripts/check-server.mjs
EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--port", "5173", "--strictPort"]

FROM development AS browser-test
USER root
RUN apt-get update && apt-get install -y --no-install-recommends chromium poppler-utils && rm -rf /var/lib/apt/lists/*
RUN npm install --prefix /opt/browser-test --ignore-scripts --no-audit --no-fund playwright-core@1.56.1
CMD ["node", "scripts/test-browser.mjs"]

FROM development AS final
