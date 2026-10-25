import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { Button } from '../components/Button';
import { SettingsGroup, SettingsPanel } from '../components/SettingsPanel';
import { useToast } from '../components/Toasts';
import { PDF_ACCEPT } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { browserSupportsPdfRendering } from '../lib/imageSupport';
import { baseNameOf, checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount, formatSavings } from '../lib/format';
import { sniffFile } from '../lib/sniff';
import { createPdfPool } from '../workers/pool';

const LEVELS = [
  { value: 'screen', label: 'Screen', dpi: 110, quality: 0.68, hint: 'Smallest files, softer text' },
  { value: 'balanced', label: 'Balanced', dpi: 150, quality: 0.75, hint: 'Good for scans and notes' },
  { value: 'print', label: 'Print', dpi: 200, quality: 0.82, hint: 'Sharper, larger files' },
];

const DEFAULT_SETTINGS = Object.freeze({ level: 'balanced' });

function levelFor(value) {
  return LEVELS.find((level) => level.value === value) || LEVELS[1];
}

function CompressSettings({ settings, onChange, disabled }) {
  const id = useId();

  return (
    <SettingsPanel title="Compression">
      <SettingsGroup title="Level">
        <div role="radiogroup" aria-label="Compression level" className="grid grid-cols-3 gap-1">
          {LEVELS.map((level) => (
            <label key={level.value} className="min-w-0">
              <input
                type="radio"
                name={`${id}-level`}
                value={level.value}
                checked={settings.level === level.value}
                disabled={disabled}
                onChange={() => onChange({ level: level.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 py-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-10">
                <span>{level.label}</span>
                <span className="mono text-[10px] font-normal text-ink-2">{level.dpi} DPI</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-[12px] leading-4 text-ink-2">{levelFor(settings.level).hint}.</p>
      </SettingsGroup>

      <SettingsGroup title="What changes">
        <p className="text-[12px] leading-5 text-ink-2">
          Every page is rendered as an image and placed back into a new PDF. Text is no longer
          selectable or searchable. Links, forms and bookmarks are flattened.
        </p>
        <p className="text-[12px] leading-5 text-ink-2">
          Scans and image-heavy PDFs usually shrink. Text PDFs can get larger, so compare the
          result before you replace the original.
        </p>
      </SettingsGroup>
    </SettingsPanel>
  );
}

export default function CompressPdf() {
  const [item, setItem] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workersSupported] = useState(() => browserSupportsPdfRendering());
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
      notify('Wait for compression to finish before removing the PDF.', 'warning');
      return;
    }
    reset();
  };

  const changeSettings = (patch) => {
    if (busy) return;
    setSettings((current) => ({ ...current, ...patch }));
    invalidateOutput();
  };

  const compress = async () => {
    if (busy || preparing || !readied) return;
    const pages = item.pages || 0;
    if (!pages) {
      notify('This PDF has no pages.', 'error');
      return;
    }

    const level = levelFor(settings.level);
    setBusy(true);
    setSummary('');
    setProgress({ label: 'Opening PDF', done: 0, total: pages });
    setItem((current) =>
      current ? { ...current, status: 'working', statusText: 'Compressing' } : current,
    );

    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      if (!aliveRef.current) return;
      const base = baseNameOf(item.name);
      const result = await getPool().run(
        'compress',
        {
          bytes,
          options: {
            dpi: level.dpi,
            quality: level.quality,
            title: `${base} compressed`,
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
        name: `${base}-compressed.pdf`,
        size: result.blob.size,
        pages: result.pages,
        clamped: result.clamped,
      };
      setOutput(nextOutput);
      setDirty(false);
      const saved = formatSavings(item.size, nextOutput.size);
      setSummary(
        saved
          ? `Rebuilt ${formatCount(result.pages, 'page')} at ${level.dpi} DPI. ${saved.percent}% smaller than the original.`
          : `Rebuilt ${formatCount(result.pages, 'page')} at ${level.dpi} DPI, but the new PDF is larger than the original.`,
      );
      setItem((current) =>
        current ? { ...current, status: 'done', statusText: 'Compressed' } : current,
      );
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The PDF could not be compressed. Try again or use another file.');
      notify(error?.message || 'The PDF could not be compressed.', 'error');
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

  const savings = output ? formatSavings(item?.size || 0, output.size) : null;
  const liveMessage = preparing
    ? 'Checking PDF…'
    : busy && progress
      ? progress.label === 'Writing PDF'
        ? 'Writing PDF…'
        : `${progress.label || 'Compressing page'}…`
      : summary ||
        (item?.status === 'error'
          ? 'This PDF could not be read. Remove it and try another file.'
          : item
            ? `${formatCount(item.pages || 0, 'page')} ready.`
            : '');

  return (
    <>
      <PageHeader
        title="Compress PDF"
        description="Rebuild a PDF with compressed page images. Smaller files, but text becomes part of a picture."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-10">
        <div className="min-w-0">
          <DropZone
            title="Drop a PDF here"
            description={`PDF files only. One file at a time, up to 40 MB. Pages are rebuilt as JPG images.`}
            accept={PDF_ACCEPT}
            multiple={false}
            disabled={busy || preparing || !workersSupported}
            onFiles={addFile}
            buttonLabel="Choose PDF"
          />

          {!workersSupported ? (
            <p className="mt-3 text-[12px] leading-5 text-err" role="status">
              This browser does not support background PDF rendering. Use a current version of
              Chrome, Edge, Firefox or Safari to compress PDFs.
            </p>
          ) : null}

          <p className="mt-3 border-l-2 border-warn pl-2.5 text-[12px] leading-5 text-ink-2">
            <span className="font-medium text-ink">This flattens text into images.</span> Text
            will not be selectable or searchable after compression.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
              {liveMessage}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {output ? (
                <>
                  <Button
                    variant={dirty ? 'primary' : 'secondary'}
                    onClick={compress}
                    disabled={busy || preparing || !workersSupported || !readied}
                  >
                    {busy ? 'Compressing…' : 'Compress again'}
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
                <Button onClick={compress} disabled={busy || preparing || !workersSupported || !readied}>
                  {busy ? 'Compressing…' : 'Compress PDF'}
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
              {formatCount(output.pages, 'page')} · {output.name}
              {savings ? ` · ${savings.percent}% smaller` : ' · larger than original'}
            </p>
          ) : null}

          {dirty && output && !busy ? (
            <p className="mt-1 text-[12px] text-warn">
              The compression level changed. Compress again to update the PDF.
            </p>
          ) : null}

          {output?.clamped && !busy ? (
            <p className="mt-1 text-[12px] text-warn">
              Some very large pages were capped by the browser canvas limit.
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
              The original file is unchanged. Compare the download with your original before
              replacing it.
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <CompressSettings
            settings={settings}
            onChange={changeSettings}
            disabled={busy || preparing || !workersSupported}
          />
          <div className="mt-4 space-y-3 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
            <p>Everything is rendered and rebuilt on this device. Nothing is uploaded.</p>
          </div>
        </div>
      </div>
    </>
  );
}
