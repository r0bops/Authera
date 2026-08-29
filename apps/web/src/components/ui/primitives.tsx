import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
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
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-cobalt text-white hover:bg-cobalt-strong border-transparent',
    secondary: 'bg-surface text-ink border-line-strong hover:bg-surface-muted',
    destructive: 'bg-coral text-white hover:brightness-95 border-transparent',
    ghost: 'bg-transparent text-cobalt border-transparent hover:bg-cobalt-soft',
  };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-[13.5px]',
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
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
          <div>
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
  'h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/20 disabled:bg-surface-muted';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldClass, className)} />;
}

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

export function Switch({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  id: string;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 text-[13px] text-ink',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full border transition-colors',
          checked ? 'border-cobalt bg-cobalt' : 'border-line-strong bg-surface-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4.5 left-0.5' : 'left-0.5',
          )}
        />
      </button>
      {label}
    </label>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-[12px] text-coral">{message}</p> : null;
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
  return <div className={cn('animate-pulse rounded-md bg-surface-muted', className)} aria-hidden />;
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
    <dl
      className={cn(
        'grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-4',
        dense ? 'gap-y-1' : 'gap-y-2',
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={index} className="contents">
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
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/45 p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'max-h-[90vh] w-full overflow-y-auto rounded-md border border-line bg-surface shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-xl',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
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
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">{title}</h1>
          {meta}
        </div>
        {description ? (
          <p className="mt-0.5 max-w-3xl text-[13px] text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
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
