'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { call } from '@/lib/checkin-api';

const SELECT =
  'block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';
const LABEL = 'block text-sm font-medium';

type Pack = { id: string; name: string; remaining: number; totalSessions: number; status: string };
type Booking = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  callLink: string | null;
};

/** Coach: create a bookable session type (PRD K10). Availability is one weekday window here; the API accepts up to 50. */
export function NewSessionTypeForm() {
  const id = useId();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('call');
  const [duration, setDuration] = useState('60');
  const [weekday, setWeekday] = useState('1');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('12:00');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await call('POST', '/api/v1/scheduling/session-types', {
          name,
          kind,
          durationMinutes: Number(duration),
          location: location || null,
          availability: [{ weekday: Number(weekday), startTime: start, endTime: end }],
        });
        setBusy(false);
        if (!res.ok) setError(res.message);
        else window.location.reload();
      }}
    >
      <div>
        <label className={LABEL} htmlFor={`${id}-name`}>
          Session type name
        </label>
        <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${id}-kind`}>
          Kind
        </label>
        <select
          id={`${id}-kind`}
          className={SELECT}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="call">Call</option>
          <option value="checkin_call">Check-in call</option>
          <option value="in_person">In-person</option>
        </select>
      </div>
      <div>
        <label className={LABEL} htmlFor={`${id}-duration`}>
          Length (minutes)
        </label>
        <Input
          id={`${id}-duration`}
          type="number"
          min={5}
          max={480}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          required
        />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${id}-location`}>
          Location (required for in-person)
        </label>
        <Input
          id={`${id}-location`}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Studio address or room"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <div>
          <label className={LABEL} htmlFor={`${id}-weekday`}>
            Weekday
          </label>
          <select
            id={`${id}-weekday`}
            className={SELECT}
            value={weekday}
            onChange={(e) => setWeekday(e.target.value)}
          >
            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
              (d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ),
            )}
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor={`${id}-start`}>
            Available from
          </label>
          <Input
            id={`${id}-start`}
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor={`${id}-end`}>
            Available until
          </label>
          <Input
            id={`${id}-end`}
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save session type'}
      </Button>
    </form>
  );
}

/** Book a session, optionally with a Zoom/Meet call link and a session pack (PRD K10, H15, K11). */
export function BookSessionForm({
  sessionTypes,
}: {
  sessionTypes: { id: string; name: string }[];
}) {
  const id = useId();
  const [sessionTypeId, setSessionTypeId] = useState(sessionTypes[0]?.id ?? '');
  const [clientId, setClientId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [callLink, setCallLink] = useState('');
  const [packId, setPackId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await call('POST', '/api/v1/scheduling/bookings', {
          sessionTypeId,
          clientId,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          callLink: callLink || null,
          packId: packId || null,
        });
        setBusy(false);
        if (!res.ok) setError(res.message);
        else window.location.reload();
      }}
    >
      <div>
        <label className={LABEL} htmlFor={`${id}-type`}>
          Session type
        </label>
        <select
          id={`${id}-type`}
          className={SELECT}
          value={sessionTypeId}
          onChange={(e) => setSessionTypeId(e.target.value)}
          required
        >
          {sessionTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={LABEL} htmlFor={`${id}-client`}>
          Client id
        </label>
        <Input
          id={`${id}-client`}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <div>
          <label className={LABEL} htmlFor={`${id}-starts`}>
            Starts at
          </label>
          <Input
            id={`${id}-starts`}
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={LABEL} htmlFor={`${id}-ends`}>
            Ends at
          </label>
          <Input
            id={`${id}-ends`}
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <label className={LABEL} htmlFor={`${id}-link`}>
          Call link (Zoom or Meet, optional)
        </label>
        <Input
          id={`${id}-link`}
          type="url"
          value={callLink}
          onChange={(e) => setCallLink(e.target.value)}
          placeholder="https://…"
        />
      </div>
      <div>
        <label className={LABEL} htmlFor={`${id}-pack`}>
          Session pack id (in-person only, optional)
        </label>
        <Input id={`${id}-pack`} value={packId} onChange={(e) => setPackId(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Booking…' : 'Book session'}
      </Button>
    </form>
  );
}

/** Look up one client's bookings (with call links) and pack balances. */
export function ClientSchedulingLookup() {
  const id = useId();
  const [clientId, setClientId] = useState('');
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const b = await fetch(
            `/api/v1/scheduling/bookings?clientId=${encodeURIComponent(clientId)}`,
            { credentials: 'same-origin' },
          );
          const p = await fetch(
            `/api/v1/scheduling/packs?clientId=${encodeURIComponent(clientId)}`,
            { credentials: 'same-origin' },
          );
          if (!b.ok || !p.ok) {
            setError('Could not load that client’s scheduling. Check the client id.');
            return;
          }
          const bj = (await b.json()) as { data: Booking[] };
          const pj = (await p.json()) as { data: Pack[] };
          setBookings(bj.data);
          setPacks(pj.data);
        }}
      >
        <div>
          <label className={LABEL} htmlFor={`${id}-client`}>
            Client id
          </label>
          <Input
            id={`${id}-client`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
          />
        </div>
        <Button type="submit">Show bookings and packs</Button>
      </form>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {packs && (
        <section aria-label="Session packs">
          <h3 className="font-medium">Session packs</h3>
          {packs.length === 0 ? (
            <p className="text-secondary">No packs for this client.</p>
          ) : (
            <ul className="list-disc pl-5">
              {packs.map((p) => (
                <li key={p.id}>
                  {p.name}: {p.remaining} of {p.totalSessions} left ({p.status})
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {bookings && (
        <section aria-label="Bookings">
          <h3 className="font-medium">Bookings</h3>
          {bookings.length === 0 ? (
            <p className="text-secondary">No bookings for this client.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {bookings.map((b) => (
                <li key={b.id}>
                  {new Date(b.startsAt).toLocaleString()} – {new Date(b.endsAt).toLocaleString()} (
                  {b.status})
                  {b.callLink && (
                    <>
                      {' '}
                      —{' '}
                      <a className="underline" href={b.callLink} target="_blank" rel="noreferrer">
                        Join call
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
