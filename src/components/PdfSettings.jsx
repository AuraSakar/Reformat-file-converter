import { useId } from 'react';
import {
  PDF_FITS,
  PDF_MARGINS,
  PDF_ORIENTATIONS,
  PDF_PAGE_SIZES,
  PDF_QUALITY_MODES,
  marginFor,
  pdfQualityMode,
} from '../lib/pdfOptions';
import { Field, SettingsGroup, SettingsPanel } from './SettingsPanel';

export function PdfSettings({ settings, onChange, disabled = false, settingsError }) {
  const id = useId();
  const orientationId = `${id}-orientation`;
  const marginId = `${id}-margin`;
  const fitId = `${id}-fit`;
  const marginHintId = `${id}-margin-hint`;
  const fitHintId = `${id}-fit-hint`;
  const qualityMode = pdfQualityMode(settings.quality);
  const margin = marginFor(settings.margin);
  const fit = PDF_FITS.find((option) => option.value === settings.fit) ?? PDF_FITS[0];

  const set = (patch) => onChange(patch);

  return (
    <SettingsPanel title="PDF settings">
      <SettingsGroup title="Page size">
        <div role="radiogroup" aria-label="Page size" className="grid grid-cols-3 gap-1">
          {PDF_PAGE_SIZES.map((size) => (
            <label key={size.value} className="min-w-0">
              <input
                type="radio"
                name={`${id}-page-size`}
                value={size.value}
                checked={settings.pageSize === size.value}
                disabled={disabled}
                onChange={() => set({ pageSize: size.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-10 cursor-pointer sm:min-h-9 items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                {size.label}
              </span>
            </label>
          ))}
        </div>
        <p className="text-[12px] leading-4 text-ink-2">
          {settings.pageSize === 'match'
            ? 'Each page takes its proportions from the image. Long side is limited to A4 length.'
            : 'A4 is the usual choice for assignments and applications.'}
        </p>
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <Field label="Orientation" htmlFor={orientationId}>
          <select
            id={orientationId}
            value={settings.pageSize === 'match' ? 'auto' : settings.orientation}
            disabled={disabled || settings.pageSize === 'match'}
            onChange={(event) => set({ orientation: event.target.value })}
            className="control"
          >
            {PDF_ORIENTATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="-mt-1 text-[12px] leading-4 text-ink-2">
          {settings.pageSize === 'match'
            ? 'Pages follow each image, so orientation is automatic.'
            : 'Auto turns each page to suit its image.'}
        </p>

        <Field label="Margins" htmlFor={marginId} hint={margin.hint} hintId={marginHintId}>
          <select
            id={marginId}
            value={settings.margin}
            disabled={disabled}
            aria-describedby={marginHintId}
            onChange={(event) => set({ margin: event.target.value })}
            className="control"
          >
            {PDF_MARGINS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Image fit" htmlFor={fitId} hint={fit.hint} hintId={fitHintId}>
          <select
            id={fitId}
            value={settings.fit}
            disabled={disabled}
            aria-describedby={fitHintId}
            onChange={(event) => set({ fit: event.target.value })}
            className="control"
          >
            {PDF_FITS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </SettingsGroup>

      <SettingsGroup title="Quality">
        <div role="radiogroup" aria-label="PDF quality" className="grid grid-cols-3 gap-1">
          {PDF_QUALITY_MODES.map((mode) => (
            <label key={mode.value} className="min-w-0">
              <input
                type="radio"
                name={`${id}-quality`}
                value={mode.value}
                checked={settings.quality === mode.value}
                disabled={disabled}
                onChange={() => set({ quality: mode.value })}
                className="peer sr-only"
              />
              <span className="flex min-h-10 cursor-pointer sm:min-h-9 items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                {mode.label}
              </span>
            </label>
          ))}
        </div>
        <p className="text-[12px] leading-4 text-ink-2">{qualityMode.hint}</p>
      </SettingsGroup>

      <div className="py-4">
        <p className="text-[12px] leading-5 text-ink-2">
          Everything is built on this device. Phone photo orientation is respected.
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
