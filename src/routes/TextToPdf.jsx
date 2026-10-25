import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader, SettingsReveal } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { Button } from '../components/Button';
import { Field, SettingsGroup, SettingsPanel } from '../components/SettingsPanel';
import { useToast } from '../components/Toasts';
import { TEXT_ACCEPT } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { baseNameOf, checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount } from '../lib/format';
import { browserSupportsWorker } from '../lib/imageSupport';
import { PDF_MARGINS, PDF_PAGE_SIZES } from '../lib/pdfOptions';
import { readTextFile, textExtensionOf } from '../lib/textFile';
import { createPdfPool } from '../workers/pool';

const PAGE_SIZES = PDF_PAGE_SIZES.filter((size) => size.value !== 'match');
const TEXT_MARGINS = PDF_MARGINS.filter((margin) => margin.value !== 'none');
const DEFAULT_SETTINGS = Object.freeze({
  font: 'mono',
  fontSize: 11,
  lineNumbers: false,
  pageSize: 'a4',
  margin: 'normal',
  wrap: true,
});

function validateSettings(settings) {
  if (!['mono', 'sans'].includes(settings.font)) return 'Choose a font.';
  const size = Number(settings.fontSize);
  if (!Number.isFinite(size) || size < 7 || size > 24) {
    return 'Choose a font size from 7 to 24 pt.';
  }
  if (!PAGE_SIZES.some((page) => page.value === settings.pageSize)) {
    return 'Choose a page size.';
  }
  if (!TEXT_MARGINS.some((margin) => margin.value === settings.margin)) {
    return 'Choose a margin.';
  }
  return null;
}

