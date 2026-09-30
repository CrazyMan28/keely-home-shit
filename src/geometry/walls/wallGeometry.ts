import type { Floor, Id, Wall } from '../../model/types';
import { lineIntersection } from '../primitives/segment';
import { add, angleOf, dist, dot, len, neg, norm, perp, scale, sub, type Vec2 } from '../primitives/vec';

/**
 * Derived wall outline. Walls are stored as centerlines; faces are computed
 * here with miter joins at shared nodes. "Left" is the side to the left when
 * walking from node a to node b in plan view (perp(dir) = rotate +90°).
 */
export interface WallFootprint {
  wallId: Id;
  a: Vec2;
  b: Vec2;
  dir: Vec2;
  /** Unit normal pointing to the wall's left side. */
  normal: Vec2;
  length: number;
  leftStart: Vec2;
  leftEnd: Vec2;
  rightStart: Vec2;
  rightEnd: Vec2;
  polygon: Vec2[];
  /** True when the end is free (not joined), so a cap line should be drawn. */
  startCap: boolean;
  endCap: boolean;
}

export interface JunctionPolygon {
  nodeId: Id;
  polygon: Vec2[];
}

export interface WallGeometry {
  footprints: Map<Id, WallFootprint>;
  junctions: JunctionPolygon[];
}

interface Spoke {
  wall: Wall;
  /** Unit direction pointing away from the node. */
  out: Vec2;
  angle: number;
  half: number;
  atStart: boolean;
}

export function wallEndpoints(floor: Floor, wall: Wall): [Vec2, Vec2] {
  const a = floor.nodes[wall.a];
  const b = floor.nodes[wall.b];
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
  ];
}

export function wallLength(floor: Floor, wall: Wall): number {
  const [a, b] = wallEndpoints(floor, wall);
  return dist(a, b);
}

/** Wall direction in degrees, measured clockwise on screen from east. */
export function wallAngleDeg(floor: Floor, wall: Wall): number {
  const [a, b] = wallEndpoints(floor, wall);
  const deg = (angleOf(sub(b, a)) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/**
 * Computes mitered footprints for a set of walls. Only walls passing `include`
 * participate in joins, so e.g. hidden or demolished walls don't distort
 * neighbors in views where they are absent.
 */
export function computeWallGeometry(floor: Floor, include: (w: Wall) => boolean = () => true): WallGeometry {
  const walls = Object.values(floor.walls).filter((w) => include(w) && floor.nodes[w.a] && floor.nodes[w.b]);
  const spokes = new Map<Id, Spoke[]>();
  for (const wall of walls) {
    const [a, b] = wallEndpoints(floor, wall);
    const d = norm(sub(b, a));
    if (len(d) === 0) continue;
    const half = wall.thickness / 2;
    const push = (nodeId: Id, out: Vec2, atStart: boolean) => {
      const list = spokes.get(nodeId) ?? [];
      list.push({ wall, out, angle: angleOf(out), half, atStart });
      spokes.set(nodeId, list);
    };
    push(wall.a, d, true);
    push(wall.b, neg(d), false);
  }

  // corner[nodeId][wallId] = { left, right } in the spoke's outgoing frame.
  const corners = new Map<string, { left: Vec2; right: Vec2; joined: boolean }>();
  const junctions: JunctionPolygon[] = [];

  for (const [nodeId, list] of spokes) {
    const node = floor.nodes[nodeId];
    const p: Vec2 = { x: node.x, y: node.y };
    list.sort((s, t) => s.angle - t.angle);
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const L = perp(s.out);
      let left = add(p, scale(L, s.half));
      let right = add(p, scale(L, -s.half));
      if (n > 1) {
        // Left neighbor: next larger angle. Its right face meets our left face.
        const ln = list[(i + 1) % n];
        const lnR = perp(ln.out);
        const hitL = lineIntersection(left, s.out, add(p, scale(lnR, -ln.half)), ln.out);
        if (hitL && miterOk(hitL.point, p, s.half, ln.half)) left = hitL.point;
        const rn = list[(i + n - 1) % n];
        const rnL = perp(rn.out);
        const hitR = lineIntersection(right, s.out, add(p, scale(rnL, rn.half)), rn.out);
        if (hitR && miterOk(hitR.point, p, s.half, rn.half)) right = hitR.point;
      }
      corners.set(`${nodeId}|${s.wall.id}|${s.atStart ? 's' : 'e'}`, { left, right, joined: n > 1 });
    }
    if (n >= 3) {
      const poly: Vec2[] = [];
      for (const s of list) {
        const c = corners.get(`${nodeId}|${s.wall.id}|${s.atStart ? 's' : 'e'}`)!;
        poly.push(c.right, c.left);
      }
      junctions.push({ nodeId, polygon: dedupe(poly) });
    }
  }

  const footprints = new Map<Id, WallFootprint>();
  for (const wall of walls) {
    const [a, b] = wallEndpoints(floor, wall);
    const length = dist(a, b);
    if (length === 0) continue;
    const dir = norm(sub(b, a));
    const normal = perp(dir);
    const cs = corners.get(`${wall.a}|${wall.id}|s`)!;
    const ce = corners.get(`${wall.b}|${wall.id}|e`)!;
    // At the end node the outgoing frame is reversed, so left/right swap.
    const leftStart = cs.left;
    const rightStart = cs.right;
    const leftEnd = ce.right;
    const rightEnd = ce.left;
    footprints.set(wall.id, {
      wallId: wall.id,
      a,
      b,
      dir,
      normal,
      length,
      leftStart,
      leftEnd,
      rightStart,
      rightEnd,
      polygon: [rightStart, rightEnd, ...(ce.joined ? [b] : []), leftEnd, leftStart, ...(cs.joined ? [a] : [])],
      startCap: !cs.joined,
      endCap: !ce.joined,
    });
  }
  return { footprints, junctions };
}

/** Rejects runaway miters at very sharp angles (fall back to a butt joint). */
function miterOk(pt: Vec2, node: Vec2, h1: number, h2: number): boolean {
  return dist(pt, node) <= 6 * Math.max(h1, h2, 1);
}

function dedupe(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) if (!out.some((q) => dist(p, q) < 0.01)) out.push(p);
  return out;
}

/** Length of a wall face measured along the wall direction. */
export function faceLength(fp: WallFootprint, side: 'left' | 'right'): number {
  const s = side === 'left' ? fp.leftStart : fp.rightStart;
  const e = side === 'left' ? fp.leftEnd : fp.rightEnd;
  return Math.abs(dot(sub(e, s), fp.dir));
}
