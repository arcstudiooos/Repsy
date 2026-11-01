/**
 * Parsing a program pasted as text or copied from a spreadsheet (PRD C14). Pure: no database, safe in the browser.
 *
 * Text, one exercise per line, under day headings and optional week headings:
 *   Week 1
 *   Day 1: Upper
 *   Bench press 3x8 @ 60kg RPE 8
 *   Plank 3x45s
 *   Run 1x5km
 * Spreadsheet (tab or comma separated, with a header row): Week?, Day, Exercise, Sets, Reps, Load, RPE, Notes?.
 */

export type ImportUnits = 'kg' | 'lb';

export interface ParsedSet {
  reps?: number;
  /** The top of a rep range ("3x8-10"). */
  repsMax?: number;
  loadKg?: number;
  rpe?: number;
  durationSec?: number;
  distanceM?: number;
}

export interface ParsedLine {
  /** 1-based line in the pasted text (or row in the sheet, header included). */
  line: number;
  raw: string;
  /** The exercise name as written; matched to the library by the server. */
  name: string;
  sets: ParsedSet[];
  note?: string;
  /** Why the line could not be read; the line is left out until fixed. */
  error?: string;
}

export interface ParsedDay {
  title: string;
  lines: ParsedLine[];
}

export interface ParsedProgram {
  weeks: { days: ParsedDay[] }[];
  /** File-level problems (no exercises found, too many weeks or days). */
  errors: string[];
}

const LB_TO_KG = 0.45359237;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
export const IMPORT_LIMITS = { weeks: 104, days: 7, exercises: 30, sets: 20 } as const;

const WEEK = /^week\s*(\d+)\b[:.\-\s]*(.*)$/i;
const DAY =
  /^(day\s*\d+|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?)\b\s*[:.\-–]?\s*(.*)$/i;

function toKg(value: number, unit: string | undefined, units: ImportUnits): number {
  const u = (unit ?? units).toLowerCase();
  return round3(u.startsWith('lb') ? value * LB_TO_KG : value);
}

/**
 * The prescription part of a line: "3x8", "3 x 8-10" (low end kept), "3x8 @ 60kg", "3x8 60", "RPE 8", "3x45s",
 * "3x1min", "1x5km", "4x400m". Returns null when no "sets x amount" is found.
 */
export function parsePrescription(text: string, units: ImportUnits): ParsedSet[] | null {
  const m =
    /(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+))?\s*(s|sec|secs|seconds?|min|mins|minutes?|m|km|mi)?\b/i.exec(
      text,
    );
  if (!m) return null;
  const sets = Number(m[1]);
  const amount = Number(m[2]);
  const top = m[3] ? Number(m[3]) : undefined;
  const unit = m[4]?.toLowerCase();
  if (!Number.isInteger(sets) || sets < 1 || sets > IMPORT_LIMITS.sets) return null;
  const one: ParsedSet = {};
  if (unit && /^s|^sec/.test(unit)) one.durationSec = Math.round(amount);
  else if (unit && /^min/.test(unit)) one.durationSec = Math.round(amount * 60);
  else if (unit === 'km') one.distanceM = round3(amount * 1000);
  else if (unit === 'mi') one.distanceM = round3(amount * 1609.344);
  else if (unit === 'm') one.distanceM = round3(amount);
  else {
    if (!Number.isInteger(amount)) return null;
    one.reps = amount;
    if (top !== undefined && Number.isInteger(top) && top > amount && top <= 1000)
      one.repsMax = top;
  }
  const rest = text.slice(m.index + m[0].length);
  const load = /(?:@|at\b)?\s*(\d+(?:\.\d+)?)\s*(kg|kgs|lb|lbs)?\b/i.exec(
    rest.replace(/rpe\s*\d+(\.\d+)?/i, ''),
  );
  if (one.reps !== undefined && load && load[1] && (load[2] || /@|at\b/i.test(rest))) {
    one.loadKg = toKg(Number(load[1]), load[2], units);
  }
  const rpe = /rpe\s*(\d+(?:\.5)?)/i.exec(text);
  if (rpe) {
    const v = Number(rpe[1]);
    if (v >= 1 && v <= 10) one.rpe = v;
  }
  return Array.from({ length: sets }, () => ({ ...one }));
}

function parseExerciseLine(raw: string, line: number, units: ImportUnits): ParsedLine {
  const text = raw.replace(/^[-•*\d.)\s]+(?=[A-Za-z])/, '').trim();
  const at = /(\d+)\s*[x×*]\s*\d/.exec(text);
  if (!at) {
    return { line, raw, name: text, sets: [], error: 'Add sets and reps, like 3x8.' };
  }
  const name = text
    .slice(0, at.index)
    .replace(/[:\-–,]\s*$/, '')
    .trim();
  if (!name) return { line, raw, name: '', sets: [], error: 'Add the exercise name before 3x8.' };
  const sets = parsePrescription(text.slice(at.index), units);
  if (!sets) return { line, raw, name, sets: [], error: 'Could not read the sets and reps.' };
  return { line, raw, name, sets };
}

