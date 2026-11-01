/**
 * Exercise demo media (PRD C2, D7). Pure: safe in the browser. A coach's link becomes an embed: YouTube (privacy-
 * enhanced, youtube-nocookie.com), Vimeo, Instagram, or a direct MP4. Anything else stays a plain link.
 */
export type ExerciseMedia =
  | { kind: 'youtube'; id: string; embedUrl: string; thumbnailUrl: string }
  | { kind: 'vimeo'; id: string; embedUrl: string }
  | { kind: 'instagram'; embedUrl: string }
  | { kind: 'video'; src: string }
  | { kind: 'link'; href: string };

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const UPLOADED = /^\/api\/v1\/media\/[0-9a-f-]{36}$/i;

/** Where an uploaded demo video (PRD C2) is streamed from. */
export const uploadedMediaPath = (mediaId: string) => `/api/v1/media/${mediaId}`;

/** The demo to show: an uploaded video wins over a link. */
export const demoUrlOf = (e: { mediaUrl: string | null; demoMediaId?: string | null }) =>
  e.demoMediaId ? uploadedMediaPath(e.demoMediaId) : e.mediaUrl;

export function parseExerciseMedia(url: string | null | undefined): ExerciseMedia | null {
  if (!url) return null;
  if (UPLOADED.test(url)) return { kind: 'video', src: url };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let yt: string | null = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') yt = u.searchParams.get('v');
    else {
      const m = /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(u.pathname);
      yt = m?.[1] ?? null;
    }
  }
  if (yt && YT_ID.test(yt)) {
    return {
      kind: 'youtube',
      id: yt,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = /\/(\d{6,12})(?:$|[/?#])/.exec(u.pathname);
    if (m?.[1]) {
      return { kind: 'vimeo', id: m[1], embedUrl: `https://player.vimeo.com/video/${m[1]}?dnt=1` };
    }
  }
  if (host === 'instagram.com') {
    const m = /^\/(p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(u.pathname);
    if (m)
      return { kind: 'instagram', embedUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed` };
  }
  if (/\.mp4$/i.test(u.pathname)) return { kind: 'video', src: u.toString() };
  return { kind: 'link', href: u.toString() };
}
