import type { Constraint, Floor, Id } from '../../model/types';
import { FloorEditor } from '../../model/floorEditor';
import { normDeg } from '../primitives/vec';

/**
 * Geometric constraint solver over wall junction nodes.
 *
 * Constraints come from explicit Constraint records plus implicit wall locks
 * (lock length / angle / position) and pinned nodes. The solver runs
 * Gauss–Seidel projection: each constraint moves its nodes directly onto the
 * constraint manifold, weighted by inverse mass (pinned nodes have zero
 * inverse mass). Iteration stops once every residual is within tolerance.
 *
 * It never alters a constraint's target value to make things fit; if the
 * system can't be satisfied, the violated constraints are reported.
 */

export const LENGTH_TOLERANCE = 0.01; // mm
export const ANGLE_TOLERANCE = 1e-6; // rad

export interface SolverConstraint {
  id: string;
  type: Constraint['type'];
  /** Node ids: pairs per wall [a0,b0,a1,b1...] or a single node for fixedPosition. */
  nodes: Id[];
  value?: number;
  point?: { x: number; y: number };
  label: string;
  source: 'lock' | 'constraint';
}

export interface Violation {
  constraintId: string;
  label: string;
  residual: number;
  unit: 'mm' | 'deg';
}

export interface SolveResult {
  floor: Floor;
  ok: boolean;
  violations: Violation[];
  iterations: number;
  /** True when user-dragged nodes had to be moved to satisfy locks. */
  overrodePins: boolean;
}

type P = { x: number; y: number };

/** Collects all active constraints (explicit + wall locks). */
export function collectConstraints(floor: Floor): SolverConstraint[] {
  const out: SolverConstraint[] = [];
  const wallName = (id: Id) => floor.walls[id]?.name ?? 'wall';
  for (const w of Object.values(floor.walls)) {
    if (!floor.nodes[w.a] || !floor.nodes[w.b]) continue;
    if (w.locks.length && w.lockedLength !== undefined)
      out.push({ id: `lock-len-${w.id}`, type: 'fixedLength', nodes: [w.a, w.b], value: w.lockedLength, label: `Locked length of ${wallName(w.id)}`, source: 'lock' });
    if (w.locks.angle && w.lockedAngle !== undefined)
      out.push({ id: `lock-ang-${w.id}`, type: 'fixedAngle', nodes: [w.a, w.b], value: w.lockedAngle, label: `Locked angle of ${wallName(w.id)}`, source: 'lock' });
    if (w.locks.position) {
      for (const n of [w.a, w.b])
        out.push({ id: `lock-pos-${w.id}-${n}`, type: 'fixedPosition', nodes: [n], point: { x: floor.nodes[n].x, y: floor.nodes[n].y }, label: `Locked position of ${wallName(w.id)}`, source: 'lock' });
    }
  }
  for (const c of Object.values(floor.constraints)) {
    if (!c.enabled) continue;
    const walls = c.refs.map((r) => floor.walls[r]).filter(Boolean);
    const nodes = walls.flatMap((w) => [w.a, w.b]);
    if (c.type === 'fixedPosition') {
      const n = floor.nodes[c.refs[0]];
      if (n) out.push({ id: c.id, type: c.type, nodes: [n.id], point: { x: n.x, y: n.y }, label: c.label ?? 'Fixed point', source: 'constraint' });
      continue;
    }
    const need = c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'equalLength' ? 2 : 1;
    if (walls.length < need) continue;
    out.push({ id: c.id, type: c.type, nodes, value: c.value, label: c.label ?? defaultLabel(c.type), source: 'constraint' });
  }
  return out;
}

const defaultLabel = (t: Constraint['type']): string =>
  ({
    fixedLength: 'Fixed length',
    fixedAngle: 'Fixed angle',
    horizontal: 'Horizontal',
    vertical: 'Vertical',
    parallel: 'Parallel',
    perpendicular: 'Perpendicular',
    equalLength: 'Equal length',
    fixedPosition: 'Fixed point',
  })[t];

