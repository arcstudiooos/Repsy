/**
 * The branded shell every Repsy email is sent in (Midnight & Ember, D-014): a dark header with the wordmark, a white
 * card, a bulletproof button for the main link, and a quiet footer. Table layout and inline styles only, because
 * email clients (Gmail, Outlook) drop <style> blocks and modern CSS. Colors are the light-theme tokens.
 *
 * Templates write simple, already-escaped HTML (<p>, <ul>, <strong>, one <p><a>…</a></p> per call to action);
 * `brandEmail` styles it. Nothing here adds content, so D-007 (no client data in email) is unchanged.
 */
const C = {
  canvas: '#f7f5f2',
  surface: '#ffffff',
  ink: '#14110f',
  secondary: '#625b55',
  divider: '#e9e4de',
  accent: '#c7431c', // accent-fill: white text on it passes WCAG AA
  ember: '#e8552d',
  midnight: '#101418',
  midnightMuted: '#a8b0ba',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function button(href: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">` +
    `<tr><td align="center" bgcolor="${C.accent}" style="border-radius:10px">` +
    `<a target="_blank" href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};` +
    `font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px">` +
    `${label}</a></td></tr></table>` +
    `<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:${C.secondary}">` +
    `Button not working? Paste this link into your browser:<br>` +
    `<a style="color:${C.accent};word-break:break-all" href="${href}">${href}</a></p>`
  );
}

/** Inline styles for the small set of tags templates use. The first lone link paragraph becomes the button. */
function styleBody(html: string): string {
  let buttons = 0;
  return (
    html
      .replace(/<p><a href="([^"]*)">([^<]*)<\/a><\/p>/g, (whole, href: string, label: string) =>
        buttons++ === 0 ? button(href, label) : whole,
      )
      .replace(/<p>/g, `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${C.ink}">`)
      .replace(
        /<p style="white-space:pre-wrap">/g,
        `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${C.ink};white-space:pre-wrap">`,
      )
      .replace(/<ul>/g, `<ul style="margin:0 0 16px;padding-left:20px;color:${C.ink}">`)
      .replace(/<li>/g, '<li style="margin:0 0 6px;font-size:16px;line-height:24px">')
      // Template links only: the button and its fallback link are written as `<a target…` / `<a style…`.
      .replace(/<a href="/g, `<a style="color:${C.accent};font-weight:600" href="`)
  );
}

export function brandEmail(input: {
  subject: string;
  /** Escaped HTML from a template. */
  bodyHtml: string;
  /** Plain text; its first line becomes the inbox preview. */
  text: string;
  /** Absolute URL of the header logo (served by the web app at /brand/repsy-logo-on-dark.png). */
  logoUrl: string;
}): string {
  const preheader = input.text.split('\n').find((l) => l.trim()) ?? '';
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    `<title>${esc(input.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}">` +
    '<tr><td align="center" style="padding:32px 16px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">' +
    // Header: wordmark on midnight with an ember accent bar.
    `<tr><td bgcolor="${C.midnight}" style="border-radius:16px 16px 0 0;padding:24px 32px">` +
    // The founder's logo (white wordmark, for dark backgrounds). Clients that block images show the alt text.
    `<img src="${esc(input.logoUrl)}" width="150" height="48" alt="Repsy" style="display:block;border:0;` +
    `outline:none;height:48px;width:150px;font-family:${FONT};font-size:22px;font-weight:700;color:#ffffff">` +
    '</td></tr>' +
    `<tr><td bgcolor="${C.ember}" style="height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>` +
    // Card
    `<tr><td bgcolor="${C.surface}" style="padding:32px;font-family:${FONT};border-left:1px solid ${C.divider};` +
    `border-right:1px solid ${C.divider}">` +
    `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;color:${C.ink}">` +
    `${esc(input.subject)}</h1>` +
    styleBody(input.bodyHtml) +
    '</td></tr>' +
    // Footer
    `<tr><td bgcolor="${C.surface}" style="border-radius:0 0 16px 16px;border:1px solid ${C.divider};` +
    `border-top:1px solid ${C.divider};padding:20px 32px;font-family:${FONT};font-size:13px;line-height:20px;` +
    `color:${C.secondary}">Sent by Repsy, coaching that keeps every client moving.<br>` +
    `<a href="https://repsy.fit" style="color:${C.secondary}">repsy.fit</a></td></tr>` +
    '</table></td></tr></table></body></html>'
  );
}
