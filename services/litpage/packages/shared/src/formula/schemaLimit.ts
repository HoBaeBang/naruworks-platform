// Database size limit and formulas: the property structure of a data source (its whole schema, formula
// code included) is capped at 1.5MB — long formulas count against it, so the formula editor refuses a formula that
// would push the schema over the limit and the server rejects client writes that grow a schema past it. The 2.5MB
// per-page property data limit does not count formulas or rollups (they are computed, never stored on the page).

/** Maximum size of a data source's property schema, in bytes of its JSON (UTF-8). */
export const SCHEMA_SIZE_LIMIT = 1.5 * 1024 * 1024;

export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Size of a schema as stored (bytes of its JSON). */
export function schemaSize(schema: Record<string, unknown> | null | undefined): number {
  return utf8Length(JSON.stringify(schema ?? {}));
}

/** The property that takes the most space (its name and size). */
export function largestProperty(schema: Record<string, unknown> | null | undefined): { id: string; name: string; size: number } | null {
  let best: { id: string; name: string; size: number } | null = null;
  for (const [id, p] of Object.entries(schema ?? {})) {
    const size = utf8Length(JSON.stringify(p ?? null));
    if (!best || size > best.size) best = { id, name: String((p as { name?: unknown } | null)?.name ?? ''), size };
  }
  return best;
}

/** Error message when `schema` is over the limit ("The database’s properties are too large. …"). */
export function schemaLimitProblem(schema: Record<string, unknown> | null | undefined): string | null {
  if (schemaSize(schema) <= SCHEMA_SIZE_LIMIT) return null;
  const big = largestProperty(schema);
  return big?.name
    ? `The database’s properties are too large. “${big.name}” uses the most space. Shorten the formula or remove properties.`
    : 'The database’s properties are too large. Shorten the formula or remove properties.';
}
