/**
 * 2D vector math. Plan coordinates are millimeters with +x = east and
 * +y = south (screen-down), so "north" is -y. 3D maps plan (x, y) to (x, z).
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const EPS = 1e-9;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Left-hand perpendicular in a y-down system appears counter-clockwise on screen. */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y });

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function rotate(a: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function rotateAround(p: Vec2, center: Vec2, rad: number): Vec2 {
  return add(center, rotate(sub(p, center), rad));
}

/** Angle of vector in radians, in (-π, π]. */
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);

export const approxEq = (a: Vec2, b: Vec2, tol = 1e-6): boolean => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;

/** Normalizes degrees to [0, 360). */
export function normDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * Cos/sin that return exact values at multiples of 90° so axis-aligned
 * geometry stays perfectly axis-aligned (no 6e-17 drift).
 */
export function exactDir(deg: number): Vec2 {
  const d = normDeg(deg);
  if (d === 0) return { x: 1, y: 0 };
  if (d === 90) return { x: 0, y: 1 };
  if (d === 180) return { x: -1, y: 0 };
  if (d === 270) return { x: 0, y: -1 };
  const r = degToRad(d);
  return { x: Math.cos(r), y: Math.sin(r) };
}
