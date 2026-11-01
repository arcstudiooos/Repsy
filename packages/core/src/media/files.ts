/**
 * Uploaded files (PRD E3, H2, D10, C2; D-011 #5). Pure Node: no database. The type is read from the bytes, never
 * trusted from the browser, and images lose their EXIF, GPS and other metadata before they are stored: JPEG APP1-APP15
 * and comment segments, PNG text/time/EXIF chunks, WebP EXIF and XMP chunks. HEIC is refused (phones send JPEG to a
 * browser upload anyway).
 */
export type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'video/mp4';

export const MAX_BYTES: Record<MediaType, number> = {
  'image/jpeg': 15 * 1024 * 1024,
  'image/png': 15 * 1024 * 1024,
  'image/webp': 15 * 1024 * 1024,
  'application/pdf': 10 * 1024 * 1024,
  'video/mp4': 100 * 1024 * 1024,
};

export const isImage = (t: MediaType) => t.startsWith('image/');

/** The file's type from its first bytes, or null for anything else. */
export function sniffType(buf: Buffer): MediaType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    // MP4 and the phone variants of it (isom, mp41, mp42, avc1, M4V, iso*); QuickTime "qt  " is refused.
    if (
      brand !== 'qt  ' &&
      !brand.startsWith('heic') &&
      !['heix', 'mif1', 'msf1'].includes(brand)
    ) {
      return 'video/mp4';
    }
  }
  return null;
}

function stripJpeg(buf: Buffer): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) throw new Error('Malformed JPEG');
    const marker = buf[i + 1]!;
    // Start of scan: the rest is image data (up to and including EOI).
    if (marker === 0xda) {
      parts.push(buf.subarray(i));
      return Buffer.concat(parts);
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw new Error('Malformed JPEG');
    const segment = buf.subarray(i, i + 2 + len);
    // Keep APP0 (JFIF) and APP14 (Adobe colour transform); drop APP1-APP13, APP15 (EXIF, GPS, XMP, IPTC) and COM.
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) parts.push(segment);
    i += 2 + len;
  }
  throw new Error('Malformed JPEG');
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function stripPng(buf: Buffer): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new Error('Malformed PNG');
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  throw new Error('Malformed PNG');
}

function stripWebp(buf: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > buf.length) throw new Error('Malformed WebP');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
      // VP8X flags: clear the EXIF (0x08) and XMP (0x04) bits.
      if (type === 'VP8X' && chunk.length > 8) chunk[8] = chunk[8]! & ~0x0c;
      chunks.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

/** The image without metadata; other types unchanged. Throws on a malformed image. */
export function stripMetadata(buf: Buffer, type: MediaType): Buffer {
  if (type === 'image/jpeg') return stripJpeg(buf);
  if (type === 'image/png') return stripPng(buf);
  if (type === 'image/webp') return stripWebp(buf);
  return buf;
}
