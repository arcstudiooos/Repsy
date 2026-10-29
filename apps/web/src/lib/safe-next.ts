/** Post-login target: same-origin only, as path + query. Anything else becomes /app. */
export function safeNext(next: string | null, origin: string): string {
  if (!next) return '/app';
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : '/app';
  } catch {
    return '/app';
  }
}