/**
 * Solves constraints. `pinned` nodes (the ones the user is directly
 * manipulating) are held first; if that's infeasible they're released so
 * locks win, and `overrodePins` is reported.
 */
export function solveConstraints(floor: Floor, pinned: Iterable<Id> = [], maxIterations = 400): SolveResult {
  const constraints = collectConstraints(floor);
  if (!constraints.length) return { floor, ok: true, violations: [], iterations: 0, overrodePins: false };
  const pinSet = new Set(pinned);
  const hardFixed = new Set<Id>();
  for (const n of Object.values(floor.nodes)) if (n.fixed) hardFixed.add(n.id);

  const attempt = (pins: Set<Id>) => run(floor, constraints, new Set([...pins, ...hardFixed]), maxIterations);
  let res = attempt(pinSet);
  let overrodePins = false;
  if (res.violations.length && pinSet.size) {
    const retry = attempt(new Set());
    if (!retry.violations.length) {
      res = retry;
      overrodePins = true;
    }
  }
  const ed = new FloorEditor(floor);
  for (const [id, p] of res.positions) ed.setNode(id, p.x, p.y);
  return { floor: ed.floor, ok: res.violations.length === 0, violations: res.violations, iterations: res.iterations, overrodePins };
}

function run(floor: Floor, constraints: SolverConstraint[], fixed: Set<Id>, maxIterations: number) {
  const positions = new Map<Id, P>();
  for (const c of constraints) for (const id of c.nodes) if (!positions.has(id) && floor.nodes[id]) positions.set(id, { x: floor.nodes[id].x, y: floor.nodes[id].y });
  const w = (id: Id) => (fixed.has(id) ? 0 : 1);
  let iterations = 0;
  let violations: Violation[] = [];
  for (; iterations < maxIterations; iterations++) {
    for (const c of constraints) project(c, positions, w);
    violations = measure(constraints, positions);
    if (!violations.length) break;
  }
  return { positions, violations, iterations };
}

function lengthOf(p: P, q: P) {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

function setLength(a: P, b: P, target: number, wa: number, wb: number) {
  const d = lengthOf(a, b);
  const sum = wa + wb;
  if (sum === 0 || d < 1e-12) return;
  const diff = (d - target) / d;
  const dx = (b.x - a.x) * diff;
  const dy = (b.y - a.y) * diff;
  a.x += (dx * wa) / sum;
  a.y += (dy * wa) / sum;
  b.x -= (dx * wb) / sum;
  b.y -= (dy * wb) / sum;
}

function setDirection(a: P, b: P, rad: number, wa: number, wb: number) {
  const sum = wa + wb;
  if (sum === 0) return;
  const L = lengthOf(a, b);
  const ux = exact(Math.cos(rad));
  const uy = exact(Math.sin(rad));
  // Pivot at the weighted fixed point (the heavier end stays put).
  const px = (a.x * wb + b.x * wa) / sum;
  const py = (a.y * wb + b.y * wa) / sum;
  const ta = -(L * wa) / sum;
  const tb = (L * wb) / sum;
  a.x = px + ux * ta;
  a.y = py + uy * ta;
  b.x = px + ux * tb;
  b.y = py + uy * tb;
}

const exact = (x: number) => (Math.abs(x) < 1e-15 ? 0 : Math.abs(Math.abs(x) - 1) < 1e-15 ? Math.sign(x) : x);

const angleOf = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x);

