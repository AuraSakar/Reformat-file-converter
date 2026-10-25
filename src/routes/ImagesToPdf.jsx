import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RotateCw } from 'lucide-react';
import { PageHeader, SettingsReveal } from '../components/PageHeader';
import { DropZone } from '../components/DropZone';
import { FileQueue } from '../components/FileQueue';
import { PdfSettings } from '../components/PdfSettings';
import { PdfPagePreview } from '../components/PdfPagePreview';
import { Button, IconButton } from '../components/Button';
import { useToast } from '../components/Toasts';
import { IMAGE_ACCEPT, INPUT_FORMATS } from '../lib/config';
import { downloadBlob } from '../lib/download';
import { baseNameOf, checkBatchLimits, makeId, uniqueName } from '../lib/files';
import { formatBytes, formatCount } from '../lib/format';
import { browserSupportsImageWorkers } from '../lib/imageSupport';
import { getJpegOrientation } from '../lib/exif';
import {
  DEFAULT_PDF_SETTINGS,
  displaySize,
  pageBoxFor,
  pdfQualityMode,
  validatePdfSettings,
} from '../lib/pdfOptions';
import { prepareImageSource } from '../lib/prepareImage';
import { sniffFile } from '../lib/sniff';
import { createImagePool } from '../workers/pool';

function drawOriginalImage(page, image, box, { rotation, exifOrientation, fit, lib }) {
  const display = displaySize({
    width: image.width,
    height: image.height,
    orientation: exifOrientation,
    rotation,
  });
  const contentX = box.margin;
  const contentY = box.margin;
  const scale =
    fit === 'fill'
      ? Math.max(box.contentWidth / display.width, box.contentHeight / display.height)
      : Math.min(box.contentWidth / display.width, box.contentHeight / display.height);
  const drawWidth = display.width * scale;
  const drawHeight = display.height * scale;
  const left = contentX + (box.contentWidth - drawWidth) / 2;
  const bottom = contentY + (box.contentHeight - drawHeight) / 2;
  const orientation = exifOrientation >= 1 && exifOrientation <= 8 ? exifOrientation : 1;
  const turn = ((rotation % 360) + 360) % 360;

  // Build an affine placement instead of re-encoding so EXIF mirroring,
  // EXIF rotation and the user's rotation stay lossless in Original mode.
  const mapPoint = (u, v) => {
    const x = u;
    const y = 1 - v;
    let dx;
    let dy;
    switch (orientation) {
      case 2:
        dx = 1 - x;
        dy = y;
        break;
      case 3:
        dx = 1 - x;
        dy = 1 - y;
        break;
      case 4:
        dx = x;
        dy = 1 - y;
        break;
      case 5:
        dx = 1 - v;
        dy = u;
        break;
      case 6:
        dx = 1 - y;
        dy = x;
        break;
      case 7:
        dx = 1 - y;
        dy = 1 - x;
        break;
      case 8:
        dx = 1 - v;
        dy = 1 - x;
        break;
      default:
        dx = x;
        dy = y;
    }

    if (turn === 90) {
      [dx, dy] = [1 - dy, dx];
    } else if (turn === 180) {
      [dx, dy] = [1 - dx, 1 - dy];
    } else if (turn === 270) {
      [dx, dy] = [dy, 1 - dx];
    }

    return [left + dx * drawWidth, bottom + (1 - dy) * drawHeight];
  };

  const origin = mapPoint(0, 0);
  const across = mapPoint(1, 0);
  const up = mapPoint(0, 1);
  const objectKey = page.node.newXObject('Image', image.ref);

  page.pushOperators(lib.pushGraphicsState());
  if (fit === 'fill') {
    page.pushOperators(
      lib.moveTo(contentX, contentY),
      lib.lineTo(contentX + box.contentWidth, contentY),
      lib.lineTo(contentX + box.contentWidth, contentY + box.contentHeight),
      lib.lineTo(contentX, contentY + box.contentHeight),
      lib.closePath(),
      lib.clip(),
      lib.endPath(),
    );
  }
  page.pushOperators(
    lib.concatTransformationMatrix(
      across[0] - origin[0],
      across[1] - origin[1],
      up[0] - origin[0],
      up[1] - origin[1],
      origin[0],
      origin[1],
    ),
    lib.drawObject(objectKey),
    lib.popGraphicsState(),
  );
}

