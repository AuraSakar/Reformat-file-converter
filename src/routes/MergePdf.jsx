import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { Button } from '../components/Button';
import { useToast } from '../components/Toasts';
import { LIMITS, PDF_ACCEPT } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { checkBatchLimits, makeId } from '../lib/files';
import { formatBytes, formatCount, formatSavings } from '../lib/format';
import { sniffFile } from '../lib/sniff';
import { browserSupportsWorker } from '../lib/imageSupport';
import { createPdfPool } from '../workers/pool';

export default function MergePdf() {
  const [items, setItems] = useState([]);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workersSupported] = useState(() => browserSupportsWorker());
  const [summary, setSummary] = useState('');
  const [output, setOutput] = useState(null);
  const [dirty, setDirty] = useState(false);

  const poolRef = useRef(null);
  const aliveRef = useRef(true);
  const removedRef = useRef(new Set());
  const addingRef = useRef(false);
  const { notify } = useToast();

  const validItems = useMemo(
    () => items.filter((item) => item.pdf && item.pages > 0 && item.status !== 'error'),
    [items],
  );

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      poolRef.current?.destroy();
      poolRef.current = null;
    };
  }, []);

  const getPool = useCallback(() => {
    if (!poolRef.current) poolRef.current = createPdfPool();
    return poolRef.current;
  }, []);

  const updateItem = useCallback((id, patch) => {
    if (!aliveRef.current || removedRef.current.has(id)) return;
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) }
          : item,
      ),
    );
  }, []);

  const invalidateOutput = useCallback(() => {
    setSummary('');
    if (output) setDirty(true);
  }, [output]);

  const addFiles = useCallback(
    async (files) => {
      if (addingRef.current || busy) return;
      addingRef.current = true;
      const { accepted, rejected } = checkBatchLimits(files, items);
      rejected.forEach(({ reason }) => notify(reason, 'error'));
      if (accepted.length === 0) {
        addingRef.current = false;
        return;
      }

      setChecking(true);
      try {
        const sniffed = await Promise.all(
          accepted.map(async (file) => ({ file, info: await sniffFile(file) })),
        );
        const additions = [];
        let skipped = 0;

        for (const { file, info } of sniffed) {
          if (!info.isPdf) {
            skipped += 1;
            continue;
          }
          additions.push({
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
          });
        }

        if (skipped > 0) {
          notify(
            skipped === 1
              ? 'One file was not a PDF and was not added. Merge accepts PDF files only.'
              : `${skipped} files were not PDFs and were not added. Merge accepts PDF files only.`,
            'error',
          );
        }

        if (additions.length === 0) return;
        if (!aliveRef.current) return;

        setItems((current) => [...current, ...additions]);
        invalidateOutput();

        await Promise.all(
          additions.map(async (item) => {
            try {
              const bytes = new Uint8Array(await item.file.arrayBuffer());
              const info = await getPool().run('inspect', { bytes }, { priority: 1 });
              if (!info?.pages) throw new Error('This PDF has no pages.');
              updateItem(item.id, {
                pages: info.pages,
                detail: formatCount(info.pages, 'page'),
                status: 'ready',
                statusText: 'Ready',
                error: null,
              });
            } catch (error) {
              updateItem(item.id, {
                pages: null,
                detail: '',
                status: 'error',
                statusText: 'Failed',
                error: error?.message || 'This PDF could not be read.',
              });
            }
          }),
        );
      } finally {
        addingRef.current = false;
        if (aliveRef.current) setChecking(false);
      }
    },
    [busy, getPool, invalidateOutput, items, notify, updateItem],
  );

  const removeItem = (item) => {
    if (busy) {
      notify('Wait for the merge to finish before removing files.', 'warning');
      return;
    }
    removedRef.current.add(item.id);
    const nextItems = items.filter((entry) => entry.id !== item.id);
    setItems(nextItems);
    invalidateOutput();
    if (nextItems.length === 0) {
      setOutput(null);
      setDirty(false);
      setSummary('');
    }
  };

  const reorderItems = (ids) => {
    if (busy || checking) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    setItems(ids.map((id) => byId.get(id)).filter(Boolean));
    invalidateOutput();
  };

  const buildPdf = async () => {
    if (busy || checking) return;
    if (validItems.length < 2) {
      notify('Add at least two readable PDFs to merge.', 'warning');
      return;
    }

    setBusy(true);
    setSummary('');
    setItems((current) =>
      current.map((item) =>
        item.pdf && item.pages > 0 && item.status !== 'error'
          ? { ...item, status: 'working', statusText: 'Merging', error: null }
          : item,
      ),
    );

    try {
      const documents = [];
      for (const item of validItems) {
        documents.push({
          name: item.name,
          bytes: new Uint8Array(await item.file.arrayBuffer()),
        });
      }
      if (!aliveRef.current) return;

      const result = await getPool().run(
        'merge',
        { documents, title: 'Merged document' },
        { priority: 2 },
      );
      if (!aliveRef.current) return;

      const failed = items.length - validItems.length;
      const outputFile = {
        blob: result.blob,
        name: 'merged.pdf',
        size: result.blob.size,
        pages: result.pages,
      };
      setOutput(outputFile);
      setDirty(false);
      setSummary(
        `Created a ${result.pages}-page PDF from ${formatCount(
          validItems.length,
          'file',
        )}.${failed ? ` ${formatCount(failed, 'file')} failed and was skipped.` : ''}`,
      );
      setItems((current) =>
        current.map((item) =>
          item.pdf && item.pages > 0
            ? { ...item, status: 'done', statusText: 'Merged', error: null }
            : item,
        ),
      );
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary('The PDFs could not be merged. Check the error message and try again.');
      notify(error?.message || 'The PDFs could not be merged.', 'error');
      setItems((current) =>
        current.map((item) =>
          item.pdf && item.pages > 0
            ? { ...item, status: 'ready', statusText: 'Ready' }
            : item,
        ),
      );
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const failedCount = items.filter((entry) => entry.status === 'error').length;
  const savings = output
    ? formatSavings(
        validItems.reduce((sum, item) => sum + item.size, 0),
        output.size,
      )
    : null;
  const liveMessage = checking
    ? 'Checking PDFs…'
    : busy
      ? 'Merging PDFs…'
      : summary ||
        (items.length
          ? `${formatCount(validItems.length, 'readable PDF')}.${
              failedCount ? ` ${formatCount(failedCount, 'file')} failed.` : ''
            } ${validItems.length < 2 ? 'Add one more to merge.' : 'Ready to merge.'}`
          : '');

  return (
    <>
      <PageHeader
        title="Merge PDF"
        description="Combine PDFs in the order you choose. Page order inside each file is kept."
      />
      <DropZone
        title="Drop PDFs here"
        description={`PDF files only. Up to ${LIMITS.maxFiles} files, 40 MB each, 300 MB total. Encrypted PDFs must be unlocked first.`}
        accept={PDF_ACCEPT}
        disabled={checking || busy || !workersSupported}
        onFiles={addFiles}
        buttonLabel="Choose PDFs"
      />

      {!workersSupported ? (
        <p className="mt-3 text-[12px] leading-5 text-err" role="status">
          This browser does not support background PDF processing. Use a current version of
          Chrome, Edge, Firefox or Safari to merge PDFs.
        </p>
      ) : null}

      {items.length > 0 ? (
        <>
          <FileQueue
            items={items}
            onRemove={removeItem}
            onReorder={reorderItems}
            reorderable
            reorderDisabled={busy || checking}
            removeDisabled={busy}
            showOutput={false}
          />

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
                      onClick={buildPdf}
                      disabled={busy || checking || !workersSupported || validItems.length < 2}
                    >
                      {busy ? 'Merging…' : 'Merge again'}
                    </Button>
                    <Button
                      size="md"
                      variant={dirty ? 'secondary' : 'primary'}
                      onClick={() => downloadBlob(output.blob, output.name)}
                      disabled={busy}
                    >
                      Download PDF
                    </Button>
                  </>
                ) : (
                  <Button
                    size="md"
                    onClick={buildPdf}
                    disabled={busy || checking || !workersSupported || validItems.length < 2}
                  >
                    {busy ? 'Merging…' : 'Merge PDFs'}
                  </Button>
                )}
              </div>
            </div>

            {output && !busy ? (
              <p className="mt-2 text-[12px] text-ink-2">
                <span className="font-mono tabular-nums">{formatBytes(output.size)}</span> ·{' '}
                {formatCount(output.pages, 'page')} · {output.name}
                {savings ? ` · ${savings.percent}% smaller than the inputs` : ''}
              </p>
            ) : null}

            {dirty && output && !busy ? (
              <p className="mt-2 text-[12px] text-warn">
                The file list changed. Merge again to update the PDF.
              </p>
            ) : null}
          </div>

          <div className="mt-5 space-y-2 border-t border-line pt-4 text-[12px] leading-5 text-ink-2">
            <p>
              Drag rows or use the reorder handle to set the merge order. PDFs that failed to load
              stay in the list so you can remove them.
            </p>
            <p>All pages from each PDF are kept. Bookmarks, links and form fields may not survive.</p>
            <p>Encrypted PDFs need to be unlocked first. Renaming a file to .pdf does not make it readable.</p>
            <p>Everything happens on this device. Nothing is uploaded.</p>
          </div>
        </>
      ) : null}
    </>
  );
}
