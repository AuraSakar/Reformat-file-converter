import { sanitizeBaseName } from './files';

export function safeFilename(filename) {
  const match = String(filename ?? '').match(/^(.*?)(\.[a-z0-9]{1,8})$/i);
  if (!match) return sanitizeBaseName(filename);
  return `${sanitizeBaseName(match[1])}${match[2].toLowerCase()}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeFilename(filename);
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBytes(bytes, filename, type = 'application/octet-stream') {
  downloadBlob(new Blob([bytes], { type }), filename);
}
