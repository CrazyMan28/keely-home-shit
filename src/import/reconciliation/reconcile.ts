import { inchesToMm } from '../../geometry/measurement/units';
import { lineIntersection } from '../../geometry/primitives/segment';
import { signedArea } from '../../geometry/primitives/polygon';
import { add, dot, exactDir, len, norm, perp, scale, sub, type Vec2 } from '../../geometry/primitives/vec';
import type { Id, Observation } from '../../model/types';

/**
 * Reconciliation engine.
 *
 * Readers (AI or manual) only PROPOSE observations: "the kitchen's first edge
 * runs East and says 15'2"". This module turns them into room outlines and
 * checks whether they are mathematically consistent. It never changes an
 * observed value to make geometry fit. When a loop doesn't close:
 *   - within tolerance (≤ 1/4"), the gap is closed and reported as info;
 *   - beyond tolerance, a CONFLICT is reported with explicit options, and the
 *     outline is drawn with the gap visible until the user chooses.
 * Only edges the user has explicitly marked "approximate" absorb error.
 */

export const CLOSURE_TOLERANCE = inchesToMm(0.25);

export type Compass = 'N' | 'E' | 'S' | 'W';
export const COMPASS_DEG: Record<Compass, number> = { E: 0, S: 90, W: 180, N: 270 };

export function directionVector(d: Observation['direction']): Vec2 | null {
  if (d === undefined) return null;
  if (typeof d === 'number') return exactDir(d);
  return exactDir(COMPASS_DEG[d]);
}

export const EDGE_TYPES: Observation['type'][] = ['wall_length', 'room_width', 'room_depth'];

export interface ReconEdge {
  obsId: Id;
  dir: Vec2;
  /** Length used for the outline. */
  length: number;
  /** Measured value (undefined when missing). */
  measured?: number;
  /** How `length` was obtained. */
  source: 'measured' | 'derived' | 'absorbed' | 'provisional';
  start: Vec2;
  end: Vec2;
}

export type ResolutionAction =
  | { kind: 'markApproximate'; obsIds: Id[] }
  | { kind: 'confirm'; obsIds: Id[] }
  | { kind: 'focus'; obsIds: Id[] };

export interface ReconIssue {
  id: string;
  group: string;
  severity: 'error' | 'warning' | 'info';
  kind: 'conflict' | 'missing' | 'underconstrained' | 'closedWithinTolerance' | 'noDirection' | 'ambiguous';
  title: string;
  detail: string;
  obsIds: Id[];
  options: Array<{ label: string; action: ResolutionAction }>;
  /** Signed closure error (mm) for conflicts. */
  error?: Vec2;
}

export interface RoomRecon {
  group: string;
  edges: ReconEdge[];
  /** Interior outline (room-local coordinates, first corner at origin). */
  polygon: Vec2[];
  closed: boolean;
  closure: Vec2;
  issues: ReconIssue[];
}

export interface Reconstruction {
  rooms: RoomRecon[];
  issues: ReconIssue[];
}

const usable = (o: Observation) => o.status !== 'rejected';

/** Human-friendly compass name for an edge direction. */
export function compassName(d: Vec2): string {
  if (Math.abs(d.x) < 1e-9) return d.y < 0 ? 'north' : 'south';
  if (Math.abs(d.y) < 1e-9) return d.x < 0 ? 'west' : 'east';
  return 'angled';
}

