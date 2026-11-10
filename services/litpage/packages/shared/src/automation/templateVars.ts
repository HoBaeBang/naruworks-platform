// Template variables: "@Today — Date when duplicated", "@Now — Time when duplicated",
// "@Me — Person who duplicated page". They live in database templates and in button "Insert blocks" content and are
// replaced by the actual date / time / person when the template is used or the button is clicked.
// Storage: date mentions carry `template_variable: "today" | "now"` next to the date fields; the person
// variable is a user mention of the reserved id TEMPLATE_ME (person properties use the same encoding).
import type { DateValue, RichText } from '../richtext.ts';
import { dateFromMs, datetimeFromMs } from '../formula/dates.ts';

export const TEMPLATE_ME = 'template-variable:me';

export type TemplateDateVariable = 'today' | 'now';
export type TemplateDateValue = DateValue & { template_variable?: TemplateDateVariable };

export interface TemplateVarValues {
  now: number;
  timeZone?: string;
  userId: string;
}

export function templateDate(kind: TemplateDateVariable, now = Date.now(), timeZone?: string): TemplateDateValue {
  const base = kind === 'now' ? datetimeFromMs(now, timeZone) : dateFromMs(now, timeZone);
  return { ...base, template_variable: kind };
}

/** Is this rich text / annotation value a template variable? */
export function isTemplateVariableDate(v: unknown): v is TemplateDateValue {
  return !!v && typeof v === 'object' && ((v as TemplateDateValue).template_variable === 'today' || (v as TemplateDateValue).template_variable === 'now');
}

export function hasTemplateVariables(rt: RichText | undefined): boolean {
  for (const d of rt ?? []) {
    for (const a of (d[1] ?? []) as unknown[][]) {
      if (a[0] === 'd' && isTemplateVariableDate(a[1])) return true;
      if (a[0] === 'u' && a[1] === TEMPLATE_ME) return true;
    }
  }
  return false;
}

/** Replace template variables with concrete values (the date / time / person at duplication time). */
export function instantiateRichText(rt: RichText | undefined, vars: TemplateVarValues): RichText {
  if (!rt) return rt as unknown as RichText;
  if (!hasTemplateVariables(rt)) return rt;
  return rt.map((d) => {
    const anns = d[1] as unknown[][] | undefined;
    if (!anns?.length) return d;
    let changed = false;
    const next = anns.map((a) => {
      if (a[0] === 'd' && isTemplateVariableDate(a[1])) {
        changed = true;
        const { template_variable: kind, ...rest } = a[1];
        const concrete = kind === 'now' ? datetimeFromMs(vars.now, vars.timeZone) : dateFromMs(vars.now, vars.timeZone);
        // keep the display format the template author picked
        return ['d', { ...concrete, ...(rest.date_format ? { date_format: rest.date_format } : {}), ...(rest.time_format ? { time_format: rest.time_format } : {}), ...(rest.reminder ? { reminder: rest.reminder } : {}) }];
      }
      if (a[0] === 'u' && a[1] === TEMPLATE_ME) {
        changed = true;
        return ['u', vars.userId];
      }
      return a;
    });
    return (changed ? [d[0], next] : d) as RichText[number];
  });
}

/** Properties of a template page with variables resolved. */
export function instantiateProperties(props: Record<string, RichText> | undefined, vars: TemplateVarValues): Record<string, RichText> {
  const out: Record<string, RichText> = {};
  for (const [k, v] of Object.entries(props ?? {})) out[k] = instantiateRichText(v, vars);
  return out;
}
