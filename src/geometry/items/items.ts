import { CATALOG_BY_ID, type CatalogEntry } from '../../assets/catalog';
import { newId } from '../../model/ids';
import type { ElementStatus, Floor, Item } from '../../model/types';
import type { WallGeometry } from '../walls/wallGeometry';
import { orientedRect } from '../primitives/polygon';
import { closestPointOnSegment, lineIntersection } from '../primitives/segment';
import { add, dot, exactDir, len, norm, perp, scale, sub, type Vec2 } from '../primitives/vec';

export function createItem(entry: CatalogEntry, at: Vec2, rotation: number, status: ElementStatus): Item {
  return {
    id: newId('item'),
    kind: 'item',
    catalogId: entry.id,
    category: entry.category,
    name: entry.name,
    x: at.x,
    y: at.y,
    rotation,
    width: entry.width,
    depth: entry.depth,
    height: entry.height,
    elevation: entry.elevation ?? 0,
    materialId: entry.materialId,
    assetRef: entry.assetRef,
    status,
    metadata: {},
  };
}

export const itemFootprint = (it: Pick<Item, 'x' | 'y' | 'width' | 'depth' | 'rotation'>): Vec2[] =>
  orientedRect({ x: it.x, y: it.y }, it.width, it.depth, it.rotation);

/** Local axes of an item: right (+width) and front (+depth, the side facing into the room). */
export function itemAxes(rotation: number): { right: Vec2; front: Vec2 } {
  const right = exactDir(rotation);
  return { right, front: perp(right) };
}

export type ItemSide = 'back' | 'front' | 'left' | 'right';

export interface WallDistance {
  side: ItemSide;
  /** Distance from the item's edge to the nearest wall face along the side's outward axis. */
  distance: number;
  from: Vec2;
  to: Vec2;
  dir: Vec2;
  compass: 'north' | 'south' | 'east' | 'west' | 'angled';
}

function compassOf(d: Vec2): WallDistance['compass'] {
  if (Math.abs(d.x) < 1e-6) return d.y < 0 ? 'north' : 'south';
  if (Math.abs(d.y) < 1e-6) return d.x < 0 ? 'west' : 'east';
  return 'angled';
}

/**
 * Casts rays from the midpoint of each item side outward and returns the
 * distance to the nearest wall face (finished surface), e.g. "32" from north wall".
 */
export function distancesToWalls(item: Item, geometry: WallGeometry, maxDistance = 20_000): WallDistance[] {
  const { right, front } = itemAxes(item.rotation);
  const c = { x: item.x, y: item.y };
  const sides: Array<[ItemSide, Vec2, number]> = [
    ['back', scale(front, -1), item.depth / 2],
    ['front', front, item.depth / 2],
    ['left', scale(right, -1), item.width / 2],
    ['right', right, item.width / 2],
  ];
  const faces: Array<[Vec2, Vec2]> = [];
  for (const fp of geometry.footprints.values()) {
    faces.push([fp.leftStart, fp.leftEnd], [fp.rightStart, fp.rightEnd]);
    faces.push([fp.leftStart, fp.rightStart], [fp.leftEnd, fp.rightEnd]);
  }
  const out: WallDistance[] = [];
  for (const [side, dir, half] of sides) {
    const origin = add(c, scale(dir, half));
    let best = maxDistance;
    let hitPt: Vec2 | null = null;
    for (const [p, q] of faces) {
      const hit = lineIntersection(origin, dir, p, sub(q, p));
      if (!hit || hit.t < -1 || hit.u < -1e-6 || hit.u > 1 + 1e-6) continue;
      if (hit.t < best) {
        best = hit.t;
        hitPt = hit.point;
      }
    }
    if (hitPt) out.push({ side, distance: Math.max(0, best), from: origin, to: hitPt, dir, compass: compassOf(dir) });
  }
  return out;
}

/**
 * Snaps a wall-aligned item's back against the nearest wall face within
 * `reach`, rotating it to face into the room. Returns null when no wall is near.
 */
export function snapItemToWall(
  item: Pick<Item, 'width' | 'depth'>,
  point: Vec2,
  floor: Floor,
  geometry: WallGeometry,
  reach: number,
): { x: number; y: number; rotation: number } | null {
  let best: { d: number; pt: Vec2; faceDir: Vec2; inward: Vec2 } | null = null;
  for (const fp of geometry.footprints.values()) {
    const w = floor.walls[fp.wallId];
    if (!w || w.status === 'demolish') continue;
    for (const side of ['left', 'right'] as const) {
      const s = side === 'left' ? fp.leftStart : fp.rightStart;
      const e = side === 'left' ? fp.leftEnd : fp.rightEnd;
      const hit = closestPointOnSegment(point, s, e);
      if (hit.distance > reach) continue;
      const inward = side === 'left' ? fp.normal : scale(fp.normal, -1);
      // Only snap from the room side of the face.
      if (dot(sub(point, hit.point), inward) < -1) continue;
      if (!best || hit.distance < best.d) best = { d: hit.distance, pt: hit.point, faceDir: fp.dir, inward };
    }
  }
  if (!best) return null;
  // Item "front" must equal inward: front = perp(right) → right = -perp(inward) rotated.
  const right = norm({ x: best.inward.y, y: -best.inward.x });
  const rotation = normalizeRotation((Math.atan2(right.y, right.x) * 180) / Math.PI);
  const center = add(best.pt, scale(best.inward, item.depth / 2));
  // Keep the cursor's position along the wall.
  const along = dot(sub(point, best.pt), best.faceDir);
  const c = add(center, scale(best.faceDir, along));
  return { x: c.x, y: c.y, rotation };
}

export function normalizeRotation(deg: number): number {
  let r = Math.round(deg * 1e6) / 1e6;
  r %= 360;
  if (r < 0) r += 360;
  return r === 360 ? 0 : r;
}

/** Moves an item so that its `side` edge is exactly `distance` from the wall it currently measures to. */
export function setDistanceToWall(item: Item, current: WallDistance, distance: number): Pick<Item, 'x' | 'y'> {
  const delta = current.distance - distance;
  const move = scale(current.dir, delta);
  return { x: item.x + move.x, y: item.y + move.y };
}

export function catalogEntry(item: Item): CatalogEntry | undefined {
  return CATALOG_BY_ID[item.catalogId];
}

export const isTiny = (v: Vec2) => len(v) < 1e-9;
