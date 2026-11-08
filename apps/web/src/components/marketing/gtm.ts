/**
 * The Google Tag Manager container for the public home page (D-023), read on the server at request time so a
 * value set on Render applies without rebuilding the browser bundle. Anything that is not a GTM id counts as off.
 */
export function gtmContainerId(env: Record<string, string | undefined> = process.env): string {
  const id = env.NEXT_PUBLIC_GTM_ID?.trim() ?? '';
  return /^GTM-[A-Z0-9]+$/.test(id) ? id : '';
}
