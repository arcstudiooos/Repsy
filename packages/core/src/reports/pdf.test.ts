import { describe, expect, it } from 'vitest';
import { jpegInfo, PdfDoc, textWidth, wrap } from './pdf';
import { TINY_JPEG } from './tinyJpeg.test-helpers';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('pdf writer (PRD E10)', () => {
  it('reads a JPEG frame header', () => {
    expect(jpegInfo(TINY_JPEG)).toEqual({ width: 32, height: 16, components: 3 });
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('measures and wraps Helvetica text', () => {
    expect(textWidth('Hello', 10)).toBeCloseTo(22.78, 1);
    const lines = wrap('one two three four five six seven', 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 10)).toBeLessThanOrEqual(60);
    expect(wrap('a\n\nb', 10, 100)).toEqual(['a', '', 'b']);
    expect(wrap('x'.repeat(80), 10, 50).every((l) => textWidth(l, 10) <= 50)).toBe(true);
  });

  it('writes a well-formed file whose cross-reference table points at each object', () => {
    const doc = new PdfDoc('Test (report)');
    const img = doc.addJpeg(TINY_JPEG)!;
    const page = doc.addPage();
    page.text(40, 40, 'Café — 5 × 3 (done) \\ ✓', { bold: true });
    page.rect(0, 0, 100, 20, [15, 118, 110]);
    page.line(0, 0, 10, 10, [0, 0, 0]);
    page.image(img, 40, 60, 64, 64);
    doc.addPage().text(40, 40, 'Second page');
    const out = latin1(doc.toBytes());
    expect(out.startsWith('%PDF-1.4')).toBe(true);
    expect(out.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(out).toContain('/Count 2');
    expect(out).toContain('/Filter /DCTDecode');
    // Text is hex-encoded WinAnsi: é is e9, the em dash 97, × d7, the tick unsupported (3f).
    expect(out).toContain('e9');
    expect(out).toMatch(/97.*d7.*3f>/);
    const startxref = Number(/startxref\n(\d+)/.exec(out)![1]);
    expect(out.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...out.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    entries.forEach((offset, i) =>
      expect(out.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true),
    );
  });
});
