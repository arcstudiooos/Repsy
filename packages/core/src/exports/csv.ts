export type CsvValue = string | number | boolean | null | undefined;

/**
 * RFC 4180 CSV with a header row. Text that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`, tab, CR) is
 * prefixed with `'` (OWASP CSV injection); numbers stay numbers.
 */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const cell = (v: CsvValue): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    const text = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
