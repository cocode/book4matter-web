export function secureAppURL(href) {
  const url = new URL(href);
  if (url.protocol !== 'http:' || url.hostname !== 'app.book4matter.com') return null;
  url.protocol = 'https:';
  return url.href;
}

export function requireFileHashing(cryptoAPI = globalThis.crypto) {
  if (typeof cryptoAPI?.subtle?.digest !== 'function') {
    throw new Error('File fingerprinting is unavailable. Open https://app.book4matter.com/ and add your files again. This build requires a secure browser connection (HTTPS).');
  }
}
