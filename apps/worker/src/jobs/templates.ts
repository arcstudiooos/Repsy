export interface RenderedBody {
  subject: string;
  text: string;
  html: string;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Payload = Record<string, unknown>;
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
