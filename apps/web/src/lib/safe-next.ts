/** Post-login target: same-origin only, as path + query. Anything else becomes `/`, which routes by role. */
export function safeNext(next: string | null, origin: string): string {
  if (!next) return '/';
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}
