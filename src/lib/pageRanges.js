export function parsePageRange(text, pageCount) {
  const cleaned = String(text ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .trim();

  if (!cleaned) {
    return { pages: [], error: 'Enter at least one page number.' };
  }

  const pages = new Set();
  const tokens = cleaned.split(/[\s,]+/).filter(Boolean);

  for (const token of tokens) {
    const range = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!range) {
      return { pages: [], error: 'Use page numbers and ranges, like 1-3, 5, 8-10.' };
    }

    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : start;
    if (start < 1 || end > pageCount) {
      return {
        pages: [],
        error: `Use page numbers between 1 and ${pageCount}.`,
      };
    }
    if (start > end) {
      return { pages: [], error: 'A range must start on a lower page than it ends.' };
    }

    for (let page = start; page <= end; page += 1) pages.add(page);
  }

  return { pages: [...pages].sort((a, b) => a - b), error: null };
}

export function formatPageRange(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';

  const parts = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const page = sorted[index];
    if (page === end + 1) {
      end = page;
    } else {
      parts.push(start === end ? String(start) : `${start}-${end}`);
      start = page;
      end = page;
    }
  }
  parts.push(start === end ? String(start) : `${start}-${end}`);
  return parts.join(', ');
}
