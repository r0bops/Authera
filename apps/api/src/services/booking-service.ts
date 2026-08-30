import { z } from 'zod';
import type { BookingView } from '@authera/contracts';
import {
  appendAuditEvent,
  confirmBooking,
  createBooking,
  failBooking,
  getBookingByExecution,
  getTravelerProfileByUser,
  type BookingRow,
  type Database,
} from '@authera/db';
import type { Logger } from '../logger.js';
import type { ReservedExecution } from './gateway.js';
import { DuffelOrderError } from './flight-market/duffel-provider.js';
import type {
  DuffelFlightMarketProvider,
  DuffelTraveler,
} from './flight-market/duffel-provider.js';

const TravelerSchema = z.strictObject({
  givenName: z.string().trim().min(1).max(40),
  familyName: z.string().trim().min(1).max(40),
  bornOn: z.iso.date(),
  gender: z.enum(['m', 'f']),
  title: z.enum(['mr', 'ms', 'mrs', 'miss', 'dr']),
  email: z.email(),
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
});

export type BookingOutcome =
  | { state: 'NOT_REQUIRED' }
  | { state: 'BOOKED'; bookingId: string }
  | { state: 'PENDING'; bookingId: string; failureReason: string }
  | { state: 'FAILED'; bookingId: string; failureReason: string };

/**
 * Flight fulfillment after mandate reservation and Stripe authorization. The LLM never receives
 * traveler data; the server joins the signed mandate's human id to a stored passenger profile.
 */
export class BookingService {
  constructor(
    private readonly deps: {
      db: Database;
      duffel?: DuffelFlightMarketProvider;
      logger: Logger;
    },
  ) {}

  async fulfill(
    reserved: ReservedExecution,
    stripePaymentIntentId: string,
  ): Promise<BookingOutcome> {
    if (reserved.offerKind !== 'flight' || reserved.offerSource !== 'duffel') {
      return { state: 'NOT_REQUIRED' };
    }
    const existing = await getBookingByExecution(this.deps.db, reserved.executionId);
    if (existing) return outcomeFor(existing);

    const { booking, created } = await this.deps.db.transaction(async (tx) => {
      const result = await createBooking(tx, {
        executionId: reserved.executionId,
        offerId: reserved.offerId,
        provider: 'duffel',
        amountMinor: reserved.amountMinor,
        currency: reserved.currency,
      });
      if (result.created) {
        await appendAuditEvent(tx, {
          eventType: 'BOOKING_REQUESTED',
          actorType: 'SYSTEM',
          mandateId: reserved.mandateId,
          mandateVersion: reserved.mandateVersion,
          executionId: reserved.executionId,
          checkoutId: reserved.checkoutId,
          payload: { provider: 'duffel', offerId: reserved.offerId },
        });
      }
      return result;
    });
    if (!created) return outcomeFor(booking);

    const profile = await getTravelerProfileByUser(this.deps.db, reserved.humanId);
    const parsedTraveler = TravelerSchema.safeParse(
      profile
        ? {
            givenName: profile.givenName,
            familyName: profile.familyName,
            bornOn: profile.bornOn,
            gender: profile.gender,
            title: profile.title,
            email: profile.email,
            phoneNumber: profile.phoneNumber,
          }
        : undefined,
    );
    if (!parsedTraveler.success || !reserved.providerOfferId || !this.deps.duffel) {
      return this.fail(
        reserved,
        booking.id,
        !profile
          ? 'traveler_profile_missing'
          : !reserved.providerOfferId
            ? 'provider_offer_missing'
            : !this.deps.duffel
              ? 'duffel_provider_unavailable'
              : 'traveler_profile_invalid',
      );
    }

    try {
      const order = await this.deps.duffel.createOrder({
        providerOfferId: reserved.providerOfferId,
        executionId: reserved.executionId,
        stripePaymentIntentId,
        amountMinor: reserved.amountMinor,
        currency: reserved.currency,
        traveler: parsedTraveler.data as DuffelTraveler,
      });
      const confirmed = await this.deps.db.transaction(async (tx) => {
        const result = await confirmBooking(tx, {
          executionId: reserved.executionId,
          ...order,
        });
        if (result.changed) {
          await appendAuditEvent(tx, {
            eventType: 'BOOKING_CONFIRMED',
            actorType: 'PROVIDER',
            actorId: 'duffel',
            mandateId: reserved.mandateId,
            mandateVersion: reserved.mandateVersion,
            executionId: reserved.executionId,
            checkoutId: reserved.checkoutId,
            detail: order.bookingReference ?? order.providerOrderId,
            payload: {
              providerOrderId: order.providerOrderId,
              bookingReference: order.bookingReference,
              liveMode: order.liveMode,
              documentCount: order.documents.length,
            },
          });
        }
        return result.booking;
      });
      return { state: 'BOOKED', bookingId: confirmed.id };
    } catch (error) {
      if (error instanceof DuffelOrderError && error.definitive) {
        this.deps.logger.warn(
          { executionId: reserved.executionId, status: error.status, detail: error.message },
          'Duffel rejected the sandbox booking',
        );
        return this.fail(reserved, booking.id, `duffel_${error.status}`);
      }
      const failureReason = error instanceof Error ? error.name : 'unknown_error';
      this.deps.logger.error(
        { err: error, executionId: reserved.executionId },
        'Duffel booking outcome is ambiguous; reconciliation required',
      );
      await this.deps.db.transaction((tx) =>
        appendAuditEvent(tx, {
          eventType: 'BOOKING_PENDING',
          actorType: 'SYSTEM',
          mandateId: reserved.mandateId,
          mandateVersion: reserved.mandateVersion,
          executionId: reserved.executionId,
          checkoutId: reserved.checkoutId,
          detail: failureReason,
          payload: { provider: 'duffel', reconciliationRequired: true },
        }),
      );
      return { state: 'PENDING', bookingId: booking.id, failureReason };
    }
  }

  private async fail(
    reserved: ReservedExecution,
    bookingId: string,
    failureReason: string,
  ): Promise<BookingOutcome> {
    await this.deps.db.transaction(async (tx) => {
      const result = await failBooking(tx, { executionId: reserved.executionId, failureReason });
      if (result.changed) {
        await appendAuditEvent(tx, {
          eventType: 'BOOKING_FAILED',
          actorType: 'PROVIDER',
          actorId: 'duffel',
          mandateId: reserved.mandateId,
          mandateVersion: reserved.mandateVersion,
          executionId: reserved.executionId,
          checkoutId: reserved.checkoutId,
          detail: failureReason,
          payload: { provider: 'duffel', failureReason },
        });
      }
    });
    return { state: 'FAILED', bookingId, failureReason };
  }
}

function outcomeFor(booking: BookingRow): BookingOutcome {
  switch (booking.state) {
    case 'BOOKED':
      return { state: 'BOOKED', bookingId: booking.id };
    case 'FAILED':
      return {
        state: 'FAILED',
        bookingId: booking.id,
        failureReason: booking.failureReason ?? 'booking_failed',
      };
    default:
      return {
        state: 'PENDING',
        bookingId: booking.id,
        failureReason: 'reconciliation_required',
      };
  }
}

export function toBookingView(row: BookingRow): BookingView {
  return {
    id: row.id,
    provider: 'duffel',
    state: row.state as BookingView['state'],
    providerOrderId: row.providerOrderId,
    bookingReference: row.bookingReference,
    liveMode: row.liveMode,
    documents: row.documents,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
