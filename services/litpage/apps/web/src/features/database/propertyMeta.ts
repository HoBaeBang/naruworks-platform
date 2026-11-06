// Property type labels/icons (backed by the shared inventory in packages/shared/src/database/schema.ts).
import { CREATABLE_TYPES, propertyTypeMeta } from '@nc/shared/database/index.ts';

export const PROPERTY_TYPES: { type: string; label: string; icon: string }[] = CREATABLE_TYPES.map((t) => {
  const m = propertyTypeMeta(t);
  return { type: t, label: m.label, icon: m.icon };
});

export function propertyIcon(type: string): string {
  return propertyTypeMeta(type).icon;
}
