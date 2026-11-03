import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * D-013 #11: two-way calendar sync for coaches. Bookings are pushed to the coach's calendar as events; busy
 * intervals are read back (start and end only, never titles or attendees) to hide clashing slots. Real adapters
 * call Google Calendar and Microsoft Graph with `fetch` and switch on only with their client ids; the fake is for
 * development and tests. Tokens are stored sealed (AES-256-GCM) by the caller.
 */
export type CalendarProvider = 'google' | 'outlook' | 'fake';

export interface CalendarTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
}

export interface CalendarEventInput {
  title: string;
  start: Date;
  end: Date;
  description: string;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export class CalendarAuthError extends Error {
  constructor(message = 'The calendar connection was refused; reconnect it.') {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

export interface CalendarSyncPort {
  readonly provider: CalendarProvider;
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(
    code: string,
    redirectUri: string,
    now: Date,
  ): Promise<{ tokens: CalendarTokens; email: string | null }>;
  /** Returns fresh tokens (refreshing when within a minute of expiry), or the same ones. */
  fresh(tokens: CalendarTokens, now: Date): Promise<CalendarTokens>;
  /** Creates the event, or updates it when `ref` is given; returns its id. */
  upsertEvent(
    tokens: CalendarTokens,
    calendarId: string,
    ref: string | null,
    e: CalendarEventInput,
  ): Promise<string>;
  deleteEvent(tokens: CalendarTokens, calendarId: string, ref: string): Promise<void>;
  busy(tokens: CalendarTokens, calendarId: string, from: Date, to: Date): Promise<BusyInterval[]>;
}

type Fetch = typeof fetch;

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401 || res.status === 403) throw new CalendarAuthError();
  if (!res.ok) throw new Error(`Calendar provider error (${res.status})`);
  return (res.status === 204 ? {} : await res.json()) as T;
}

async function tokenRequest(
  f: Fetch,
  url: string,
  body: Record<string, string>,
  now: Date,
  previousRefresh: string | null,
): Promise<CalendarTokens> {
  const res = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  if (res.status === 400 || res.status === 401) throw new CalendarAuthError();
  const t = await json<{ access_token?: string; refresh_token?: string; expires_in?: number }>(res);
  if (!t.access_token) throw new CalendarAuthError();
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? previousRefresh,
    expiresAt: now.getTime() + (t.expires_in ?? 3600) * 1000,
  };
}

const needsRefresh = (t: CalendarTokens, now: Date) => t.expiresAt - 60_000 <= now.getTime();

// ---------------------------------------------------------------- Google Calendar

export class GoogleCalendar implements CalendarSyncPort {
  readonly provider = 'google' as const;
  constructor(
    private readonly config: { clientId: string; clientSecret: string },
    private readonly f: Fetch = fetch,
  ) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: [
        'https://www.googleapis.com/auth/calendar.events.owned',
        'https://www.googleapis.com/auth/calendar.freebusy',
        'openid',
        'email',
      ].join(' '),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string, now: Date) {
    const res = await this.f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!res.ok) throw new CalendarAuthError();
    const t = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
    };
    if (!t.access_token) throw new CalendarAuthError();
    // The id token's email claim, for display only (the token came straight from Google over TLS).
    let email: string | null = null;
    const payload = t.id_token?.split('.')[1];
    if (payload) {
      try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
          email?: unknown;
        };
        email = typeof claims.email === 'string' ? claims.email.slice(0, 254) : null;
      } catch {
        email = null;
      }
    }
    return {
      tokens: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? null,
        expiresAt: now.getTime() + (t.expires_in ?? 3600) * 1000,
      },
      email,
    };
  }

  fresh(tokens: CalendarTokens, now: Date): Promise<CalendarTokens> {
    if (!needsRefresh(tokens, now)) return Promise.resolve(tokens);
    if (!tokens.refreshToken) throw new CalendarAuthError();
    return tokenRequest(
      this.f,
      'https://oauth2.googleapis.com/token',
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      },
      now,
      tokens.refreshToken,
    );
  }

  async upsertEvent(t: CalendarTokens, cal: string, ref: string | null, e: CalendarEventInput) {
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`;
    const res = await this.f(ref ? `${base}/${encodeURIComponent(ref)}` : base, {
      method: ref ? 'PATCH' : 'POST',
      headers: { authorization: `Bearer ${t.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: e.title,
        description: e.description,
        start: { dateTime: e.start.toISOString() },
        end: { dateTime: e.end.toISOString() },
        // Repsy owns this event: no invitations go out from the coach's calendar.
        guestsCanInviteOthers: false,
        transparency: 'opaque',
      }),
    });
    return String((await json<{ id: string }>(res)).id);
  }

  async deleteEvent(t: CalendarTokens, cal: string, ref: string) {
    const res = await this.f(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events/${encodeURIComponent(ref)}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${t.accessToken}` } },
    );
    // Already gone is done.
    if (res.status === 404 || res.status === 410) return;
    await json(res);
  }

  async busy(t: CalendarTokens, cal: string, from: Date, to: Date) {
    const res = await this.f('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { authorization: `Bearer ${t.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: cal }],
      }),
    });
    const body = await json<{
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    }>(res);
    return toIntervals(body.calendars?.[cal]?.busy ?? []);
  }
}

