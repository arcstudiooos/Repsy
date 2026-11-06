import { Fragment, type ReactNode } from 'react';

/**
 * Renders the assistant's answer: a small, safe subset of Markdown (headings, paragraphs, bullet and
 * numbered lists, tables, **bold** and `code`). It builds React elements only, so model output can
 * never inject HTML.
 */
export function AnswerText({ text }: { text: string }) {
  return <div className="space-y-3 text-body">{blocks(text)}</div>;
}

function inline(text: string, key: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={`${key}-${i}`} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
  });
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const key = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(
        <p key={key} className="font-semibold">
          {inline(heading[2] ?? '', key)}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) {
        rows.push(cells(lines[i] ?? ''));
        i++;
      }
      out.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                {head.map((h, c) => (
                  <th key={c} scope="col" className="py-1.5 pr-4 font-medium">
                    {inline(h, `${key}h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border">
                  {r.map((c, ci) => (
                    <td key={ci} className="py-1.5 pr-4">
                      {inline(c, `${key}r${ri}c${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*[-*]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(pattern, ''));
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={key} className={`space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, `${key}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,4})\s/.test(lines[i] ?? '') &&
      !bullet.test(lines[i] ?? '') &&
      !numbered.test(lines[i] ?? '') &&
      !/^\s*\|.*\|\s*$/.test(lines[i] ?? '')
    ) {
      para.push(lines[i] ?? '');
      i++;
    }
    out.push(
      <p key={key} className="whitespace-pre-line">
        {inline(para.join('\n'), key)}
      </p>,
    );
  }
  return out;
}
