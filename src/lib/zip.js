import { sanitizeBaseName } from './files';

export async function createZip(files) {
  const { zip } = await import('fflate');
  const entries = {};
  const used = new Set();

  for (const file of files) {
    let name = file.name;
    if (!name || used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const extension = dot > 0 ? name.slice(dot + 1) : 'bin';
      let suffix = 1;
      let candidate = `${sanitizeBaseName(base)}-${suffix}.${extension}`;
      while (used.has(candidate.toLowerCase())) {
        suffix += 1;
        candidate = `${sanitizeBaseName(base)}-${suffix}.${extension}`;
      }
      name = candidate;
    }
    used.add(name.toLowerCase());
    entries[name] = new Uint8Array(await file.blob.arrayBuffer());
  }

  const data = await new Promise((resolve, reject) => {
    zip(entries, { level: 0 }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

  return new Blob([data], { type: 'application/zip' });
}
