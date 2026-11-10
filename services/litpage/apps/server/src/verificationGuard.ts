// Page verification is written by the server only (api/modules/wiki.ts setPageVerification /
// setPageOwners: owner, plan and archive rules, expiry jobs). The transaction guard (authz.ts) keeps client writes —
// Litpage transactions, the public API, or anything hand-built, from forging it:
// - format.page_verification of a page can't change
// - the value of a database's Verification property can't change, and no property may get a verification value
// (a `vr` atom) — it could become a Verification property later
// - new records made by a client (pasted / duplicated pages) lose any verification they carry
import type { CollectionRecord } from '@nc/shared/records.ts';
import { verificationProperty } from '@nc/shared/verification.ts';

type Rec = Record<string, any>;

interface GuardLike {
  get(table: any, id: string | undefined | null): any;
}

function stable(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Rec;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/** A property value holding a verification atom ([["‣", [["vr", …]]]]). */
export function hasVerificationAtom(rt: unknown): boolean {
  return Array.isArray(rt) && rt.some((d) => Array.isArray(d) && Array.isArray(d[1]) && (d[1] as unknown[]).some((a) => Array.isArray(a) && a[0] === 'vr'));
}

function verificationPropId(g: GuardLike, b: Rec | undefined): string | null {
  if (!b || b.parent_table !== 'collection') return null;
  return verificationProperty((g.get('collection', b.parent_id) as CollectionRecord | undefined)?.schema)?.id ?? null;
}

const MESSAGE = 'Verify or remove verification from the page’s Verification menu';

/** A client update of an existing block that changes verification data, or null. */
export function verificationEditProblem(g: GuardLike, before: Rec, after: Rec, keys: Set<string>): string | null {
  if (keys.has('format') && stable(before.format?.page_verification) !== stable(after.format?.page_verification)) return MESSAGE;
  if (!keys.has('properties')) return null;
  const vid = verificationPropId(g, after) ?? verificationPropId(g, before);
  const bp = (before.properties ?? {}) as Rec;
  const ap = (after.properties ?? {}) as Rec;
  for (const k of new Set([...Object.keys(bp), ...Object.keys(ap)])) {
    if (stable(bp[k]) === stable(ap[k])) continue;
    if (k === vid || hasVerificationAtom(ap[k])) return MESSAGE;
  }
  return null;
}

/** New records from a client never arrive verified (in place). */
export function stripVerification(r: Rec) {
  if (r.format && typeof r.format === 'object' && 'page_verification' in r.format) {
    const { page_verification: _v, ...format } = r.format as Rec;
    r.format = format;
  }
  if (r.properties && typeof r.properties === 'object') {
    for (const [k, v] of Object.entries(r.properties as Rec)) if (hasVerificationAtom(v)) delete (r.properties as Rec)[k];
  }
}

