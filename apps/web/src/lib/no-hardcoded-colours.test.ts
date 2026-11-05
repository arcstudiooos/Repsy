import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * D-018: components use tokens only. No raw hex colours or white/black utilities in components and pages; the
 * exceptions hold data, not styling (avatar tones and tag colours are palettes users pick from or that are tested
 * for contrast; branding settings show the coach's own colour; the dev UI page documents the palette).
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = new Set([
  'components/ui/avatar.tsx',
  'components/tags/TagBadge.tsx',
  'components/settings/BrandingSection.tsx',
  'app/layout.tsx',
  'app/manifest.ts',
  'app/app/dev/ui/page.tsx',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('no hard-coded colours', () => {
  it('components and pages use tokens, not #hex or white/black utilities', () => {
    const offenders: string[] = [];
    for (const path of [...files(join(root, 'components')), ...files(join(root, 'app'))]) {
      const rel = relative(root, path);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(path, 'utf8');
      if (
        /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![\w-])/i.test(
          src.replace(/href="#[^"]*"|'#main'|"#main"/g, ''),
        )
      )
        offenders.push(`${rel}: hex colour`);
      if (/\b(bg|text|ring|border|fill|stroke)-(white|black)\b/.test(src))
        offenders.push(`${rel}: white/black utility`);
    }
    expect(offenders).toEqual([]);
  });
});