export function reconstructRoom(group: string, observations: Observation[], fmt: (mm: number) => string = (mm) => `${Math.round(mm)} mm`): RoomRecon {
  const issues: ReconIssue[] = [];
  const obs = observations
    .filter((o) => o.group === group && EDGE_TYPES.includes(o.type) && usable(o))
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  type Tmp = { o: Observation; dir: Vec2; value?: number };
  const tmp: Tmp[] = [];
  for (const o of obs) {
    const dir = directionVector(o.direction);
    if (!dir) {
      issues.push({
        id: `nodir-${o.id}`,
        group,
        severity: 'warning',
        kind: 'noDirection',
        title: `“${o.originalText}” has no direction`,
        detail: 'Choose which way this edge runs (N/E/S/W) so it can be placed.',
        obsIds: [o.id],
        options: [{ label: 'Show me', action: { kind: 'focus', obsIds: [o.id] } }],
      });
      continue;
    }
    tmp.push({ o, dir, value: o.valueMm });
    if (o.valueMm !== undefined && (o.status === 'ambiguous' || o.alternatives.length > 1) && !o.approximate) {
      issues.push({
        id: `amb-${o.id}`,
        group,
        severity: 'warning',
        kind: 'ambiguous',
        title: `Unclear reading “${o.originalText}”`,
        detail: o.alternatives.length ? `Could be ${o.alternatives.map((a) => a.text).join(' or ')} (${Math.round(o.confidence * 100)}% sure)` : `${Math.round(o.confidence * 100)}% confident`,
        obsIds: [o.id],
        options: [{ label: 'Review', action: { kind: 'focus', obsIds: [o.id] } }],
      });
    }
  }

  // 1. Sum known vectors; approximate edges are treated as unknown for closure.
  const known = tmp.filter((t) => t.value !== undefined && !t.o.approximate);
  const approx = tmp.filter((t) => t.value !== undefined && t.o.approximate);
  const missing = tmp.filter((t) => t.value === undefined);
  let sum: Vec2 = { x: 0, y: 0 };
  for (const t of known) sum = add(sum, scale(t.dir, t.value!));

  const lengths = new Map<Id, { length: number; source: ReconEdge['source'] }>();
  for (const t of known) lengths.set(t.o.id, { length: t.value!, source: 'measured' });

  // 2. Solve unknowns along each axis from closure (sum of all edges = 0).
  const unknown = [...missing, ...approx];
  const axisSolve = (axis: 'x' | 'y') => {
    const onAxis = unknown.filter((t) => Math.abs(t.dir[axis]) > 0.999);
    if (!onAxis.length) return;
    const need = -sum[axis];
    if (onAxis.length === 1) {
      const t = onAxis[0];
      const L = need / t.dir[axis];
      if (L > 0) {
        lengths.set(t.o.id, { length: L, source: t.value === undefined ? 'derived' : 'absorbed' });
        sum = add(sum, scale(t.dir, L));
      }
      return;
    }
    // Several unknowns on one axis: approximate edges keep their proportions; missing ones split evenly.
    const weights = onAxis.map((t) => t.value ?? 1);
    const signed = onAxis.map((t, i) => weights[i] * t.dir[axis]);
    const denom = signed.reduce((s, v) => s + v, 0);
    if (Math.abs(denom) < 1e-9) return;
    const k = need / denom;
    if (k <= 0) return;
    onAxis.forEach((t, i) => {
      const L = weights[i] * k;
      lengths.set(t.o.id, { length: L, source: t.value === undefined ? 'provisional' : 'absorbed' });
      sum = add(sum, scale(t.dir, L));
    });
    if (onAxis.some((t) => t.value === undefined))
      issues.push({
        id: `under-${group}-${axis}`,
        group,
        severity: 'warning',
        kind: 'underconstrained',
        title: `${group}: not enough ${axis === 'x' ? 'east–west' : 'north–south'} measurements`,
        detail: `${onAxis.filter((t) => t.value === undefined).length} edges are unmeasured, so their lengths are provisional guesses. Measure one of them to pin the shape down.`,
        obsIds: onAxis.map((t) => t.o.id),
        options: [{ label: 'Show edges', action: { kind: 'focus', obsIds: onAxis.map((t) => t.o.id) } }],
      });
  };
  axisSolve('x');
  axisSolve('y');

  // Angled unknown edges (rare): take whatever closes, if exactly one remains.
  for (const t of unknown) {
    if (lengths.has(t.o.id)) continue;
    const L = -dot(sum, t.dir);
    if (L > 0) {
      lengths.set(t.o.id, { length: L, source: t.value === undefined ? 'derived' : 'absorbed' });
      sum = add(sum, scale(t.dir, L));
    } else {
      lengths.set(t.o.id, { length: t.value ?? 0, source: 'provisional' });
    }
  }
  for (const t of missing) {
    const l = lengths.get(t.o.id)!;
    if (l.source === 'derived')
      issues.push({
        id: `derived-${t.o.id}`,
        group,
        severity: 'info',
        kind: 'missing',
        title: `${group}: ${compassName(t.dir)} edge not measured`,
        detail: `Derived from the other measurements as ${fmt(l.length)}. Worth confirming with a tape.`,
        obsIds: [t.o.id],
        options: [{ label: 'Show edge', action: { kind: 'focus', obsIds: [t.o.id] } }],
      });
  }

  // 3. Build the outline.
  const edges: ReconEdge[] = [];
  let p: Vec2 = { x: 0, y: 0 };
  for (const t of tmp) {
    const l = lengths.get(t.o.id) ?? { length: 0, source: 'provisional' as const };
    const end = add(p, scale(t.dir, l.length));
    edges.push({ obsId: t.o.id, dir: t.dir, length: l.length, measured: t.value, source: l.source, start: p, end });
    p = end;
  }
  const closure = p;
  const err = len(closure);
  let closed = edges.length >= 3 && err <= CLOSURE_TOLERANCE;

  if (edges.length >= 3 && err > CLOSURE_TOLERANCE) {
    // Explain per axis which measurements disagree.
    for (const axis of ['x', 'y'] as const) {
      const e = closure[axis];
      if (Math.abs(e) <= CLOSURE_TOLERANCE) continue;
      const involved = edges.filter((ed) => Math.abs(ed.dir[axis]) > 0.5);
      const pos = involved.filter((ed) => ed.dir[axis] > 0);
      const neg = involved.filter((ed) => ed.dir[axis] < 0);
      const sumOf = (list: ReconEdge[]) => list.reduce((s, ed) => s + ed.length * Math.abs(ed.dir[axis]), 0);
      const names = axis === 'x' ? ['east', 'west'] : ['south', 'north'];
      const describe = (list: ReconEdge[]) => list.map((ed) => `“${observations.find((o) => o.id === ed.obsId)?.originalText ?? fmt(ed.length)}”`).join(' + ');
      issues.push({
        id: `conflict-${group}-${axis}`,
        group,
        severity: 'error',
        kind: 'conflict',
        error: closure,
        title: `${group}: these measurements can’t all be true`,
        detail: `Going ${names[0]}: ${describe(pos) || 'nothing'} = ${fmt(sumOf(pos))}. Coming back ${names[1]}: ${describe(neg) || 'nothing'} = ${fmt(sumOf(neg))}. Off by ${fmt(Math.abs(e))}.`,
        obsIds: involved.map((ed) => ed.obsId),
        options: [
          ...involved.slice(0, 4).map((ed) => ({
            label: `Keep others, adjust ${observations.find((o) => o.id === ed.obsId)?.originalText ?? compassName(ed.dir)}`,
            action: { kind: 'markApproximate' as const, obsIds: [ed.obsId] },
          })),
          { label: 'Fit all within tolerance (mark approximate)', action: { kind: 'markApproximate', obsIds: involved.map((ed) => ed.obsId) } },
          { label: 'Let me fix the numbers', action: { kind: 'focus', obsIds: involved.map((ed) => ed.obsId) } },
        ],
      });
    }
  } else if (edges.length >= 3 && err > 1e-6) {
    issues.push({
      id: `close-${group}`,
      group,
      severity: 'info',
      kind: 'closedWithinTolerance',
      title: `${group} closes within ${fmt(err)}`,
      detail: 'That’s within the 1/4" tolerance, so the outline was closed without changing any measurement.',
      obsIds: [],
      options: [],
    });
  }
  if (edges.length > 0 && edges.length < 3)
    issues.push({ id: `few-${group}`, group, severity: 'warning', kind: 'missing', title: `${group} needs at least 3 edges`, detail: 'Add the remaining walls of this room.', obsIds: [], options: [] });

  if (closed) {
    // Snap the tiny residual away at the final corner (reported above).
    const last = edges[edges.length - 1];
    last.end = { x: 0, y: 0 };
  }
  closed = closed && edges.length >= 3;
  const polygon = edges.map((e) => e.start);
  return { group, edges, polygon, closed, closure, issues };
}

