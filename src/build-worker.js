import { buildBook } from './build-book.js';

// The worker bundle lives in assets/, while public files use the site's base.
const appURL = new URL(import.meta.env.BASE_URL, self.location.origin);
const assetURL = path => new URL(path, appURL).href;
const log = message => postMessage({ type: 'log', message });
async function get(path, binary = false) {
  const response = await fetch(assetURL(path));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.text();
}

self.onmessage = async ({ data }) => {
  try {
    const result = await buildBook(data.files || [], data.format, { assetURL, get, log });
    postMessage({ type: 'complete', ...result }, [result.bytes.buffer]);
  } catch (error) {
    postMessage({ type: 'error', message: error.stack || String(error) });
  }
};
