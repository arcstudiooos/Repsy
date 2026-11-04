/**
 * A small PDF 1.4 writer (PRD E10): A4 pages with the two standard Helvetica faces, filled rectangles, lines and
 * JPEG images. Pure and dependency-free. Text is WinAnsi-encoded, so Western European text renders and anything
 * else becomes "?"; every page and font is uncompressed, which keeps the writer tiny and its output easy to test.
 */
export const A4 = { width: 595.28, height: 841.89 } as const;

export type Rgb = readonly [number, number, number];

export interface JpegInfo {
  width: number;
  height: number;
  components: 1 | 3 | 4;
}

/** Reads a JPEG's size and colour components from its frame header; null when it isn't a baseline/progressive JPEG. */
export function jpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      const components = bytes[i + 9]!;
      if (!width || !height || ![1, 3, 4].includes(components)) return null;
      return { width, height, components: components as 1 | 3 | 4 };
    }
    i += 2 + len;
  }
  return null;
}

/** Helvetica advance widths (per 1000 em) for ASCII 32-126, from the standard AFM. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** The width of `text` in points (bold runs about 6% wider). */
export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    w += c >= 32 && c <= 126 ? HELVETICA[c - 32]! : 556;
  }
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

/** Breaks `text` into lines no wider than `max` points; blank lines are kept. */
export function wrap(text: string, size: number, max: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= max) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A single word longer than the line is cut.
      let rest = word;
      while (textWidth(rest, size, bold) > max && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && textWidth(rest.slice(0, n), size, bold) > max) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

const WIN_ANSI: Record<number, number> = {
  0x20ac: 0x80,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2026: 0x85,
  0x00d7: 0xd7,
};

/** A PDF hex string of `text` in WinAnsi; unsupported characters become "?". */
function hexText(text: string): string {
  let hex = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const b =
      (c >= 32 && c <= 126) || (c >= 0xa0 && c <= 0xff) ? c : (WIN_ANSI[c] ?? (c === 9 ? 32 : 63));
    hex += b.toString(16).padStart(2, '0');
  }
  return `<${hex}>`;
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const rgb = (c: Rgb) => c.map((x) => n(x / 255)).join(' ');

interface Image {
  name: string;
  info: JpegInfo;
  data: Uint8Array;
}

/** One page; coordinates are points from the top-left corner. */
export class PdfPage {
  readonly ops: string[] = [];
  readonly images = new Set<string>();
  constructor(private readonly doc: PdfDoc) {}

  text(
    x: number,
    y: number,
    text: string,
    opts: { size?: number; bold?: boolean; color?: Rgb } = {},
  ): void {
    const size = opts.size ?? 11;
    this.ops.push(
      `BT /${opts.bold ? 'F2' : 'F1'} ${n(size)} Tf ${rgb(opts.color ?? [0, 0, 0])} rg ${n(x)} ${n(A4.height - y)} Td ${hexText(text)} Tj ET`,
    );
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.ops.push(`${rgb(color)} rg ${n(x)} ${n(A4.height - y - h)} ${n(w)} ${n(h)} re f`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, width = 0.5): void {
    this.ops.push(
      `${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(A4.height - y1)} m ${n(x2)} ${n(A4.height - y2)} l S`,
    );
  }

  /** Draws a JPEG added with `doc.addJpeg` into the box, keeping its proportions. Returns the drawn height. */
  image(name: string, x: number, y: number, maxW: number, maxH: number): number {
    const img = this.doc.image(name);
    if (!img) return 0;
    const scale = Math.min(maxW / img.info.width, maxH / img.info.height);
    const w = img.info.width * scale;
    const h = img.info.height * scale;
    this.images.add(name);
    this.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(A4.height - y - h)} cm /${name} Do Q`);
    return h;
  }
}

export class PdfDoc {
  readonly pages: PdfPage[] = [];
  private readonly imgs = new Map<string, Image>();

  constructor(private readonly title = 'Document') {}

  addPage(): PdfPage {
    const page = new PdfPage(this);
    this.pages.push(page);
    return page;
  }

  /** Registers a JPEG; returns its name, or null when the bytes aren't a usable JPEG. */
  addJpeg(data: Uint8Array): string | null {
    const info = jpegInfo(data);
    if (!info) return null;
    const name = `Im${this.imgs.size + 1}`;
    this.imgs.set(name, { name, info, data });
    return name;
  }

  image(name: string): Image | undefined {
    return this.imgs.get(name);
  }

  toBytes(): Uint8Array {
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (b: Uint8Array | string) => {
      const bytes = typeof b === 'string' ? latin1(b) : b;
      chunks.push(bytes);
      length += bytes.length;
    };
    const latin1 = (s: string) => {
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    };
    const images = [...this.imgs.values()];
    // Object numbers: 1 catalog, 2 pages, 3-4 fonts, 5 info, then images, then (page, content) pairs.
    const imageNo = new Map(images.map((img, i) => [img.name, 6 + i]));
    const firstPage = 6 + images.length;
    const pageNo = (i: number) => firstPage + i * 2;
    const total = firstPage + this.pages.length * 2 - 1;
    const obj = (no: number, body: string | Uint8Array[]) => {
      offsets[no] = length;
      push(`${no} 0 obj\n`);
      if (typeof body === 'string') push(body);
      else for (const b of body) push(b);
      push('\nendobj\n');
    };

    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(
      2,
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map((_, i) => `${pageNo(i)} 0 R`).join(' ')}] >>`,
    );
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(
      4,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    obj(5, `<< /Title ${hexText(this.title)} /Producer (Repsy) >>`);
    for (const img of images) {
      const cs =
        img.info.components === 1
          ? '/DeviceGray'
          : img.info.components === 4
            ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]'
            : '/DeviceRGB';
      obj(imageNo.get(img.name)!, [
        latin1(
          `<< /Type /XObject /Subtype /Image /Width ${img.info.width} /Height ${img.info.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`,
        ),
        img.data,
        latin1('\nendstream'),
      ]);
    }
    this.pages.forEach((page, i) => {
      const xobjects = [...page.images]
        .map((name) => `/${name} ${imageNo.get(name)} 0 R`)
        .join(' ');
      obj(
        pageNo(i),
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(A4.width)} ${n(A4.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${pageNo(i) + 1} 0 R >>`,
      );
      const content = latin1(page.ops.join('\n'));
      obj(pageNo(i) + 1, [
        latin1(`<< /Length ${content.length} >>\nstream\n`),
        content,
        latin1('\nendstream'),
      ]);
    });
    const xref = length;
    push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
    for (let no = 1; no <= total; no++) push(`${String(offsets[no]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}
