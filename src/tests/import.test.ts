import { describe, expect, it } from 'vitest';
import { buildFloorFromReconstruction } from '../import/reconciliation/buildPlan';
import { CLOSURE_TOLERANCE, defaultLayout, reconstruct, reconstructRoom } from '../import/reconciliation/reconcile';
import { detectFaces } from '../geometry/rooms/roomDetection';
import { DEFAULT_INTERIOR_THICKNESS, createFloor } from '../model/factory';
import type { Observation } from '../model/types';
import { SAMPLE_OBSERVATIONS } from './fixtures/sampleObservations';
import { ft } from './helpers';

let seq = 0;
function edge(group: string, direction: Observation['direction'], text: string, valueMm: number | undefined, extra: Partial<Observation> = {}): Observation {
  seq++;
  return {
    id: `obs-${seq}`,
    type: 'wall_length',
    sourceImageId: 'img-1',
    originalText: text,
    valueMm,
    alternatives: [],
    confidence: 0.95,
    interpretation: 'wall length',
    status: 'likely',
    group,
    direction,
    sequence: seq,
    provider: 'test',
    ...extra,
  };
}

describe('reconciliation', () => {
  it('closes a consistent rectangle exactly', () => {
    const obs = [edge('Kitchen', 'E', `15'2"`, ft(15, 2)), edge('Kitchen', 'S', `11'6"`, ft(11, 6)), edge('Kitchen', 'W', `15'2"`, ft(15, 2)), edge('Kitchen', 'N', `11'6"`, ft(11, 6))];
    const r = reconstructRoom('Kitchen', obs);
    expect(r.closed).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(r.polygon[2]).toEqual({ x: ft(15, 2), y: ft(11, 6) });
  });

  it('reports a conflict instead of distorting geometry', () => {
    const obs = [edge('Den', 'E', `15'2"`, ft(15, 2)), edge('Den', 'S', `11'6"`, ft(11, 6)), edge('Den', 'W', `15'4"`, ft(15, 4)), edge('Den', 'N', `11'6"`, ft(11, 6))];
    const r = reconstructRoom('Den', obs);
    expect(r.closed).toBe(false);
    const conflict = r.issues.find((i) => i.kind === 'conflict')!;
    expect(conflict).toBeDefined();
    expect(conflict.title).toMatch(/can’t all be true/);
    expect(Math.abs(conflict.error!.x)).toBeCloseTo(ft(0, 2), 6);
    // Measurements are untouched.
    expect(r.edges.map((e) => e.length)).toEqual([ft(15, 2), ft(11, 6), ft(15, 4), ft(11, 6)]);
    expect(conflict.options.some((o) => o.label.includes(`15'4"`))).toBe(true);
  });

  it('an explicitly approximate edge absorbs the error — and only then', () => {
    const obs = [edge('Den', 'E', `15'2"`, ft(15, 2)), edge('Den', 'S', `11'6"`, ft(11, 6)), edge('Den', 'W', `15'4"`, ft(15, 4), { approximate: true }), edge('Den', 'N', `11'6"`, ft(11, 6))];
    const r = reconstructRoom('Den', obs);
    expect(r.closed).toBe(true);
    const w = r.edges[2];
    expect(w.source).toBe('absorbed');
    expect(w.length).toBeCloseTo(ft(15, 2), 6);
    expect(w.measured).toBeCloseTo(ft(15, 4), 6);
  });

  it('closes within tolerance and says so', () => {
    const obs = [edge('Bath', 'E', `8'`, ft(8)), edge('Bath', 'S', `5'`, ft(5)), edge('Bath', 'W', `8' 1/8"`, ft(8, 0.125)), edge('Bath', 'N', `5'`, ft(5))];
    const r = reconstructRoom('Bath', obs);
    expect(r.closed).toBe(true);
    expect(ft(0, 0.125)).toBeLessThan(CLOSURE_TOLERANCE);
    expect(r.issues.some((i) => i.kind === 'closedWithinTolerance')).toBe(true);
  });

  it('derives a single missing edge and flags it', () => {
    const obs = [
      edge('L', 'E', `20'`, ft(20)),
      edge('L', 'S', `8'`, ft(8)),
      edge('L', 'W', `8'`, ft(8)),
      edge('L', 'S', `8'`, ft(8)),
      edge('L', 'W', '?', undefined, { status: 'missing' }),
      edge('L', 'N', `16'`, ft(16)),
    ];
    const r = reconstructRoom('L', obs);
    expect(r.closed).toBe(true);
    expect(r.edges[4].source).toBe('derived');
    expect(r.edges[4].length).toBeCloseTo(ft(12), 6);
    expect(r.issues.some((i) => i.kind === 'missing' && i.severity === 'info')).toBe(true);
  });

  it('flags readings without a direction', () => {
    const obs = [edge('X', 'E', `10'`, ft(10)), edge('X', undefined, `9'`, ft(9)), edge('X', 'W', `10'`, ft(10))];
    const r = reconstructRoom('X', obs);
    expect(r.issues.some((i) => i.kind === 'noDirection')).toBe(true);
  });
});

