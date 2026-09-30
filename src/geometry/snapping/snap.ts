import type { Floor, Id } from '../../model/types';
import { openingFrame } from '../openings/openings';
import { closestPointOnSegment, lineIntersection, segmentIntersection } from '../primitives/segment';
import { add, angleOf, dist, dot, exactDir, len, mid, normDeg, radToDeg, scale, sub, type Vec2 } from '../primitives/vec';
import type { WallGeometry } from '../walls/wallGeometry';

export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'intersection'
  | 'opening'
  | 'wallCenter'
  | 'wallFace'
  | 'angle'
  | 'alignment'
  | 'grid'
  | 'none';

export interface SnapGuide {
  a: Vec2;
  b: Vec2;
  kind: 'alignment' | 'angle' | 'perpendicular';
}

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  /** Element the point snapped to (node or wall id). */
  targetId?: Id;
  guides: SnapGuide[];
  /** Direction angle in degrees when an angle snap applied. */
  angle?: number;
}

export interface SnapOptions {
  endpoint: boolean;
  midpoint: boolean;
  intersection: boolean;
  wall: boolean;
  angle: boolean;
  alignment: boolean;
  grid: boolean;
  /** Angular step for angle snapping (deg). */
  angleStep: number;
}

export const DEFAULT_SNAP_OPTIONS: SnapOptions = {
  endpoint: true,
  midpoint: true,
  intersection: true,
  wall: true,
  angle: true,
  alignment: true,
  grid: true,
  angleStep: 45,
};

export interface SnapContext {
  floor: Floor;
  geometry: WallGeometry;
  /** Snap radius in world units (mm). */
  radius: number;
  gridSize: number;
  options: SnapOptions;
  /** Previous point of the current drawing operation (enables angle snapping). */
  from?: Vec2;
  /** Node ids to ignore (e.g. the node being dragged). */
  excludeNodes?: Set<Id>;
  excludeWalls?: Set<Id>;
  /** Length rounding step when no geometric snap applies (e.g. 1"). */
  lengthStep?: number;
}

/**
 * Resolves a raw cursor point to a snapped point. Priority:
 * endpoint > intersection > midpoint > opening edge > angle/alignment > wall > grid.
 */
