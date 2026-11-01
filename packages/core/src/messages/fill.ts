/** Fills `{placeholder}` tokens in a saved reply (PRD F7). Pure; used in the browser. Unknown ones stay as written. */
export function fillPlaceholders(text: string, facts: Partial<Record<string, string>>): string {
  return text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => facts[key] ?? whole);
}
