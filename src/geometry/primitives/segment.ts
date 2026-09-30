import { EPS, add, cross, dot, len, scale, sub, type Vec2 } from './vec';

export interface Segment {
  a: Vec2;
  b: Vec2;
}

/** Parameter t of the orthogonal projection of p on the infinite line ab (0 at a, 1 at b). */
export function projectT(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return 0;
  return dot(sub(p, a), ab) / l2;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const t = Math.max(0, Math.min(1, projectT(p, a, b)));
  const point = add(a, scale(sub(b, a), t));
  return { point, t, distance: len(sub(p, point)) };
}

export function closestPointOnLine(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const t = projectT(p, a, b);
  return add(a, scale(sub(b, a), t));
}

export const distanceToSegment = (p: Vec2, a: Vec2, b: Vec2): number => closestPointOnSegment(p, a, b).distance;

/** Intersection of infinite lines (p + t r) and (q + u s). Null if parallel. */
export function lineIntersection(p: Vec2, r: Vec2, q: Vec2, s: Vec2): { point: Vec2; t: number; u: number } | null {
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-12) return null;
  const qp = sub(q, p);
  const t = cross(qp, s) / rxs;
  const u = cross(qp, r) / rxs;
  return { point: add(p, scale(r, t)), t, u };
}

/**
 * Proper intersection of segments ab and cd. Returns parameters on each.
 * `tol` (0..1 param space) controls whether touching endpoints count.
 */
export function segmentIntersection(
  a: Vec2,
  b: Vec2,
  c: Vec2,
  d: Vec2,
  tol = 1e-9,
): { point: Vec2; t: number; u: number } | null {
  const hit = lineIntersection(a, sub(b, a), c, sub(d, c));
  if (!hit) return null;
  if (hit.t < -tol || hit.t > 1 + tol || hit.u < -tol || hit.u > 1 + tol) return null;
  return hit;
}

/** Signed perpendicular distance of p from the directed line ab (positive = left in y-down plan). */
export function signedDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l = len(ab);
  if (l < EPS) return len(sub(p, a));
  return cross(ab, sub(p, a)) / l;
}
