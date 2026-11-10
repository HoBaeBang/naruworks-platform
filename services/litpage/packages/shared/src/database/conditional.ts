// Conditional color (view format.conditional_color_rules): each rule is a property filter plus a background
// color; it colors the whole row/card, or only the rule's property cell when apply_to = "property".
import type { BlockRecord } from '../records.ts';
import type { PropertyFilterLeaf, QueryContext, Schema } from './types.ts';
import { isActiveLeaf, matchesLeaf } from './filters.ts';

export interface ConditionalColorRule {
  id: string;
  property: string;
  filter: PropertyFilterLeaf['filter'];
  /** "<color>_background" */
  color: string;
  apply_to?: 'row' | 'property';
}

export interface ConditionalColors {
  /** base color name for the whole row/card (first matching row rule wins) */
  row?: string;
  /** base color name per property id */
  cells: Record<string, string>;
}

export function conditionalColorRulesOf(view: { format?: unknown } | undefined | null): ConditionalColorRule[] {
  const rules = (view?.format as { conditional_color_rules?: ConditionalColorRule[] } | undefined)?.conditional_color_rules;
  return Array.isArray(rules) ? rules.filter((r) => r && r.property && r.filter?.operator) : [];
}

export function conditionalColorsFor(row: BlockRecord, rules: ConditionalColorRule[], schema: Schema, ctx: QueryContext): ConditionalColors {
  const out: ConditionalColors = { cells: {} };
  for (const r of rules) {
    if (!schema[r.property]) continue;
    const leaf: PropertyFilterLeaf = { property: r.property, filter: r.filter };
    if (!isActiveLeaf(leaf) || !matchesLeaf(row, leaf, schema, ctx)) continue;
    const color = String(r.color ?? '').replace(/_background$/, '') || 'default';
    if (color === 'default') continue;
    if (r.apply_to === 'property') {
      if (!out.cells[r.property]) out.cells[r.property] = color;
    } else if (!out.row) out.row = color;
  }
  return out;
}
