import { createOpening, offsetForPoint } from '../../geometry/openings/openings';
import { closestPointOnSegment } from '../../geometry/primitives/segment';
import { pointInPolygon } from '../../geometry/primitives/polygon';
import { add, dist, dot, norm, scale, sub, type Vec2 } from '../../geometry/primitives/vec';
import { addWallChainTo } from '../../geometry/walls/wallOps';
import { DEFAULT_EXTERIOR_THICKNESS, DEFAULT_INTERIOR_THICKNESS } from '../../model/factory';
import { FloorEditor } from '../../model/floorEditor';
import { finalizeFloor } from '../../model/pipeline';
import type { Floor, Id, ImportSettings, Observation, OpeningType } from '../../model/types';
import { interiorToCenterline, type Reconstruction, type RoomRecon } from './reconcile';

export interface BuildResult {
  floor: Floor;
  /** observation id → wall/opening id */
  links: Record<Id, Id>;
  /** Rooms that couldn't be built (not closed). */
  skipped: string[];
}

/** Room outline in world coordinates. */
export function placedPolygon(room: RoomRecon, layout: Record<string, { x: number; y: number }>): Vec2[] {
  const o = layout[room.group] ?? { x: 0, y: 0 };
  return room.polygon.map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
}

/**
 * Converts a reviewed reconstruction into walls. Edges that face another
 * room across one interior wall thickness become a single shared interior
 * wall; the rest become exterior walls. With interior (wall-to-wall)
 * measurements, walls are placed so their finished faces land exactly on the
 * measured lines.
 */
export function buildFloorFromReconstruction(
  base: Floor,
  recon: Reconstruction,
  layout: Record<string, { x: number; y: number }>,
  observations: Observation[],
  settings: ImportSettings,
  height: number,
): BuildResult {
  const ed = new FloorEditor(base);
  const skipped: string[] = [];
  const rooms = recon.rooms.filter((r) => {
    if (!r.closed) skipped.push(r.group);
    return r.closed;
  });
  const polys = new Map(rooms.map((r) => [r.group, placedPolygon(r, layout)]));
  const tInt = DEFAULT_INTERIOR_THICKNESS;
  const tExt = DEFAULT_EXTERIOR_THICKNESS;

  const isShared = (group: string, a: Vec2, b: Vec2): boolean => {
    const d = norm(sub(b, a));
    for (const [g, poly] of polys) {
      if (g === group) continue;
      for (let i = 0; i < poly.length; i++) {
        const c = poly[i];
        const e = poly[(i + 1) % poly.length];
        const d2 = norm(sub(e, c));
        if (dot(d, d2) > -0.999) continue;
        const gap = Math.abs(d.x * (c.y - a.y) - d.y * (c.x - a.x));
        if (Math.abs(gap - tInt) > 25 && gap > 25) continue;
        const t0 = dot(sub(c, a), d);
        const t1 = dot(sub(e, a), d);
        const overlap = Math.min(dist(a, b), Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
        if (overlap > 0.5 * Math.min(dist(a, b), dist(c, e))) return true;
      }
    }
    return false;
  };

  const edgeLines = new Map<Id, { a: Vec2; b: Vec2; group: string }>();
  for (const r of rooms) {
    const poly = polys.get(r.group)!;
    const n = poly.length;
    const shared = poly.map((p, i) => isShared(r.group, p, poly[(i + 1) % n]));
    const halves = shared.map((s) => (settings.interiorMeasurements ? (s ? tInt / 2 : tExt / 2) : 0));
    const center = interiorToCenterline(poly, halves);
    for (let i = 0; i < n; i++) {
      const a = center[i];
      const b = center[(i + 1) % n];
      addWallChainTo(ed, [a, b], {
        thickness: shared[i] ? tInt : tExt,
        height,
        wallType: shared[i] ? 'interior' : 'exterior',
        status: 'existing',
      });
      edgeLines.set(r.edges[i].obsId, { a, b, group: r.group });
    }
  }

  let floor = finalizeFloor(base, ed.floor).floor;
  const ed2 = new FloorEditor(floor);
  const links: Record<Id, Id> = {};

  // Link edge observations to the wall that runs along them.
  const wallAlong = (a: Vec2, b: Vec2): Id | null => {
    let best: { id: Id; overlap: number } | null = null;
    const d = norm(sub(b, a));
    for (const w of Object.values(floor.walls)) {
      const p = floor.nodes[w.a];
      const q = floor.nodes[w.b];
      if (closestPointOnSegment(p, a, b).distance > 2 && closestPointOnSegment(q, a, b).distance > 2) continue;
      const t0 = dot(sub(p, a), d);
      const t1 = dot(sub(q, a), d);
      const overlap = Math.min(dist(a, b), Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (overlap > 1 && (!best || overlap > best.overlap)) best = { id: w.id, overlap };
    }
    return best?.id ?? null;
  };
  for (const [obsId, line] of edgeLines) {
    const wallId = wallAlong(line.a, line.b);
    if (!wallId) continue;
    links[obsId] = wallId;
    const o = observations.find((x) => x.id === obsId);
    const w = floor.walls[wallId];
    const full = Math.abs(dist(floor.nodes[w.a], floor.nodes[w.b]) - dist(line.a, line.b)) < 1;
    ed2.patchWall(wallId, {
      sourceObservationId: obsId,
      ...(settings.lockMeasured && full && o?.status === 'confirmed' && !o.approximate
        ? { locks: { ...w.locks, length: true }, lockedLength: dist(floor.nodes[w.a], floor.nodes[w.b]) }
        : {}),
    });
  }

  // Openings: placed on the wall behind the referenced room edge.
  for (const o of observations) {
    if (o.status === 'rejected' || !o.group || o.edgeIndex === undefined) continue;
    const type: OpeningType | null = o.type === 'door' ? 'door' : o.type === 'window' ? 'window' : o.type === 'opening_width' ? 'opening' : null;
    if (!type) continue;
    const room = rooms.find((r) => r.group === o.group);
    const edge = room?.edges[o.edgeIndex];
    if (!room || !edge) continue;
    const line = edgeLines.get(edge.obsId);
    const wallId = links[edge.obsId] ?? (line ? wallAlong(line.a, line.b) : null);
    if (!wallId || !line) continue;
    const poly = polys.get(room.group)!;
    const start = poly[o.edgeIndex];
    const width = o.valueMm ?? 813;
    const along = o.offsetMm !== undefined ? o.offsetMm + width / 2 : edge.length / 2;
    const center = add(start, scale(edge.dir, along));
    const opening = createOpening(type, wallId, 0, 'existing', { width });
    ed2.putOpening({ ...opening, offset: offsetForPoint(ed2.floor, wallId, center, width) });
    links[o.id] = opening.id;
  }

  floor = finalizeFloor(floor, ed2.floor).floor;

  // Name rooms after their sketch groups.
  const ed3 = new FloorEditor(floor);
  for (const room of Object.values(floor.rooms)) {
    for (const [g, poly] of polys) {
      if (pointInPolygon(room.anchor, poly)) {
        ed3.patchRoom(room.id, { name: g });
        break;
      }
    }
  }
  return { floor: ed3.floor, links, skipped };
}