describe('building the measured plan', () => {
  it('produces walls whose finished faces match interior measurements', () => {
    const obs = [edge('Kitchen', 'E', `12'`, ft(12), { status: 'confirmed' }), edge('Kitchen', 'S', `10'`, ft(10), { status: 'confirmed' }), edge('Kitchen', 'W', `12'`, ft(12), { status: 'confirmed' }), edge('Kitchen', 'N', `10'`, ft(10), { status: 'confirmed' })];
    const recon = reconstruct(obs);
    const res = buildFloorFromReconstruction(createFloor(), recon, defaultLayout(recon.rooms), obs, { interiorMeasurements: true, lockMeasured: true }, 2438.4);
    const faces = detectFaces(res.floor);
    expect(faces).toHaveLength(1);
    expect(faces[0].area).toBeCloseTo(ft(12) * ft(10), 0);
    expect(Object.values(res.floor.rooms)[0].name).toBe('Kitchen');
    expect(Object.values(res.floor.walls).every((w) => w.locks.length)).toBe(true);
    expect(Object.keys(res.links)).toHaveLength(4);
  });

  it('adjacent rooms one wall apart share a single interior wall', () => {
    const a = [edge('A', 'E', `10'`, ft(10)), edge('A', 'S', `10'`, ft(10)), edge('A', 'W', `10'`, ft(10)), edge('A', 'N', `10'`, ft(10))];
    const b = [edge('B', 'E', `8'`, ft(8)), edge('B', 'S', `10'`, ft(10)), edge('B', 'W', `8'`, ft(8)), edge('B', 'N', `10'`, ft(10))];
    const obs = [...a, ...b];
    const recon = reconstruct(obs);
    const layout = { A: { x: 0, y: 0 }, B: { x: ft(10) + DEFAULT_INTERIOR_THICKNESS, y: 0 } };
    const res = buildFloorFromReconstruction(createFloor(), recon, layout, obs, { interiorMeasurements: true, lockMeasured: false }, 2438.4);
    const faces = detectFaces(res.floor);
    expect(faces).toHaveLength(2);
    const areas = faces.map((f) => f.area).sort((x, y) => x - y);
    expect(areas[0]).toBeCloseTo(ft(8) * ft(10), 0);
    expect(areas[1]).toBeCloseTo(ft(10) * ft(10), 0);
    const interior = Object.values(res.floor.walls).filter((w) => w.wallType === 'interior');
    expect(interior).toHaveLength(1);
  });

  it('places doors and windows on the referenced edge', () => {
    const obs = [
      edge('Bed', 'E', `12'`, ft(12)),
      edge('Bed', 'S', `11'`, ft(11)),
      edge('Bed', 'W', `12'`, ft(12)),
      edge('Bed', 'N', `11'`, ft(11)),
      { ...edge('Bed', undefined, `36"`, ft(3)), type: 'window' as const, edgeIndex: 0, offsetMm: ft(2) },
      { ...edge('Bed', undefined, `32"`, ft(2, 8)), type: 'door' as const, edgeIndex: 2 },
    ];
    const recon = reconstruct(obs);
    const res = buildFloorFromReconstruction(createFloor(), recon, defaultLayout(recon.rooms), obs, { interiorMeasurements: true, lockMeasured: false }, 2438.4);
    const openings = Object.values(res.floor.openings);
    expect(openings.map((o) => o.type).sort()).toEqual(['door', 'window']);
    expect(openings.find((o) => o.type === 'window')!.width).toBeCloseTo(ft(3), 6);
  });
});

describe('sample sketch fixture', () => {
  it('reconstructs the fixture rooms and surfaces its deliberate conflict', () => {
    const recon = reconstruct(SAMPLE_OBSERVATIONS);
    expect(recon.rooms.map((r) => r.group).sort()).toEqual(['Bathroom', 'Kitchen', 'Living Room']);
    expect(recon.rooms.find((r) => r.group === 'Kitchen')!.closed).toBe(true);
    expect(recon.issues.some((i) => i.kind === 'conflict' && i.group === 'Living Room')).toBe(true);
    expect(recon.issues.some((i) => i.kind === 'ambiguous')).toBe(true);
  });
});
