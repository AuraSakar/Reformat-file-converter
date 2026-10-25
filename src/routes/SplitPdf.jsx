import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { PageHeader, SettingsReveal } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { SettingsPanel } from '../components/SettingsPanel';
import { Button } from '../components/Button';
import { useToast } from '../components/Toasts';
import { PDF_ACCEPT } from '../lib/config';
import { browserSupportsPdfRendering } from '../lib/imageSupport';
import { downloadBlob } from '../lib/download';
import { baseNameOf, checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount } from '../lib/format';
import { formatPageRange, parsePageRange } from '../lib/pageRanges';
import { sniffFile } from '../lib/sniff';
import { createPdfPool } from '../workers/pool';

function Thumbnail({ page, selected, onToggle, disabled = false }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Page ${page.page}${selected ? ', selected' : ''}`}
      onClick={() => onToggle(page.page)}
      disabled={disabled}
      className="group min-w-0 rounded-[4px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        className={`relative block aspect-[3/4] overflow-hidden rounded-[4px] border bg-white transition-colors duration-150 ${
          selected
            ? 'border-ink ring-1 ring-ink'
            : 'border-line-strong group-hover:border-ink'
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
  const [workersSupported] = useState(() => browserSupportsPdfRendering());
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [output, setOutput] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('extract');
  const [everyN, setEveryN] = useState('2');
  const [outputMode, setOutputMode] = useState('single');

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
  const chunkSize = Number(everyN);
  const everyError = useMemo(() => {
    if (mode !== 'every') return null;
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      return 'Enter a whole number of pages.';
    }
    if (pageCount > 0 && chunkSize > pageCount) {
      return `Enter a number from 1 to ${pageCount}.`;
    }
    return null;
  }, [chunkSize, mode, pageCount]);
  const everyGroups = useMemo(() => {
    if (!Number.isInteger(chunkSize) || chunkSize < 1) return [];
    const groups = [];
    for (let start = 1; start <= pageCount; start += chunkSize) {
      groups.push(
        Array.from(
          { length: Math.min(chunkSize, pageCount - start + 1) },
          (_, index) => start + index,
        ),
      );
    }
    return groups;
  }, [chunkSize, pageCount]);
  const zipOutput = mode === 'every' || outputMode === 'zip';
  const canGenerate =
    Boolean(item) &&
    item.status !== 'error' &&
    pageCount > 0 &&
    !busy &&
    !preparing &&
    workersSupported &&
    (mode === 'extract'
      ? !rangeError && selectedPages.length > 0
      : !everyError);

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

  const changeMode = (nextMode) => {
    if (busy) return;
    setMode(nextMode);
    invalidateOutput();
  };

  const changeEveryN = (value) => {
    if (busy) return;
    setEveryN(value);
    invalidateOutput();
  };

  const changeOutputMode = (value) => {
    if (busy) return;
    setOutputMode(value);
    invalidateOutput();
  };

  const generate = async () => {
    if (busy || preparing || !item || item.status === 'error') return;
    if (!bytesRef.current) {
      notify('The PDF needs to be loaded again. Remove it and add it once more.', 'error');
      return;
    }

    if (mode === 'extract') {
      if (rangeError) {
        notify(rangeError, 'error');
        return;
      }
      if (selectedPages.length === 0) {
        notify('Select at least one page to extract.', 'warning');
        return;
      }
    } else if (everyError) {
      notify(everyError, 'error');
      return;
    }

    const base = baseNameOf(item.name);
    setBusy(true);
    setSummary('');
    try {
      if (mode === 'extract' && outputMode === 'single') {
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
        setOutput({
          blob: result.blob,
          name: `${base}-pages.pdf`,
          size: result.blob.size,
          pages: result.pages,
          files: 1,
          zip: false,
        });
        setSummary(
          allSelected
            ? `Created a full copy with ${formatCount(result.pages, 'page')}.`
            : `Extracted ${result.pages} of ${pageCount} pages into a new PDF.`,
        );
      } else {
        const groups =
          mode === 'every'
            ? everyGroups
            : selectedPages.map((page) => [page]);
        const result = await getPool().run(
          'split-zip',
          {
            bytes: new Uint8Array(bytesRef.current),
            groups,
            title: base,
          },
          { priority: 2 },
        );
        if (!aliveRef.current) return;
        setOutput({
          blob: result.blob,
          name: `${base}-${mode === 'every' ? 'split' : 'selected-pages'}.zip`,
          size: result.blob.size,
          pages: result.pages,
          files: result.files,
          zip: true,
        });
        setSummary(
          mode === 'every'
            ? `Split ${formatCount(result.pages, 'page')} into ${formatCount(result.files, 'PDF')} in a ZIP.`
            : `Created ${formatCount(result.files, 'PDF')} from ${formatCount(result.pages, 'page')} in a ZIP.`,
        );
      }
      setDirty(false);
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The pages could not be split. Try again.');
      notify(error?.message || 'The pages could not be split.', 'error');
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const liveMessage = busy
    ? mode === 'every'
      ? 'Splitting pages and packing the ZIP…'
      : outputMode === 'zip'
        ? 'Creating PDFs and packing the ZIP…'
        : 'Extracting pages…'
    : preparing && progress
      ? progress.label || 'Rendering page previews…'
      : summary ||
        (item?.status === 'error'
          ? 'This PDF could not be opened. Remove it and try another file.'
          : '');
  const actionLabel =
    mode === 'every' ? 'Split PDF' : outputMode === 'zip' ? 'Create ZIP' : 'Extract pages';
  const againLabel =
    mode === 'every' ? 'Split again' : outputMode === 'zip' ? 'Create again' : 'Extract again';
  const busyLabel =
    mode === 'every' ? 'Splitting…' : outputMode === 'zip' ? 'Creating ZIP…' : 'Extracting…';

  return (
    <>
      <PageHeader
        title="Split PDF"
        description="Extract chosen pages into one PDF, save selected pages separately, or split the document every N pages."
      />
      <DropZone
        title="Drop a PDF here"
        description="PDF files only. One file at a time, up to 40 MB. Page previews load on this device."
        accept={PDF_ACCEPT}
        multiple={false}
        disabled={preparing || busy || !workersSupported}
        onFiles={addFile}
        buttonLabel="Choose PDF"
      />

      {!workersSupported ? (
        <p className="mt-3 text-[12px] leading-5 text-err" role="status">
          This browser does not support background PDF processing. Use a current version of
          Chrome, Edge, Firefox or Safari to split PDFs.
        </p>
      ) : null}

      {item ? (
        <>
          <FileQueue
            items={[item]}
            onRemove={removeItem}
            removeDisabled={busy || preparing}
            showOutput={false}
          />

          {thumbs.length > 0 ? (
            <section className="mt-5" aria-labelledby="pages-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="pages-heading" className="text-[15px] font-semibold text-ink">
                    Pages
                  </h2>
                  <p className="mt-0.5 text-[12px] text-ink-2">
                    {mode === 'extract'
                      ? `${formatCount(selectedPages.length, 'page')} selected of ${pageCount}.`
                      : `All ${formatCount(pageCount, 'page')}. Previews are view-only in this mode.`}
                  </p>
                </div>
                {mode === 'extract' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={selectAll}
                      disabled={allSelected || busy}
                    >
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
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2.5">
                {thumbs.map((thumb) => (
                  <Thumbnail
                    key={thumb.page}
                    page={thumb}
                    selected={mode === 'extract' && selected.has(thumb.page)}
                    onToggle={togglePage}
                    disabled={mode !== 'extract' || preparing || busy}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <SettingsReveal show>
            <SettingsPanel title="Split mode">
              <div className="py-4">
                <div
                  role="radiogroup"
                  aria-label="Split mode"
                  className="grid grid-cols-2 gap-1"
                >
                  {[
                    {
                      value: 'extract',
                      label: 'Extract selected',
                      hint: 'Choose pages',
                    },
                    {
                      value: 'every',
                      label: 'Every N pages',
                      hint: 'Even chunks',
                    },
                  ].map((option) => (
                    <label key={option.value} className="min-w-0">
                      <input
                        type="radio"
                        name="split-mode"
                        value={option.value}
                        checked={mode === option.value}
                        disabled={busy || preparing || !item || item.status === 'error'}
                        onChange={() => changeMode(option.value)}
                        className="peer sr-only"
                      />
                      <span className="flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 py-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-10">
                        <span>{option.label}</span>
                        <span className="text-[10px] font-normal text-ink-2">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {mode === 'extract' ? (
                <>
                  <div className="border-t border-line py-4">
                    <p className="field-label">Output</p>
                    <div
                      role="radiogroup"
                      aria-label="Output"
                      className="mt-1.5 grid grid-cols-2 gap-1"
                    >
                      {[
                        { value: 'single', label: 'One PDF', hint: 'Selected pages together' },
                        { value: 'zip', label: 'Separate PDFs', hint: 'One per page, ZIP' },
                      ].map((option) => (
                        <label key={option.value} className="min-w-0">
                          <input
                            type="radio"
                            name="split-output"
                            value={option.value}
                            checked={outputMode === option.value}
                            disabled={busy || preparing || !item || item.status === 'error'}
                            onChange={() => changeOutputMode(option.value)}
                            className="peer sr-only"
                          />
                          <span className="flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 py-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-10">
                            <span>{option.label}</span>
                            <span className="text-[10px] font-normal text-ink-2">{option.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-line py-4">
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
                  <div className="py-4 text-[12px] leading-5 text-ink-2">
                    <p>Pages are kept in document order.</p>
                    <p className="mt-2">
                      {outputMode === 'single'
                        ? 'The selected pages become one new PDF.'
                        : 'Each selected page becomes its own PDF inside one ZIP.'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="border-t border-line py-4">
                  <label className="field-label" htmlFor="split-every">
                    Pages per file
                  </label>
                  <input
                    id="split-every"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={Math.max(1, pageCount)}
                    step="1"
                    value={everyN}
                    onChange={(event) => changeEveryN(event.target.value)}
                    disabled={busy || preparing || !item || item.status === 'error'}
                    aria-invalid={Boolean(everyError)}
                    aria-describedby="split-every-hint split-every-status"
                    className="control control-sm w-28 font-mono"
                  />
                  <p id="split-every-hint" className="field-hint">
                    The whole PDF is split from page 1. Chunks go into one ZIP.
                  </p>
                  <p
                    id="split-every-status"
                    className={`mt-2 text-[12px] leading-4 ${everyError ? 'text-err' : 'text-ink-2'}`}
                    role={everyError ? 'alert' : undefined}
                  >
                    {everyError ||
                      (pageCount > 0 && everyGroups.length > 0
                        ? `${formatCount(pageCount, 'page')} become ${formatCount(everyGroups.length, 'PDF')}: ${everyGroups
                            .map((group) =>
                              group.length === 1
                                ? String(group[0])
                                : `${group[0]}-${group[group.length - 1]}`,
                            )
                            .slice(0, 6)
                            .join(', ')}${
                            everyGroups.length > 6 ? ', …' : ''
                          }.`
                        : 'Add a PDF to choose a chunk size.')}
                  </p>
                  <p className="mt-2 text-[12px] leading-5 text-ink-2">
                    Page previews are view-only in this mode. Every page stays in the document.
                  </p>
                </div>
              )}
            </SettingsPanel>
          </SettingsReveal>

          <div className="mt-6 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
                {liveMessage}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {output ? (
                  <>
                    <Button
                      size="md"
                      variant={dirty ? 'primary' : 'secondary'}
                      onClick={generate}
                      disabled={!canGenerate}
                    >
                      {busy ? busyLabel : againLabel}
                    </Button>
                    <Button
                      size="md"
                      variant={dirty ? 'secondary' : 'primary'}
                      onClick={() => downloadBlob(output.blob, output.name)}
                      disabled={busy}
                    >
                      <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                      {output.zip ? 'Download ZIP' : 'Download PDF'}
                    </Button>
                  </>
                ) : (
                  <Button size="md" onClick={generate} disabled={!canGenerate}>
                    {busy ? busyLabel : actionLabel}
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
              <p className="mt-2 text-[12px] text-ink-2">
                <span className="font-mono tabular-nums">{formatBytes(output.size)}</span> ·{' '}
                {output.zip ? `${formatCount(output.files, 'PDF')} · ` : ''}
                {formatCount(output.pages, 'page')} · {output.name}
              </p>
            ) : null}

            {dirty && output && !busy ? (
              <p className="mt-2 text-[12px] text-warn">
                The split settings changed. Generate again to replace the current download.
              </p>
            ) : null}
          </div>

          <div className="mt-5 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
            {item.status === 'error' ? (
              <p>
                Remove the file and try another PDF. Password-protected files must be unlocked
                first.
              </p>
            ) : (
              <p>Everything happens on this device. Nothing is uploaded.</p>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
