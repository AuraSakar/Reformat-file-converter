const MAX_SIDE = 16384;
const MAX_PIXELS = 100_000_000;

let utifPromise = null;

async function loadUtif() {
  if (!utifPromise) {
    utifPromise = import('utif2').then((module) => module.default ?? module);
  }
  return utifPromise;
}

export async function convertTiffToPng(file) {
  const UTIF = await loadUtif();
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error('The TIFF file could not be read.');
  }

  let ifds;
  try {
    ifds = UTIF.decode(buffer);
  } catch {
    throw new Error('The TIFF file could not be decoded. It may be damaged.');
  }
  if (!Array.isArray(ifds) || ifds.length === 0) {
    throw new Error('The TIFF file does not contain a readable image.');
  }

  const ifd = ifds[0];
  const width = Number(ifd.t256?.[0] ?? ifd.width);
  const height = Number(ifd.t257?.[0] ?? ifd.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('The TIFF image has no readable dimensions.');
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error('The TIFF image is too large to open in this browser.');
  }

  try {
    UTIF.decodeImage(buffer, ifd);
  } catch {
    throw new Error('The TIFF image data could not be decoded.');
  }

  let rgba;
  try {
    rgba = UTIF.toRGBA8(ifd);
  } catch {
    throw new Error('The TIFF color data could not be decoded.');
  }
  if (!rgba || rgba.length < width * height * 4) {
    throw new Error('The TIFF image data is incomplete.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create a canvas for the TIFF.');

  const imageData = context.createImageData(width, height);
  imageData.data.set(rgba);
  context.putImageData(imageData, 0, 0);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('The browser could not convert the TIFF image.'));
    }, 'image/png');
  });

  canvas.width = 0;
  canvas.height = 0;
  return blob;
}