function project(c: SolverConstraint, pos: Map<Id, P>, w: (id: Id) => number) {
  const n = c.nodes.map((id) => pos.get(id)!);
  const ws = c.nodes.map(w);
  switch (c.type) {
    case 'fixedLength':
      setLength(n[0], n[1], c.value!, ws[0], ws[1]);
      break;
    case 'fixedAngle':
      setDirection(n[0], n[1], (c.value! * Math.PI) / 180, ws[0], ws[1]);
      break;
    case 'horizontal':
    case 'vertical': {
      const cur = angleOf(n[0], n[1]);
      const step = Math.PI;
      const base = c.type === 'horizontal' ? 0 : Math.PI / 2;
      const target = base + Math.round((cur - base) / step) * step;
      setDirection(n[0], n[1], target, ws[0], ws[1]);
      break;
    }
    case 'parallel':
    case 'perpendicular': {
      const a1 = angleOf(n[0], n[1]);
      const a2 = angleOf(n[2], n[3]);
      const period = Math.PI;
      const offset = c.type === 'perpendicular' ? Math.PI / 2 : 0;
      // Rotate both toward a common orientation; wall with pinned nodes rotates less.
      let diff = a2 - (a1 + offset);
      diff = diff - Math.round(diff / period) * period;
      const m1 = ws[0] + ws[1];
      const m2 = ws[2] + ws[3];
      if (m1 + m2 === 0) break;
      const r1 = (diff * m1) / (m1 + m2);
      const r2 = -(diff * m2) / (m1 + m2);
      if (m1) setDirection(n[0], n[1], a1 + r1, ws[0], ws[1]);
      if (m2) setDirection(n[2], n[3], a2 + r2, ws[2], ws[3]);
      break;
    }
    case 'equalLength': {
      const l1 = lengthOf(n[0], n[1]);
      const l2 = lengthOf(n[2], n[3]);
      const m1 = ws[0] + ws[1];
      const m2 = ws[2] + ws[3];
      if (m1 + m2 === 0) break;
      const target = (l1 * m2 + l2 * m1) / (m1 + m2);
      if (m1) setLength(n[0], n[1], target, ws[0], ws[1]);
      if (m2) setLength(n[2], n[3], target, ws[2], ws[3]);
      break;
    }
    case 'fixedPosition':
      n[0].x = c.point!.x;
      n[0].y = c.point!.y;
      break;
  }
}

function measure(constraints: SolverConstraint[], pos: Map<Id, P>): Violation[] {
  const out: Violation[] = [];
  const angDiff = (x: number, y: number, period: number) => {
    let d = (x - y) % period;
    if (d > period / 2) d -= period;
    if (d < -period / 2) d += period;
    return Math.abs(d);
  };
  for (const c of constraints) {
    const n = c.nodes.map((id) => pos.get(id)!);
    let residual = 0;
    let unit: Violation['unit'] = 'mm';
    switch (c.type) {
      case 'fixedLength':
        residual = Math.abs(lengthOf(n[0], n[1]) - c.value!);
        break;
      case 'fixedAngle':
        residual = angDiff(angleOf(n[0], n[1]), (normDeg(c.value!) * Math.PI) / 180, 2 * Math.PI);
        unit = 'deg';
        break;
      case 'horizontal':
        residual = angDiff(angleOf(n[0], n[1]), 0, Math.PI);
        unit = 'deg';
        break;
      case 'vertical':
        residual = angDiff(angleOf(n[0], n[1]), Math.PI / 2, Math.PI);
        unit = 'deg';
        break;
      case 'parallel':
        residual = angDiff(angleOf(n[0], n[1]), angleOf(n[2], n[3]), Math.PI);
        unit = 'deg';
        break;
      case 'perpendicular':
        residual = angDiff(angleOf(n[0], n[1]) + Math.PI / 2, angleOf(n[2], n[3]), Math.PI);
        unit = 'deg';
        break;
      case 'equalLength':
        residual = Math.abs(lengthOf(n[0], n[1]) - lengthOf(n[2], n[3]));
        break;
      case 'fixedPosition':
        residual = lengthOf(n[0], c.point!);
        break;
    }
    const tol = unit === 'mm' ? LENGTH_TOLERANCE : ANGLE_TOLERANCE;
    if (residual > tol) out.push({ constraintId: c.id, label: c.label, residual: unit === 'deg' ? (residual * 180) / Math.PI : residual, unit });
  }
  return out;
}
