import type { Floor, Id, Room, Wall } from '../../model/types';
import { DEFAULT_FLOOR_MATERIAL } from '../../model/materials';
import { newId } from '../../model/ids';
import { lineIntersection } from '../primitives/segment';
import { interiorPoint, perimeter, pointInPolygon, polygonArea, signedArea } from '../primitives/polygon';
import { add, angleOf, norm, perp, scale, sub, type Vec2 } from '../primitives/vec';

export interface DetectedFace {
  nodeIds: Id[];
  wallIds: Id[];
  /** Polygon through wall centerline junctions. */
  centerPolygon: Vec2[];
  /** Polygon of the finished interior wall faces. */
  interiorPolygon: Vec2[];
  /** Interior (finished-surface) area in mm². */
  area: number;
  perimeter: number;
  labelPoint: Vec2;
  key: string;
}

export interface DetectedRoom extends DetectedFace {
  room: Room;
}

/** Walls that define rooms in the proposed layout. */
export const roomDefiningWall = (w: Wall): boolean => w.status !== 'demolish';

const MIN_ROOM_AREA = 90_000; // 0.09 m² ≈ 1 ft²

/**
 * Finds bounded faces of the planar wall graph. Assumes crossing walls have
 * been split at their intersections (the wall ops guarantee this).
 */
export function detectFaces(floor: Floor, include: (w: Wall) => boolean = roomDefiningWall): DetectedFace[] {
  const walls = Object.values(floor.walls).filter((w) => include(w) && w.a !== w.b && floor.nodes[w.a] && floor.nodes[w.b]);
  const adj = new Map<Id, Map<Id, Wall>>();
  const link = (u: Id, v: Id, w: Wall) => {
    if (!adj.has(u)) adj.set(u, new Map());
    adj.get(u)!.set(v, w);
  };
  for (const w of walls) {
    link(w.a, w.b, w);
    link(w.b, w.a, w);
  }
  // Prune dangling walls (degree-1 chains) — they can't bound a room.
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [u, nbrs] of adj) {
      if (nbrs.size <= 1) {
        for (const v of nbrs.keys()) adj.get(v)?.delete(u);
        adj.delete(u);
        pruned = true;
      }
    }
  }
  const pos = (id: Id): Vec2 => ({ x: floor.nodes[id].x, y: floor.nodes[id].y });
  const sortedOut = new Map<Id, Array<{ to: Id; angle: number }>>();
  for (const [u, nbrs] of adj) {
    const pu = pos(u);
    const list = [...nbrs.keys()].map((to) => ({ to, angle: angleOf(sub(pos(to), pu)) }));
    list.sort((a, b) => a.angle - b.angle);
    sortedOut.set(u, list);
  }

  const visited = new Set<string>();
  const faces: DetectedFace[] = [];
  for (const [u, list] of sortedOut) {
    for (const { to } of list) {
      const startKey = `${u}>${to}`;
      if (visited.has(startKey)) continue;
      const nodeIds: Id[] = [];
      let from = u;
      let cur = to;
      let guard = 0;
      visited.add(startKey);
      nodeIds.push(from);
      while (cur !== u && guard++ < 10_000) {
        nodeIds.push(cur);
        const out = sortedOut.get(cur)!;
        // Take the sharpest right turn (largest angle below the way back) so
        // bounded faces are traced clockwise on screen (positive area).
        const back = angleOf(sub(pos(from), pos(cur)));
        let next: { to: Id; angle: number } | undefined;
        for (let k = out.length - 1; k >= 0; k--) {
          if (out[k].angle < back - 1e-12) {
            next = out[k];
            break;
          }
        }
        if (!next) next = out[out.length - 1];
        const k = `${cur}>${next.to}`;
        if (visited.has(k)) break;
        visited.add(k);
        from = cur;
        cur = next.to;
      }
      if (cur !== u || nodeIds.length < 3) continue;
      const centerPolygon = nodeIds.map(pos);
      if (signedArea(centerPolygon) <= 0) continue; // outer boundary of a component
      const wallIds = nodeIds.map((id, i) => adj.get(id)!.get(nodeIds[(i + 1) % nodeIds.length])!.id);
      const interiorPolygon = offsetInterior(floor, wallIds, centerPolygon);
      const area = polygonArea(interiorPolygon);
      if (area < MIN_ROOM_AREA) continue;
      faces.push({
        nodeIds,
        wallIds,
        centerPolygon,
        interiorPolygon,
        area,
        perimeter: perimeter(interiorPolygon),
        labelPoint: interiorPoint(interiorPolygon),
        key: [...nodeIds].sort().join(','),
      });
    }
  }
  return faces;
}

/** Offsets each boundary edge inward by its wall's half thickness and re-intersects. */
function offsetInterior(floor: Floor, wallIds: Id[], poly: Vec2[]): Vec2[] {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const d = norm(sub(q, p));
    const h = floor.walls[wallIds[i]].thickness / 2;
    return { p: add(p, scale(perp(d), h)), d };
  });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i + n - 1) % n];
    const cur = lines[i];
    const hit = lineIntersection(prev.p, prev.d, cur.p, cur.d);
    out.push(hit && Math.abs(hit.t) < 1e7 ? hit.point : cur.p);
  }
  return out;
}

/**
 * Keeps stored room records in sync with detected faces while preserving
 * user metadata (names, finishes) across geometry edits. Returns the same
 * record object when nothing changed so structural sharing is preserved.
 */
export function syncRooms(floor: Floor, faces: DetectedFace[] = detectFaces(floor)): Record<Id, Room> {
  const existing = Object.values(floor.rooms);
  const used = new Set<Id>();
  const next: Record<Id, Room> = {};
  let changed = false;
  const byKey = new Map(existing.map((r) => [r.boundaryKey, r]));
  const pending: DetectedFace[] = [];

  for (const face of faces) {
    const r = byKey.get(face.key);
    if (r && !used.has(r.id)) {
      used.add(r.id);
      next[r.id] = r;
    } else pending.push(face);
  }
  for (const face of pending) {
    let match = existing.find((r) => !used.has(r.id) && pointInPolygon(r.anchor, face.centerPolygon));
    if (!match) {
      const faceNodes = new Set(face.nodeIds);
      match = existing.find(
        (r) => !used.has(r.id) && r.boundaryKey.split(',').filter((id) => faceNodes.has(id)).length >= 3,
      );
    }
    changed = true;
    if (match) {
      used.add(match.id);
      next[match.id] = { ...match, boundaryKey: face.key, anchor: face.labelPoint };
    } else {
      const id = newId('room');
      next[id] = {
        id,
        kind: 'room',
        name: nextRoomName([...existing, ...Object.values(next)]),
        floorMaterialId: DEFAULT_FLOOR_MATERIAL,
        labelOffset: { x: 0, y: 0 },
        boundaryKey: face.key,
        anchor: face.labelPoint,
      };
    }
  }
  if (!changed && existing.length === Object.keys(next).length) return floor.rooms;
  return next;
}

/** Joins detected faces with their stored room records. */
export function resolveRooms(floor: Floor, faces: DetectedFace[]): DetectedRoom[] {
  const byKey = new Map(Object.values(floor.rooms).map((r) => [r.boundaryKey, r]));
  const out: DetectedRoom[] = [];
  for (const f of faces) {
    const room = byKey.get(f.key);
    if (room) out.push({ ...f, room });
  }
  return out;
}

function nextRoomName(rooms: Room[]): string {
  let max = 0;
  for (const r of rooms) {
    const m = /^Room (\d+)$/.exec(r.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Room ${max + 1}`;
}
