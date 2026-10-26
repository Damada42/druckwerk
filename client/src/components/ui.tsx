import { X } from 'lucide-react';
import { useEffect, type ComponentProps, type ReactNode } from 'react';

export const euro = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '–'
    : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

export const grams = (g: number) =>
  g >= 1000
    ? `${(g / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} kg`
    : `${Math.round(g)} g`;

export const dateDe = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('de-DE') : '–';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line bg-surface hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-main',
        variant === 'danger' && 'text-red-600 hover:bg-red-500/10',
        className,
      )}
      {...props}
    />
  );
}

const inputClass =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

export function Field({
  label,
  children,
  className,
  badge,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Kleiner Hinweis neben dem Label, z.B. „erkannt“ */
  badge?: ReactNode;
}) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {label}
        {badge}
      </span>
      {children}
    </label>
  );
}

export function TextInput(props: ComponentProps<'input'>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function TextArea(props: ComponentProps<'textarea'>) {
  return <textarea rows={3} {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: ComponentProps<'select'>) {
  return <select {...props} className={cx(inputClass, props.className)} />;
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('rounded-xl border border-line bg-surface', className)} {...props} />;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
      {children}
    </div>
  );
}

export function ColorDot({
  color,
  size = 14,
  title,
}: {
  color: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-block shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" className="!p-1.5" onClick={onClose} aria-label="Schließen">
            <X size={18} />
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="text-sm text-red-600">{error instanceof Error ? error.message : String(error)}</p>
  );
}

/** Initialen-Avatar für Personen. */
export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-strong ring-2 ring-[var(--surface)] dark:text-orange-300"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}
