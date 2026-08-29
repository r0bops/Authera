import {
  Activity,
  Bot,
  House,
  ListChecks,
  ReceiptText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Store,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useMandates, useMe } from '../../api/hooks.js';
import { Badge } from '../../components/ui/primitives.js';
import { cn } from '../../lib/cn.js';
import { friendlyAgentName } from '../../lib/format.js';

export type AppPerspective = 'client' | 'agent' | 'merchant' | 'auditor' | 'demo';

const CLIENT_NAV = [
  { to: '/dashboard', label: 'Home', icon: House, end: true },
  { to: '/dashboard/mandates', label: 'Plans', icon: ListChecks },
  { to: '/dashboard/activity', label: 'Activity', icon: Activity },
  { to: '/dashboard/purchases', label: 'Purchases', icon: ReceiptText },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
];

const PERSPECTIVE_CONFIG = {
  client: {
    section: 'Your account',
    nav: CLIENT_NAV,
    footer: 'Aria can only spend inside the rules you set',
  },
  agent: {
    section: 'Purchasing agent',
    nav: [{ to: '/agent', label: 'Agent overview', icon: Bot, end: true }],
    footer: 'Discovery and decisions, never authorization',
  },
  merchant: {
    section: 'Merchant',
    nav: [{ to: '/verify', label: 'Purchase verification', icon: Store, end: true }],
    footer: 'Verify before accepting an agent purchase',
  },
  auditor: {
    section: 'Independent audit',
    nav: [{ to: '/audit', label: 'Evidence ledger', icon: ShieldCheck, end: true }],
    footer: 'Decisions explained from recorded evidence',
  },
  demo: {
    section: 'Judge tools',
    nav: [{ to: '/demo', label: 'Trial by fire', icon: SlidersHorizontal, end: true }],
    footer: 'Local controls available only in demo mode',
  },
} satisfies Record<
  AppPerspective,
  {
    section: string;
    nav: Array<{ to: string; label: string; icon: typeof House; end?: boolean }>;
    footer: string;
  }
>;

function NavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: typeof House;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[10.5px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 focus-visible:outline-none md:min-h-10 md:flex-row md:justify-start md:gap-2.5 md:px-2.5 md:text-[13px]',
          isActive
            ? 'bg-cobalt-soft text-cobalt'
            : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="max-w-full truncate">{label}</span>
    </NavLink>
  );
}

export function AppShell({
  perspective,
  children,
}: {
  perspective: AppPerspective;
  children?: ReactNode;
}) {
  const me = useMe();
  const mandates = useMandates();
  const active = mandates.data?.find(
    (mandate) => mandate.status === 'ACTIVE' && mandate.usage.remainingCount > 0,
  );
  const completed = mandates.data?.find(
    (mandate) => mandate.status === 'ACTIVE' && mandate.usage.remainingCount === 0,
  );
  const config = PERSPECTIVE_CONFIG[perspective];
  const humanName = me.data?.user.displayName ?? 'Marta Ledezma';
  const agentName = friendlyAgentName(me.data?.agents[0]?.displayName);
  const identity =
    perspective === 'client'
      ? humanName
      : perspective === 'agent'
        ? agentName
        : perspective === 'merchant'
          ? 'Merchant'
          : perspective === 'auditor'
            ? 'Auditor'
            : 'Demo operator';
  const initials = identity
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[208px_1fr]">
      <aside className="flex min-w-0 flex-col border-b border-line bg-surface md:border-r md:border-b-0">
        <div className="flex h-12 items-center gap-2 border-b border-line px-4">
          <span className="h-2.5 w-2.5 rounded-sm bg-cobalt" aria-hidden />
          <span className="text-[14px] font-semibold tracking-tight">Authera</span>
        </div>
        <nav
          className={cn(
            'grid flex-1 gap-0.5 p-2 md:flex md:flex-col md:p-2.5',
            config.nav.length === 5 ? 'grid-cols-5' : 'grid-cols-1',
          )}
          aria-label={`${config.section} navigation`}
        >
          <p className="hidden px-2.5 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-wider text-ink-faint uppercase md:block">
            {config.section}
          </p>
          {config.nav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="hidden border-t border-line px-4 py-3 text-[11.5px] text-ink-faint md:block">
          {config.footer}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex min-h-12 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 md:px-5 md:py-0">
          <div className="flex items-center gap-2 text-[13px]">
            {perspective === 'client' ? (
              <>
                <span className="text-ink-muted">{agentName}</span>
                {active ? (
                  <Badge tone="verified">Watching prices</Badge>
                ) : completed ? (
                  <Badge tone="verified">Plan complete</Badge>
                ) : (
                  <Badge tone="neutral">Ready for a new plan</Badge>
                )}
              </>
            ) : (
              <span className="font-medium text-ink">{config.section}</span>
            )}
            {me.data?.demoMode ? <Badge tone="info">Demo mode</Badge> : null}
          </div>
          <div className="flex items-center gap-3">
            {me.isError ? <Badge tone="destructive">API unreachable</Badge> : null}
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cobalt-soft text-[11.5px] font-semibold text-cobalt">
                {initials || '··'}
              </span>
              <span className="hidden text-[13px] font-medium sm:inline">{identity}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-4 sm:px-5 md:px-6 md:py-5">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
