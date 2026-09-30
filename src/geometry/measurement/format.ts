import { MM2_PER_FT2, MM2_PER_M2, MM_PER_INCH, type UnitSettings } from './units';

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Formats millimeters as feet-inches-fraction, e.g. 1778 → `5' 10"`.
 * Rounds once, to the nearest 1/precision inch, and carries into feet so we
 * never print 12" or 16/16.
 */
export function formatImperial(mm: number, precision: number, opts: { compact?: boolean } = {}): string {
  const negative = mm < 0;
  const totalUnits = Math.round((Math.abs(mm) / MM_PER_INCH) * precision);
  const unitsPerFoot = 12 * precision;
  const feet = Math.floor(totalUnits / unitsPerFoot);
  const remUnits = totalUnits - feet * unitsPerFoot;
  const inches = Math.floor(remUnits / precision);
  const fracNum = remUnits - inches * precision;
  let frac = '';
  if (fracNum > 0) {
    const g = gcd(fracNum, precision);
    frac = `${fracNum / g}/${precision / g}`;
  }
  const sign = negative && totalUnits > 0 ? '-' : '';
  const inchPart = inches > 0 && frac ? `${inches} ${frac}` : inches > 0 ? `${inches}` : frac ? frac : '0';
  if (feet === 0) return `${sign}${inchPart}"`;
  if (opts.compact && inchPart === '0') return `${sign}${feet}'`;
  return `${sign}${feet}' ${inchPart}"`;
}

export function formatMetric(mm: number, unit: 'mm' | 'cm' | 'm'): string {
  switch (unit) {
    case 'mm':
      return `${Math.round(mm).toLocaleString('en-US')} mm`;
    case 'cm':
      return `${(Math.round(mm) / 10).toFixed(1)} cm`;
    case 'm':
      return `${(Math.round(mm) / 1000).toFixed(3)} m`;
  }
}

export function formatLength(mm: number, units: UnitSettings, opts: { compact?: boolean } = {}): string {
  return units.system === 'imperial'
    ? formatImperial(mm, units.imperialPrecision, opts)
    : formatMetric(mm, units.metricUnit);
}

/** Formats an editable string that round-trips through parseLength. */
export function formatLengthForInput(mm: number, units: UnitSettings): string {
  if (units.system === 'imperial') return formatImperial(mm, Math.max(units.imperialPrecision, 16));
  switch (units.metricUnit) {
    case 'mm':
      return `${+mm.toFixed(1)} mm`;
    case 'cm':
      return `${+(mm / 10).toFixed(2)} cm`;
    case 'm':
      return `${+(mm / 1000).toFixed(4)} m`;
  }
}

export function formatArea(mm2: number, units: UnitSettings): string {
  if (units.system === 'imperial') return `${(mm2 / MM2_PER_FT2).toFixed(1)} ft²`;
  return `${(mm2 / MM2_PER_M2).toFixed(2)} m²`;
}

export function formatAngle(deg: number, digits = 1): string {
  let d = deg % 360;
  if (d < 0) d += 360;
  const rounded = +d.toFixed(digits);
  return `${rounded === 360 ? 0 : rounded}°`;
}

/** Signed offset with explicit +/−, used for live drag read-outs. */
export function formatSignedLength(mm: number, units: UnitSettings): string {
  const s = formatLength(Math.abs(mm), units);
  return `${mm < 0 ? '−' : '+'}${s}`;
}
