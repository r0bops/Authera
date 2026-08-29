import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  approvalMachine,
  canTransition,
  executionMachine,
  IllegalTransitionError,
  isTerminal,
  mandateMachine,
  paymentMachine,
  reservationMachine,
  settleReservation,
  transition,
  transitionIdempotent,
  type ReservationView,
  type RuntimeCounters,
} from './index.js';

describe('state machines', () => {
  it('mandate: DRAFT -> ACTIVE -> terminal, never back to ACTIVE', () => {
    expect(transition(mandateMachine, 'DRAFT', 'ACTIVE')).toBe('ACTIVE');
    for (const terminal of ['REVOKED', 'EXPIRED', 'SUPERSEDED'] as const) {
      expect(transition(mandateMachine, 'ACTIVE', terminal)).toBe(terminal);
      expect(isTerminal(mandateMachine, terminal)).toBe(true);
      expect(canTransition(mandateMachine, terminal, 'ACTIVE')).toBe(false);
    }
    expect(() => transition(mandateMachine, 'DRAFT', 'REVOKED')).toThrow(IllegalTransitionError);
  });

  it('execution: only declared transitions are legal', () => {
    expect(transition(executionMachine, 'RECEIVED', 'AUTHENTICATED')).toBe('AUTHENTICATED');
    expect(transition(executionMachine, 'AUTHENTICATED', 'EVALUATED')).toBe('EVALUATED');
    expect(transition(executionMachine, 'EVALUATED', 'RESERVED')).toBe('RESERVED');
    expect(transition(executionMachine, 'RESERVED', 'PAYMENT_PENDING')).toBe('PAYMENT_PENDING');
    expect(transition(executionMachine, 'PAYMENT_PENDING', 'SUCCEEDED')).toBe('SUCCEEDED');
    expect(() => transition(executionMachine, 'RECEIVED', 'RESERVED')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition(executionMachine, 'BLOCKED', 'RESERVED')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition(executionMachine, 'SUCCEEDED', 'FAILED')).toThrow(
      IllegalTransitionError,
    );
    expect(canTransition(executionMachine, 'REQUIRES_HUMAN', 'RESERVED')).toBe(false);
  });

  it('approval binds to a single terminal decision', () => {
    expect(transition(approvalMachine, 'PENDING', 'APPROVED')).toBe('APPROVED');
    expect(transition(approvalMachine, 'APPROVED', 'CONSUMED')).toBe('CONSUMED');
    expect(() => transition(approvalMachine, 'REJECTED', 'APPROVED')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition(approvalMachine, 'CONSUMED', 'APPROVED')).toThrow(
      IllegalTransitionError,
    );
  });

  it('payment never moves backward', () => {
    expect(transition(paymentMachine, 'CREATED', 'PENDING')).toBe('PENDING');
    expect(transition(paymentMachine, 'PENDING', 'FAILED')).toBe('FAILED');
    expect(() => transition(paymentMachine, 'SUCCEEDED', 'PENDING')).toThrow(
      IllegalTransitionError,
    );
    expect(() => transition(paymentMachine, 'FAILED', 'SUCCEEDED')).toThrow(IllegalTransitionError);
  });

  it('idempotent transition treats re-application as a no-op and refuses illegal moves', () => {
    expect(transitionIdempotent(reservationMachine, 'CONSUMED', 'CONSUMED')).toEqual({
      changed: false,
      state: 'CONSUMED',
      reason: 'already-in-state',
    });
    expect(transitionIdempotent(reservationMachine, 'RESERVED', 'CONSUMED')).toEqual({
      changed: true,
      state: 'CONSUMED',
    });
    expect(transitionIdempotent(reservationMachine, 'RELEASED', 'CONSUMED')).toEqual({
      changed: false,
      state: 'RELEASED',
      reason: 'illegal',
    });
  });
});

describe('settleReservation', () => {
  const counters: RuntimeCounters = {
    reservedMinor: 13_000,
    consumedMinor: 0,
    reservedCount: 1,
    consumedCount: 0,
  };

  it('consume moves the reservation into consumed counters once', () => {
    const first = settleReservation(
      counters,
      { state: 'RESERVED', amountMinor: 13_000 },
      'consume',
    );
    expect(first.applied).toBe(true);
    expect(first.counters).toEqual({
      reservedMinor: 0,
      consumedMinor: 13_000,
      reservedCount: 0,
      consumedCount: 1,
    });
    const again = settleReservation(first.counters, first.reservation, 'consume');
    expect(again.applied).toBe(false);
    expect(again.counters).toEqual(first.counters);
  });

  it('release returns the allowance exactly once', () => {
    const first = settleReservation(
      counters,
      { state: 'RESERVED', amountMinor: 13_000 },
      'release',
    );
    expect(first.counters).toEqual({
      reservedMinor: 0,
      consumedMinor: 0,
      reservedCount: 0,
      consumedCount: 0,
    });
    const again = settleReservation(first.counters, first.reservation, 'release');
    expect(again.applied).toBe(false);
    const flipped = settleReservation(first.counters, first.reservation, 'consume');
    expect(flipped.applied).toBe(false);
  });

  it('refuses to settle more than was reserved', () => {
    expect(() =>
      settleReservation(
        { ...counters, reservedMinor: 100 },
        { state: 'RESERVED', amountMinor: 13_000 },
        'consume',
      ),
    ).toThrow(IllegalTransitionError);
  });

  it('property: repeating consume or release any number of times changes counters once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 20 }),
        fc.constantFrom('consume', 'release' as const),
        fc.integer({ min: 1, max: 6 }),
        (amount, times, outcome, extraReserved) => {
          let state: { counters: RuntimeCounters; reservation: ReservationView } = {
            counters: {
              reservedMinor: amount + extraReserved,
              consumedMinor: 0,
              reservedCount: 2,
              consumedCount: 0,
            },
            reservation: { state: 'RESERVED', amountMinor: amount },
          };
          const after = settleReservation(state.counters, state.reservation, outcome);
          state = { counters: after.counters, reservation: after.reservation };
          for (let i = 0; i < times; i += 1) {
            const repeat = settleReservation(state.counters, state.reservation, outcome);
            if (repeat.applied) return false;
            state = { counters: repeat.counters, reservation: repeat.reservation };
          }
          return (
            state.counters.reservedMinor === extraReserved &&
            state.counters.reservedCount === 1 &&
            state.counters.consumedMinor === (outcome === 'consume' ? amount : 0) &&
            state.counters.consumedCount === (outcome === 'consume' ? 1 : 0)
          );
        },
      ),
    );
  });
});
