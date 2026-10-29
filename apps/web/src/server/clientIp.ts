/** TRUSTED_PROXY_HOPS; unset or blank means the Render default of 1. Junk yields NaN (rejected by clientIp). */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env.TRUSTED_PROXY_HOPS?.trim();
  return raw ? Number(raw) : 1;
}

/**
 * Client IP behind the platform proxy. Only the hops our own proxies appended
 * are trusted: with TRUSTED_PROXY_HOPS=1 (Render) the real client address is the
 * LAST X-Forwarded-For entry, so a spoofed leftmost value is ignored.
 */
export function clientIp(headers: Headers, hops: number = trustedProxyHops()): string {
  if (!Number.isInteger(hops) || hops < 1) return 'unknown';
  const parts = (headers.get('x-forwarded-for') ?? '').split(',').map((p) => p.trim());
  const ip = parts[parts.length - hops];
  return ip ? ip : 'unknown';
}
