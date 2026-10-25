import { useEffect, useState } from 'react';
import { PDF_FITS, PDF_PAGE_SIZES, pageBoxFor } from '../lib/pdfOptions';
import { formatCount } from '../lib/format';

export function PdfPagePreview({ settings, item, pageCount }) {
  const [loadedAspect, setLoadedAspect] = useState(null);

  useEffect(() => {
    setLoadedAspect(null);
  }, [item?.id, item?.thumbUrl]);

  const sourceAspect =
    item?.sourceWidth > 0 && item?.sourceHeight > 0
      ? item.sourceWidth / item.sourceHeight
      : loadedAspect;
  const rotation = item?.rotation ?? 0;
  const aspect =
    sourceAspect && (rotation === 90 || rotation === 270)
      ? 1 / sourceAspect
      : sourceAspect;

  const box = pageBoxFor({
    pageSize: settings.pageSize,
    orientation: settings.orientation,
    margin: settings.margin,
    aspect,
  });
  const fit = PDF_FITS.find((option) => option.value === settings.fit) ?? PDF_FITS[0];
  const pageLabel =
    PDF_PAGE_SIZES.find((size) => size.value === settings.pageSize)?.label ?? 'A4';
  const topBottom = (box.margin / box.pageHeight) * 100;
  const leftRight = (box.margin / box.pageWidth) * 100;
  const description = `${formatCount(pageCount, 'page')}, ${pageLabel} ${box.orientation}, image set to ${fit.label.toLowerCase()}.`;

  let previewStyle = null;
  if (sourceAspect) {
    const rotatedAspect = aspect;
    const contentAspect = box.contentWidth / box.contentHeight;
    let finalWidth;
    let finalHeight;
    if (settings.fit === 'fill') {
      if (rotatedAspect >= contentAspect) {
        finalWidth = 100 * (rotatedAspect / contentAspect);
        finalHeight = 100;
      } else {
        finalWidth = 100;
        finalHeight = 100 * (contentAspect / rotatedAspect);
      }
    } else if (rotatedAspect >= contentAspect) {
      finalWidth = 100;
      finalHeight = 100 * (contentAspect / rotatedAspect);
    } else {
      finalWidth = 100 * (rotatedAspect / contentAspect);
      finalHeight = 100;
    }

    const swap = rotation === 90 || rotation === 270;
    const contentRatio = box.contentWidth / box.contentHeight;
    previewStyle = {
      width: `${swap ? finalHeight / contentRatio : finalWidth}%`,
      height: `${swap ? finalWidth * contentRatio : finalHeight}%`,
      transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    };
  }

  return (
    <section className="mt-6 border-t border-line pt-4" aria-labelledby="page-preview-title">
      <h2 id="page-preview-title" className="text-[12px] font-medium text-ink-2">
        Page preview
      </h2>
      <div className="mt-3 flex justify-center rounded-[4px] bg-surface-muted p-4">
        <div
          className="relative w-full max-w-[196px] overflow-hidden border border-line bg-page"
          style={{ aspectRatio: `${box.pageWidth} / ${box.pageHeight}` }}
          role="img"
          aria-label={`Page preview: ${description}`}
        >
          {item?.thumbUrl ? (
            <div
              className="absolute overflow-hidden"
              style={{
                inset: `${topBottom}% ${leftRight}% ${topBottom}% ${leftRight}%`,
              }}
            >
              <img
                src={item.thumbUrl}
                alt=""
                aria-hidden="true"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth && image.naturalHeight) {
                    setLoadedAspect(image.naturalWidth / image.naturalHeight);
                  }
                }}
                className={`size-full max-w-none ${
                  previewStyle ? 'object-fill' : settings.fit === 'fill' ? 'object-cover' : 'object-contain'
                }`}
                style={
                  previewStyle
                    ? {
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        ...previewStyle,
                      }
                    : undefined
                }
              />
            </div>
          ) : (
            <span className="absolute inset-0 flex items-center justify-center px-4 text-center font-mono text-[10px] uppercase text-ink-2">
              {item ? 'Page layout' : 'Add images'}
            </span>
          )}
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-4 text-ink-2">
        {formatCount(pageCount, 'page')} · {pageLabel} {box.orientation} · {fit.label.toLowerCase()}
      </p>
      {item?.rotation ? (
        <p className="mt-1 text-[12px] leading-4 text-ink-2">
          First image rotated {item.rotation}° clockwise.
        </p>
      ) : null}
    </section>
  );
}
