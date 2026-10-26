export function SettingsPanel({ title = 'Settings', children, footer, className = '' }) {
  return (
    <section className={`min-w-0 ${className}`} aria-label={title}>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <div className="settings-form mt-2 border-t border-line pt-1">{children}</div>
      {footer ? <div className="border-t border-line pt-4">{footer}</div> : null}
    </section>
  );
}

export function SettingsGroup({ title, description, children, className = '' }) {
  return (
    <fieldset className={`border-b border-line py-4 ${className}`}>
      <legend className="mb-3 text-[12px] font-medium text-ink-2">{title}</legend>
      {description ? (
        <p className="-mt-1.5 mb-3 text-[12px] leading-4 text-ink-2">{description}</p>
      ) : null}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

export function Field({ label, htmlFor, hint, hintId, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
