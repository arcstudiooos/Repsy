import type {
  CalendarProvider,
  CalendarSyncPort,
  ExternalCalendarEvent,
} from '../scheduling/calendarSync';

/**
 * PRD K10: the Google Calendar adapter (OAuth 2.0 + Calendar API v3 over HTTPS). `fetchImpl` is
 * injectable so tests never touch the network.
 */
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Fetch = typeof fetch;

/** Google answered with an error. `revoked` means the coach must connect again. */
export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly revoked = false,
  ) {
    super(message);
  }
}

export function googleOAuthConfig(
  env: Record<string, string | undefined> = process.env,
): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const base = env.APP_BASE_URL || env.BETTER_AUTH_URL;
  if (!clientId || !clientSecret || !base) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${base.replace(/\/$/, '')}/api/v1/calendar/google/callback`,
  };
}

/** The consent-screen URL. `access_type=offline` + `prompt=consent` always returns a refresh token. */
export function googleConsentUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
}

async function tokenRequest(
  body: Record<string, string>,
  fetchImpl: Fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    const revoked = json.error === 'invalid_grant';
    throw new GoogleCalendarError(
      revoked ? 'Google access was revoked. Connect the calendar again.' : 'Google sign-in failed.',
      res.status,
      revoked,
    );
  }
  return {
    access_token: json.access_token,
    refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
  };
}

/** Swaps the consent code for tokens, and reads the Google account's email. */
export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: Fetch = fetch,
): Promise<{ refreshToken: string; accessToken: string; email: string }> {
  const tokens = await tokenRequest(
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    },
    fetchImpl,
  );
  if (!tokens.refresh_token) {
    throw new GoogleCalendarError(
      'Google did not grant offline access. Try connecting again.',
      400,
    );
  }
  const info = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = (await info.json().catch(() => ({}))) as { email?: unknown };
  if (!info.ok || typeof profile.email !== 'string') {
    throw new GoogleCalendarError('Could not read the Google account email.', info.status);
  }
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    email: profile.email,
  };
}

export async function refreshGoogleAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  const tokens = await tokenRequest(
    {
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    },
    fetchImpl,
  );
  return tokens.access_token;
}

/** Best effort: tells Google to drop the grant when a coach disconnects. */
export async function revokeGoogleToken(
  refreshToken: string,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  await fetchImpl('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }).toString(),
  }).catch(() => undefined);
}

const toGoogleEvent = (event: ExternalCalendarEvent) => ({
  summary: event.title,
  description: event.description,
  ...(event.location ? { location: event.location } : {}),
  start: { dateTime: event.startsAt.toISOString(), timeZone: event.timeZone },
  end: { dateTime: event.endsAt.toISOString(), timeZone: event.timeZone },
});

/** `CalendarSyncPort` for one connected Google calendar, using a fresh access token. */
export class GoogleCalendarSync implements CalendarSyncPort {
  readonly provider: CalendarProvider = 'google';

  constructor(
    private readonly accessToken: string,
    private readonly calendarId = 'primary',
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${GOOGLE_CALENDAR_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return {};
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new GoogleCalendarError(
        `Google Calendar returned ${res.status}.`,
        res.status,
        res.status === 401,
      );
    }
    return json;
  }

  private events() {
    return `/calendars/${encodeURIComponent(this.calendarId)}/events`;
  }

  async pushEvent(event: ExternalCalendarEvent): Promise<{ externalId: string }> {
    const json = await this.call('POST', this.events(), toGoogleEvent(event));
    if (typeof json.id !== 'string') {
      throw new GoogleCalendarError('Google returned no event id.', 502);
    }
    return { externalId: json.id };
  }

  async updateEvent(externalId: string, event: ExternalCalendarEvent): Promise<void> {
    await this.call(
      'PATCH',
      `${this.events()}/${encodeURIComponent(externalId)}`,
      toGoogleEvent(event),
    );
  }

  async deleteEvent(externalId: string): Promise<void> {
    try {
      await this.call('DELETE', `${this.events()}/${encodeURIComponent(externalId)}`);
    } catch (err) {
      // Already gone in Google (404/410): nothing left to remove.
      if (err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410)) return;
      throw err;
    }
  }

  /** Busy blocks in [timeMin, timeMax): the two-way half of K10. */
  async busy(timeMin: Date, timeMax: Date): Promise<{ startsAt: Date; endsAt: Date }[]> {
    const json = await this.call('POST', '/freeBusy', {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: this.calendarId }],
    });
    const calendars = (json.calendars ?? {}) as Record<
      string,
      { busy?: { start: string; end: string }[] }
    >;
    return (calendars[this.calendarId]?.busy ?? []).map((b) => ({
      startsAt: new Date(b.start),
      endsAt: new Date(b.end),
    }));
  }
}