/** Parses the text format. Lines before any day heading go into "Day 1". */
export function parseProgramText(text: string, units: ImportUnits = 'kg'): ParsedProgram {
  const weeks: { days: ParsedDay[] }[] = [];
  let week: { days: ParsedDay[] } | null = null;
  let day: ParsedDay | null = null;
  const ensureWeek = () => {
    if (!week) {
      week = { days: [] };
      weeks.push(week);
    }
    return week;
  };
  const ensureDay = () => {
    const w = ensureWeek();
    if (!day) {
      day = { title: `Day ${w.days.length + 1}`, lines: [] };
      w.days.push(day);
    }
    return day;
  };
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim();
    if (!raw || raw.startsWith('#')) return;
    const wk = WEEK.exec(raw);
    if (wk) {
      week = { days: [] };
      weeks.push(week);
      day = null;
      return;
    }
    const dy = DAY.exec(raw);
    if (dy && !/\d+\s*[x×*]\s*\d/.test(raw)) {
      const w = ensureWeek();
      const label = (dy[11] ?? '').trim();
      day = {
        title: label ? `${dy[1]!.replace(/\s+/, ' ')}: ${label}` : dy[1]!.replace(/\s+/, ' '),
        lines: [],
      };
      day.title = day.title.charAt(0).toUpperCase() + day.title.slice(1);
      w.days.push(day);
      return;
    }
    if (/:$/.test(raw) && !/\d\s*[x×*]\s*\d/.test(raw)) {
      const w = ensureWeek();
      day = { title: raw.slice(0, -1).trim().slice(0, 120), lines: [] };
      w.days.push(day);
      return;
    }
    ensureDay().lines.push(parseExerciseLine(raw, i + 1, units));
  });
  return finish(weeks);
}

function finish(weeks: { days: ParsedDay[] }[]): ParsedProgram {
  const kept = weeks
    .map((w) => ({ days: w.days.filter((d) => d.lines.length > 0) }))
    .filter((w) => w.days.length > 0);
  const errors: string[] = [];
  if (kept.length === 0)
    errors.push('No exercises found. Put one exercise per line, like "Bench press 3x8".');
  if (kept.length > IMPORT_LIMITS.weeks) errors.push(`Use at most ${IMPORT_LIMITS.weeks} weeks.`);
  if (kept.some((w) => w.days.length > IMPORT_LIMITS.days)) {
    errors.push(`Use at most ${IMPORT_LIMITS.days} days in a week.`);
  }
  if (kept.some((w) => w.days.some((d) => d.lines.length > IMPORT_LIMITS.exercises))) {
    errors.push(`Use at most ${IMPORT_LIMITS.exercises} exercises in a day.`);
  }
  return { weeks: kept, errors };
}

/** Splits one spreadsheet row on tabs, or on commas outside quotes. */
function splitRow(row: string, sep: string): string[] {
  if (sep === '\t') return row.split('\t').map((c) => c.trim());
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]!;
    if (ch === '"') {
      if (quoted && row[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/** True when the first line looks like a spreadsheet header (has Exercise and Sets columns). */
export function looksLikeSheet(text: string): boolean {
  const first = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  return /exercise/.test(first) && /sets/.test(first) && /[\t,]/.test(first);
}

/** Parses a sheet with a header row: Week (optional), Day, Exercise, Sets, Reps, Load, RPE, Notes. */
export function parseProgramSheet(text: string, units: ImportUnits = 'kg'): ParsedProgram {
  const lines = text.split(/\r?\n/);
  const sep = lines[0]?.includes('\t') ? '\t' : ',';
  const header = splitRow(lines[0] ?? '', sep).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const c = {
    week: col('week', 'wk'),
    day: col('day', 'workout', 'session'),
    exercise: col('exercise', 'exercisename', 'movement'),
    sets: col('sets'),
    reps: col('reps', 'repetitions'),
    load: col('load', 'weight', 'loadkg', 'weightkg', 'loadlb', 'weightlb', 'kg', 'lb', 'lbs'),
    rpe: col('rpe'),
    notes: col('notes', 'note', 'comments'),
  };
  const loadUnit: ImportUnits | undefined = /lb/.test(header[c.load] ?? '')
    ? 'lb'
    : /kg/.test(header[c.load] ?? '')
      ? 'kg'
      : undefined;
  const weeks = new Map<string, Map<string, ParsedDay>>();
  lines.slice(1).forEach((rowText, i) => {
    if (!rowText.trim()) return;
    const r = splitRow(rowText, sep);
    const get = (k: number) => (k >= 0 ? (r[k] ?? '').trim() : '');
    const weekKey = get(c.week) || '1';
    const dayKey = get(c.day) || 'Day 1';
    if (!weeks.has(weekKey)) weeks.set(weekKey, new Map());
    const days = weeks.get(weekKey)!;
    if (!days.has(dayKey)) days.set(dayKey, { title: dayKey.slice(0, 120), lines: [] });
    const name = get(c.exercise);
    const line = i + 2;
    const parsed: ParsedLine = { line, raw: rowText, name, sets: [] };
    const note = get(c.notes);
    if (note) parsed.note = note.slice(0, 500);
    const sets = Number(get(c.sets));
    const repsText = get(c.reps);
    if (!name) parsed.error = 'Add the exercise name.';
    else if (!Number.isInteger(sets) || sets < 1 || sets > IMPORT_LIMITS.sets) {
      parsed.error = `Sets must be 1-${IMPORT_LIMITS.sets}.`;
    } else {
      const presc = parsePrescription(
        `${sets}x${repsText || '0'}${get(c.load) ? ` @ ${get(c.load)}${loadUnit ?? ''}` : ''}${get(c.rpe) ? ` RPE ${get(c.rpe)}` : ''}`,
        units,
      );
      if (!presc || !repsText) parsed.error = 'Could not read the reps.';
      else parsed.sets = presc;
    }
    days.get(dayKey)!.lines.push(parsed);
  });
  return finish([...weeks.values()].map((days) => ({ days: [...days.values()] })));
}

/** Picks the right parser for what was pasted. */
export function parseProgram(text: string, units: ImportUnits = 'kg'): ParsedProgram {
  return looksLikeSheet(text) ? parseProgramSheet(text, units) : parseProgramText(text, units);
}
