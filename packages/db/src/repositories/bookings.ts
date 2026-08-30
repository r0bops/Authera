import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { BookingState } from '@authera/contracts';
import { isUniqueViolation, type DbExecutor } from '../client.js';
import { bookings, travelerProfiles } from '../schema.js';

export type BookingRow = typeof bookings.$inferSelect;
export type TravelerProfileRow = typeof travelerProfiles.$inferSelect;

export async function getTravelerProfileByUser(
  db: DbExecutor,
  userId: string,
): Promise<TravelerProfileRow | undefined> {
  const [row] = await db.select().from(travelerProfiles).where(eq(travelerProfiles.userId, userId));
  return row;
}

export async function getBookingByExecution(
  db: DbExecutor,
  executionId: string,
): Promise<BookingRow | undefined> {
  const [row] = await db.select().from(bookings).where(eq(bookings.executionId, executionId));
  return row;
}

export async function createBooking(
  db: DbExecutor,
  input: {
    executionId: string;
    offerId: string;
    provider: 'duffel';
    amountMinor: number;
    currency: string;
  },
): Promise<{ booking: BookingRow; created: boolean }> {
  try {
    const [row] = await db
      .insert(bookings)
      .values({ id: randomUUID(), ...input, state: 'PENDING', documents: [] })
      .returning();
    if (!row) throw new Error('booking insert returned no row');
    return { booking: row, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await getBookingByExecution(db, input.executionId);
    if (!existing) throw error;
    return { booking: existing, created: false };
  }
}

export async function confirmBooking(
  db: DbExecutor,
  input: {
    executionId: string;
    providerOrderId: string;
    bookingReference: string | null;
    liveMode: boolean;
    documents: Array<{ type: string; uniqueIdentifier: string | null }>;
  },
): Promise<{ booking: BookingRow; changed: boolean }> {
  const current = await getBookingByExecution(db, input.executionId);
  if (!current) throw new Error(`booking for execution ${input.executionId} not found`);
  if (current.state === 'BOOKED') return { booking: current, changed: false };
  if (current.state !== 'PENDING') throw new Error(`booking is terminal: ${current.state}`);
  const [row] = await db
    .update(bookings)
    .set({
      providerOrderId: input.providerOrderId,
      bookingReference: input.bookingReference,
      liveMode: input.liveMode,
      documents: input.documents,
      state: 'BOOKED',
      failureReason: null,
      updatedAt: sql`now()`,
    })
    .where(eq(bookings.executionId, input.executionId))
    .returning();
  if (!row) throw new Error('booking confirmation returned no row');
  return { booking: row, changed: true };
}

export async function failBooking(
  db: DbExecutor,
  input: { executionId: string; failureReason: string },
): Promise<{ booking: BookingRow; changed: boolean }> {
  const current = await getBookingByExecution(db, input.executionId);
  if (!current) throw new Error(`booking for execution ${input.executionId} not found`);
  if (current.state === 'FAILED') return { booking: current, changed: false };
  if (current.state !== 'PENDING') throw new Error(`booking is terminal: ${current.state}`);
  const [row] = await db
    .update(bookings)
    .set({ state: 'FAILED', failureReason: input.failureReason, updatedAt: sql`now()` })
    .where(eq(bookings.executionId, input.executionId))
    .returning();
  if (!row) throw new Error('booking failure returned no row');
  return { booking: row, changed: true };
}

export function bookingState(row: BookingRow): BookingState {
  return row.state as BookingState;
}
