import type { ChatSessionState } from '@authera/contracts';
import { Ban, ChevronRight, MessageSquare, Plane, Plus, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useChats } from '../api/hooks.js';
import {
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  buttonStyles,
} from '../components/ui/primitives.js';
import { formatDateTime } from '../lib/format.js';

export function ChatsPage() {
  const chats = useChats();

  return (
    <section className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-surface sm:rounded-lg sm:border sm:border-line sm:shadow-sm">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-2 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink">Chats</h1>
          <p className="text-[12px] text-ink-muted">
            Return to a flight conversation or its record.
          </p>
        </div>
        <Link to="/dashboard" className={buttonStyles({ size: 'sm' })}>
          <Plus className="h-4 w-4" aria-hidden /> New trip
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-ground p-4 sm:p-5">
        {chats.isError ? (
          <ErrorState error={chats.error} retry={() => void chats.refetch()} />
        ) : null}
        {chats.isPending ? <ChatsSkeleton /> : null}
        {chats.data?.length === 0 ? (
          <EmptyState
            title="No saved chats yet"
            action={
              <Link to="/dashboard" className={buttonStyles()}>
                Start a flight chat
              </Link>
            }
          >
            Your conversation will be saved after your first message.
          </EmptyState>
        ) : null}
        {chats.data && chats.data.length > 0 ? (
          <div className="space-y-2" aria-label="Saved flight chats">
            {chats.data.map((chat) => {
              const state = chatState(chat.state, Boolean(chat.mandateId));
              const Icon = state.icon;
              return (
                <Link
                  key={chat.id}
                  to={`/dashboard/chats/${chat.id}`}
                  className="group flex min-h-20 items-center gap-3 rounded-xl border border-line bg-surface p-3 transition-colors motion-reduce:transition-none hover:border-cobalt/30 hover:bg-cobalt-soft/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt sm:p-4"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cobalt-soft text-cobalt">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13.5px] font-semibold text-ink">
                        {chat.title}
                      </span>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">
                      {chat.lastMessage}
                    </span>
                    <span className="mt-1 block text-[11.5px] text-ink-muted">
                      {chat.state === 'BOOKED' || chat.state === 'REVOKED'
                        ? 'Open record'
                        : 'Continue chat'}
                      {' · '}
                      {formatDateTime(chat.updatedAt)}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-ink-muted transition-transform motion-reduce:transform-none motion-reduce:transition-none group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function chatState(state: ChatSessionState, hasMandate: boolean) {
  if (state === 'BOOKED') {
    return { label: 'Booked', tone: 'verified' as const, icon: Plane };
  }
  if (state === 'REVOKED') {
    return { label: 'Revoked', tone: 'neutral' as const, icon: Ban };
  }
  if (hasMandate) {
    return { label: 'Plan active', tone: 'verified' as const, icon: ShieldCheck };
  }
  return { label: 'In progress', tone: 'info' as const, icon: MessageSquare };
}

function ChatsSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading saved chats">
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  );
}
