import { ImageResponse } from 'next/og';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';

/**
 * The share card for links to Repsy (SEO/AEO audit 2026-11-06: no og:image before, so shares showed no preview).
 * Generated at build time from the brand tokens in styles/tokens.css; no external fonts or images.
 */
export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: '#5b5bd6',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: '#e8ff47',
            color: '#1a1a2e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          R
        </div>
        <div style={{ fontSize: 40, fontWeight: 700 }}>{SITE_NAME}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, maxWidth: 960 }}>
          Coaching software that never drops the ball.
        </div>
        <div style={{ fontSize: 30, color: '#e4e4fb', maxWidth: 940 }}>
          Programs, check-ins, messages and scheduling in one place. Every feature on every plan.
        </div>
      </div>
    </div>,
    size,
  );
}
