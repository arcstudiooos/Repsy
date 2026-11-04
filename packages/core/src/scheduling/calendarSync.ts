/**
 * PRD K10 / L7: two-way Google and Outlook calendar sync for K10 bookings.
 *
 * This slice ships the port and a fake provider only. No Google or Outlook
 * OAuth, SDK, key, or network call exists anywhere in this file. A real
 * provider is a documented follow-up (see SLICE_REPORT_SCHEDULING.md): it
 * implements `CalendarSyncPort`, stores provider tokens per workspace through
 * the secure connection flow, and replaces `FakeCalendarSync` at the call
 * site. The one-way ICS feed (L7, already built in calendar/feed.ts) is
 * untouched and remains the read-only calendar route until real sync lands.
 */
export type CalendarProvider = 'google' | 'outlook' | 'fake';

export interface ExternalCalendarEvent {
  /** Provider-side id, when the event already exists there. */
  externalId?: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** IANA zone the booking was made in, so the provider shows the right local time. */
  timeZone: string;
  /** Zoom/Meet link (H15), carried as the event location when present. */
  location: string | null;
  description: string;
}

export interface CalendarSyncPort {
  readonly provider: CalendarProvider;
  pushEvent(event: ExternalCalendarEvent): Promise<{ externalId: string }>;
  updateEvent(externalId: string, event: ExternalCalendarEvent): Promise<void>;
  deleteEvent(externalId: string): Promise<void>;
}

export interface BookingForSync {
  id: string;
  sessionTypeName: string;
  clientName: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  callLink: string | null;
  externalCalendarId?: string | null;
}

/** Pure: a booking as the calendar event a provider would receive. No client content beyond the name. */
export function bookingToExternalEvent(booking: BookingForSync): ExternalCalendarEvent {
  return {
    externalId: booking.externalCalendarId ?? undefined,
    title: `${booking.sessionTypeName} with ${booking.clientName}`,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    timeZone: booking.timeZone,
    location: booking.callLink,
    description: `Coaching session (${booking.sessionTypeName}).${booking.callLink ? ` Join: ${booking.callLink}` : ''}`,
  };
}

/**
 * In-memory fake provider for tests and for development before OAuth exists.
 * It records every call so a test can assert a booking was pushed, updated,
 * or deleted without any provider account.
 */
export class FakeCalendarSync implements CalendarSyncPort {
  readonly provider: CalendarProvider = 'fake';
  readonly events = new Map<string, ExternalCalendarEvent>();
  readonly calls: { action: 'push' | 'update' | 'delete'; externalId: string }[] = [];
  private next = 1;

  async pushEvent(event: ExternalCalendarEvent): Promise<{ externalId: string }> {
    const externalId = `fake-${this.next++}`;
    this.events.set(externalId, event);
    this.calls.push({ action: 'push', externalId });
    return { externalId };
  }

  async updateEvent(externalId: string, event: ExternalCalendarEvent): Promise<void> {
    if (!this.events.has(externalId))
      throw new Error(`FakeCalendarSync: unknown event ${externalId}`);
    this.events.set(externalId, event);
    this.calls.push({ action: 'update', externalId });
  }

  async deleteEvent(externalId: string): Promise<void> {
    this.events.delete(externalId);
    this.calls.push({ action: 'delete', externalId });
  }
}

/**
 * Pushes a booking to the provider (create, or update when it was already
 * pushed) and hands the provider id back through `saveExternalId`, so the
 * caller — not this module — owns persistence. Returns the provider id, or
 * null when the booking has no usable start/end.
 */
export async function syncBookingToCalendar(
  port: CalendarSyncPort,
  booking: BookingForSync,
  saveExternalId: (externalId: string) => Promise<void> | void,
): Promise<string | null> {
  if (booking.endsAt <= booking.startsAt) return null;
  const event = bookingToExternalEvent(booking);
  if (booking.externalCalendarId) {
    await port.updateEvent(booking.externalCalendarId, event);
    return booking.externalCalendarId;
  }
  const { externalId } = await port.pushEvent(event);
  await saveExternalId(externalId);
  return externalId;
}

/** Removes a pushed booking from the provider. A missing provider id is a no-op. */
export async function removeBookingFromCalendar(
  port: CalendarSyncPort,
  externalCalendarId: string | null | undefined,
): Promise<boolean> {
  if (!externalCalendarId) return false;
  await port.deleteEvent(externalCalendarId);
  return true;
}