async function addOriginalPage({ doc, lib, item, settings, pool, onStage }) {
  onStage('Preparing image');
  const prepared = await prepareImageSource(item.file, item.kind);
  let source = prepared.blob;
  let sourceKind = prepared.kind;
  let exifOrientation = 1;

  if (sourceKind !== 'jpeg' && sourceKind !== 'png') {
    onStage('Converting image');
    const converted = await pool.run(
      'convert',
      {
        source,
        kind: sourceKind,
        orientation: 1,
        options: {
          type: 'image/png',
          rotation: 0,
          resizeMode: 'none',
          background: null,
        },
      },
      { priority: 2 },
    );
    source = converted.blob;
    sourceKind = 'png';
  }

  if (sourceKind === 'jpeg') {
    exifOrientation = await getJpegOrientation(source);
  }

  onStage('Adding to PDF');
  const bytes = new Uint8Array(await source.arrayBuffer());
  const image =
    sourceKind === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  const display = displaySize({
    width: image.width,
    height: image.height,
    orientation: exifOrientation,
    rotation: item.rotation,
  });
  const box = pageBoxFor({
    pageSize: settings.pageSize,
    orientation: settings.orientation,
    margin: settings.margin,
    aspect: display.width / display.height,
  });
  const page = doc.addPage([box.pageWidth, box.pageHeight]);
  drawOriginalImage(page, image, box, {
    rotation: item.rotation,
    exifOrientation,
    fit: settings.fit,
    lib,
  });

  return { prepared };
}

async function addRasterPage({ doc, item, settings, qualityMode, pool, onStage }) {
  onStage('Preparing image');
  const prepared = await prepareImageSource(item.file, item.kind);

  onStage('Rendering page');
  const result = await pool.run(
    'pdf-page',
    {
      source: prepared.blob,
      kind: prepared.kind,
      orientation: 1,
      options: {
        pageSize: settings.pageSize,
        orientation: settings.orientation,
        margin: settings.margin,
        fit: settings.fit,
        dpi: qualityMode.dpi,
        quality: qualityMode.jpegQuality,
        rotation: item.rotation,
      },
    },
    { priority: 2 },
  );

  onStage('Adding to PDF');
  const image = await doc.embedJpg(new Uint8Array(await result.blob.arrayBuffer()));
  const page = doc.addPage([result.pageWidth, result.pageHeight]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: result.pageWidth,
    height: result.pageHeight,
  });

  return { prepared };
}