export function reconstruct(observations: Observation[], fmt?: (mm: number) => string): Reconstruction {
  const groups = [...new Set(observations.filter((o) => o.group && EDGE_TYPES.includes(o.type)).map((o) => o.group!))];
  const rooms = groups.map((g) => reconstructRoom(g, observations, fmt));
  return { rooms, issues: rooms.flatMap((r) => r.issues) };
}

/**
 * Offsets an interior outline outward to wall centerlines. `edgeHalf[i]` is
 * half the thickness of the wall behind edge i.
 */
export function interiorToCenterline(poly: Vec2[], edgeHalf: number[]): Vec2[] {
  const n = poly.length;
  const cw = signedArea(poly) > 0; // clockwise on screen: interior is on perp() side
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const d = norm(sub(q, p));
    const outward = cw ? scale(perp(d), -1) : perp(d);
    return { p: add(p, scale(outward, edgeHalf[i])), d };
  });
  return poly.map((_, i) => {
    const prev = lines[(i + n - 1) % n];
    const cur = lines[i];
    const hit = lineIntersection(prev.p, prev.d, cur.p, cur.d);
    return hit ? hit.point : cur.p;
  });
}

/** Default layout: rooms in a row, left to right, with a gap. */
export function defaultLayout(rooms: RoomRecon[], existing: Record<string, { x: number; y: number }> = {}): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = { ...existing };
  let cursor = 0;
  for (const r of rooms) {
    const xs = r.polygon.map((p) => p.x);
    const ys = r.polygon.map((p) => p.y);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0;
    if (!out[r.group]) out[r.group] = { x: cursor - minX, y: -minY };
    cursor = Math.max(cursor, out[r.group].x + maxX) + 900;
  }
  return out;
}
