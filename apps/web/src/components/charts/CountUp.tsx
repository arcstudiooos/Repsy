'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts up to `value` on first show (plan §2.2), then stays put. Renders the final value on the server
 * and for reduced motion, so the figure is never wrong or missing.
 */
export function CountUp({
  value,
  decimals = 0,
  suffix = '',
  durationMs = 700,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) {
      setShown(value);  
      return;
    }
    done.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || value === 0) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      setShown(value * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return (
    <>
      {shown.toLocaleString('en-GB', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </>
  );
}