export function snapPoint(raw: Vec2, ctx: SnapContext): SnapResult {
  const { floor, geometry, radius, options } = ctx;
  const exN = ctx.excludeNodes ?? new Set<Id>();
  const exW = ctx.excludeWalls ?? new Set<Id>();
  const walls = Object.values(floor.walls).filter((w) => !exW.has(w.id) && !exN.has(w.a) && !exN.has(w.b));

  if (options.endpoint) {
    let best: { d: number; id: Id; p: Vec2 } | null = null;
    for (const n of Object.values(floor.nodes)) {
      if (exN.has(n.id)) continue;
      const d = Math.hypot(n.x - raw.x, n.y - raw.y);
      if (d <= radius && (!best || d < best.d)) best = { d, id: n.id, p: { x: n.x, y: n.y } };
    }
    if (best) return { point: best.p, kind: 'endpoint', targetId: best.id, guides: [] };
  }

  if (options.intersection) {
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const w1 = walls[i];
        const w2 = walls[j];
        if (w1.a === w2.a || w1.a === w2.b || w1.b === w2.a || w1.b === w2.b) continue;
        const hit = segmentIntersection(nodePos(floor, w1.a), nodePos(floor, w1.b), nodePos(floor, w2.a), nodePos(floor, w2.b));
        if (hit && dist(hit.point, raw) <= radius) return { point: hit.point, kind: 'intersection', guides: [] };
      }
    }
  }

  if (options.midpoint) {
    for (const w of walls) {
      const m = mid(nodePos(floor, w.a), nodePos(floor, w.b));
      if (dist(m, raw) <= radius * 0.8) return { point: m, kind: 'midpoint', targetId: w.id, guides: [] };
    }
  }

  if (options.wall) {
    for (const o of Object.values(floor.openings)) {
      if (exW.has(o.wallId)) continue;
      const f = openingFrame(floor, o);
      if (!f) continue;
      for (const p of [f.start, f.end]) if (dist(p, raw) <= radius * 0.7) return { point: p, kind: 'opening', targetId: o.id, guides: [] };
    }
  }

  // Angle + alignment snapping (can combine: angle ray ∩ alignment line).
  const guides: SnapGuide[] = [];
  let point = raw;
  let kind: SnapKind = 'none';
  let angle: number | undefined;
  let rayDir: Vec2 | null = null;

  if (ctx.from && options.angle && dist(ctx.from, raw) > radius * 0.5) {
    const cur = normDeg(radToDeg(angleOf(sub(raw, ctx.from))));
    const refs = referenceAngles(floor, options.angleStep);
    let bestDelta = Infinity;
    let bestAngle = 0;
    for (const r of refs) {
      const delta = Math.abs(((cur - r + 540) % 360) - 180);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestAngle = r;
      }
    }
    const tolDeg = Math.min(6, radToDeg(Math.atan2(radius, dist(ctx.from, raw))));
    if (bestDelta <= tolDeg) {
      rayDir = exactDir(bestAngle);
      const t = dot(sub(raw, ctx.from), rayDir);
      point = add(ctx.from, scale(rayDir, t));
      kind = 'angle';
      angle = bestAngle;
      guides.push({ a: ctx.from, b: add(ctx.from, scale(rayDir, Math.max(t, 0) + radius * 40)), kind: 'angle' });
    }
  }

  if (options.alignment) {
    let bx: { d: number; x: number; src: Vec2 } | null = null;
    let by: { d: number; y: number; src: Vec2 } | null = null;
    const candidates: Vec2[] = Object.values(floor.nodes)
      .filter((n) => !exN.has(n.id))
      .map((n) => ({ x: n.x, y: n.y }));
    if (ctx.from) candidates.push(ctx.from);
    for (const c of candidates) {
      const dx = Math.abs(c.x - point.x);
      const dy = Math.abs(c.y - point.y);
      if (dx <= radius * 0.6 && (!bx || dx < bx.d) && Math.abs(c.y - point.y) > 1) bx = { d: dx, x: c.x, src: c };
      if (dy <= radius * 0.6 && (!by || dy < by.d) && Math.abs(c.x - point.x) > 1) by = { d: dy, y: c.y, src: c };
    }
    if (rayDir && ctx.from) {
      // Slide along the angle ray to hit an alignment line.
      const pick = bx && (!by || bx.d <= by.d) ? { line: { p: { x: bx.x, y: 0 }, d: { x: 0, y: 1 } }, src: bx.src } : by ? { line: { p: { x: 0, y: by.y }, d: { x: 1, y: 0 } }, src: by.src } : null;
      if (pick) {
        const hit = lineIntersection(ctx.from, rayDir, pick.line.p, pick.line.d);
        if (hit && hit.t > 0 && dist(hit.point, point) <= radius * 0.6) {
          point = hit.point;
          guides.push({ a: pick.src, b: point, kind: 'alignment' });
          kind = 'alignment';
        }
      }
    } else {
      if (bx) {
        point = { x: bx.x, y: point.y };
        guides.push({ a: bx.src, b: point, kind: 'alignment' });
        kind = 'alignment';
      }
      if (by) {
        point = { x: point.x, y: by.y };
        guides.push({ a: by.src, b: point, kind: 'alignment' });
        kind = 'alignment';
      }
    }
  }

  if (kind !== 'none') {
    if (kind === 'angle' && ctx.from && rayDir && ctx.lengthStep) {
      const L = dot(sub(point, ctx.from), rayDir);
      const rounded = Math.round(L / ctx.lengthStep) * ctx.lengthStep;
      point = add(ctx.from, scale(rayDir, rounded));
    }
    return { point, kind, guides, angle };
  }

  if (options.wall) {
    let best: { d: number; p: Vec2; id: Id; face: boolean } | null = null;
    for (const w of walls) {
      const fp = geometry.footprints.get(w.id);
      const c = closestPointOnSegment(raw, nodePos(floor, w.a), nodePos(floor, w.b));
      if (c.distance <= radius * 0.6 && (!best || c.distance < best.d)) best = { d: c.distance, p: c.point, id: w.id, face: false };
      if (fp) {
        for (const [s, e] of [
          [fp.leftStart, fp.leftEnd],
          [fp.rightStart, fp.rightEnd],
        ] as const) {
          const f = closestPointOnSegment(raw, s, e);
          if (f.distance <= radius * 0.5 && (!best || f.distance < best.d)) best = { d: f.distance, p: f.point, id: w.id, face: true };
        }
      }
    }
    if (best) return { point: best.p, kind: best.face ? 'wallFace' : 'wallCenter', targetId: best.id, guides: [] };
  }

  if (options.grid && ctx.gridSize > 0) {
    const g = ctx.gridSize;
    const p = { x: Math.round(raw.x / g) * g, y: Math.round(raw.y / g) * g };
    if (dist(p, raw) <= radius) return { point: p, kind: 'grid', guides: [] };
  }
  if (ctx.from && ctx.lengthStep) {
    const d = sub(raw, ctx.from);
    const L = len(d);
    if (L > 0) {
      const rounded = Math.round(L / ctx.lengthStep) * ctx.lengthStep;
      return { point: add(ctx.from, scale(d, rounded / L)), kind: 'none', guides: [] };
    }
  }
  return { point: raw, kind: 'none', guides: [] };
}

const nodePos = (floor: Floor, id: Id): Vec2 => ({ x: floor.nodes[id].x, y: floor.nodes[id].y });

/** Axis angles in `step` increments plus directions (and perpendiculars) of existing walls. */
function referenceAngles(floor: Floor, step: number): number[] {
  const set = new Set<number>();
  for (let a = 0; a < 360; a += step) set.add(a);
  for (const w of Object.values(floor.walls)) {
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    if (!a || !b) continue;
    const deg = Math.round(normDeg(radToDeg(Math.atan2(b.y - a.y, b.x - a.x))) * 1e6) / 1e6;
    for (let k = 0; k < 4; k++) set.add(normDeg(deg + k * 90));
  }
  return [...set];
}
