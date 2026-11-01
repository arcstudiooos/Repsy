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
  /** The file's header cells, for choosing columns by hand (PRD M4). */
  headers: string[];
}

/**
 * PRD M4: the coach's own choice of column per field, by header index; `null` means "not in this file". Fields left
 * out are matched by header name as usual.
 */
export type ColumnMapping = Partial<Record<RosterField, number | null>>;

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

/**
 * Parses a roster and maps its columns by header name (or by `mapping`, where given). First and last name columns are
 * joined when no name column is found or chosen.
 */
export function parseRoster(text: string, mapping: ColumnMapping = {}): ParsedRoster {
  const table = parseCsv(text);
  const header = table[0];
  if (!header) return { rows: [], columns: {}, error: 'The file is empty.', headers: [] };
  const headers = header.map((h) => h.trim());
  const keys = header.map(norm);
  const find = (names: string[]) => keys.findIndex((k) => names.includes(k));
  const idx: Partial<Record<RosterField, number>> = {};
  const columns: ParsedRoster['columns'] = {};
  for (const field of Object.keys(ALIASES) as RosterField[]) {
    const chosen = mapping[field];
    const i =
      chosen === null
        ? -1
        : chosen !== undefined && chosen >= 0 && chosen < header.length
          ? chosen
          : find(ALIASES[field]);
    if (i >= 0) {
      idx[field] = i;
      columns[field] = header[i]!.trim();
    }
  }
  const first = mapping.name === undefined ? find(FIRST) : -1;
  const last = mapping.name === undefined ? find(LAST) : -1;
  if (idx.name === undefined && first >= 0) {
    columns.name = [header[first], last >= 0 ? header[last] : null]
      .filter(Boolean)
      .map((h) => h!.trim())
      .join(' + ');
  }
  if (idx.email === undefined) {
    return {
      rows: [],
      columns,
      headers,
      error: 'No email column found. Choose it below, or name a column "Email".',
    };
  }
  if (columns.name === undefined) {
    return {
      rows: [],
      columns,
      headers,
      error: 'No name column found. Choose it below, or name a column "Name".',
    };
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
    headers,
    error: rows.length === 0 ? 'The file has a header but no clients.' : null,
  };
}
