const VARIANTS = {
  primary:
    'bg-btn-bg text-btn-ink hover:bg-btn-hover active:bg-btn-active disabled:hover:bg-btn-bg',
  secondary:
    'border border-line-strong bg-surface text-ink hover:bg-hover active:bg-press',
  ghost:
    'bg-transparent text-ink-2 hover:bg-hover hover:text-ink active:bg-press',
  danger:
    'bg-transparent text-err hover:bg-err/[0.08] active:bg-err/[0.14]',
};

const SIZES = {
  sm: 'min-h-10 px-2.5 text-[12px] sm:min-h-9',
  md: 'min-h-10 px-3.5 text-[13px] sm:min-h-9',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...props
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[4px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, tone = 'default', className = '', children, ...props }) {
  const colors =
    tone === 'danger'
      ? 'text-ink-2 hover:text-err hover:bg-err/[0.08]'
      : 'text-ink-2 hover:text-ink hover:bg-hover';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-[4px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 sm:size-9 ${colors} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
