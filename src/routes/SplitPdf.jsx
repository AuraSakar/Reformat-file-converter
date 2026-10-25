import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { Button } from '../components/Button';
import { useToast } from '../components/Toasts';
import { LIMITS, PDF_ACCEPT } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { baseNameOf, checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount } from '../lib/format';
import { formatPageRange, parsePageRange } from '../lib/pageRanges';
import { sniffFile } from '../lib/sniff';
import { createPdfPool } from '../workers/pool';

function Thumbnail({ page, selected, onToggle }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Page ${page.page}${selected ? ', selected' : ''}`}
      onClick={() => onToggle(page.page)}
      className="group min-w-0 rounded-[4px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <span
        className={`relative block aspect-[3/4] overflow-hidden rounded-[4px] border bg-white transition-colors duration-150 ${
          selected
            ? 'border-ink ring-1 ring-ink'
            : 'border-line group-hover:border-line-strong'
        }`}
      >
        <img
          src={page.url}
          alt=""
          className="size-full object-contain"
          loading="lazy"
          decoding="async"
        />
        {selected ? (
          <span className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-[3px] bg-ink text-white">
            <Check size={12} strokeWidth={2} aria-hidden="true" />
          </span>
        ) : null}
      </span>
      <span
        className={`mono mt-1 block text-center text-[11px] ${
          selected ? 'font-medium text-ink' : 'text-ink-2'
        }`}
      >
        {page.page}
      </span>
    </button>
  );
}

export default function SplitPdf() {
  const [item, setItem] = useState(null);
  const [thumbs, setThumbs] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [output, setOutput] = useState(null);
  const [dirty, setDirty] = useState(false);

  const poolRef = useRef(null);
  const bytesRef = useRef(null);
  const thumbUrlsRef = useRef(new Set());
  const prepareTokenRef = useRef(0);
  const aliveRef = useRef(true);
  const addingRef = useRef(false);
  const { notify } = useToast();

  const pageCount = thumbs.length;
  const selectedPages = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const allSelected = pageCount > 0 && selectedPages.length === pageCount;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      prepareTokenRef.current += 1;
      poolRef.current?.destroy();
      poolRef.current = null;
      for (const url of thumbUrlsRef.current) URL.revokeObjectURL(url);
      thumbUrlsRef.current.clear();
    };
  }, []);

  const getPool = useCallback(() => {
    if (!poolRef.current) poolRef.current = createPdfPool();
    return poolRef.current;
  }, []);

  const revokeThumbUrls = useCallback(() => {
    for (const url of thumbUrlsRef.current) URL.revokeObjectURL(url);
    thumbUrlsRef.current.clear();
  }, []);

  const resetWorkspace = useCallback(() => {
    prepareTokenRef.current += 1;
    revokeThumbUrls();
    bytesRef.current = null;
    setItem(null);
    setThumbs([]);
    setSelected(new Set());
    setRangeText('');
    setRangeError(null);
    setProgress(null);
    setSummary('');
    setOutput(null);
    setDirty(false);
    setPreparing(false);
  }, [revokeThumbUrls]);

  const invalidateOutput = useCallback(() => {
    setSummary('');
    if (output) setDirty(true);
  }, [output]);

  const addFile = useCallback(
    async (files) => {
      if (addingRef.current || busy || preparing) return;
      addingRef.current = true;
      try {
        const file = files?.[0];
        if (!file) return;

        const { accepted, rejected } = checkBatchLimits([file], []);
        if (rejected.length) {
          rejected.forEach(({ reason }) => notify(reason, 'error'));
          return;
        }
        if (!accepted.length) return;

        const info = await sniffFile(file);
        if (!info.isPdf) {
          notify(
            info.kind === 'pdf'
              ? 'This file could not be opened as a PDF.'
              : 'Choose a PDF file for this tool.',
            'error',
          );
          return;
        }

        const token = prepareTokenRef.current + 1;
        prepareTokenRef.current = token;
        resetWorkspace();
        prepareTokenRef.current = token;

        const nextItem = {
          id: makeId(),
          file,
          name: file.name,
          size: file.size,
          kind: 'pdf',
          typeLabel: 'PDF',
          pdf: true,
          pages: null,
          detail: '',
          status: 'working',
          statusText: 'Preparing',
          error: null,
        };
        setItem(nextItem);
        setPreparing(true);
        setProgress({ label: 'Opening PDF' });

        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!aliveRef.current || prepareTokenRef.current !== token) return;
          bytesRef.current = bytes;

          const result = await getPool().run(
            'split-prepare',
            { bytes },
            {
              priority: 2,
              onProgress: (value) => {
                if (aliveRef.current && prepareTokenRef.current === token) setProgress(value);
              },
            },
          );
          if (!aliveRef.current || prepareTokenRef.current !== token) return;

          const nextThumbs = result.thumbs.map((thumb) => ({
            ...thumb,
            url: URL.createObjectURL(thumb.blob),
          }));
          nextThumbs.forEach((thumb) => thumbUrlsRef.current.add(thumb.url));
          const pages = nextThumbs.length;
          const all = new Set(nextThumbs.map((thumb) => thumb.page));
          setThumbs(nextThumbs);
          setSelected(all);
          setRangeText(pages === 1 ? '1' : `1-${pages}`);
          setRangeError(null);
          setItem((current) =>
            current
              ? {
                  ...current,
                  pages,
                  detail: formatCount(pages, 'page'),
                  status: 'ready',
                  statusText: 'Ready',
                }
              : current,
          );
        } catch (error) {
          if (!aliveRef.current || prepareTokenRef.current !== token) return;
          setItem((current) =>
            current
              ? {
                  ...current,
                  status: 'error',
                  statusText: 'Failed',
                  error: error?.message || 'This PDF could not be opened.',
                }
              : current,
          );
        } finally {
          if (aliveRef.current && prepareTokenRef.current === token) {
            setPreparing(false);
            setProgress(null);
          }
        }
      } finally {
        addingRef.current = false;
      }
    },
    [busy, getPool, notify, preparing, resetWorkspace],
  );

  const removeItem = () => {
    if (busy) {
      notify('Wait for the extraction to finish before removing the PDF.', 'warning');
      return;
    }
    resetWorkspace();
  };

  const updateSelection = (nextSelected, text, error = null) => {
    setSelected(nextSelected);
    setRangeText(text);
    setRangeError(error);
    invalidateOutput();
  };

  const handleRangeChange = (value) => {
    setRangeText(value);
    const parsed = parsePageRange(value, pageCount);
    if (parsed.error) {
      setRangeError(parsed.error);
      return;
    }
    setRangeError(null);
    updateSelection(new Set(parsed.pages), value);
  };

  const togglePage = (page) => {
    const next = new Set(selected);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    updateSelection(next, formatPageRange([...next]));
  };

  const selectAll = () => {
    const next = new Set(thumbs.map((thumb) => thumb.page));
    updateSelection(next, pageCount === 1 ? '1' : `1-${pageCount}`);
  };

  const clearSelection = () => {
    updateSelection(new Set(), '');
  };

  const extract = async () => {
    if (busy || preparing || !item || item.status === 'error') return;
    if (rangeError) {
      notify(rangeError, 'error');
      return;
    }
    if (selectedPages.length === 0) {
      notify('Select at least one page to extract.', 'warning');
      return;
    }
    if (!bytesRef.current) {
      notify('The PDF needs to be loaded again. Remove it and add it once more.', 'error');
      return;
    }

    setBusy(true);
    setSummary('');
    try {
      const base = baseNameOf(item.name);
      const result = await getPool().run(
        'split',
        {
          bytes: new Uint8Array(bytesRef.current),
          pages: selectedPages,
          title: `${base} pages`,
        },
        { priority: 2 },
      );
      if (!aliveRef.current) return;
      const nextOutput = {
        blob: result.blob,
        name: `${base}-pages.pdf`,
        size: result.blob.size,
        pages: result.pages,
      };
      setOutput(nextOutput);
      setDirty(false);
      setSummary(
        allSelected
          ? `Created a full copy with ${formatCount(result.pages, 'page')}.`
          : `Extracted ${result.pages} of ${pageCount} pages into a new PDF.`,
      );
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The selected pages could not be extracted. Try again.');
      notify(error?.message || 'The pages could not be extracted.', 'error');
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const liveMessage = busy
    ? 'Extracting pages…'
    : preparing && progress
      ? progress.label || 'Rendering page previews…'
      : summary ||
        (item?.status === 'error'
          ? 'This PDF could not be opened. Remove it and try another file.'
          : '');

  return (
    <>
      <PageHeader
        title="Split PDF"
        description="Pick pages visually or type a range. The selected pages become a new PDF."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
        <div className="min-w-0">
          <DropZone
            title="Drop a PDF here"
            description={`PDF files only. One file at a time, up to 40 MB. Page previews load on this device.`}
            accept={PDF_ACCEPT}
            multiple={false}
            disabled={preparing || busy}
            onFiles={addFile}
            buttonLabel="Choose PDF"
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
              {liveMessage}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {output ? (
                <>
                  <Button
                    variant={dirty ? 'primary' : 'secondary'}
                    onClick={extract}
                    disabled={
                      busy || preparing || Boolean(rangeError) || selectedPages.length === 0
                    }
                  >
                    {busy ? 'Extracting…' : 'Extract again'}
                  </Button>
                  <Button
                    variant={dirty ? 'secondary' : 'primary'}
                    onClick={() => downloadBlob(output.blob, output.name)}
                    disabled={busy}
                  >
                    Download PDF
                  </Button>
                </>
              ) : (
                <Button
                  onClick={extract}
                  disabled={
                    busy ||
                    preparing ||
                    !item ||
                    item.status === 'error' ||
                    Boolean(rangeError) ||
                    selectedPages.length === 0
                  }
                >
                  {busy ? 'Extracting…' : 'Extract pages'}
                </Button>
              )}
            </div>
          </div>

          {preparing && progress?.total ? (
            <div className="mt-2" aria-hidden="true">
              <div className="h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-ink transition-[width] duration-150"
                  style={{ width: `${Math.max(4, (progress.done / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          {output && !busy ? (
            <p className="mt-1 text-[12px] text-ink-2">
              <span className="font-mono tabular-nums">{formatBytes(output.size)}</span> ·{' '}
              {formatCount(output.pages, 'page')} · {output.name}
            </p>
          ) : null}

          {dirty && output && !busy ? (
            <p className="mt-1 text-[12px] text-warn">
              The selected pages changed. Extract again to update the PDF.
            </p>
          ) : null}

          {item ? (
            <FileQueue
              items={[item]}
              onRemove={removeItem}
              removeDisabled={busy || preparing}
              showOutput={false}
            />
          ) : null}

          {thumbs.length > 0 ? (
            <section className="mt-5" aria-labelledby="pages-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="pages-heading" className="text-[15px] font-semibold text-ink">
                    Pages
                  </h2>
                  <p className="mt-0.5 text-[12px] text-ink-2">
                    {formatCount(selectedPages.length, 'page')} selected of {pageCount}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={selectAll} disabled={allSelected || busy}>
                    Select all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    disabled={selectedPages.length === 0 || busy}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2.5">
                {thumbs.map((thumb) => (
                  <Thumbnail
                    key={thumb.page}
                    page={thumb}
                    selected={selected.has(thumb.page)}
                    onToggle={togglePage}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {item && item.status === 'error' ? (
            <p className="mt-2 text-[12px] leading-5 text-ink-2">
              Remove the file and try another PDF. Password-protected files must be unlocked first.
            </p>
          ) : null}
        </div>

        <aside className="min-w-0" aria-label="Page range">
          <h2 className="text-[15px] font-semibold text-ink">Page range</h2>
          <div className="mt-2 border-t border-line pt-4">
            <label className="field-label" htmlFor="page-range">
              Pages to keep
            </label>
            <input
              id="page-range"
              type="text"
              autoComplete="off"
              spellCheck="false"
              className="control"
              placeholder="1-3, 5, 8-10"
              value={rangeText}
              onChange={(event) => handleRangeChange(event.target.value)}
              disabled={!item || item.status === 'error' || preparing || busy}
              aria-invalid={Boolean(rangeError)}
              aria-describedby="page-range-hint page-range-status"
            />
            <p id="page-range-hint" className="field-hint">
              Use commas and ranges. For example, 1-3, 5, 8-10.
            </p>
            <p
              id="page-range-status"
              className={`mt-2 text-[12px] leading-4 ${rangeError ? 'text-err' : 'text-ink-2'}`}
              role={rangeError ? 'alert' : undefined}
            >
              {rangeError ||
                (item?.status === 'ready'
                  ? `${formatCount(selectedPages.length, 'page')} selected. Click previews to change the range.`
                  : 'Add a PDF to choose pages.')}
            </p>
          </div>
          <div className="mt-4 space-y-3 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
            <p>Pages are kept in document order in the new PDF.</p>
            <p>Click a page preview to include or leave it out. The range box follows your clicks.</p>
            <p>Everything happens on this device. Nothing is uploaded.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
