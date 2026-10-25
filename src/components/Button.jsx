const VARIANTS = {
  primary:
    'bg-ink text-white hover:bg-[#2a2d34] active:bg-[#3a3e46] disabled:hover:bg-ink',
  secondary:
    'border border-line-strong bg-surface text-ink hover:bg-bg active:bg-[#f2f0eb]',
  ghost:
    'bg-transparent text-ink-2 hover:bg-black/[0.04] hover:text-ink active:bg-black/[0.06]',
  danger:
    'bg-transparent text-err hover:bg-err/[0.06] active:bg-err/[0.1]',
};

const SIZES = {
  sm: 'min-h-9 px-2.5 text-[12px]',
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
      ? 'text-ink-2 hover:text-err hover:bg-err/[0.06]'
      : 'text-ink-2 hover:text-ink hover:bg-black/[0.04]';
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