// ---------------------------------------------------------------- Microsoft Graph (Outlook)

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';

export class OutlookCalendar implements CalendarSyncPort {
  readonly provider = 'outlook' as const;
  constructor(
    private readonly config: { clientId: string; clientSecret: string },
    private readonly f: Fetch = fetch,
  ) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: 'offline_access Calendars.ReadWrite User.Read',
      state,
    });
    return `${MS_AUTH}/authorize?${q.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string, now: Date) {
    const tokens = await tokenRequest(
      this.f,
      `${MS_AUTH}/token`,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      },
      now,
      null,
    );
    let email: string | null = null;
    const me = await this.f(`${GRAPH}/me?$select=mail,userPrincipalName`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (me.ok) {
      const m = (await me.json()) as { mail?: string; userPrincipalName?: string };
      email = (m.mail ?? m.userPrincipalName ?? null)?.slice(0, 254) ?? null;
    }
    return { tokens, email };
  }

  fresh(tokens: CalendarTokens, now: Date): Promise<CalendarTokens> {
    if (!needsRefresh(tokens, now)) return Promise.resolve(tokens);
    if (!tokens.refreshToken) throw new CalendarAuthError();
    return tokenRequest(
      this.f,
      `${MS_AUTH}/token`,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
        scope: 'offline_access Calendars.ReadWrite User.Read',
      },
      now,
      tokens.refreshToken,
    );
  }

  private events(cal: string) {
    return cal === 'primary'
      ? `${GRAPH}/me/events`
      : `${GRAPH}/me/calendars/${encodeURIComponent(cal)}/events`;
  }

  async upsertEvent(t: CalendarTokens, cal: string, ref: string | null, e: CalendarEventInput) {
    const res = await this.f(
      ref ? `${GRAPH}/me/events/${encodeURIComponent(ref)}` : this.events(cal),
      {
        method: ref ? 'PATCH' : 'POST',
        headers: { authorization: `Bearer ${t.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: e.title,
          body: { contentType: 'text', content: e.description },
          start: { dateTime: e.start.toISOString().slice(0, 19), timeZone: 'UTC' },
          end: { dateTime: e.end.toISOString().slice(0, 19), timeZone: 'UTC' },
          showAs: 'busy',
          isReminderOn: false,
        }),
      },
    );
    return String((await json<{ id: string }>(res)).id);
  }

  async deleteEvent(t: CalendarTokens, _cal: string, ref: string) {
    const res = await this.f(`${GRAPH}/me/events/${encodeURIComponent(ref)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${t.accessToken}` },
    });
    if (res.status === 404) return;
    await json(res);
  }

  async busy(t: CalendarTokens, _cal: string, from: Date, to: Date) {
    // Start, end and free/busy only: no subjects, bodies or attendees are requested.
    const q = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: 'start,end,showAs,isCancelled',
      $top: '500',
    });
    const res = await this.f(`${GRAPH}/me/calendarView?${q.toString()}`, {
      headers: { authorization: `Bearer ${t.accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    });
    const body = await json<{
      value?: {
        start?: { dateTime: string };
        end?: { dateTime: string };
        showAs?: string;
        isCancelled?: boolean;
      }[];
    }>(res);
    return toIntervals(
      (body.value ?? [])
        .filter((v) => !v.isCancelled && v.showAs !== 'free' && v.start && v.end)
        .map((v) => ({ start: `${v.start!.dateTime}Z`, end: `${v.end!.dateTime}Z` })),
    );
  }
}

function toIntervals(rows: { start: string; end: string }[]): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const r of rows.slice(0, 2000)) {
    const start = new Date(r.start.replace(/Z+$/, 'Z'));
    const end = new Date(r.end.replace(/Z+$/, 'Z'));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) continue;
    out.push({ start, end });
  }
  return out;
}

// ---------------------------------------------------------------- fake (development and tests)

export class FakeCalendar implements CalendarSyncPort {
  readonly provider = 'fake' as const;
  readonly events = new Map<string, CalendarEventInput>();
  busyIntervals: BusyInterval[] = [];
  private n = 0;
  constructor(private readonly appBaseUrl = 'http://localhost:3000') {}

  authorizeUrl(state: string): string {
    return `${this.appBaseUrl}/api/v1/calendar/connect/fake/callback?code=fake&state=${encodeURIComponent(state)}`;
  }
  exchangeCode(_code: string, _redirect: string, now: Date) {
    return Promise.resolve({
      tokens: { accessToken: 'fake', refreshToken: 'fake', expiresAt: now.getTime() + 3_600_000 },
      email: 'calendar@example.test',
    });
  }
  fresh(tokens: CalendarTokens) {
    return Promise.resolve(tokens);
  }
  upsertEvent(_t: CalendarTokens, _cal: string, ref: string | null, e: CalendarEventInput) {
    const id = ref ?? `evt_fake_${++this.n}`;
    this.events.set(id, e);
    return Promise.resolve(id);
  }
  deleteEvent(_t: CalendarTokens, _cal: string, ref: string) {
    this.events.delete(ref);
    return Promise.resolve();
  }
  busy(_t: CalendarTokens, _cal: string, from: Date, to: Date) {
    return Promise.resolve(this.busyIntervals.filter((b) => b.start < to && b.end > from));
  }
}

// ---------------------------------------------------------------- OAuth state

/** HMAC-signed `state` binding the user, workspace and provider for 15 minutes (as payments connect does). */
export function signCalendarState(
  secret: string,
  userId: string,
  orgId: string,
  provider: string,
  now: number,
): string {
  const body = `${userId}.${orgId}.${provider}.${now}`;
  const mac = createHmac('sha256', secret).update(`calendar-connect:${body}`).digest('base64url');
  return `${Buffer.from(body).toString('base64url')}.${mac}`;
}

export function verifyCalendarState(
  secret: string,
  state: string,
  userId: string,
  orgId: string,
  provider: string,
  now: number,
): boolean {
  const [b64, mac] = state.split('.');
  if (!b64 || !mac) return false;
  const body = Buffer.from(b64, 'base64url').toString('utf8');
  const want = createHmac('sha256', secret).update(`calendar-connect:${body}`).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  const [u, o, p, t] = body.split('.');
  const issued = Number(t);
  return (
    u === userId &&
    o === orgId &&
    p === provider &&
    Number.isFinite(issued) &&
    now - issued >= 0 &&
    now - issued <= 15 * 60_000
  );
}

// ---------------------------------------------------------------- configuration

/**
 * Which calendar providers this deployment offers, from its environment: Google and Outlook with their OAuth
 * clients, the fake only outside production with FAKE_CALENDAR=on. Shared by the web app (connect) and the worker
 * (sync), so both see the same set.
 */
export function calendarPorts(
  env: Record<string, string | undefined>,
  appBaseUrl: string,
  f: typeof fetch = fetch,
): Partial<Record<CalendarProvider, CalendarSyncPort>> {
  const v = (k: string) => env[k]?.trim() || undefined;
  const out: Partial<Record<CalendarProvider, CalendarSyncPort>> = {};
  const g = [v('GOOGLE_CALENDAR_CLIENT_ID'), v('GOOGLE_CALENDAR_CLIENT_SECRET')];
  if (g[0] && g[1]) out.google = new GoogleCalendar({ clientId: g[0], clientSecret: g[1] }, f);
  const m = [v('MS_CALENDAR_CLIENT_ID'), v('MS_CALENDAR_CLIENT_SECRET')];
  if (m[0] && m[1]) out.outlook = new OutlookCalendar({ clientId: m[0], clientSecret: m[1] }, f);
  if (env.NODE_ENV !== 'production' && v('FAKE_CALENDAR') === 'on')
    out.fake = sharedFake(appBaseUrl);
  return out;
}

let fakeSingleton: FakeCalendar | undefined;
/** One fake per process, so development sees the events it pushed. */
function sharedFake(appBaseUrl: string): FakeCalendar {
  fakeSingleton ??= new FakeCalendar(appBaseUrl);
  return fakeSingleton;
}
