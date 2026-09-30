import { MM_PER_FOOT, MM_PER_INCH, type UnitSystem, type MetricUnit } from './units';

/**
 * Parses human-entered lengths into millimeters.
 *
 * Accepted forms (any mix, case-insensitive):
 *   15'2"   15' 2"   15'-2"   15ft 2in   15 feet 2 inches   5'10 1/2"   5'10.5"
 *   70"   70 in   2 1/2"   1/2"   5.875 ft   1778 mm   177.8 cm   1.778 m
 *   curly/prime quotes (’ ” ′ ″) typed by iOS/macOS smart punctuation
 *   simple arithmetic between terms:  12' + 3 1/2"   10' - 4"
 * A bare number with no unit uses the `defaultUnit` (inches for imperial,
 * the chosen metric unit for metric).
 */

export interface ParseOptions {
  system?: UnitSystem;
  metricUnit?: MetricUnit;
  /** Allow a negative result (offsets). Default false. */
  allowNegative?: boolean;
}

export type ParseResult =
  | { ok: true; mm: number }
  | { ok: false; error: string };

type Unit = 'ft' | 'in' | 'mm' | 'cm' | 'm';

const UNIT_MM: Record<Unit, number> = {
  ft: MM_PER_FOOT,
  in: MM_PER_INCH,
  mm: 1,
  cm: 10,
  m: 1000,
};

const UNIT_WORDS: Array<[RegExp, Unit]> = [
  [/^(feet|foot|ft)(?![a-z])/, 'ft'],
  [/^(inches|inch|in)(?![a-z])/, 'in'],
  [/^(millimeters|millimetres|millimeter|millimetre|mm)(?![a-z])/, 'mm'],
  [/^(centimeters|centimetres|centimeter|centimetre|cm)(?![a-z])/, 'cm'],
  [/^(meters|metres|meter|metre|m)(?![a-z])/, 'm'],
  [/^('')/, 'in'],
  [/^(')/, 'ft'],
  [/^(")/, 'in'],
];

function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[’‘′`´]/g, "'")
    .replace(/[”“″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ');
}

interface NumberToken {
  value: number;
  rest: string;
}

/** Reads "10", "10.5", ".5", "10 1/2", "1/2", "10-1/2" at the start of s. */
function readNumber(s: string): NumberToken | null {
  const mixed = /^(\d+(?:\.\d+)?)[ -]+(\d+)\/(\d+)/.exec(s);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return { value: Number(mixed[1]) + Number(mixed[2]) / den, rest: s.slice(mixed[0].length) };
  }
  const frac = /^(\d+)\/(\d+)/.exec(s);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return { value: Number(frac[1]) / den, rest: s.slice(frac[0].length) };
  }
  const dec = /^(\d+(?:\.\d*)?|\.\d+)/.exec(s);
  if (dec) return { value: Number(dec[1]), rest: s.slice(dec[0].length) };
  return null;
}

function readUnit(s: string): { unit: Unit; rest: string } | null {
  for (const [re, unit] of UNIT_WORDS) {
    const m = re.exec(s);
    if (m) return { unit, rest: s.slice(m[0].length) };
  }
  return null;
}

export function parseLength(input: string, options: ParseOptions = {}): ParseResult {
  const system = options.system ?? 'imperial';
  const defaultUnit: Unit = system === 'imperial' ? 'in' : (options.metricUnit ?? 'mm');
  let s = normalize(input);
  if (!s) return { ok: false, error: 'Enter a length' };

  let total = 0;
  let sign = 1;
  let termCount = 0;
  let lastUnit: Unit | null = null;

  // A leading sign applies to the first term.
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1).trimStart();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trimStart();
  }

  while (s.length) {
    const num = readNumber(s);
    if (!num) return { ok: false, error: `Couldn't read "${input.trim()}"` };
    s = num.rest.trimStart();
    let unit: Unit | null = null;
    const u = readUnit(s);
    if (u) {
      unit = u.unit;
      s = u.rest.trimStart();
    }
    if (!unit) {
      // "15' 2" → implicit inches after a feet term; "1 m 20" → cm; else default.
      unit = lastUnit === 'ft' ? 'in' : lastUnit === 'm' ? 'cm' : defaultUnit;
    }
    total += sign * num.value * UNIT_MM[unit];
    termCount++;
    lastUnit = unit;

    if (!s.length) break;
    // Architectural "15'-2"": dash with no spaces directly after a feet term.
    if (unit === 'ft' && /^-\s?\d/.test(s) && !/^-\s/.test(s)) {
      s = s.slice(1);
      continue;
    }
    if (s.startsWith('+')) {
      sign = 1;
      s = s.slice(1).trimStart();
      lastUnit = null;
      continue;
    }
    if (s.startsWith('-')) {
      sign = -1;
      s = s.slice(1).trimStart();
      lastUnit = null;
      continue;
    }
    if (s.startsWith('and ')) {
      s = s.slice(4);
      continue;
    }
    // Juxtaposed terms ("15' 2"", "1 m 20 cm") are summed with the same sign.
  }

  if (termCount === 0) return { ok: false, error: 'Enter a length' };
  if (!Number.isFinite(total)) return { ok: false, error: 'Invalid number' };
  if (total < 0 && !options.allowNegative) return { ok: false, error: 'Length must be positive' };
  return { ok: true, mm: total };
}

/** Parses an angle in degrees: "90", "90°", "45 deg", "-12.5". */
export function parseAngle(input: string): { ok: true; deg: number } | { ok: false; error: string } {
  const s = input.trim().toLowerCase().replace(/°|deg(rees?)?/g, '').trim();
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return { ok: false, error: 'Enter an angle in degrees' };
  return { ok: true, deg: Number(s) };
}
