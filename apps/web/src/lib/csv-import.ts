/**
 * Parsing a client roster exported from another platform (PRD B17), in the browser.
 * RFC 4180 CSV: quoted fields may hold commas, newlines and doubled quotes. Tab-separated text (a spreadsheet
 * paste) is detected from the header line.
 */

export interface RosterRow {
  name: string;
  email: string;
  goals?: string;
  timezone?: string;
  units?: string;
}

export type RosterField = keyof RosterRow;

export interface ParsedRoster {
  rows: RosterRow[];
  /** Which source column feeds each field; a field with no column is absent. */
  columns: Partial<Record<RosterField, string>>;
  /** A problem with the file as a whole (no header, no name or email column); null when it parsed. */
  error: string | null;
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = delimiter ?? (firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',');
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  // Blank lines carry nothing.
  return out.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

/** Header spellings other platforms use, normalised (lower case, letters only). */
const ALIASES: Record<RosterField, string[]> = {
  name: ['name', 'fullname', 'clientname', 'client', 'athlete', 'athletename'],
  email: ['email', 'emailaddress', 'mail', 'clientemail'],
  goals: ['goals', 'goal', 'objective', 'objectives'],
  timezone: ['timezone', 'tz', 'zone'],
  units: ['units', 'unit', 'weightunit', 'weightunits', 'preferredunits'],
};
const FIRST = ['firstname', 'first', 'givenname'];
const LAST = ['lastname', 'last', 'surname', 'familyname'];

/** Parses a roster and maps its columns by header name. First and last name columns are joined. */
export function parseRoster(text: string): ParsedRoster {
  const table = parseCsv(text);
  const header = table[0];
  if (!header) return { rows: [], columns: {}, error: 'The file is empty.' };
  const keys = header.map(norm);
  const find = (names: string[]) => keys.findIndex((k) => names.includes(k));
  const idx: Partial<Record<RosterField, number>> = {};
  const columns: ParsedRoster['columns'] = {};
  for (const field of Object.keys(ALIASES) as RosterField[]) {
    const i = find(ALIASES[field]);
    if (i >= 0) {
      idx[field] = i;
      columns[field] = header[i]!.trim();
    }
  }
  const first = find(FIRST);
  const last = find(LAST);
  if (idx.name === undefined && first >= 0) {
    columns.name = [header[first], last >= 0 ? header[last] : null]
      .filter(Boolean)
      .map((h) => h!.trim())
      .join(' + ');
  }
  if (idx.email === undefined) {
    return { rows: [], columns, error: 'No email column found. Name a column "Email".' };
  }
  if (columns.name === undefined) {
    return { rows: [], columns, error: 'No name column found. Name a column "Name".' };
  }
  const cell = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim());
  const rows = table.slice(1).map((r) => {
    const name =
      idx.name !== undefined
        ? cell(r, idx.name)
        : [cell(r, first), last >= 0 ? cell(r, last) : ''].filter(Boolean).join(' ');
    const row: RosterRow = { name, email: cell(r, idx.email) };
    for (const f of ['goals', 'timezone', 'units'] as const) {
      const v = cell(r, idx[f]);
      if (v !== '') row[f] = v;
    }
    return row;
  });
  return {
    rows,
    columns,
    error: rows.length === 0 ? 'The file has a header but no clients.' : null,
  };
}
