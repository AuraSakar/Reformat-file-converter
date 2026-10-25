let webpSupportPromise = null;

export function browserSupportsImageWorkers() {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}

export function supportsWebpEncode() {
  if (!webpSupportPromise) {
    webpSupportPromise = detectEncoding('image/webp');
  }
  return webpSupportPromise;
}

async function detectEncoding(type) {
  try {
    if (typeof OffscreenCanvas !== 'undefined' && 'convertToBlob' in OffscreenCanvas.prototype) {
      const canvas = new OffscreenCanvas(2, 2);
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 2, 2);
      const blob = await canvas.convertToBlob({ type, quality: 0.8 });
      return blob.type === type;
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 2, 2);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.8));
      return blob?.type === type;
    }
  } catch {
    return false;
  }
  return false;
}
