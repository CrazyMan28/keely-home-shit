import { describe, expect, it } from 'vitest';
import { parseAngle, parseLength } from '../geometry/measurement/parse';
import { formatArea, formatImperial, formatLength, formatLengthForInput, formatMetric } from '../geometry/measurement/format';
import { DEFAULT_UNIT_SETTINGS, MM_PER_INCH } from '../geometry/measurement/units';

const mm = (s: string, opts?: Parameters<typeof parseLength>[1]) => {
  const r = parseLength(s, opts);
  if (!r.ok) throw new Error(`parse failed: ${s}: ${r.error}`);
  return r.mm;
};
const inches = (n: number) => n * MM_PER_INCH;

describe('parseLength – imperial', () => {
  it.each([
    [`15'2"`, 182],
    [`15' 2"`, 182],
    [`15'-2"`, 182],
    [`15 ft 2 in`, 182],
    [`15 feet 2 inches`, 182],
    [`15ft2in`, 182],
    [`15' 2`, 182],
    [`70"`, 70],
    [`70 in`, 70],
    [`70`, 70],
    [`12'`, 144],
    [`1/2"`, 0.5],
    [`2 1/2"`, 2.5],
    [`15’ 2”`, 182],
    [`15′2″`, 182],
    [`8' + 3 1/2"`, 99.5],
    [`10' - 4"`, 116],
  ])('%s → %d in', (input, expected) => {
    expect(mm(input)).toBeCloseTo(inches(expected), 9);
  });

  it('parses fractional inches three equivalent ways', () => {
    const a = mm(`5' 10 1/2"`);
    const b = mm(`70.5"`);
    const c = mm(`5 ft 10.5 in`);
    const d = mm(`5'10.5"`);
    const e = mm(`5'10-1/2"`);
    expect(a).toBeCloseTo(1790.7, 9);
    for (const x of [b, c, d, e]) expect(x).toBeCloseTo(a, 9);
  });

  it('parses decimal feet', () => {
    expect(mm('5.875 ft')).toBeCloseTo(inches(70.5), 9);
  });

  it('rejects garbage and negatives unless allowed', () => {
    expect(parseLength('abc').ok).toBe(false);
    expect(parseLength('').ok).toBe(false);
    expect(parseLength('-3"').ok).toBe(false);
    expect(mm('-3"', { allowNegative: true })).toBeCloseTo(-inches(3), 9);
    expect(parseLength('1/0"').ok).toBe(false);
  });
});

describe('parseLength – metric', () => {
  it.each([
    ['1778 mm', 1778],
    ['177.8 cm', 1778],
    ['1.778 m', 1778],
    ['1 m 20 cm', 1200],
    ['1 m 20', 1200],
    ['1,5 m', 1500],
  ])('%s → %d mm', (input, expected) => {
    expect(mm(input)).toBeCloseTo(expected, 9);
  });

  it('bare numbers use the metric default unit', () => {
    expect(mm('1778', { system: 'metric', metricUnit: 'mm' })).toBe(1778);
    expect(mm('177.8', { system: 'metric', metricUnit: 'cm' })).toBeCloseTo(1778, 9);
  });
});

describe('formatting', () => {
  it('formats feet/inches with fraction precision', () => {
    expect(formatImperial(1778, 1)).toBe(`5' 10"`);
    expect(formatImperial(inches(70.5), 8)).toBe(`5' 10 1/2"`);
    expect(formatImperial(inches(70.5), 1)).toBe(`5' 11"`);
    expect(formatImperial(inches(10.125), 16)).toBe(`10 1/8"`);
    expect(formatImperial(inches(144), 16)).toBe(`12' 0"`);
    expect(formatImperial(0, 16)).toBe(`0"`);
  });

  it('carries rounding into feet (never prints 12")', () => {
    expect(formatImperial(inches(11.99), 8)).toBe(`1' 0"`);
    expect(formatImperial(inches(143.97), 16)).toBe(`12' 0"`);
  });

  it('formats metric', () => {
    expect(formatMetric(1778, 'mm')).toBe('1,778 mm');
    expect(formatMetric(1778, 'cm')).toBe('177.8 cm');
    expect(formatMetric(1778, 'm')).toBe('1.778 m');
  });

  it('formats area', () => {
    expect(formatArea(inches(144) * inches(120), DEFAULT_UNIT_SETTINGS)).toBe('120.0 ft²');
    expect(formatArea(12_000_000, { ...DEFAULT_UNIT_SETTINGS, system: 'metric' })).toBe('12.00 m²');
  });

  it('round-trips through the input formatter without drift', () => {
    const units = { ...DEFAULT_UNIT_SETTINGS, imperialPrecision: 16 as const };
    for (const v of [inches(182), inches(70.5), inches(3.0625), inches(0.25), 4623]) {
      const s = formatLengthForInput(v, units);
      const back = mm(s);
      expect(Math.abs(back - v)).toBeLessThanOrEqual(inches(1 / 32) + 1e-9);
      // A second round trip is exactly stable.
      expect(mm(formatLengthForInput(back, units))).toBeCloseTo(back, 9);
    }
  });

  it('formatLength honors the unit system', () => {
    expect(formatLength(4623, DEFAULT_UNIT_SETTINGS)).toBe(`15' 2"`);
  });
});

describe('parseAngle', () => {
  it('parses degrees', () => {
    expect(parseAngle('90°')).toEqual({ ok: true, deg: 90 });
    expect(parseAngle('45 deg')).toEqual({ ok: true, deg: 45 });
    expect(parseAngle('-12.5')).toEqual({ ok: true, deg: -12.5 });
    expect(parseAngle('x').ok).toBe(false);
  });
});
