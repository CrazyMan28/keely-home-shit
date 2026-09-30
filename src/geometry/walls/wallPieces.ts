import type { Opening } from '../../model/types';
import { clipHalfPlane } from '../primitives/polygon';
import { add, scale, type Vec2 } from '../primitives/vec';
import type { WallFootprint } from './wallGeometry';

/**
 * Splits a wall footprint along its axis into solid spans and opening spans.
 * Both renderers use this: 2D fills the solid spans (openings show as gaps),
 * 3D extrudes solid spans full height and opening spans below the sill and
 * above the head, which produces real holes with proper reveals.
 */
export interface WallSpan {
  /** Distance range along the centerline from node a. */
  from: number;
  to: number;
  polygon: Vec2[];
  opening?: Opening;
}

export function wallSpans(fp: WallFootprint, openings: Opening[]): WallSpan[] {
  const sorted = openings
    .filter((o) => o.width > 0)
    .map((o) => ({ o, s: Math.max(0, o.offset), e: Math.min(fp.length, o.offset + o.width) }))
    .filter((x) => x.e > x.s)
    .sort((p, q) => p.s - q.s);
  const cuts: Array<{ from: number; to: number; opening?: Opening }> = [];
  let cursor = -Infinity;
  for (const { o, s, e } of sorted) {
    const start = Math.max(s, cursor);
    if (start > cursor) cuts.push({ from: cursor, to: start });
    if (e > start) cuts.push({ from: start, to: e, opening: o });
    cursor = Math.max(cursor, e);
  }
  cuts.push({ from: cursor, to: Infinity });
  const spans: WallSpan[] = [];
  for (const c of cuts) {
    let poly = fp.polygon;
    if (Number.isFinite(c.from)) poly = clipHalfPlane(poly, add(fp.a, scale(fp.dir, c.from)), fp.dir);
    if (Number.isFinite(c.to)) poly = clipHalfPlane(poly, add(fp.a, scale(fp.dir, c.to)), scale(fp.dir, -1));
    if (poly.length >= 3) spans.push({ from: c.from, to: c.to, polygon: poly, opening: c.opening });
  }
  return spans;
}

/** Rectangle of an opening across the wall thickness, in plan. */
export function openingRect(fp: WallFootprint, o: Opening, thickness: number): Vec2[] {
  const h = thickness / 2;
  const s = add(fp.a, scale(fp.dir, o.offset));
  const e = add(fp.a, scale(fp.dir, o.offset + o.width));
  return [add(s, scale(fp.normal, h)), add(e, scale(fp.normal, h)), add(e, scale(fp.normal, -h)), add(s, scale(fp.normal, -h))];
}
