export const PDF_PAGE_SIZES = Object.freeze([
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'match', label: 'Fit image' },
]);

export const PDF_ORIENTATIONS = Object.freeze([
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
]);

export const PDF_MARGINS = Object.freeze([
  { value: 'none', label: 'None', points: 0, hint: 'Images extend to the page edge.' },
  { value: 'small', label: 'Small', points: 18, hint: 'A 0.25 in margin around each image.' },
  { value: 'normal', label: 'Normal', points: 36, hint: 'A 0.5 in margin around each image.' },
]);

export const PDF_FITS = Object.freeze([
  { value: 'contain', label: 'Contain', hint: 'Shows the whole image. Any extra space stays white.' },
  { value: 'fill', label: 'Fill', hint: 'Crops the edges so the image covers the page area.' },
]);

export const PDF_QUALITY_MODES = Object.freeze([
  {
    value: 'original',
    label: 'Original',
    dpi: null,
    jpegQuality: null,
    hint: 'Does not recompress JPG or PNG; both are embedded directly. Other formats are converted once. Metadata already in those files stays embedded.',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    dpi: 150,
    jpegQuality: 0.8,
    hint: 'Rasterizes pages at about 150 DPI. Clear on screen and sized for uploads.',
  },
  {
    value: 'small',
    label: 'Small',
    dpi: 100,
    jpegQuality: 0.65,
    hint: 'Rasterizes pages at about 100 DPI. Smallest file, softer if printed.',
  },
]);

export const DEFAULT_PDF_SETTINGS = Object.freeze({
  pageSize: 'a4',
  orientation: 'auto',
  margin: 'normal',
  fit: 'contain',
  quality: 'balanced',
});

export const PAGE_BASE_SIZES = Object.freeze({
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
});

export const MATCH_LONG_SIDE = 842;

export function pdfQualityMode(value) {
  return PDF_QUALITY_MODES.find((mode) => mode.value === value) ?? PDF_QUALITY_MODES[1];
}

export function marginFor(value) {
  return PDF_MARGINS.find((margin) => margin.value === value) ?? PDF_MARGINS[2];
}

export function validatePdfSettings(settings) {
  if (!PDF_PAGE_SIZES.some((size) => size.value === settings.pageSize)) {
    return 'Choose a page size.';
  }
  if (!PDF_ORIENTATIONS.some((option) => option.value === settings.orientation)) {
    return 'Choose a page orientation.';
  }
  if (!PDF_MARGINS.some((margin) => margin.value === settings.margin)) {
    return 'Choose a page margin.';
  }
  if (!PDF_FITS.some((fit) => fit.value === settings.fit)) {
    return 'Choose how images fit on the page.';
  }
  if (!PDF_QUALITY_MODES.some((mode) => mode.value === settings.quality)) {
    return 'Choose a quality mode.';
  }
  return null;
}

export function isMirroredOrientation(orientation) {
  return orientation === 2 || orientation === 4 || orientation === 5 || orientation === 7;
}

export function exifClockwise(orientation) {
  switch (orientation) {
    case 3:
      return 180;
    case 6:
      return 90;
    case 8:
      return 270;
    default:
      return 0;
  }
}

export function displaySize({ width, height, orientation = 1, rotation = 0 }) {
  let nextWidth = width;
  let nextHeight = height;
  if (orientation >= 5 && orientation <= 8) {
    [nextWidth, nextHeight] = [nextHeight, nextWidth];
  }
  if (rotation === 90 || rotation === 270) {
    [nextWidth, nextHeight] = [nextHeight, nextWidth];
  }
  return { width: nextWidth, height: nextHeight };
}

export function pageBoxFor({ pageSize, orientation, margin, aspect }) {
  const marginPoints = marginFor(margin).points;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 595.28 / 841.89;

  if (pageSize === 'match') {
    const contentLong = MATCH_LONG_SIDE - marginPoints * 2;
    const contentWidth =
      safeAspect >= 1 ? contentLong : Math.max(1, contentLong * safeAspect);
    const contentHeight =
      safeAspect >= 1 ? Math.max(1, contentLong / safeAspect) : contentLong;
    return {
      pageWidth: contentWidth + marginPoints * 2,
      pageHeight: contentHeight + marginPoints * 2,
      contentWidth,
      contentHeight,
      margin: marginPoints,
      orientation: safeAspect >= 1 ? 'landscape' : 'portrait',
    };
  }

  const base = PAGE_BASE_SIZES[pageSize] ?? PAGE_BASE_SIZES.a4;
  const resolvedOrientation =
    orientation === 'auto'
      ? safeAspect >= 1
        ? 'landscape'
        : 'portrait'
      : orientation;
  const pageWidth =
    resolvedOrientation === 'landscape' ? base.height : base.width;
  const pageHeight =
    resolvedOrientation === 'landscape' ? base.width : base.height;

  return {
    pageWidth,
    pageHeight,
    contentWidth: Math.max(1, pageWidth - marginPoints * 2),
    contentHeight: Math.max(1, pageHeight - marginPoints * 2),
    margin: marginPoints,
    orientation: resolvedOrientation,
  };
}
