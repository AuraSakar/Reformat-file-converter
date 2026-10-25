export function PageHeader({ title, description, children }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-[70ch] text-[13px] leading-5 text-ink-2">{description}</p>
        ) : null}
      </div>
      {children}
    </header>
  );
}

export function SettingsReveal({ show, children }) {
  if (!show) return null;
  return <div className="settings-reveal mt-6">{children}</div>;
}
