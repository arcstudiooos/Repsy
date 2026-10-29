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
    return { subject: `${coachName} invited you to Kinetic`, text, html };
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
