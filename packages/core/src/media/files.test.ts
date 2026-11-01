import { describe, expect, it } from 'vitest';
import { sniffType, stripMetadata } from './files';

const seg = (marker: number, payload: string) => {
  const p = Buffer.from(payload, 'latin1');
  const b = Buffer.alloc(4);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(p.length + 2, 2);
  return Buffer.concat([b, p]);
};

describe('uploaded files (PRD E3, H2)', () => {
  it('reads the type from the bytes', () => {
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffType(Buffer.from('\0\0\0\x18ftypisom', 'latin1'))).toBe('video/mp4');
    expect(sniffType(Buffer.from('\0\0\0\x18ftypheic', 'latin1'))).toBeNull();
    expect(sniffType(Buffer.from('<html>'))).toBeNull();
  });

  it('drops EXIF, GPS, XMP and comments from a JPEG and keeps the image', () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      seg(0xe0, 'JFIF\0\x01\x01'),
      seg(0xe1, 'Exif\0\0GPSLatitude 51.5'),
      seg(0xe1, 'http://ns.adobe.com/xap/1.0/ <x:xmpmeta/>'),
      seg(0xfe, 'secret comment'),
      seg(0xdb, 'quant'),
      Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xaa, 0xbb, 0xff, 0xd9]),
    ]);
    const out = stripMetadata(jpeg, 'image/jpeg');
    const text = out.toString('latin1');
    expect(text).not.toContain('GPSLatitude');
    expect(text).not.toContain('xmpmeta');
    expect(text).not.toContain('secret comment');
    expect(text).toContain('JFIF');
    expect(text).toContain('quant');
    expect(out.subarray(-4)).toEqual(Buffer.from([0xaa, 0xbb, 0xff, 0xd9]));
  });

  it('drops text and EXIF chunks from a PNG', () => {
    const chunk = (type: string, data: string) => {
      const d = Buffer.from(data, 'latin1');
      const head = Buffer.alloc(8);
      head.writeUInt32BE(d.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, d, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', 'header-bytes!'),
      chunk('tEXt', 'Comment\0taken at home'),
      chunk('eXIf', 'GPS'),
      chunk('IDAT', 'pixels'),
      chunk('IEND', ''),
    ]);
    const text = stripMetadata(png, 'image/png').toString('latin1');
    expect(text).not.toContain('taken at home');
    expect(text).not.toContain('eXIf');
    expect(text).toContain('pixels');
    expect(text).toContain('IEND');
  });
});
