const MAX_RASTER_SIDE = 3000;

/**
 * SVG cannot be decoded reliably inside a browser worker across all engines,
 * so diagrams are rasterized once on the main thread at a high enough
 * resolution for print. The worker still handles resizing and encoding.
 */
export async function rasterizeSvg(file) {
  const text = await file.text();
  if (!/<svg[\s>]/i.test(text)) {
    throw new Error('The file does not contain an SVG image.');
  }

  const root = text.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const viewBox = parseViewBox(root);
  const widthAttribute = parseLength(root, 'width');
  const heightAttribute = parseLength(root, 'height');

  let width = widthAttribute;
  let height = heightAttribute;
  if (!width || !height) {
    if (viewBox) {
      width = viewBox.width;
      height = viewBox.height;
    } else if (width) {
      height = width * 0.5;
    } else if (height) {
      width = height * 2;
    } else {
      width = 300;
      height = 150;
    }
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The SVG has no usable dimensions.');
  }

  const scale = Math.min(1, MAX_RASTER_SIDE / Math.max(width, height));
  const rasterWidth = Math.max(1, Math.round(width * scale));
  const rasterHeight = Math.max(1, Math.round(height * scale));

  const blob = new Blob([text], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';

  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = rasterWidth;
    canvas.height = rasterHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create a canvas for the SVG.');

    const aspect = width / height;
    let drawWidth = rasterWidth;
    let drawHeight = rasterHeight;
    if (Math.abs(rasterWidth / rasterHeight - aspect) > 0.01) {
      if (aspect > rasterWidth / rasterHeight) {
        drawHeight = Math.max(1, Math.round(rasterWidth / aspect));
      } else {
        drawWidth = Math.max(1, Math.round(rasterHeight * aspect));
      }
    }

    context.drawImage(
      image,
      Math.round((rasterWidth - drawWidth) / 2),
      Math.round((rasterHeight - drawHeight) / 2),
      drawWidth,
      drawHeight,
    );

    const png = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('The browser could not rasterize the SVG.'));
      }, 'image/png');
    });

    return { blob: png, width: rasterWidth, height: rasterHeight };
  } catch (error) {
    if (error?.message?.includes('rasterize')) throw error;
    throw new Error('The SVG could not be rendered. It may contain unsupported markup.');
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

function parseViewBox(root) {
  const match = root.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  if (!match) return null;
  const values = match[1]
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number(value));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [, , width, height] = values;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseLength(root, attribute) {
  const match = root.match(new RegExp(`\\b${attribute}\\s*=\\s*["']\\s*([\\d.]+)`, 'i'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
