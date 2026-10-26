let heicModulePromise = null;
let heicChain = Promise.resolve();

/**
 * The CSP-safe heic-to build is loaded only after a HEIC file is selected.
 * Decoding is serialized so a batch of iPhone photos does not decode several
 * large HEICs at once in the same tab.
 */
export function convertHeicToJpeg(file) {
  const task = heicChain.then(async () => {
    if (!heicModulePromise) heicModulePromise = import('heic-to/csp');
    const { heicTo } = await heicModulePromise;
    const blob = await heicTo({
      blob: file,
      type: 'image/jpeg',
      quality: 0.94,
    });
    if (!blob || blob.size === 0) throw new Error('HEIC decoding returned no image.');
    return blob;
  });

  heicChain = task.catch(() => {});
  return task;
}
