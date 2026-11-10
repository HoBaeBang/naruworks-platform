// Number formatting per collection.schema[prop].number_format / number_precision
// number formats use Intl currency style, with percent using Intl percent.
import { NUMBER_FORMATS, NUMBER_PRECISIONS, ZERO_DECIMAL_FORMATS } from './schema.ts';

const UNCAPPED_MAX_FRACTION = 12;

export function precisionDigits(precision: string | undefined): number | null {
  return NUMBER_PRECISIONS.find((p) => p.id === precision)?.digits ?? null;
}

/** Format a number for display ("$1,200.00", "50%", "1,234"). */
export function formatNumber(n: number | null | undefined, format?: string, precision?: string, opts?: { maxFractionDigits?: number }): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';
  const digits = precisionDigits(precision);
  const fixed = digits !== null ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : null;
  const cap = opts?.maxFractionDigits ?? UNCAPPED_MAX_FRACTION;
  const fmt = format ?? 'number';
  try {
    if (fmt === 'number') {
      return new Intl.NumberFormat('en-US', { useGrouping: false, ...(fixed ?? { maximumFractionDigits: cap }) }).format(n);
    }
    if (fmt === 'number_with_commas') {
      return new Intl.NumberFormat('en-US', { useGrouping: true, ...(fixed ?? { maximumFractionDigits: cap }) }).format(n);
    }
    if (fmt === 'percent') {
      return new Intl.NumberFormat('en-US', {
        style: 'percent', useGrouping: false, roundingMode: 'halfExpand',
        ...(fixed ?? { maximumFractionDigits: Math.min(cap, 10) }),
      } as Intl.NumberFormatOptions).format(n);
    }
    const meta = NUMBER_FORMATS.find((f) => f.id === fmt);
    if (meta?.currency === 'BTC') {
      const body = new Intl.NumberFormat('en-US', fixed ?? { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(Math.abs(n));
      return `${n < 0 ? '-' : ''}₿${body}`;
    }
    if (meta?.currency) {
      const zero = ZERO_DECIMAL_FORMATS.has(fmt);
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: meta.currency, currencyDisplay: 'narrowSymbol',
        ...(fixed ?? (zero ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
      }).format(n);
    }
  } catch {
    /* fall through */
  }
  return String(n);
}

/**
 * Parse user input into a number: "1,234.5" → 1234.5, "12%" → 0.12, "$1,200" → 1200, "1e3" → 1000.
 * Returns null for empty/invalid input.
 */
export function parseNumberInput(text: string): number | null {
  let s = String(text ?? '').trim();
  if (!s) return null;
  let percent = false;
  if (s.endsWith('%')) {
    percent = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[\s,]/g, '').replace(/^[^\d+\-.]+/, '').replace(/[^\d.eE+-]+$/, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}

/** Bar/ring fraction for number "show as" (value / maxValue, clamped). */
export function showAsFraction(n: number | null, maxValue: number | undefined): number {
  if (n === null || !Number.isFinite(n)) return 0;
  const max = maxValue && maxValue > 0 ? maxValue : 100;
  return Math.max(0, Math.min(1, n / max));
}
