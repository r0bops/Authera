import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn.js';

export type Tone = 'neutral' | 'verified' | 'attention' | 'destructive' | 'info';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-ink-muted border-line',
  verified: 'bg-emerald-soft text-emerald border-emerald/20',
  attention: 'bg-amber-soft text-amber border-amber/20',
  destructive: 'bg-coral-soft text-coral border-coral/20',
  info: 'bg-cobalt-soft text-cobalt border-cobalt/20',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

export function buttonStyles({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  className?: string;
} = {}) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-cobalt text-white hover:bg-cobalt-strong border-transparent',
    secondary: 'bg-surface text-ink border-line-strong hover:bg-surface-muted',
    destructive: 'bg-coral text-white hover:brightness-95 border-transparent',
    ghost: 'bg-transparent text-cobalt border-transparent hover:bg-cobalt-soft',
  };
  return cn(
    'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt',
    size === 'sm'
      ? 'min-h-11 px-2.5 text-[12.5px] md:min-h-10'
      : 'min-h-11 px-3.5 text-[13.5px] md:min-h-10',
    variants[variant],
    className,
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        buttonStyles({ variant, size }),
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {loading ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          <span className="sr-only" aria-live="polite">
            Working…
          </span>
        </>
      ) : null}
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  title,
  actions,
  description,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section className={cn('rounded-md border border-line bg-surface', className)}>
      {title !== undefined ? (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function Label({
  children,
  htmlFor,
  hint,
}: {
  children: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-ink">
      {children}
      {hint ? <span className="ml-1 font-normal text-ink-faint">{hint}</span> : null}
    </label>
  );
}

const fieldClass =
  'min-h-11 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13.5px] text-ink placeholder:text-ink-muted focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/30 disabled:bg-surface-muted md:min-h-10';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldClass, className)} />;
}

/** Small-integer control: − [n] + with hard bounds. Typing is still allowed inside the box. */

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(fieldClass, 'pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldClass, 'h-auto min-h-20 py-2', className)} />;
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const Icon =
    tone === 'verified'
      ? CheckCircle2
      : tone === 'attention'
        ? AlertTriangle
        : tone === 'destructive'
          ? XCircle
          : Info;
  return (
    <div
      className={cn('flex gap-2.5 rounded-md border px-3 py-2.5 text-[13px]', toneClasses[tone])}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5')}>{children}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {children ? <p className="max-w-md text-[13px] text-ink-muted">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  const code = (error as { code?: string } | undefined)?.code;
  return (
    <Alert
      tone={code === 'DISCONNECTED' ? 'attention' : 'destructive'}
      title={code === 'DISCONNECTED' ? 'Disconnected from the API' : 'Request failed'}
    >
      <p>
        {message}
        {code ? <span className="ml-1 font-mono text-[12px]">({code})</span> : null}
      </p>
      {retry ? (
        <Button variant="secondary" size="sm" className="mt-2" onClick={retry}>
          Retry
        </Button>
      ) : null}
    </Alert>
  );
}

export function KeyValue({
  items,
  dense = false,
  className,
}: {
  items: Array<{ label: ReactNode; value: ReactNode; mono?: boolean }>;
  dense?: boolean;
  className?: string;
}) {
  return (
    <dl className={cn('grid min-w-0', dense ? 'gap-y-2' : 'gap-y-3', className)}>
      {items.map((item, index) => (
        <div
          key={index}
          className="grid min-w-0 grid-cols-1 gap-y-0.5 sm:grid-cols-[minmax(120px,max-content)_minmax(0,1fr)] sm:gap-x-4"
        >
          <dt className="text-[12.5px] text-ink-muted">{item.label}</dt>
          <dd
            className={cn(
              'min-w-0 break-words text-[13px] text-ink',
              item.mono && 'font-mono text-[12px]',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-md border border-line', className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'border-b border-line bg-surface-muted px-3 py-2 text-left text-[11.5px] font-semibold tracking-wide text-ink-muted uppercase',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  mono,
}: {
  children?: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <td
      className={cn(
        'border-b border-line px-3 py-2 align-top text-ink',
        mono && 'font-mono text-[12px]',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <OpenDialog onClose={onClose} title={title} footer={footer} wide={wide}>
      {children}
    </OpenDialog>
  );
}

function OpenDialog({
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => returnFocus.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn(
        'm-auto mb-0 max-h-[88dvh] w-full overflow-x-hidden overflow-y-auto rounded-t-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/45 sm:mb-auto sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:rounded-md',
        wide ? 'max-w-3xl' : 'max-w-xl',
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full" onClick={(e) => e.stopPropagation()}>
        <header className="border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-[15px] font-semibold">
            {title}
          </h2>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex flex-col gap-2 border-t border-line px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
          {meta}
        </div>
        {description ? (
          <p className="mt-0.5 max-w-3xl text-[13px] text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code
      className={cn(
        'rounded bg-surface-muted px-1 py-0.5 font-mono text-[12px] text-ink',
        className,
      )}
    >
      {children}
    </code>
  );
}
