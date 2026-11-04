export interface RenderedBody {
  subject: string;
  text: string;
  html: string;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Payload = Record<string, unknown>;

/** Every reminder says how to stop it. */
const OFF = 'You can turn reminders off under Profile, Notifications.';
type Template = (payload: Payload, appBaseUrl: string) => RenderedBody;

const str = (payload: Payload, key: string): string | undefined =>
  typeof payload[key] === 'string' ? payload[key] : undefined;

/**
 * Templates keyed by `OutboxEmail.templateKey`. A key without a template falls
 * back to payload.subject / text / html (platform emails supply their own).
 */
const TEMPLATES: Record<string, Template> = {
  client_invite: (payload, appBaseUrl) => {
    const coachName = str(payload, 'coachName') ?? 'Your coach';
    const orgName = str(payload, 'orgName');
    const token = str(payload, 'token') ?? '';
    const link = `${appBaseUrl.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}`;
    const where = orgName ? ` (${orgName})` : '';
    const text =
      `${coachName}${where} invited you to Kinetic.\n\n` +
      `Accept your invite: ${link}\n\n` +
      'This link works once and expires in 7 days.';
    const html =
      `<p>${escapeHtml(coachName)}${escapeHtml(where)} invited you to Kinetic.</p>` +
      `<p><a href="${escapeHtml(link)}">Accept your invite</a></p>` +
      '<p>This link works once and expires in 7 days.</p>';
    // Names are user-controlled: CR/LF in a subject would allow header injection.
    const subject = `${coachName} invited you to Kinetic`.replace(/[\r\n]+/g, ' ');
    return { subject, text, html };
  },
  // PRD B15: the owner hears that someone applied (their name only, D-007).
  new_lead: (payload, appBaseUrl) => {
    const name = str(payload, 'leadName') ?? 'Someone';
    const link = `${appBaseUrl.replace(/\/+$/, '')}/app/leads`;
    const text = `${name} applied on your Kinetic page.\n\nSee your leads: ${link}`;
    const html = `<p>${escapeHtml(name)} applied on your Kinetic page.</p><p><a href="${escapeHtml(link)}">See your leads</a></p>`;
    return { subject: `New application from ${name}`.replace(/[\r\n]+/g, ' '), text, html };
  },
  // PRD A10: an invite to join a workspace's team.
  team_invite: (payload, appBaseUrl) => {
    const orgName = str(payload, 'orgName') ?? 'a workspace';
    const inviter = str(payload, 'inviterName');
    const role = str(payload, 'role') ?? 'coach';
    const token = str(payload, 'token') ?? '';
    const link = `${appBaseUrl.replace(/\/+$/, '')}/team/join/${encodeURIComponent(token)}`;
    const who = inviter ? `${inviter} invited you` : 'You are invited';
    const text =
      `${who} to join ${orgName} on Kinetic as ${role === 'admin' ? 'an admin' : `a ${role}`}.\n\n` +
      `Join the team: ${link}\n\n` +
      'Sign in (or create an account) with this email address. The link works once and expires in 7 days.';
    const html =
      `<p>${escapeHtml(who)} to join ${escapeHtml(orgName)} on Kinetic as ${escapeHtml(role === 'admin' ? 'an admin' : `a ${role}`)}.</p>` +
      `<p><a href="${escapeHtml(link)}">Join the team</a></p>` +
      '<p>Sign in (or create an account) with this email address. The link works once and expires in 7 days.</p>';
    const subject = `Join ${orgName} on Kinetic`.replace(/[\r\n]+/g, ' ');
    return { subject, text, html };
  },
  // PRD M13: to the support inbox; the request text is the point of this email.
  support_request: (payload) => {
    const topic = str(payload, 'topic') ?? 'question';
    const from = `${str(payload, 'fromName') ?? ''} <${str(payload, 'fromEmail') ?? ''}>`;
    const org = str(payload, 'orgName') ?? '';
    const role = str(payload, 'role') ?? '';
    const message = str(payload, 'message') ?? '';
    return {
      subject: `Support (${topic}) from ${org}`.replace(/[\r\n]+/g, ' '),
      text: `From: ${from}\nWorkspace: ${org} (${role})\nTopic: ${topic}\n\n${message}`,
      html: `<p>From: ${escapeHtml(from)}<br>Workspace: ${escapeHtml(org)} (${escapeHtml(role)})<br>Topic: ${escapeHtml(topic)}</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
    };
  },
  // PRD F2: a one-off form from the coach; never its questions (D-007).
  form_ready: (payload, appBaseUrl) => {
    const coachName = str(payload, 'coachName') ?? 'Your coach';
    const id = str(payload, 'checkinId') ?? '';
    const link = `${appBaseUrl.replace(/\/+$/, '')}/portal/check-ins/${encodeURIComponent(id)}`;
    return {
      subject: `${coachName} sent you a form`.replace(/[\r\n]+/g, ' '),
      text: `${coachName} sent you a form to fill in.\n\nOpen it: ${link}\n\nEvery question is optional.`,
      html: `<p>${escapeHtml(coachName)} sent you a form to fill in.</p><p><a href="${escapeHtml(link)}">Open it</a></p><p>Every question is optional.</p>`,
    };
  },
  // PRD H13, F9: reminders carry a count and a link, never workout, check-in or habit content (D-007).
  workout_reminder: (payload, appBaseUrl) => {
    const n = typeof payload.workouts === 'number' ? payload.workouts : 1;
    const link = `${appBaseUrl.replace(/\/+$/, '')}/portal`;
    const what = n === 1 ? 'a workout' : `${n} workouts`;
    return {
      subject: 'You have a workout today',
      text: `You have ${what} planned today.\n\nOpen Kinetic: ${link}\n\n${OFF}`,
      html: `<p>You have ${what} planned today.</p><p><a href="${escapeHtml(link)}">Open Kinetic</a></p><p>${OFF}</p>`,
    };
  },
  checkin_reminder: (_payload, appBaseUrl) => {
    const link = `${appBaseUrl.replace(/\/+$/, '')}/portal/check-ins`;
    return {
      subject: 'Your check-in is due tonight',
      text: `Your check-in is due tonight and hasn't been sent yet.\n\nFill it in: ${link}\n\n${OFF}`,
      html: `<p>Your check-in is due tonight and hasn't been sent yet.</p><p><a href="${escapeHtml(link)}">Fill it in</a></p><p>${OFF}</p>`,
    };
  },
  habit_reminder: (payload, appBaseUrl) => {
    const n = typeof payload.habits === 'number' ? payload.habits : 1;
    const link = `${appBaseUrl.replace(/\/+$/, '')}/portal`;
    const what = n === 1 ? 'a habit' : `${n} habits`;
    return {
      subject: 'A quick habit check',
      text: `You still have ${what} to tick today.\n\nOpen Kinetic: ${link}\n\n${OFF}`,
      html: `<p>You still have ${what} to tick today.</p><p><a href="${escapeHtml(link)}">Open Kinetic</a></p><p>${OFF}</p>`,
    };
  },
  // S4-1: no answers or questions in the email, only the link (D-007).
  checkin_ready: (payload, appBaseUrl) => {
    const coachName = str(payload, 'coachName') ?? 'Your coach';
    const id = str(payload, 'checkinId') ?? '';
    const link = `${appBaseUrl.replace(/\/+$/, '')}/portal/check-ins/${encodeURIComponent(id)}`;
    const text =
      `Your weekly check-in from ${coachName} is ready.\n\n` +
      `Fill it in: ${link}\n\n` +
      'Every question is optional.';
    const html =
      `<p>Your weekly check-in from ${escapeHtml(coachName)} is ready.</p>` +
      `<p><a href="${escapeHtml(link)}">Fill it in</a></p>` +
      '<p>Every question is optional.</p>';
    const subject = 'Your weekly check-in is ready';
    return { subject, text, html };
  },
  // S4-4: who wrote, never what (the body stays in the app).
  new_message: (payload, appBaseUrl) => {
    const sender = str(payload, 'senderName') ?? 'your coach';
    const path = payload.toPortal === true ? '/portal/messages' : '/app/messages';
    const link = `${appBaseUrl.replace(/\/+$/, '')}${path}`;
    const text = `You have a new message from ${sender}.\n\nRead it in Kinetic: ${link}`;
    const html =
      `<p>You have a new message from ${escapeHtml(sender)}.</p>` +
      `<p><a href="${escapeHtml(link)}">Read it in Kinetic</a></p>`;
    const subject = `New message from ${sender}`.replace(/[\r\n]+/g, ' ');
    return { subject, text, html };
  },
  // PRD H14: counts and a link only, never client names or content (D-007).
  coach_digest: (payload, appBaseUrl) => {
    const n = (k: string) => (typeof payload[k] === 'number' ? (payload[k] as number) : 0);
    const orgName = str(payload, 'orgName');
    const lines = [
      [n('checkins'), 'check-in waiting for your review', 'check-ins waiting for your review'],
      [n('unread'), 'unread client message', 'unread client messages'],
      [n('flags'), 'item that needs review', 'items that need review'],
    ]
      .filter(([count]) => (count as number) > 0)
      .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
    const link = `${appBaseUrl.replace(/\/+$/, '')}/app`;
    const where = orgName ? ` in ${orgName}` : '';
    const text =
      `Your Kinetic day${where}:\n\n` +
      lines.map((l) => `- ${l}`).join('\n') +
      `\n\nOpen your dashboard: ${link}\n\n` +
      'You get this because you turned on the daily digest in Settings.';
    const html =
      `<p>Your Kinetic day${escapeHtml(where)}:</p><ul>` +
      lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('') +
      `</ul><p><a href="${escapeHtml(link)}">Open your dashboard</a></p>` +
      '<p>You get this because you turned on the daily digest in Settings.</p>';
    return { subject: 'Your Kinetic daily digest', text, html };
  },
  // PRD I9: the Monday brief. Counts and a link only, never client names or content (D-007).
  weekly_brief: (payload, appBaseUrl) => {
    const n = (k: string) => (typeof payload[k] === 'number' ? (payload[k] as number) : 0);
    const orgName = str(payload, 'orgName');
    const plural = (count: number, one: string, many: string) =>
      `${count} ${count === 1 ? one : many}`;
    const wins = [
      n('completed') > 0 && plural(n('completed'), 'workout completed', 'workouts completed'),
      n('perfectWeeks') > 0 &&
        plural(n('perfectWeeks'), 'client did every workout', 'clients did every workout'),
    ].filter((x): x is string => Boolean(x));
    const slipped =
      n('slipped') > 0
        ? [
            plural(
              n('slipped'),
              'client missed 2 or more workouts',
              'clients missed 2 or more workouts',
            ),
          ]
        : [];
    const due = [
      n('workoutsDue') > 0 && plural(n('workoutsDue'), 'workout planned', 'workouts planned'),
      n('checkinsDue') > 0 && plural(n('checkinsDue'), 'check-in due', 'check-ins due'),
      n('programsEnding') > 0 &&
        plural(
          n('programsEnding'),
          'program ends with nothing after it',
          'programs end with nothing after them',
        ),
    ].filter((x): x is string => Boolean(x));
    const link = `${appBaseUrl.replace(/\/+$/, '')}/app`;
    const sections: [string, string[]][] = [
      ['Last week', wins],
      ['Who slipped', slipped],
      ['This week', due],
    ];
    const shown = sections.filter(([, lines]) => lines.length > 0);
    const where = orgName ? ` for ${orgName}` : '';
    const text =
      `Your week ahead${where}:\n\n` +
      shown.map(([h, lines]) => `${h}:\n${lines.map((l) => `- ${l}`).join('\n')}`).join('\n\n') +
      `\n\nOpen Kinetic: ${link}\n\n` +
      'You get this because you turned on the Monday brief in Settings.';
    const html =
      `<p>Your week ahead${escapeHtml(where)}:</p>` +
      shown
        .map(
          ([h, lines]) =>
            `<p><strong>${escapeHtml(h)}</strong></p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`,
        )
        .join('') +
      `<p><a href="${escapeHtml(link)}">Open Kinetic</a></p>` +
      '<p>You get this because you turned on the Monday brief in Settings.</p>';
    return { subject: 'Your Kinetic week ahead', text, html };
  },
  // S5-3: the coach is told a client asked for deletion (D-010 #4). No content beyond the client's name.
  deletion_requested: (payload, appBaseUrl) => {
    const name = str(payload, 'clientName') ?? 'A client';
    const text =
      `${name} asked for their data in your Kinetic workspace to be deleted.\n\n` +
      'Kinetic will verify the request and then delete it. You need to do nothing.\n\n' +
      `${appBaseUrl.replace(/\/+$/, '')}/app/clients`;
    const html =
      `<p>${escapeHtml(name)} asked for their data in your Kinetic workspace to be deleted.</p>` +
      '<p>Kinetic will verify the request and then delete it. You need to do nothing.</p>';
    return { subject: 'A client asked for data deletion', text, html };
  },
};

export function renderTemplate(
  templateKey: string,
  payload: Payload,
  appBaseUrl: string,
): RenderedBody {
  const template = TEMPLATES[templateKey];
  if (template) return template(payload, appBaseUrl);
  const text = str(payload, 'text') ?? '';
  return {
    subject: str(payload, 'subject') ?? templateKey,
    text,
    html: str(payload, 'html') ?? `<p>${escapeHtml(text)}</p>`,
  };
}
