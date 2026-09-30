import type { Floor, Id, Item } from '../../model/types';
import { inchesToMm } from '../measurement/units';
import { openingFrame } from '../openings/openings';
import { convexOverlap, polygonDistance } from '../primitives/polygon';
import { add, scale, type Vec2 } from '../primitives/vec';
import type { WallGeometry } from '../walls/wallGeometry';
import { itemFootprint } from './items';

export type ClearanceSeverity = 'warning' | 'info';

export interface ClearanceIssue {
  id: string;
  severity: ClearanceSeverity;
  message: string;
  elementIds: Id[];
  /** Point to zoom to. */
  at: Vec2;
  /** Measured gap, when relevant. */
  distance?: number;
}

/** NKBA recommends ≥ 42" work aisles; 36" is the common walkway minimum. */
export const KITCHEN_AISLE_MIN = inchesToMm(42);
export const WALKWAY_MIN = inchesToMm(36);
export const TOILET_SIDE_MIN = inchesToMm(15);

const ignoresCollisions = (it: Item) => it.catalogId.startsWith('rug') || it.category === 'structure';
const kitchenRun = (it: Item) => it.category === 'counter' || it.category === 'cabinet' || it.category === 'appliance';

function verticalOverlap(a: Item, b: Item): boolean {
  return a.elevation < b.elevation + b.height && b.elevation < a.elevation + a.height;
}

/** Door swing as a convex fan polygon (quarter circle). */
export function doorSwingPolygon(floor: Floor, openingId: Id, segments = 8): Vec2[] | null {
  const o = floor.openings[openingId];
  if (!o || o.type !== 'door' || !o.door || o.door.style === 'sliding' || o.door.style === 'pocket') return null;
  const f = openingFrame(floor, o);
  if (!f) return null;
  const side = o.door.swing === 'left' ? 1 : -1;
  const n = scale(f.normal, side);
  const faceOffset = scale(n, f.thickness / 2);
  const hinge = add(o.door.hinge === 'start' ? f.start : f.end, faceOffset);
  const closedDir = o.door.hinge === 'start' ? f.dir : scale(f.dir, -1);
  const pts: Vec2[] = [hinge];
  const r = o.door.style === 'double' ? o.width / 2 : o.width;
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * (Math.PI / 2);
    const d = add(scale(closedDir, Math.cos(t)), scale(n, Math.sin(t)));
    pts.push(add(hinge, scale(d, r)));
  }
  return pts;
}

export function analyzeClearances(floor: Floor, geometry: WallGeometry): ClearanceIssue[] {
  const issues: ClearanceIssue[] = [];
  const items = Object.values(floor.items).filter((it) => it.status !== 'demolish' && !it.hidden);
  const polys = new Map(items.map((it) => [it.id, itemFootprint(it)]));

  // Item ↔ wall overlaps.
  for (const it of items) {
    if (ignoresCollisions(it)) continue;
    const p = polys.get(it.id)!;
    for (const fp of geometry.footprints.values()) {
      const w = floor.walls[fp.wallId];
      if (!w || w.status === 'demolish') continue;
      if (convexOverlap(p, [fp.rightStart, fp.rightEnd, fp.leftEnd, fp.leftStart], 2)) {
        issues.push({ id: `wall-overlap-${it.id}-${w.id}`, severity: 'warning', message: `${it.name ?? 'Item'} overlaps a wall`, elementIds: [it.id, w.id], at: { x: it.x, y: it.y } });
        break;
      }
    }
  }

  // Item ↔ item overlaps and kitchen aisles.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (ignoresCollisions(a) || ignoresCollisions(b)) continue;
      const pa = polys.get(a.id)!;
      const pb = polys.get(b.id)!;
      if (verticalOverlap(a, b) && convexOverlap(pa, pb, 2)) {
        issues.push({ id: `overlap-${a.id}-${b.id}`, severity: 'warning', message: `${a.name} overlaps ${b.name}`, elementIds: [a.id, b.id], at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
        continue;
      }
      const isIsland = (x: Item) => x.catalogId === 'island';
      if ((isIsland(a) && kitchenRun(b)) || (isIsland(b) && kitchenRun(a))) {
        const d = polygonDistance(pa, pb);
        if (d > 0 && d < KITCHEN_AISLE_MIN) {
          issues.push({
            id: `aisle-${a.id}-${b.id}`,
            severity: 'warning',
            message: `Kitchen aisle between ${a.name} and ${b.name} is below the 42" guideline`,
            elementIds: [a.id, b.id],
            at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            distance: d,
          });
        }
      }
    }
  }

  // Door swing collisions.
  for (const o of Object.values(floor.openings)) {
    if (o.status === 'demolish' || o.type !== 'door') continue;
    const swing = doorSwingPolygon(floor, o.id);
    if (!swing) continue;
    for (const it of items) {
      if (ignoresCollisions(it) || it.elevation > inchesToMm(80)) continue;
      if (convexOverlap(swing, polys.get(it.id)!, 1)) {
        issues.push({ id: `swing-${o.id}-${it.id}`, severity: 'warning', message: `Door swing hits ${it.name}`, elementIds: [o.id, it.id], at: { x: it.x, y: it.y } });
      }
    }
  }
  return issues;
}
