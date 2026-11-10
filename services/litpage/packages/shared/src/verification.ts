// Page verification and wiki owners.
// Wiki pages / database rows: the collection has a `verification` property (schema.verifier_property = the Owner
// person property); the value is the property cell
// [["‣", [["vr", VerificationValue]]]] (database/values.ts reads the same atom).
// Other pages: block.format.page_verification = VerificationValue (owners listed in it).
// A verification lasts until `expiry_time` (null = Indefinitely); after that it reads as "expired" and the owners get an
// Inbox notification (server scheduler).
import type { BlockRecord, CollectionRecord, PropertySchema } from './records.ts';
import type { DateValue, RichText } from './richtext.ts';

export interface VerificationValue {
  state: 'verified' | 'none';
  /** who verified */
  user?: string;
  /** verified-on date … expiry date (database/values.ts shows it as the property's date range) */
  date?: DateValue;
  verified_time?: number;
  /** null / missing = verified indefinitely */
  expiry_time?: number | null;
  /** page owners (non-database pages; wiki rows use the Owner property) */
  owners?: string[];
}

export type VerificationStatus = 'verified' | 'expired' | 'none';

export interface VerificationInfo {
  status: VerificationStatus;
  verifiedBy?: string;
  verifiedTime?: number;
  expiryTime?: number | null;
  owners: string[];
  /** where the value lives */
  source: 'property' | 'page';
  propertyId?: string;
  ownerPropertyId?: string;
}

export const VERIFICATION_PRESETS = [7, 30, 90] as const;

/** The database's Verification property (and its Owner person property). */
export function verificationProperty(schema: Record<string, PropertySchema> | undefined): { id: string; ownerId?: string } | null {
  if (!schema) return null;
  for (const [id, p] of Object.entries(schema)) {
    if (p?.type !== 'verification') continue;
    const owner = typeof p.verifier_property === 'string' && schema[p.verifier_property as string]?.type === 'person' ? (p.verifier_property as string) : undefined;
    return { id, ownerId: owner };
  }
  return null;
}

/** Person ids in a person-property cell. */
export function personIds(rt: RichText | undefined): string[] {
  const out: string[] = [];
  for (const d of rt ?? []) for (const a of (d[1] ?? []) as unknown[][]) if (a[0] === 'u' && typeof a[1] === 'string' && !out.includes(a[1])) out.push(a[1]);
  return out;
}

export function encodePeople(ids: string[]): RichText | undefined {
  if (!ids.length) return undefined;
  const out: RichText = [];
  ids.forEach((id, i) => {
    if (i) out.push([',']);
    out.push(['‣', [['u', id]]] as any);
  });
  return out;
}

function readAtom(rt: RichText | undefined): VerificationValue | null {
  for (const d of rt ?? []) for (const a of (d[1] ?? []) as unknown[][]) if (a[0] === 'vr' && a[1] && typeof a[1] === 'object') return a[1] as VerificationValue;
  return null;
}

export function encodeVerificationValue(v: VerificationValue | null): RichText | undefined {
  return v && v.state === 'verified' ? ([['‣', [['vr', v]]]] as any) : undefined;
}

function statusOf(v: VerificationValue | null, now: number): VerificationStatus {
  if (!v || v.state !== 'verified') return 'none';
  const exp = v.expiry_time ?? null;
  return exp !== null && exp !== undefined && exp <= now ? 'expired' : 'verified';
}

/** Verification of a page: from its database's Verification property when there is one, else its own format. */
export function readVerification(block: BlockRecord | undefined, collection?: CollectionRecord, now = Date.now()): VerificationInfo {
  const empty: VerificationInfo = { status: 'none', owners: [], source: 'page' };
  if (!block) return empty;
  const prop = block.parent_table === 'collection' ? verificationProperty(collection?.schema) : null;
  if (prop) {
    const v = readAtom(block.properties?.[prop.id] as RichText | undefined);
    const owners = prop.ownerId ? personIds(block.properties?.[prop.ownerId] as RichText | undefined) : [];
    return {
      status: statusOf(v, now), verifiedBy: v?.user, verifiedTime: v?.verified_time, expiryTime: v?.expiry_time ?? null,
      owners, source: 'property', propertyId: prop.id, ownerPropertyId: prop.ownerId,
    };
  }
  const v = (block.format as Record<string, unknown> | undefined)?.page_verification as VerificationValue | undefined;
  if (!v) return empty;
  return { status: statusOf(v, now), verifiedBy: v.user, verifiedTime: v.verified_time, expiryTime: v.expiry_time ?? null, owners: Array.isArray(v.owners) ? v.owners.filter((x) => typeof x === 'string') : [], source: 'page' };
}

function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A fresh verification by `user` at `now`, valid until `expiry` (ms) or indefinitely (null). */
export function makeVerification(user: string, now: number, expiry: number | null, owners?: string[]): VerificationValue {
  const date: DateValue = expiry ? { type: 'daterange', start_date: ymd(now), end_date: ymd(expiry) } : { type: 'date', start_date: ymd(now) };
  return { state: 'verified', user, date, verified_time: now, expiry_time: expiry, ...(owners ? { owners } : {}) };
}
