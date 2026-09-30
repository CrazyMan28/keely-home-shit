import type { Observation } from '../../model/types';
import { inchesToMm } from '../../geometry/measurement/units';

/**
 * Observations as a sketch reader would propose them for a typical
 * hand-drawn measurement sheet. Used as a realistic regression fixture until
 * the real sketch photos are added under /fixtures/measurement-sketches.
 *
 *  - Kitchen: L-shape with a pantry alcove (non-rectangular), closes exactly.
 *  - Living Room: north says 15'2", south says 15'4" → must be a conflict.
 *  - Bathroom: one reading is ambiguous (5'10" vs 5'11").
 */
const i = (inches: number) => inchesToMm(inches);
let n = 0;
const o = (group: string, direction: Observation['direction'], text: string, inches: number | undefined, extra: Partial<Observation> = {}): Observation => ({
  id: `fx-${++n}`,
  type: 'wall_length',
  sourceImageId: 'fixture-sketch-1',
  originalText: text,
  valueMm: inches === undefined ? undefined : i(inches),
  alternatives: [],
  confidence: 0.93,
  interpretation: 'Wall length (interior, wall to wall)',
  status: 'likely',
  group,
  direction,
  sequence: n,
  provider: 'fixture',
  ...extra,
});

export const SAMPLE_OBSERVATIONS: Observation[] = [
  // Kitchen (clockwise from the north-west corner)
  o('Kitchen', 'E', `13'8"`, 164),
  o('Kitchen', 'S', `4'2"`, 50),
  o('Kitchen', 'E', `2'6"`, 30, { interpretation: 'Pantry alcove depth' }),
  o('Kitchen', 'S', `3'0"`, 36),
  o('Kitchen', 'W', `2'6"`, 30),
  o('Kitchen', 'S', `4'4"`, 52),
  o('Kitchen', 'W', `13'8"`, 164),
  o('Kitchen', 'N', `11'6"`, 138),
  // Living room — contradictory north/south
  o('Living Room', 'E', `15'2"`, 182),
  o('Living Room', 'S', `12'0"`, 144),
  o('Living Room', 'W', `15'4"`, 184),
  o('Living Room', 'N', `12'0"`, 144),
  // Bathroom — ambiguous reading
  o('Bathroom', 'E', `8'2"`, 98),
  o('Bathroom', 'S', `5'10"`, 70, {
    status: 'ambiguous',
    confidence: 0.63,
    alternatives: [
      { text: `5'10"`, valueMm: i(70), confidence: 0.63 },
      { text: `5'11"`, valueMm: i(71), confidence: 0.31 },
    ],
  }),
  o('Bathroom', 'W', `8'2"`, 98),
  o('Bathroom', 'N', `5'10"`, 70),
];
