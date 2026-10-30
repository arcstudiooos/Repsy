/** Canonical 8-4-4-4-12 hex UUID, any version, case-insensitive. Guards ids before they reach a uuid column. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);
