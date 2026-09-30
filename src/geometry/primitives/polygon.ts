import { closestPointOnSegment, segmentIntersection } from './segment';
import { add, cross, dist, dot, norm, perp, rotate, sub, type Vec2 } from './vec';

/** Shoelace signed area. Positive = clockwise on screen (y-down), i.e. CCW in math coords. */
export function signedArea(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const polygonArea = (poly: readonly Vec2[]): number => Math.abs(signedArea(poly));

export function perimeter(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) s += dist(poly[i], poly[(i + 1) % n]);
  return s;
}

export function centroid(poly: readonly Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const sx = poly.reduce((s, p) => s + p.x, 0);
    const sy = poly.reduce((s, p) => s + p.y, 0);
    return { x: sx / poly.length, y: sy / poly.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * A point guaranteed to be inside a simple polygon (for labels). Uses the
 * centroid when inside, otherwise the midpoint of the widest horizontal span.
 */
export function interiorPoint(poly: readonly Vec2[]): Vec2 {
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const ys = poly.map((p) => p.y).sort((a, b) => a - b);
  let best: Vec2 = c;
  let bestW = -1;
  for (let k = 0; k < ys.length - 1; k++) {
    const y = (ys[k] + ys[k + 1]) / 2;
    const xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > y !== b.y > y) xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (w > bestW) {
        bestW = w;
        best = { x: (xs[i] + xs[i + 1]) / 2, y };
      }
    }
  }
  return best;
}

export function bounds(points: readonly Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Corners of an oriented rectangle centered at c. Rotation in degrees, clockwise on screen. */
export function orientedRect(c: Vec2, width: number, depth: number, rotationDeg: number): Vec2[] {
  const r = (rotationDeg * Math.PI) / 180;
  const hw = width / 2;
  const hd = depth / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => add(c, rotate(p, r)));
}

/** Clips a polygon to the half-plane { p : dot(p - origin, normal) >= 0 } (Sutherland–Hodgman). */
export function clipHalfPlane(poly: readonly Vec2[], origin: Vec2, normal: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i];
    const prev = poly[(i + n - 1) % n];
    const dc = dot(sub(cur, origin), normal);
    const dp = dot(sub(prev, origin), normal);
    if (dc >= 0) {
      if (dp < 0) out.push(intersectAt(prev, cur, dp, dc));
      out.push(cur);
    } else if (dp >= 0) {
      out.push(intersectAt(prev, cur, dp, dc));
    }
  }
  return out;
}

function intersectAt(a: Vec2, b: Vec2, da: number, db: number): Vec2 {
  const t = da / (da - db);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Separating-axis overlap test for convex polygons. */
export function convexOverlap(a: readonly Vec2[], b: readonly Vec2[], tolerance = 0): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const axis = norm(perp(sub(poly[(i + 1) % poly.length], poly[i])));
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const p of a) {
        const d = dot(p, axis);
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const p of b) {
        const d = dot(p, axis);
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA <= minB + tolerance || maxB <= minA + tolerance) return false;
    }
  }
  return true;
}

/** Minimum distance between two polygons' boundaries (0 if they intersect or one contains the other). */
export function polygonDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentIntersection(a1, a2, b1, b2)) return 0;
      best = Math.min(
        best,
        closestPointOnSegment(a1, b1, b2).distance,
        closestPointOnSegment(a2, b1, b2).distance,
        closestPointOnSegment(b1, a1, a2).distance,
        closestPointOnSegment(b2, a1, a2).distance,
      );
    }
  }
  return best;
}

/** True when the polygon winding is clockwise on screen (positive shoelace in y-down). */
export const isClockwise = (poly: readonly Vec2[]): boolean => signedArea(poly) > 0;

export function ensureWinding(poly: Vec2[], clockwise: boolean): Vec2[] {
  return isClockwise(poly) === clockwise ? poly : [...poly].reverse();
}

/** Removes consecutive duplicate / collinear vertices. */
export function simplifyPolygon(poly: readonly Vec2[], tol = 1e-6): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    if (out.length && dist(out[out.length - 1], p) < tol) continue;
    out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < tol) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      if (Math.abs(cross(sub(b, a), sub(c, b))) < tol * Math.max(1, dist(a, c))) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}
