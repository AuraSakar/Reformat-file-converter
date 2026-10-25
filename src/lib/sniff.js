import { IMAGE_FORMAT_LABELS } from './config';

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(bytes, start, end) {
  let text = '';
  for (let index = start; index < end && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function startsWith(bytes, signature) {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function unsupported(label) {
  return {
    kind: 'unsupported',
    label,
    message: `${label} files are not supported. Choose JPG, PNG, WebP, GIF, BMP, SVG, HEIC or PDF.`,
  };
}

function imageResult(kind) {
  return {
    kind,
    label: IMAGE_FORMAT_LABELS[kind] ?? kind.toUpperCase(),
    isImage: true,
    isPdf: false,
  };
}

function pdfResult() {
  return { kind: 'pdf', label: 'PDF', isImage: false, isPdf: true };
}

/**
 * Identifies a file from its bytes. Extensions are not trusted; a renamed
 * binary without a known signature is rejected before conversion.
 */
export async function sniffFile(file) {
  let bytes;
  try {
    bytes = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  } catch {
    return {
      kind: 'unsupported',
      label: 'Unknown',
      message: `${file.name} could not be read. Try downloading it again.`,
    };
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return imageResult('jpeg');
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return imageResult('png');
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return imageResult('gif');
  }
  if (startsWith(bytes, [0x42, 0x4d])) {
    return imageResult('bmp');
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    ascii(bytes, 8, 12) === 'WEBP'
  ) {
    return imageResult('webp');
  }

  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brands = [ascii(bytes, 8, 12)];
    for (let offset = 16; offset + 4 <= bytes.length && offset < 256; offset += 4) {
      brands.push(ascii(bytes, offset, offset + 4));
    }
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) {
      return unsupported('AVIF');
    }
    if (brands.some((brand) => HEIC_BRANDS.has(brand))) {
      return imageResult('heic');
    }
    return unsupported('This HEIF variant is not supported');
  }

  const head = ascii(bytes, 0, Math.min(bytes.length, 64 * 1024));
  if (head.includes('%PDF-')) {
    return pdfResult();
  }

  if (/<svg[\s>]/i.test(head) && !/<html[\s>]/i.test(head.slice(0, 2048))) {
    return imageResult('svg');
  }

  return {
    kind: 'unsupported',
    label: 'Unknown',
    message: `${file.name} is not a supported file. Choose JPG, PNG, WebP, GIF, BMP, SVG, HEIC or PDF.`,
  };
}

export function extensionForKind(kind) {
  if (kind === 'jpeg') return 'jpg';
  return kind;
}
