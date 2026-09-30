/**
 * Canonical unit system.
 *
 * Every length in the document model is a plain number of MILLIMETERS.
 * Imperial conversions use the exact definition 1 in = 25.4 mm, so parsing
 * and formatting never introduce drift beyond float epsilon. Values are only
 * rounded at display time.
 */

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;
export const MM2_PER_FT2 = MM_PER_FOOT * MM_PER_FOOT;
export const MM2_PER_M2 = 1_000_000;

/** Geometric tolerance for treating two lengths as equal (0.05 mm). */
export const LENGTH_EPSILON = 0.05;

export type UnitSystem = 'imperial' | 'metric';
export type MetricUnit = 'mm' | 'cm' | 'm';
/** Denominator of the smallest displayed inch fraction. */
export type ImperialPrecision = 1 | 2 | 4 | 8 | 16;

export interface UnitSettings {
  system: UnitSystem;
  imperialPrecision: ImperialPrecision;
  metricUnit: MetricUnit;
}

export const DEFAULT_UNIT_SETTINGS: UnitSettings = {
  system: 'imperial',
  imperialPrecision: 8,
  metricUnit: 'mm',
};

export const inchesToMm = (inches: number): number => inches * MM_PER_INCH;
export const feetToMm = (feet: number): number => feet * MM_PER_FOOT;
export const mmToInches = (mm: number): number => mm / MM_PER_INCH;
export const mmToFeet = (mm: number): number => mm / MM_PER_FOOT;
