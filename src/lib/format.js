export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

export function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatSavings(before, after) {
  if (!before || !after || after >= before) return null;
  const saved = before - after;
  const percent = Math.round((saved / before) * 100);
  return { bytes: saved, percent };
}
