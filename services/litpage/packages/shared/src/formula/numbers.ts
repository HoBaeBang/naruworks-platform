// Number display formats: number, number_with_commas, percent, 42 currencies,
// plus the formula-only compact ("humanize") and bytes formats.

export const CURRENCY_FORMATS: Record<string, string> = {
  dollar: 'USD', australian_dollar: 'AUD', canadian_dollar: 'CAD', singapore_dollar: 'SGD', euro: 'EUR', pound: 'GBP', yen: 'JPY',
  ruble: 'RUB', rupee: 'INR', won: 'KRW', yuan: 'CNY', real: 'BRL', lira: 'TRY', rupiah: 'IDR', franc: 'CHF', hong_kong_dollar: 'HKD',
  new_zealand_dollar: 'NZD', krona: 'SEK', norwegian_krone: 'NOK', mexican_peso: 'MXN', rand: 'ZAR', new_taiwan_dollar: 'TWD',
  danish_krone: 'DKK', zloty: 'PLN', baht: 'THB', forint: 'HUF', koruna: 'CZK', shekel: 'ILS', chilean_peso: 'CLP', philippine_peso: 'PHP',
  dirham: 'AED', colombian_peso: 'COP', riyal: 'SAR', ringgit: 'MYR', leu: 'RON', argentine_peso: 'ARS', uruguayan_peso: 'UYU',
  peruvian_sol: 'PEN', vietnamese_dong: 'VND', pakistani_rupee: 'PKR', nigerian_naira: 'NGN', bitcoin: 'BTC',
};

/** Formats offered in the property "Number format" menu, in menu order. */
export const NUMBER_FORMATS = ['number', 'number_with_commas', 'percent', ...Object.keys(CURRENCY_FORMATS)];
const ZERO_DECIMAL = new Set(['yen', 'won', 'vietnamese_dong']);
const MAX_FRACTION = 12;

/** formatNumber() argument -> internal format name: humanize/commas/bytes aliases + ISO currency codes. */
export function resolveNumberFormat(arg: string): string | null {
  const a = arg.toLowerCase();
  const alias: Record<string, string> = { humanize: 'compact', commas: 'number_with_commas', bytes: 'bytes_binary' };
  for (const [name, code] of Object.entries(CURRENCY_FORMATS)) alias[code.toLowerCase()] = name;
  const f = alias[a] ?? a;
  return [...NUMBER_FORMATS, 'compact', 'bytes', 'bytes_binary', 'bytes_decimal'].includes(f) ? f : null;
}

function precisionDigits(p: number | string | undefined): { max: number; min?: number; explicit: boolean } {
  if (typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= MAX_FRACTION) return { max: p, min: p, explicit: true };
  if (typeof p === 'string' && /^precision_\d$/.test(p)) {
    const n = Number(p.slice(-1));
    return { max: n, min: n, explicit: true };
  }
  return { max: MAX_FRACTION, explicit: false };
}

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(opts);
  let f = nfCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-US', opts);
    } catch {
      f = new Intl.NumberFormat('en-US', { ...opts, roundingMode: undefined } as Intl.NumberFormatOptions);
    }
    nfCache.set(key, f);
  }
  return f;
}

function bytes(n: number, decimals: number, base: 2 | 10): string {
  if (n === 0) return '0 B';
  const k = base === 2 ? 1024 : 1000;
  const units = ['B', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
  const neg = n < 0;
  const a = Math.abs(n);
  const dec = decimals < 0 ? 0 : decimals;
  if (a < k) return `${neg ? '-' : ''}${parseFloat(a.toFixed(dec))} B`;
  const i = Math.min(Math.floor(Math.log(a) / Math.log(k)), units.length - 1);
  return `${neg ? '-' : ''}${parseFloat((a / Math.pow(k, i)).toFixed(dec))} ${units[i]}${base === 2 ? 'i' : ''}B`;
}

/** Display a number with a number format and precision ("precision_2" or 0-12). */
export function formatNumberValue(n: number | undefined | null, format = 'number', precision?: number | string): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  const { max, min, explicit } = precisionDigits(precision);
  const rounding = { roundingMode: 'halfExpand' } as Intl.NumberFormatOptions;
  if (format === 'percent') return nf({ style: 'percent', maximumFractionDigits: max, minimumFractionDigits: min, useGrouping: false, ...rounding }).format(n);
  if (format === 'bitcoin') return `₿${nf({ maximumFractionDigits: max, minimumFractionDigits: min, ...rounding }).format(n)}`;
  const currency = CURRENCY_FORMATS[format];
  if (currency) {
    if (ZERO_DECIMAL.has(format) && !explicit) return nf({ style: 'currency', currency, currencyDisplay: 'symbol', maximumFractionDigits: 0, minimumFractionDigits: 0, ...rounding }).format(Math.round(n));
    return nf({ style: 'currency', currency, currencyDisplay: 'symbol', ...(explicit ? { maximumFractionDigits: max, minimumFractionDigits: min } : {}), ...rounding }).format(n);
  }
  if (format === 'number_with_commas') return nf({ maximumFractionDigits: max, minimumFractionDigits: min, useGrouping: true, ...rounding }).format(n);
  if (format === 'compact') return nf({ notation: 'compact' }).format(n);
  if (format === 'bytes' || format === 'bytes_binary' || format === 'bytes_decimal') return bytes(n, explicit ? max : 2, format === 'bytes_decimal' ? 10 : 2);
  return nf({ maximumFractionDigits: max, minimumFractionDigits: min, useGrouping: false, ...rounding }).format(n);
}

/** Round to `digits` decimal places like lodash round (used on final formula results, with 12 digits). */
export function roundTo(n: number, digits = MAX_FRACTION): number {
  if (!Number.isFinite(n)) return n;
  const shift = (x: number, e: number) => {
    const [m, ex = '0'] = String(x).split('e');
    return Number(`${m}e${Number(ex) + e}`);
  };
  return shift(Math.round(shift(n, digits)), -digits);
}

/** Decimal-safe arithmetic for non-integers (+ - * / % and mean/sum). */
function decimals(x: number): number {
  if (Number.isInteger(x)) return 0;
  const s = String(x);
  const e = s.indexOf('e-');
  if (e >= 0) return Number(s.slice(e + 2)) + (s.slice(0, e).split('.')[1]?.length ?? 0);
  return s.split('.')[1]?.length ?? 0;
}

export function decAdd(a: number, b: number): number {
  if (Number.isInteger(a) && Number.isInteger(b)) return a + b;
  const d = Math.min(Math.max(decimals(a), decimals(b)), 20);
  return roundTo(a + b, d);
}

export function decSub(a: number, b: number): number {
  return decAdd(a, -b);
}

export function decMul(a: number, b: number): number {
  if (Number.isInteger(a) && Number.isInteger(b)) return a * b;
  const d = Math.min(decimals(a) + decimals(b), 20);
  return roundTo(a * b, d);
}

export function decDiv(a: number, b: number): number {
  const k = Math.max(decimals(a), decimals(b));
  if (k === 0 || k > 15) return a / b;
  const s = Math.pow(10, k);
  return Math.round(a * s) / Math.round(b * s);
}

export function decMod(a: number, b: number): number {
  if (Number.isInteger(b) && Number.isInteger(a)) return a % b;
  const d = Math.min(Math.max(decimals(a), decimals(b)), 20);
  return roundTo(a % b, d);
}
