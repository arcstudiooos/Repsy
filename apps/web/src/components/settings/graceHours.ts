/**
 * The grace-hours form value for the PATCH body. Blank or non-numeric input becomes null, which the server rejects
 * with a field error; `Number('')` would otherwise silently save 0.
 */
export function graceHoursValue(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
