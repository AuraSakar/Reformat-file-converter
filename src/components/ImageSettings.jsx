import { useId } from 'react';
import { ICO_SIZES, OUTPUT_FORMATS } from '../lib/config';
import { QUALITY_FORMATS, TARGET_FORMATS } from '../lib/imageOptions';
import { Field, SettingsGroup, SettingsPanel } from './SettingsPanel';

const ROTATIONS = [
  { value: 0, label: 'None' },
  { value: 90, label: '90° clockwise' },
  { value: 180, label: '180°' },
  { value: 270, label: '270° clockwise' },
];

export function ImageSettings({
  settings,
  onChange,
  disabled = false,
  supportsWebp = true,
  supportsAvif = true,
  settingsError,
}) {
  const id = useId();
  const qualityId = `${id}-quality`;
  const targetValueId = `${id}-target-value`;
  const targetUnitId = `${id}-target-unit`;
  const resizeId = `${id}-resize`;
  const widthId = `${id}-max-width`;
  const heightId = `${id}-max-height`;
  const percentId = `${id}-percent`;
  const rotationId = `${id}-rotation`;
  const backgroundId = `${id}-background`;
  const backgroundHintId = `${id}-background-hint`;

  const set = (patch) => onChange(patch);
  const qualityDisabled = disabled || !QUALITY_FORMATS.has(settings.format) || settings.targetEnabled;

  return (
    <SettingsPanel title="Conversion settings">
      <SettingsGroup title="Output format">
        <div
          role="radiogroup"
          aria-label="Output format"
          className="grid grid-cols-3 gap-1"
        >
          {OUTPUT_FORMATS.map((format) => {
            const webpDisabled = format.value === 'image/webp' && !supportsWebp;
            const avifDisabled = format.value === 'image/avif' && !supportsAvif;
            return (
              <label key={format.value} className="min-w-0">
                <input
                  type="radio"
                  name={`${id}-format`}
                  value={format.value}
                  checked={settings.format === format.value}
                  disabled={disabled || webpDisabled || avifDisabled}
                  onChange={() => set({ format: format.value })}
                  className="peer sr-only"
                />
                <span className="flex min-h-10 cursor-pointer sm:min-h-9 items-center justify-center rounded-[4px] border border-line-strong bg-surface px-1 text-[12px] text-ink-2 transition-colors duration-150 peer-checked:border-ink peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                  {format.label}
                </span>
              </label>
            );
          })}
        </div>
        {!supportsWebp ? (
          <p className="text-[12px] leading-4 text-ink-2">
            This browser cannot encode WebP. JPG and PNG are available.
          </p>
        ) : null}
        {!supportsAvif ? (
          <p className="text-[12px] leading-4 text-ink-2">
            AVIF needs WebAssembly. JPG, PNG and WebP are available.
          </p>
        ) : null}
        {settings.format === 'image/jpeg' || settings.format === 'image/bmp' ? (
          <p className="text-[12px] leading-4 text-ink-2">
            {settings.format === 'image/jpeg' ? 'JPG' : 'BMP'} has no transparency. Transparent
            areas are filled with the chosen background.
          </p>
        ) : null}
        {settings.format === 'image/gif' ? (
          <p className="text-[12px] leading-4 text-ink-2">
            GIF output is one static frame. Animation is not preserved.
          </p>
        ) : null}
        {settings.format === 'image/avif' ? (
          <p className="text-[12px] leading-4 text-ink-2">
            AVIF encoding uses the bundled WebAssembly encoder and can take longer.
          </p>
        ) : null}
        {settings.format === 'image/x-icon' ? (
          <p className="text-[12px] leading-4 text-ink-2">
            ICO files contain square PNG icons at the sizes you choose.
          </p>
        ) : null}

        {QUALITY_FORMATS.has(settings.format) ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label className="text-[12px] font-medium text-ink-2" htmlFor={qualityId}>
                Quality
              </label>
              <span className="mono text-[12px] text-ink-2">
                {settings.targetEnabled
                  ? 'Automatic'
                  : `${Math.round(settings.quality * 100)}%`}
              </span>
            </div>
            <input
              id={qualityId}
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.quality}
              disabled={qualityDisabled}
              onChange={(event) => set({ quality: Number(event.target.value) })}
              className="h-10 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 sm:h-8"
            />
            <p className="text-[12px] leading-4 text-ink-2">
              {settings.format === 'image/avif'
                ? 'Lower values create smaller AVIF files.'
                : 'JPG and WebP use a lossy quality setting.'}
            </p>
          </div>
        ) : null}

        {settings.format === 'image/x-icon' ? (
          <fieldset>
            <legend className="mb-1.5 text-[12px] font-medium text-ink-2">Icon sizes</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ICO_SIZES.map((size) => (
                <label key={size} className="flex min-h-10 cursor-pointer items-center gap-2 text-[12px] text-ink sm:min-h-8">
                  <input
                    type="checkbox"
                    checked={settings.icoSizes.includes(size)}
                    disabled={disabled}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...settings.icoSizes, size].sort((a, b) => a - b)
                        : settings.icoSizes.filter((value) => value !== size);
                      set({ icoSizes: next });
                    }}
                    className="size-4 accent-ink"
                  />
                  <span className="mono">{size}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[12px] leading-4 text-ink-2">
              Select one or more sizes. 256 is the largest Windows icon size.
            </p>
          </fieldset>
        ) : null}
      </SettingsGroup>

      {TARGET_FORMATS.has(settings.format) ? (
        <SettingsGroup title="Target file size">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-[13px] text-ink sm:min-h-8">
            <input
              type="checkbox"
              checked={settings.targetEnabled}
              disabled={disabled}
              onChange={(event) => set({ targetEnabled: event.target.checked })}
              className="size-4 accent-ink"
            />
            Fit under a limit
          </label>
          {settings.targetEnabled ? (
            <>
              <div className="flex items-center gap-1.5">
                <label className="sr-only" htmlFor={targetValueId}>
                  Target size
                </label>
                <input
                  id={targetValueId}
                  type="number"
                  inputMode="decimal"
                  min="1"
                  step="any"
                  value={settings.targetValue}
                  disabled={disabled}
                  onChange={(event) => set({ targetValue: event.target.value })}
                  className="control control-sm w-24"
                />
                <label className="sr-only" htmlFor={targetUnitId}>
                  Target size unit
                </label>
                <select
                  id={targetUnitId}
                  value={settings.targetUnit}
                  disabled={disabled}
                  onChange={(event) => set({ targetUnit: event.target.value })}
                  className="control control-sm w-20"
                >
                  <option value="KB">KB</option>
                  <option value="MB">MB</option>
                </select>
              </div>
              <p className="text-[12px] leading-4 text-ink-2">
                Quality is searched first, then dimensions are reduced if needed.
                {settings.format === 'image/png'
                  ? ' PNG has no quality setting, so only dimensions are reduced.'
                  : ''}
              </p>
            </>
          ) : (
            <p className="text-[12px] leading-4 text-ink-2">
              Use this for portal upload limits. It finds the highest quality that fits.
            </p>
          )}
        </SettingsGroup>
      ) : null}

      {settings.format !== 'image/x-icon' ? (
      <SettingsGroup title="Resize">
        <label className="sr-only" htmlFor={resizeId}>
          Resize mode
        </label>
        <select
          id={resizeId}
          value={settings.resizeMode}
          disabled={disabled}
          onChange={(event) => set({ resizeMode: event.target.value })}
          className="control"
        >
          <option value="none">Original dimensions</option>
          <option value="max">Max width and height</option>
          <option value="percent">Percentage</option>
        </select>

        {settings.resizeMode === 'max' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Max width" htmlFor={widthId}>
              <div className="relative">
                <input
                  id={widthId}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  placeholder="Auto"
                  value={settings.maxWidth}
                  disabled={disabled}
                  onChange={(event) => set({ maxWidth: event.target.value })}
                  className="control control-sm pr-7 font-mono"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-ink-2">
                  px
                </span>
              </div>
            </Field>
            <Field label="Max height" htmlFor={heightId}>
              <div className="relative">
                <input
                  id={heightId}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  placeholder="Auto"
                  value={settings.maxHeight}
                  disabled={disabled}
                  onChange={(event) => set({ maxHeight: event.target.value })}
                  className="control control-sm pr-7 font-mono"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-ink-2">
                  px
                </span>
              </div>
            </Field>
          </div>
        ) : null}

        {settings.resizeMode === 'percent' ? (
          <Field label="Scale" htmlFor={percentId}>
            <div className="relative">
              <input
                id={percentId}
                type="number"
                inputMode="numeric"
                min="1"
                max="200"
                step="1"
                value={settings.percent}
                disabled={disabled}
                onChange={(event) => set({ percent: event.target.value })}
                className="control control-sm pr-7 font-mono"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-ink-2">
                %
              </span>
            </div>
          </Field>
        ) : null}
        <p className="text-[12px] leading-4 text-ink-2">
          Images are never enlarged by max-width or max-height.
        </p>
      </SettingsGroup>
      ) : null}

      <SettingsGroup title="Rotation and background">
        <Field label="Rotate" htmlFor={rotationId}>
          <select
            id={rotationId}
            value={settings.rotation}
            disabled={disabled}
            onChange={(event) => set({ rotation: Number(event.target.value) })}
            className="control"
          >
            {ROTATIONS.map((rotation) => (
              <option key={rotation.value} value={rotation.value}>
                {rotation.label}
              </option>
            ))}
          </select>
        </Field>

        {settings.format === 'image/jpeg' || settings.format === 'image/bmp' ? (
          <Field
            label="Background for transparency"
            htmlFor={backgroundId}
            hint={`${settings.format === 'image/jpeg' ? 'JPG' : 'BMP'} has no transparency. Transparent areas are filled with this color.`}
            hintId={backgroundHintId}
          >
            <div className="flex items-center gap-2">
              <input
                id={backgroundId}
                type="color"
                value={settings.background}
                disabled={disabled}
                aria-describedby={backgroundHintId}
                onChange={(event) => set({ background: event.target.value })}
                className="h-10 w-10 cursor-pointer rounded-[4px] border border-line-strong bg-surface p-0.5 disabled:opacity-40 sm:h-9"
              />
              <span className="mono text-[12px] uppercase text-ink-2">{settings.background}</span>
            </div>
          </Field>
        ) : null}
      </SettingsGroup>

      <div className="py-4">
        <p className="text-[12px] leading-5 text-ink-2">
          EXIF metadata is removed from converted images. EXIF orientation is applied so phone
          photos stay upright.
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
