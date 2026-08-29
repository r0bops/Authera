import {
  Activity,
  Bot,
  FileSignature,
  LayoutDashboard,
  ReceiptText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Store,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useMandates, useMe } from '../../api/hooks.js';
import { cn } from '../../lib/cn.js';
import { Badge } from '../../components/ui/primitives.js';

const HUMAN_NAV = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/mandates', label: 'Mandates', icon: FileSignature },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/purchases', label: 'Purchases', icon: ReceiptText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const ROLE_NAV = [
  { to: '/agent', label: 'Agent', icon: Bot },
  { to: '/merchant', label: 'Merchant', icon: Store },
  { to: '/auditor', label: 'Auditor', icon: ShieldCheck },
  { to: '/demo-control', label: 'Demo control', icon: SlidersHorizontal },
];

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-cobalt-soft text-cobalt'
            : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const me = useMe();
  const mandates = useMandates();
  const active = mandates.data?.find((m) => m.status === 'ACTIVE');
  const initials =
    me.data?.user.displayName
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ?? '··';

  return (
    <div className="grid min-h-screen grid-cols-[208px_1fr]">
      <aside className="flex flex-col border-r border-line bg-surface">
        <div className="flex h-12 items-center gap-2 border-b border-line px-4">
          <span className="h-2.5 w-2.5 rounded-sm bg-cobalt" aria-hidden />
          <span className="text-[14px] font-semibold tracking-tight">AgentCerta</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2.5">
          <p className="px-2.5 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-wider text-ink-faint uppercase">
            Marta
          </p>
          {HUMAN_NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
          <p className="px-2.5 pt-4 pb-1.5 text-[10.5px] font-semibold tracking-wider text-ink-faint uppercase">
            Role views
          </p>
          {ROLE_NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-[11.5px] text-ink-faint">
          The mandate gateway for agentic commerce
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex h-12 items-center justify-between gap-4 border-b border-line bg-surface px-5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-ink-muted">Agent</span>
            {active ? (
              <Badge tone="verified">Watching prices</Badge>
            ) : (
              <Badge tone="neutral">Idle — no active mandate</Badge>
            )}
            {me.data?.demoMode ? <Badge tone="info">Demo mode</Badge> : null}
          </div>
          <div className="flex items-center gap-3">
            {me.isError ? <Badge tone="destructive">API unreachable</Badge> : null}
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cobalt-soft text-[11.5px] font-semibold text-cobalt">
                {initials}
              </span>
              <span className="text-[13px] font-medium">{me.data?.user.displayName ?? '…'}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-5">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
