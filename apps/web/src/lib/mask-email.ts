/** `ann.smith@example.com` -> `a********@example.com`: enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}${'*'.repeat(Math.min(at - 1, 8))}${email.slice(at)}`;
}
