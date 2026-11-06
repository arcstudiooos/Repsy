'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * PRD L11: plays an uploaded demo with adaptive bitrate. Asks the server for the Cloudflare Stream
 * HLS manifest; Safari plays HLS natively, other browsers load hls.js on demand. Until the stream is
 * ready (or when Stream is not set up) the original MP4 plays.
 */
export function AdaptiveVideo({ src, label }: { src: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [mp4, setMp4] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      const res = await fetch(`${src}/playback`, { credentials: 'same-origin' }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as {
        data?: { hls: string | null; mp4: string };
      } | null;
      const hls = json?.data?.hls ?? null;
      const video = ref.current;
      if (cancelled || !video) return;
      if (!hls) {
        setMp4(json?.data?.mp4 ?? src);
        return;
      }
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hls;
        return;
      }
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setMp4(src);
        return;
      }
      const player = new Hls({ capLevelToPlayerSize: true });
      player.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          player.destroy();
          setMp4(src);
        }
      });
      player.loadSource(hls);
      player.attachMedia(video);
      destroy = () => player.destroy();
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [src]);

  return (
    <video
      ref={ref}
      src={mp4 ?? undefined}
      controls
      playsInline
      aria-label={label}
      className="h-full w-full"
    >
      <track kind="captions" />
    </video>
  );
}
