import { TEXT_EXTENSIONS, TEXT_MAX_CHARS } from './config';

const ALLOWED_EXTENSIONS = new Set(TEXT_EXTENSIONS);

export function textExtensionOf(name) {
  const match = /\.([^.\\/]+)$/.exec(String(name ?? ''));
  const extension = match?.[1]?.toLowerCase() ?? '';
  return ALLOWED_EXTENSIONS.has(extension) ? extension : null;
}

function looksBinary(bytes) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 16 * 1024));
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.02;
}

export async function readTextFile(file) {
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error('The text file could not be read. Try downloading it again.');
  }

  let text;
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      text = new TextDecoder('utf-8').decode(bytes.subarray(3));
    } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    } else {
      if (looksBinary(bytes)) {
        throw new Error('This file looks like binary data, not text.');
      }
      text = new TextDecoder('utf-8').decode(bytes);
    }
  } catch (error) {
    if (error?.message?.includes('binary')) throw error;
    throw new Error('The text could not be decoded. Save it as UTF-8 and try again.');
  }

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length > TEXT_MAX_CHARS) {
    throw new Error('This text file is too large to turn into a PDF. Use a file under 5 million characters.');
  }
  return text;
}
