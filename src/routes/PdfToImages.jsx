import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { Button } from '../components/Button';
import { SettingsGroup, SettingsPanel } from '../components/SettingsPanel';
import { useToast } from '../components/Toasts';
import { PDF_ACCEPT, PDF_TO_IMAGES_DPI_OPTIONS } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { baseNameOf, checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount } from '../lib/format';
import { sniffFile } from '../lib/sniff';
import { createPdfPool } from '../workers/pool';

const DEFAULT_SETTINGS = Object.freeze({
  format: 'image/png',
  dpi: 150,
});

const FORMATS = [
  { value: 'image/png', label: 'PNG', hint: 'Lossless, larger files' },
  { value: 'image/jpeg', label: 'JPG', hint: 'Smaller files' },
];

function PdfPageSettings({ settings, onChange, disabled }) {
  const id = useId();

  return (
    <SettingsPanel title="Image settings">
      <SettingsGroup title="Format">
        <div role="radiogroup" aria-label="Image format" className="grid grid-cols-2 gap-1">
          {FORMATS.map((format) => (
            <label key={format.value} className="min-w-0">
              <input
                type="radio"
                name={`${id}-format`}
                value={format.value}
                checked={settings.format === format.value}
                disabled={disabled}
                onChange={() => onChange({ format: format.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-10 cursor-pointer items-center justify-center rounded-[4px] border border-line bg-surface px-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-9">
                {format.label}
              </span>
            </label>
          ))}
        </div>
        <p className="text-[12px] leading-4 text-ink-2">
          {settings.format === 'image/png'
            ? 'PNG keeps sharp text and lines. Files are usually larger.'
            : 'JPG is smaller and uses quality 90. Text edges can soften.'}
        </p>
      </SettingsGroup>

      <SettingsGroup title="Resolution">
        <div role="radiogroup" aria-label="Resolution" className="grid grid-cols-3 gap-1">
          {PDF_TO_IMAGES_DPI_OPTIONS.map((dpi) => (
            <label key={dpi} className="min-w-0">
              <input
                type="radio"
                name={`${id}-dpi`}
                value={dpi}
                checked={settings.dpi === dpi}
                disabled={disabled}
                onChange={() => onChange({ dpi })}
                className="peer sr-only"
              />
              <span className="flex min-h-10 cursor-pointer items-center justify-center rounded-[4px] border border-line bg-surface px-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-9">
                {dpi} DPI
              </span>
            </label>
          ))}
        </div>
        <p className="text-[12px] leading-4 text-ink-2">
          150 DPI suits screens and notes. Use 300 DPI for printing; it can create large files.
        </p>
      </SettingsGroup>
    </SettingsPanel>
  );
}

export default function PdfToImages() {
  const [item, setItem] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [output, setOutput] = useState(null);
  const [dirty, setDirty] = useState(false);

  const poolRef = useRef(null);
  const aliveRef = useRef(true);
  const addingRef = useRef(false);
  const tokenRef = useRef(0);
  const { notify } = useToast();

  const readied = Boolean(item?.status === 'ready' || item?.status === 'done');

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      tokenRef.current += 1;
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, []);

  const getPool = useCallback(() => {
    if (!poolRef.current) poolRef.current = createPdfPool();
    return poolRef.current;
  }, []);

  const invalidateOutput = useCallback(() => {
    setSummary('');
    if (output) setDirty(true);
  }, [output]);

  const reset = useCallback(() => {
    tokenRef.current += 1;
    setItem(null);
    setProgress(null);
    setSummary('');
    setOutput(null);
    setDirty(false);
    setPreparing(false);
  }, []);

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
          notify('Choose a PDF file for this tool.', 'error');
          return;
        }

        reset();
        const token = tokenRef.current + 1;
        tokenRef.current = token;
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
          statusText: 'Checking',
          error: null,
        };
        setItem(nextItem);
        setPreparing(true);

        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const result = await getPool().run('inspect', { bytes }, { priority: 2 });
          if (!aliveRef.current || tokenRef.current !== token) return;
          if (!result?.pages) throw new Error('This PDF has no pages.');
          setItem((current) =>
            current
              ? {
                  ...current,
                  pages: result.pages,
                  detail: formatCount(result.pages, 'page'),
                  status: 'ready',
                  statusText: 'Ready',
                }
              : current,
          );
        } catch (error) {
          if (!aliveRef.current || tokenRef.current !== token) return;
          setItem((current) =>
            current
              ? {
                  ...current,
                  status: 'error',
                  statusText: 'Failed',
                  error: error?.message || 'This PDF could not be read.',
                }
              : current,
          );
        } finally {
          if (aliveRef.current && tokenRef.current === token) setPreparing(false);
        }
      } finally {
        addingRef.current = false;
      }
    },
    [busy, getPool, notify, preparing, reset],
  );

  const removeItem = () => {
    if (busy || preparing) {
      notify('Wait for the current task to finish before removing the PDF.', 'warning');
      return;
    }
    reset();
  };

  const changeSettings = (patch) => {
    if (busy) return;
    setSettings((current) => ({ ...current, ...patch }));
    invalidateOutput();
  };

  const convert = async () => {
    if (busy || preparing || !readied) return;
    const pages = item.pages || 0;
    if (!pages) {
      notify('This PDF has no pages.', 'error');
      return;
    }

    setBusy(true);
    setSummary('');
    setProgress({ label: 'Opening PDF', done: 0, total: pages });
    setItem((current) =>
      current ? { ...current, status: 'working', statusText: 'Converting' } : current,
    );

    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      if (!aliveRef.current) return;
      const base = baseNameOf(item.name);
      const result = await getPool().run(
        'pdf-to-images',
        {
          bytes,
          options: {
            dpi: settings.dpi,
            type: settings.format,
            baseName: base,
          },
        },
        {
          priority: 2,
          onProgress: (value) => {
            if (aliveRef.current) setProgress(value);
          },
        },
      );
      if (!aliveRef.current) return;

      const nextOutput = {
        blob: result.blob,
        name: `${base}-images.zip`,
        size: result.blob.size,
        pages: result.pages,
        clamped: result.clamped,
      };
      setOutput(nextOutput);
      setDirty(false);
      setSummary(
        `Created ${formatCount(result.pages, 'image')} at ${settings.dpi} DPI in a ZIP.${
          result.clamped
            ? ' Some very large pages were capped by the browser canvas limit.'
            : ''
        }`,
      );
      setItem((current) =>
        current ? { ...current, status: 'done', statusText: 'Converted' } : current,
      );
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The PDF could not be converted to images. Try again.');
      notify(error?.message || 'The PDF could not be converted.', 'error');
      setItem((current) =>
        current ? { ...current, status: 'ready', statusText: 'Ready' } : current,
      );
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const liveMessage = preparing
    ? 'Checking PDF…'
    : busy && progress
      ? progress.label === 'Packing ZIP'
        ? 'Packing ZIP…'
        : `${progress.label || 'Rendering page'}…`
      : summary ||
        (item?.status === 'error'
          ? 'This PDF could not be read. Remove it and try another file.'
          : item
            ? `${formatCount(item.pages || 0, 'page')} ready.`
            : '');

  return (
    <>
      <PageHeader
        title="PDF to images"
        description="Turn every PDF page into a PNG or JPG. Pages are numbered and packed into one ZIP."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
        <div className="min-w-0">
          <DropZone
            title="Drop a PDF here"
            description={`PDF files only. One file at a time, up to 40 MB. Every page becomes an image.`}
            accept={PDF_ACCEPT}
            multiple={false}
            disabled={busy || preparing}
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
                    onClick={convert}
                    disabled={busy || preparing || !readied}
                  >
                    {busy ? 'Converting…' : 'Convert again'}
                  </Button>
                  <Button
                    variant={dirty ? 'secondary' : 'primary'}
                    onClick={() => downloadBlob(output.blob, output.name)}
                    disabled={busy}
                  >
                    Download ZIP
                  </Button>
                </>
              ) : (
                <Button onClick={convert} disabled={busy || preparing || !readied}>
                  {busy ? 'Converting…' : 'Convert to images'}
                </Button>
              )}
            </div>
          </div>

          {busy && progress?.total ? (
            <div className="mt-2" aria-hidden="true">
              <div className="h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-ink transition-[width] duration-150"
                  style={{
                    width: `${Math.max(4, ((progress.done || 0) / progress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : null}

          {output && !busy ? (
            <p className="mt-1 text-[12px] text-ink-2">
              <span className="font-mono tabular-nums">{formatBytes(output.size)}</span> ·{' '}
              {formatCount(output.pages, 'image')} · {output.name}
            </p>
          ) : null}

          {dirty && output && !busy ? (
            <p className="mt-1 text-[12px] text-warn">
              Settings changed. Convert again to update the ZIP.
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

          {item ? (
            <p className="mt-2 text-[12px] leading-5 text-ink-2">
              Each page is rendered at the selected resolution. JPG pages use quality 90. The ZIP
              keeps pages in order.
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <PdfPageSettings
            settings={settings}
            onChange={changeSettings}
            disabled={busy || preparing}
          />
          <div className="mt-4 space-y-3 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
            <p>Text in the PDF becomes part of the image and is no longer selectable.</p>
            <p>Everything happens on this device. Nothing is uploaded.</p>
          </div>
        </div>
      </div>
    </>
  );
}
