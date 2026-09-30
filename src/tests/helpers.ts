import { createFloor } from '../model/factory';
import type { Floor } from '../model/types';
import { addWallChain, type WallProps } from '../geometry/walls/wallOps';
import { inchesToMm } from '../geometry/measurement/units';
import type { Vec2 } from '../geometry/primitives/vec';

export const WALL: WallProps = { thickness: inchesToMm(4.5), height: inchesToMm(96), wallType: 'interior', status: 'existing' };

export const ft = (feet: number, inches = 0) => inchesToMm(feet * 12 + inches);

export function rect(w: number, h: number, origin: Vec2 = { x: 0, y: 0 }): Vec2[] {
  return [
    origin,
    { x: origin.x + w, y: origin.y },
    { x: origin.x + w, y: origin.y + h },
    { x: origin.x, y: origin.y + h },
  ];
}

export function roomFloor(w: number, h: number): { floor: Floor; wallIds: string[] } {
  return addWallChain(createFloor(), rect(w, h), WALL, { closed: true });
}

export function wallLen(floor: Floor, id: string): number {
  const w = floor.walls[id];
  const a = floor.nodes[w.a];
  const b = floor.nodes[w.b];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Finds the wall whose midpoint is nearest the given point. */
export function wallNear(floor: Floor, p: Vec2): string {
  let best = '';
  let bestD = Infinity;
  for (const w of Object.values(floor.walls)) {
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    const d = Math.hypot((a.x + b.x) / 2 - p.x, (a.y + b.y) / 2 - p.y);
    if (d < bestD) {
      bestD = d;
      best = w.id;
    }
  }
  return best;
}
