let heicModulePromise = null;
let heicChain = Promise.resolve();

/**
 * heic2any is loaded only after a HEIC file is selected. Decoding is
 * serialized so a batch of iPhone photos does not decode several large HEICs
 * at once in the same tab.
 */
export function convertHeicToJpeg(file) {
  const task = heicChain.then(async () => {
    if (!heicModulePromise) heicModulePromise = import('heic2any');
    const module = await heicModulePromise;
    const heic2any = module.default ?? module;
    const result = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.94,
      multiple: false,
    });
    const blob = Array.isArray(result) ? result[0] : result;
    if (!blob || blob.size === 0) throw new Error('HEIC decoding returned no image.');
    return blob;
  });

  heicChain = task.catch(() => {});
  return task;
}
