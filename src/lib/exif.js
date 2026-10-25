/**
 * Reads the EXIF orientation of a JPEG without decoding it. Workers use this
 * value to rotate the bitmap themselves, which avoids browser differences in
 * EXIF handling and keeps the orientation after re-encoding.
 */
export async function getJpegOrientation(file) {
  try {
    const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    return parseExifOrientation(bytes);
  } catch {
    return 1;
  }
}

export function parseExifOrientation(bytes) {
  return findJpegExifOrientation(bytes)?.orientation ?? 1;
}

/**
 * Some browsers apply JPEG EXIF orientation even when createImageBitmap is
 * asked not to. The orientation tag is reset to 1 in a temporary copy so the
 * worker can apply the rotation itself exactly once.
 */
export function normalizeJpegOrientation(bytes) {
  const found = findJpegExifOrientation(bytes);
  if (!found) return 1;
  if (found.orientation > 1) {
    found.view.setUint16(found.entryOffset + 8, 1, found.littleEndian);
  }
  return found.orientation;
}

function findJpegExifOrientation(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    if (marker === 0xe1 && offset + 10 <= bytes.length) {
      const isExif =
        bytes[offset + 4] === 0x45 &&
        bytes[offset + 5] === 0x78 &&
        bytes[offset + 6] === 0x69 &&
        bytes[offset + 7] === 0x66 &&
        bytes[offset + 8] === 0x00 &&
        bytes[offset + 9] === 0x00;
      if (isExif) {
        const found = readTiffOrientation(bytes, offset + 10);
        if (found && found.orientation >= 1 && found.orientation <= 8) return found;
      }
    }
    offset += 2 + length;
  }
  return null;
}

function readTiffOrientation(bytes, start) {
  if (start + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.length - start);
  const byteOrder = view.getUint16(0, false);
  let littleEndian;
  if (byteOrder === 0x4949) littleEndian = true;
  else if (byteOrder === 0x4d4d) littleEndian = false;
  else return null;

  if (view.getUint16(2, littleEndian) !== 42) return null;
  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > view.byteLength) return null;

  const count = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < count; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (entryOffset + 12 > view.byteLength) return null;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === 0x0112) {
      const type = view.getUint16(entryOffset + 2, littleEndian);
      if (type !== 3) return null;
      const orientation = view.getUint16(entryOffset + 8, littleEndian);
      return { orientation, littleEndian, view, entryOffset };
    }
  }
  return null;
}