function TextSettings({ settings, onChange, disabled, settingsError }) {
  const id = useId();
  const sizeId = `${id}-size`;
  const pageId = `${id}-page`;
  const marginId = `${id}-margin`;

  return (
    <SettingsPanel title="Text settings">
      <SettingsGroup title="Font">
        <div role="radiogroup" aria-label="Font" className="grid grid-cols-2 gap-1">
          {[
            { value: 'mono', label: 'IBM Plex Mono', hint: 'Code and tables' },
            { value: 'sans', label: 'IBM Plex Sans', hint: 'Prose and notes' },
          ].map((font) => (
            <label key={font.value} className="min-w-0">
              <input
                type="radio"
                name={`${id}-font`}
                value={font.value}
                checked={settings.font === font.value}
                disabled={disabled}
                onChange={() => onChange({ font: font.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 py-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40 sm:min-h-10">
                <span>{font.label}</span>
                <span className="text-[10px] font-normal text-ink-2">{font.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <Field label="Font size" htmlFor={sizeId} hint="Measured in points.">
          <div className="relative w-28">
            <input
              id={sizeId}
              type="number"
              inputMode="numeric"
              min="7"
              max="24"
              step="1"
              value={settings.fontSize}
              disabled={disabled}
              onChange={(event) => onChange({ fontSize: Number(event.target.value) })}
              className="control control-sm pr-8 font-mono"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-ink-2">
              pt
            </span>
          </div>
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Page size" htmlFor={pageId}>
            <select
              id={pageId}
              value={settings.pageSize}
              disabled={disabled}
              onChange={(event) => onChange({ pageSize: event.target.value })}
              className="control"
            >
              {PAGE_SIZES.map((page) => (
                <option key={page.value} value={page.value}>
                  {page.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Margins" htmlFor={marginId}>
            <select
              id={marginId}
              value={settings.margin}
              disabled={disabled}
              onChange={(event) => onChange({ margin: event.target.value })}
              className="control"
            >
              {TEXT_MARGINS.map((margin) => (
                <option key={margin.value} value={margin.value}>
                  {margin.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink sm:min-h-8">
          <input
            type="checkbox"
            checked={settings.lineNumbers}
            disabled={disabled}
            onChange={(event) => onChange({ lineNumbers: event.target.checked })}
            className="size-4 accent-ink"
          />
          Show line numbers
        </label>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink sm:min-h-8">
          <input
            type="checkbox"
            checked={settings.wrap}
            disabled={disabled}
            onChange={(event) => onChange({ wrap: event.target.checked })}
            className="size-4 accent-ink"
          />
          Wrap long lines
        </label>
        <p className="text-[12px] leading-4 text-ink-2">
          With wrapping off, long lines continue past the right edge of the page. Tabs become four
          spaces. Unsupported glyphs become a visible ?.
        </p>
      </SettingsGroup>

      <div className="py-4">
        <p className="text-[12px] leading-5 text-ink-2">
          Markdown and CSV are added as plain text, without formatting.
        </p>
        {settingsError ? (
          <p className="mt-2 text-[12px] leading-4 text-err" role="alert">
            {settingsError}
          </p>
        ) : null}
      </div>
    </SettingsPanel>
  );
}

export default function TextToPdf() {
  const [item, setItem] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workersSupported] = useState(() => browserSupportsWorker());
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [output, setOutput] = useState(null);
  const [dirty, setDirty] = useState(false);

  const poolRef = useRef(null);
  const textRef = useRef('');
  const textLoadedRef = useRef(false);
  const aliveRef = useRef(true);
  const addingRef = useRef(false);
  const tokenRef = useRef(0);
  const { notify } = useToast();

  const settingsError = useMemo(() => validateSettings(settings), [settings]);
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

  const reset = useCallback(() => {
    tokenRef.current += 1;
    textRef.current = '';
    textLoadedRef.current = false;
    setItem(null);
    setProgress(null);
    setSummary('');
    setOutput(null);
    setDirty(false);
    setPreparing(false);
  }, []);

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

        const extension = textExtensionOf(file.name);
        if (!extension) {
          notify(
            'Choose a text, Markdown, CSV or source file (.txt, .md, .csv, .c, .py, .js, .json and similar).',
            'error',
          );
          return;
        }

        const { accepted, rejected } = checkBatchLimits([file], []);
        if (rejected.length) {
          rejected.forEach(({ reason }) => notify(reason, 'error'));
          return;
        }
        if (!accepted.length) return;

        reset();
        const token = tokenRef.current + 1;
        tokenRef.current = token;
        const nextItem = {
          id: makeId(),
          file,
          name: file.name,
          size: file.size,
          kind: 'text',
          typeLabel: extension.toUpperCase(),
          detail: '',
          status: 'working',
          statusText: 'Reading',
          error: null,
        };
        setItem(nextItem);
        setPreparing(true);

        try {
          const text = await readTextFile(file);
          if (!aliveRef.current || tokenRef.current !== token) return;
          textRef.current = text;
          textLoadedRef.current = true;
          const lines = text.length === 0 ? 1 : text.split(/\r\n?|\n/).length;
          setItem((current) =>
            current
              ? {
                  ...current,
                  lines,
                  detail: formatCount(lines, 'line'),
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
                  error: error?.message || 'This text file could not be read.',
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
    [busy, notify, preparing, reset],
  );

  const removeItem = () => {
    if (busy || preparing) {
      notify('Wait for the PDF to finish before removing the file.', 'warning');
      return;
    }
    reset();
  };

  const changeSettings = (patch) => {
    if (busy) return;
    setSettings((current) => ({ ...current, ...patch }));
    invalidateOutput();
  };

  const createPdf = async () => {
    if (busy || preparing || !readied || settingsError) {
      if (settingsError) notify(settingsError, 'error');
      return;
    }
    if (!textLoadedRef.current) {
      notify('The text file needs to be loaded again. Remove it and add it once more.', 'error');
      return;
    }

    setBusy(true);
    setSummary('');
    setProgress({ label: 'Preparing text' });
    setItem((current) =>
      current ? { ...current, status: 'working', statusText: 'Creating PDF' } : current,
    );

    try {
      const result = await getPool().run(
        'text-to-pdf',
        {
          text: textRef.current,
          options: settings,
          title: baseNameOf(item.name),
        },
        {
          priority: 2,
          onProgress: (value) => {
            if (aliveRef.current) setProgress(value);
          },
        },
      );
      if (!aliveRef.current) return;

      const blob = new Blob([result.bytes], { type: 'application/pdf' });
      const name = `${baseNameOf(item.name)}.pdf`;
      setOutput({ blob, name, size: blob.size, pages: result.pages });
      setDirty(false);
      setSummary(
        `Created ${formatCount(result.pages, 'page')}.${
          result.replaced
            ? ` ${formatCount(result.replaced, 'unsupported character')} ${
                result.replaced === 1 ? 'was' : 'were'
              } shown as ?.`
            : ''
        }`,
      );
      setItem((current) =>
        current ? { ...current, status: 'done', statusText: 'Created' } : current,
      );
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The PDF could not be created. Check the file and try again.');
      notify(error?.message || 'The PDF could not be created.', 'error');
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
    ? 'Reading text…'
    : busy && progress
      ? `${progress.label || 'Creating PDF'}…`
      : summary ||
        (item?.status === 'error'
          ? 'This text file could not be read. Remove it and try another file.'
          : item
            ? `${formatCount(item.lines || 0, 'line')} ready.`
            : '');

  return (
    <>
      <PageHeader
        title="Text to PDF"
        description="Turn plain text, Markdown, CSV or source code into a clean, paginated PDF with embedded fonts."
      />
      <DropZone
        title="Drop a text or source file here"
        description="TXT, MD, CSV, C, C++, Java, Python, JavaScript, JSON, MATLAB, Verilog, VHDL or assembly. One file, up to 40 MB."
        accept={TEXT_ACCEPT}
        multiple={false}
        disabled={busy || preparing || !workersSupported}
        onFiles={addFile}
        buttonLabel="Choose text file"
      />

      {!workersSupported ? (
        <p className="mt-3 text-[12px] leading-5 text-err" role="status">
          This browser does not support background PDF creation. Use a current version of Chrome,
          Edge, Firefox or Safari.
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

          <SettingsReveal show>
            <TextSettings
              settings={settings}
              onChange={changeSettings}
              disabled={busy || preparing}
              settingsError={settingsError}
            />
          </SettingsReveal>

          <div className="mt-6 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
                {liveMessage}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="md"
                  variant={output ? (dirty ? 'primary' : 'secondary') : 'primary'}
                  onClick={createPdf}
                  disabled={
                    busy ||
                    preparing ||
                    !workersSupported ||
                    !readied ||
                    Boolean(settingsError)
                  }
                  title={settingsError || undefined}
                >
                  {busy ? 'Creating PDF…' : output ? 'Create again' : 'Create PDF'}
                </Button>
                {output ? (
                  <Button
                    size="md"
                    variant={dirty ? 'secondary' : 'primary'}
                    onClick={() => downloadBlob(output.blob, output.name)}
                    disabled={busy}
                  >
                    <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                    Download
                  </Button>
                ) : null}
              </div>
            </div>

            {output && !busy ? (
              <p className="mt-2 text-[12px] text-ink-2">
                <span className="font-mono tabular-nums">{formatBytes(output.size)}</span> ·{' '}
                {formatCount(output.pages, 'page')} · {output.name}
              </p>
            ) : null}

            {dirty && output && !busy ? (
              <p className="mt-2 text-[12px] text-warn">
                Settings changed. Create the PDF again to replace the current download.
              </p>
            ) : null}
          </div>

          <div className="mt-5 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
            <p>
              IBM Plex Mono and IBM Plex Sans are embedded in the PDF. Markdown is treated as
              plain text. Everything happens on this device.
            </p>
          </div>
        </>
      ) : null}
    </>
  );
}