export default function ImagesToPdf() {
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_PDF_SETTINGS);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [summary, setSummary] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pdfOutput, setPdfOutput] = useState(null);
  const [workersSupported] = useState(() => browserSupportsImageWorkers());

  const poolRef = useRef(null);
  const preparedRef = useRef(new Map());
  const thumbUrlsRef = useRef(new Map());
  const objectUrlsRef = useRef(new Set());
  const removedIdsRef = useRef(new Set());
  const addingRef = useRef(false);
  const aliveRef = useRef(true);
  const { notify } = useToast();

  const settingsError = useMemo(() => validatePdfSettings(settings), [settings]);
  const convertible = items.filter((item) => item.convertible);
  const readyCount = convertible.length;
  const previewItem = convertible[0];

  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;
      poolRef.current?.destroy();
      poolRef.current = null;
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
      objectUrlsRef.current.clear();
      thumbUrlsRef.current.clear();
      preparedRef.current.clear();
    };
  }, []);

  const getPool = useCallback(() => {
    if (!poolRef.current) poolRef.current = createImagePool();
    return poolRef.current;
  }, []);

  const updateItem = useCallback((id, patch) => {
    if (!aliveRef.current) return;
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, ...(typeof patch === 'function' ? patch(item) : patch) }
          : item,
      ),
    );
  }, []);

  const attachThumb = useCallback(
    (id, url, width, height) => {
      if (removedIdsRef.current.has(id)) {
        URL.revokeObjectURL(url);
        return;
      }
      const previous = thumbUrlsRef.current.get(id);
      if (previous) {
        URL.revokeObjectURL(previous);
        objectUrlsRef.current.delete(previous);
      }
      thumbUrlsRef.current.set(id, url);
      objectUrlsRef.current.add(url);
      updateItem(id, {
        thumbUrl: url,
        ...(width > 0 && height > 0 ? { sourceWidth: width, sourceHeight: height } : {}),
      });
    },
    [updateItem],
  );

  const makeThumbnailFrom = useCallback(
    async (id, source, kind, orientation) => {
      if (removedIdsRef.current.has(id) || thumbUrlsRef.current.has(id)) return;
      try {
        const result = await getPool().run(
          'thumbnail',
          { source, kind, orientation },
          { priority: 0 },
        );
        if (aliveRef.current && !removedIdsRef.current.has(id)) {
          attachThumb(id, URL.createObjectURL(result.blob), result.width, result.height);
        }
      } catch {
        // Thumbnails are cosmetic; build errors are reported separately.
      }
    },
    [attachThumb, getPool],
  );

  const invalidateResult = useCallback(() => {
    setSummary('');
    if (!pdfOutput) return;
    setDirty(true);
    setItems((current) =>
      current.map((item) => (item.pageNumber ? { ...item, pageNumber: null } : item)),
    );
  }, [pdfOutput]);

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

        for (const { file, info } of sniffed) {
          const isImage = Boolean(info.isImage);
          let error = null;
          if (!isImage) {
            error =
              info.kind === 'pdf'
                ? 'This is already a PDF. Use Merge PDF or Split PDF instead.'
                : info.message || 'This file type is not supported here.';
          }

          let thumbUrl = null;
          if (isImage && info.kind === 'svg') {
            thumbUrl = URL.createObjectURL(file);
            objectUrlsRef.current.add(thumbUrl);
          }

          const item = {
            id: makeId(),
            file,
            name: file.name,
            size: file.size,
            kind: info.kind,
            typeLabel: info.label,
            convertible: isImage,
            status: isImage ? 'ready' : 'error',
            statusText: isImage ? 'Ready' : 'Failed',
            error,
            thumbUrl,
            rotation: 0,
            pageNumber: null,
          };
          if (thumbUrl) thumbUrlsRef.current.set(item.id, thumbUrl);
          additions.push(item);
        }

        if (!aliveRef.current) return;
        setItems((current) => [...current, ...additions]);
        invalidateResult();

        for (const item of additions) {
          if (item.convertible && item.kind !== 'heic' && item.kind !== 'svg') {
            makeThumbnailFrom(item.id, item.file, item.kind, 1);
          }
        }
      } finally {
        addingRef.current = false;
        if (aliveRef.current) setChecking(false);
      }
    },
    [busy, invalidateResult, items, makeThumbnailFrom, notify],
  );

  const removeItem = (item) => {
    if (busy) {
      notify('Wait for the PDF to finish before removing files.', 'warning');
      return;
    }
    removedIdsRef.current.add(item.id);
    preparedRef.current.delete(item.id);
    const thumbUrl = thumbUrlsRef.current.get(item.id) ?? item.thumbUrl;
    if (thumbUrl) {
      URL.revokeObjectURL(thumbUrl);
      objectUrlsRef.current.delete(thumbUrl);
      thumbUrlsRef.current.delete(item.id);
    }
    const nextItems = items.filter((entry) => entry.id !== item.id);
    setItems(nextItems);
    invalidateResult();
    if (nextItems.length === 0) {
      setPdfOutput(null);
      setDirty(false);
      setSummary('');
    }
  };

  const rotateItem = (item) => {
    if (busy) return;
    updateItem(item.id, (current) => ({
      rotation: ((current.rotation ?? 0) + 90) % 360,
    }));
    invalidateResult();
  };

  const reorderItems = (ids) => {
    if (busy) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    const nextItems = ids.map((id) => byId.get(id)).filter(Boolean);
    setItems(nextItems);
    invalidateResult();
  };

  const changeSettings = (patch) => {
    if (busy) return;
    setSettings((current) => ({ ...current, ...patch }));
    invalidateResult();
  };

  const downloadPdf = () => {
    if (!pdfOutput) return;
    downloadBlob(pdfOutput.blob, pdfOutput.name);
  };

  const buildPdf = async () => {
    if (busy || checking) return;
    if (settingsError) {
      notify(settingsError, 'error');
      return;
    }
    if (!workersSupported) {
      notify('This browser cannot process images in the background. Use a current browser.', 'error');
      return;
    }
    const targets = items.filter((item) => item.convertible);
    if (targets.length === 0) {
      notify('Add at least one image before building a PDF.', 'warning');
      return;
    }

    const qualityMode = pdfQualityMode(settings.quality);
    const pdfName = uniqueName(baseNameOf(targets[0].name), 'pdf', new Set());
    const pool = getPool();

    setBusy(true);
    setSummary('');
    setProgress({ done: 0, total: targets.length, label: 'Building pages' });
    setItems((current) =>
      current.map((item) =>
        item.convertible
          ? {
              ...item,
              status: 'working',
              statusText: 'Queued',
              error: null,
              pageNumber: null,
            }
          : item,
      ),
    );

    try {
      const lib = await import('pdf-lib');
      const doc = await lib.PDFDocument.create();
      const now = new Date();
      doc.setTitle(pdfName.replace(/\.pdf$/i, ''));
      doc.setCreator('Reformat');
      doc.setProducer('Reformat');
      doc.setCreationDate(now);
      doc.setModificationDate(now);

      let pageCount = 0;
      let successes = 0;
      let failures = 0;

      for (let index = 0; index < targets.length; index += 1) {
        if (!aliveRef.current) return;
        const item = targets[index];
        updateItem(item.id, {
          statusText: 'Preparing image',
          error: null,
          pageNumber: null,
        });

        try {
          let built;
          if (qualityMode.value === 'original') {
            built = await addOriginalPage({
              doc,
              lib,
              item,
              settings,
              pool,
              onStage: (label) => updateItem(item.id, { statusText: label }),
            });
          } else {
            built = await addRasterPage({
              doc,
              item,
              settings,
              qualityMode,
              pool,
              onStage: (label) => updateItem(item.id, { statusText: label }),
            });
          }

          pageCount += 1;
          successes += 1;
          updateItem(item.id, {
            status: 'done',
            statusText: 'Added',
            error: null,
            pageNumber: pageCount,
          });

          if (item.kind === 'heic' && built?.prepared) {
            makeThumbnailFrom(item.id, built.prepared.blob, built.prepared.kind, 1);
          }
        } catch (error) {
          failures += 1;
          updateItem(item.id, {
            status: 'error',
            statusText: 'Failed',
            error:
              error?.message ||
              'The image could not be added to the PDF. The file may be damaged.',
            pageNumber: null,
          });
        }

        if (aliveRef.current) {
          setProgress({ done: index + 1, total: targets.length, label: 'Building pages' });
        }
      }

      if (!aliveRef.current) return;

      if (pageCount === 0) {
        setSummary('No pages were added. Check the errors next to each file and try again.');
        setProgress(null);
        setBusy(false);
        return;
      }

      setProgress({ done: targets.length, total: targets.length, label: 'Writing PDF' });
      const bytes = await doc.save();
      if (!aliveRef.current) return;
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const output = {
        blob,
        name: pdfName,
        size: blob.size,
        pages: pageCount,
      };
      setPdfOutput(output);
      setDirty(false);
      setSummary(
        `Created a ${pageCount}-page PDF from ${
          failures === 0
            ? `${successes} ${successes === 1 ? 'image' : 'images'}`
            : `${successes} of ${targets.length} images`
        }.${failures ? ` ${failures} ${failures === 1 ? 'image' : 'images'} failed; the reason is next to the ${failures === 1 ? 'file' : 'files'}.` : ''}`,
      );
    } catch (error) {
      if (!aliveRef.current) return;
      setSummary(
        'The PDF could not be created. Try again, or remove the file that failed and rebuild.',
      );
      notify(error?.message || 'The PDF could not be created.', 'error');
    } finally {
      if (aliveRef.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const liveMessage = checking
    ? 'Checking files…'
    : busy && progress
      ? progress.label === 'Writing PDF'
        ? 'Writing PDF…'
        : `Building PDF: ${progress.done} of ${progress.total} images…`
      : summary ||
        (items.length
          ? `${formatCount(convertible.length, 'image')} ready for ${formatCount(convertible.length, 'page')}.`
          : '');

  const renderActions = (item) =>
    item.convertible ? (
      <IconButton
        label={`Rotate ${item.name} 90 degrees clockwise. Current rotation ${item.rotation ?? 0} degrees.`}
        onClick={() => rotateItem(item)}
        disabled={busy}
      >
        <RotateCw size={16} strokeWidth={1.5} aria-hidden="true" />
      </IconButton>
    ) : null;

  return (
    <>
      <PageHeader
        title="Images to PDF"
        description="Put photos and scans in order, then build one PDF. Choose page size, margins, fit and quality."
      />
      <DropZone
        title="Drop images here"
        description={`${INPUT_FORMATS}. One page per image; GIF uses its first frame. Up to 50 files, 40 MB each, 300 MB total.`}
        accept={IMAGE_ACCEPT}
        disabled={checking || busy}
        onFiles={addFiles}
      />

      {!workersSupported ? (
        <p className="mt-3 text-[12px] leading-5 text-err">
          This browser does not support background image processing. Use a current version of
          Chrome, Edge, Firefox or Safari to build PDFs.
        </p>
      ) : null}

      {items.length > 0 ? (
        <>
          <FileQueue
            items={items}
            onRemove={removeItem}
            onReorder={reorderItems}
            reorderable
            reorderDisabled={busy}
            renderActions={renderActions}
            removeDisabled={busy}
          />

          <SettingsReveal show>
            <PdfSettings
              settings={settings}
              onChange={changeSettings}
              disabled={busy}
              settingsError={settingsError}
            />
            <PdfPagePreview settings={settings} item={previewItem} pageCount={readyCount} />
          </SettingsReveal>

          <div className="mt-6 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-[12px] text-ink-2" aria-live="polite">
                {liveMessage}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {pdfOutput ? (
                  <>
                    <Button
                      size="md"
                      variant={dirty ? 'primary' : 'secondary'}
                      onClick={buildPdf}
                      disabled={busy || checking || !workersSupported || Boolean(settingsError) || readyCount === 0}
                      title={settingsError || undefined}
                    >
                      {busy ? 'Building…' : 'Build again'}
                    </Button>
                    <Button
                      size="md"
                      variant={dirty ? 'secondary' : 'primary'}
                      onClick={downloadPdf}
                      disabled={busy}
                    >
                      <Download size={15} strokeWidth={1.5} aria-hidden="true" />
                      Download PDF
                    </Button>
                  </>
                ) : (
                  <Button
                    size="md"
                    variant="primary"
                    onClick={buildPdf}
                    disabled={busy || checking || !workersSupported || Boolean(settingsError) || readyCount === 0}
                    title={settingsError || undefined}
                  >
                    {busy ? 'Building…' : 'Build PDF'}
                  </Button>
                )}
              </div>
            </div>

            {pdfOutput && !busy ? (
              <p className="mt-2 text-[12px] text-ink-2">
                <span className="font-mono tabular-nums">{formatBytes(pdfOutput.size)}</span> ·{' '}
                {formatCount(pdfOutput.pages, 'page')} · {pdfOutput.name}
              </p>
            ) : null}

            {dirty && pdfOutput && !busy ? (
              <p className="mt-2 text-[12px] text-warn">
                Settings or page order changed. Build again to update the PDF.
              </p>
            ) : null}
          </div>

          <p className="mt-3 text-[12px] leading-5 text-ink-2">
            Drag rows or use the reorder handle to set page order. Rotate turns the whole image
            clockwise. Transparent areas become white on the PDF page.
          </p>
        </>
      ) : null}
    </>
  );
}
