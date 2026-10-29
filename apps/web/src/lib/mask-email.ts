/**
 * `ann.smith@example.com` -> `a********@example.com`: enough to recognise, not to harvest.
 * The local part always ends in at least one `*`, so a 1-character name is never shown whole.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}${'*'.repeat(Math.max(1, Math.min(at - 1, 8)))}${email.slice(at)}`;
}
