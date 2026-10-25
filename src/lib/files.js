import { LIMITS } from './config';

export function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sanitizeBaseName(name) {
  const withoutExtension = String(name ?? '').replace(/\.[^./\\]+$/, '');
  return (
    withoutExtension
      .normalize('NFKC')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s-]+|[.\s-]+$/g, '')
      .slice(0, 96) || 'file'
  );
}

export function uniqueName(baseName, extension, usedNames) {
  const base = sanitizeBaseName(baseName);
  const ext = String(extension).replace(/^\./, '').toLowerCase();
  let candidate = `${base}.${ext}`;
  let suffix = 1;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix}.${ext}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export function baseNameOf(name) {
  return sanitizeBaseName(name);
}

export function sortFilesForDisplay(files) {
  return [...files].sort((a, b) => {
    const aName = a.name ?? '';
    const bName = b.name ?? '';
    return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function collectFiles(fileList, { multiples = true } = {}) {
  const files = Array.from(fileList ?? []);
  if (!multiples && files.length > 1) return files.slice(0, 1);
  return files;
}

export function checkBatchLimits(incomingFiles, existingItems) {
  const accepted = [];
  const rejected = [];
  let fileCount = existingItems.length;
  let totalBytes = existingItems.reduce((sum, item) => sum + item.size, 0);

  for (const file of incomingFiles) {
    if (file.size > LIMITS.maxFileBytes) {
      rejected.push({
        file,
        reason: `${file.name} is larger than the 40 MB per-file limit.`,
      });
      continue;
    }
    if (fileCount >= LIMITS.maxFiles) {
      rejected.push({
        file,
        reason: `The batch is limited to ${LIMITS.maxFiles} files. ${file.name} was not added.`,
      });
      continue;
    }
    if (totalBytes + file.size > LIMITS.maxTotalBytes) {
      rejected.push({
        file,
        reason: `Adding ${file.name} would exceed the 300 MB batch limit.`,
      });
      continue;
    }
    accepted.push(file);
    fileCount += 1;
    totalBytes += file.size;
  }

  return { accepted, rejected };
}
