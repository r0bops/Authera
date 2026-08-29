import type {
  ApprovalState,
  ExecutionState,
  MandateState,
  PaymentState,
  ReservationState,
} from '@authera/contracts';

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: illegal transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export const MANDATE_TRANSITIONS: TransitionTable<MandateState> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['REVOKED', 'EXPIRED', 'SUPERSEDED'],
  REVOKED: [],
  EXPIRED: [],
  SUPERSEDED: [],
};

export const EXECUTION_TRANSITIONS: TransitionTable<ExecutionState> = {
  RECEIVED: ['AUTHENTICATED', 'BLOCKED'],
  AUTHENTICATED: ['EVALUATED', 'BLOCKED'],
  EVALUATED: ['BLOCKED', 'REQUIRES_HUMAN', 'RESERVED'],
  RESERVED: ['PAYMENT_PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
  PAYMENT_PENDING: ['SUCCEEDED', 'FAILED'],
  REQUIRES_HUMAN: ['CANCELLED'],
  BLOCKED: [],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
};

export const RESERVATION_TRANSITIONS: TransitionTable<ReservationState> = {
  RESERVED: ['CONSUMED', 'RELEASED'],
  CONSUMED: [],
  RELEASED: [],
};

export const APPROVAL_TRANSITIONS: TransitionTable<ApprovalState> = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: ['CONSUMED', 'REVOKED'],
  CONSUMED: [],
  REJECTED: [],
  EXPIRED: [],
  REVOKED: [],
};

export const PAYMENT_TRANSITIONS: TransitionTable<PaymentState> = {
  CREATED: ['PENDING', 'SUCCEEDED', 'FAILED'],
  PENDING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
};

export interface Machine<S extends string> {
  readonly name: string;
  readonly table: TransitionTable<S>;
}

export const mandateMachine: Machine<MandateState> = {
  name: 'mandate',
  table: MANDATE_TRANSITIONS,
};
export const executionMachine: Machine<ExecutionState> = {
  name: 'execution',
  table: EXECUTION_TRANSITIONS,
};
export const reservationMachine: Machine<ReservationState> = {
  name: 'reservation',
  table: RESERVATION_TRANSITIONS,
};
export const approvalMachine: Machine<ApprovalState> = {
  name: 'approval',
  table: APPROVAL_TRANSITIONS,
};
export const paymentMachine: Machine<PaymentState> = {
  name: 'payment',
  table: PAYMENT_TRANSITIONS,
};

export function canTransition<S extends string>(machine: Machine<S>, from: S, to: S): boolean {
  const targets = machine.table[from];
  return targets !== undefined && targets.includes(to);
}

export function isTerminal<S extends string>(machine: Machine<S>, state: S): boolean {
  const targets = machine.table[state];
  return targets !== undefined && targets.length === 0;
}

/** Returns `to` when legal; throws otherwise. */
export function transition<S extends string>(machine: Machine<S>, from: S, to: S): S {
  if (!canTransition(machine, from, to)) throw new IllegalTransitionError(machine.name, from, to);
  return to;
}

export type TransitionResult<S> =
  | { changed: true; state: S }
  | { changed: false; state: S; reason: 'already-in-state' | 'illegal' };

/**
 * Idempotent transition: re-applying a transition whose target is already the current state
 * is a no-op, not an error. Any other illegal move is reported, never applied.
 */
export function transitionIdempotent<S extends string>(
  machine: Machine<S>,
  from: S,
  to: S,
): TransitionResult<S> {
  if (from === to) return { changed: false, state: from, reason: 'already-in-state' };
  if (!canTransition(machine, from, to)) return { changed: false, state: from, reason: 'illegal' };
  return { changed: true, state: to };
}

export interface RuntimeCounters {
  reservedMinor: number;
  consumedMinor: number;
  reservedCount: number;
  consumedCount: number;
}

export interface ReservationView {
  state: ReservationState;
  amountMinor: number;
}

export type SettlementOutcome = 'consume' | 'release';

export interface Settlement {
  counters: RuntimeCounters;
  reservation: ReservationView;
  applied: boolean;
}

/**
 * Pure settlement of a reservation against runtime counters (spec §10 "Reservation settlement").
 * Only a RESERVED reservation changes anything; repeating the call is a no-op, so counters move
 * exactly once no matter how many times a payment result is delivered.
 */
export function settleReservation(
  counters: RuntimeCounters,
  reservation: ReservationView,
  outcome: SettlementOutcome,
): Settlement {
  if (reservation.state !== 'RESERVED') {
    return { counters, reservation, applied: false };
  }
  const amount = reservation.amountMinor;
  if (counters.reservedMinor < amount || counters.reservedCount < 1) {
    throw new IllegalTransitionError('reservation', reservation.state, outcome.toUpperCase());
  }
  const next: RuntimeCounters = {
    reservedMinor: counters.reservedMinor - amount,
    reservedCount: counters.reservedCount - 1,
    consumedMinor: outcome === 'consume' ? counters.consumedMinor + amount : counters.consumedMinor,
    consumedCount: outcome === 'consume' ? counters.consumedCount + 1 : counters.consumedCount,
  };
  const state: ReservationState = outcome === 'consume' ? 'CONSUMED' : 'RELEASED';
  return { counters: next, reservation: { state, amountMinor: amount }, applied: true };
}
