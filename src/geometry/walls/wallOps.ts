import { FloorEditor } from '../../model/floorEditor';
import { newId } from '../../model/ids';
import { DEFAULT_WALL_MATERIAL } from '../../model/materials';
import type { ElementStatus, Floor, Id, Opening, Wall, WallType } from '../../model/types';
import { closestPointOnSegment, lineIntersection, segmentIntersection } from '../primitives/segment';
import { add, dist, dot, len, norm, perp, scale, sub, type Vec2 } from '../primitives/vec';

/** Points closer than this (mm) are treated as the same junction. */
export const NODE_MERGE_TOLERANCE = 1;
/** Walls within this angle (deg) are treated as parallel/collinear. */
export const PARALLEL_TOLERANCE_DEG = 0.5;
const COS_PARALLEL = Math.cos((PARALLEL_TOLERANCE_DEG * Math.PI) / 180);

export interface WallProps {
  thickness: number;
  height: number;
  wallType: WallType;
  status: ElementStatus;
  materialId?: Id;
}

const pos = (ed: FloorEditor, id: Id): Vec2 => ({ x: ed.nodes[id].x, y: ed.nodes[id].y });

export function makeWall(a: Id, b: Id, props: WallProps, id = newId('wall')): Wall {
  return {
    id,
    kind: 'wall',
    a,
    b,
    thickness: props.thickness,
    height: props.height,
    wallType: props.wallType,
    materialId: props.materialId ?? DEFAULT_WALL_MATERIAL,
    status: props.status,
    locks: { length: false, angle: false, position: false },
  };
}

/** Finds an existing node within tolerance of p. */
export function findNodeAt(ed: FloorEditor, p: Vec2, tol = NODE_MERGE_TOLERANCE): Id | null {
  let best: Id | null = null;
  let bestD = tol;
  for (const n of Object.values(ed.nodes)) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

/**
 * Returns a node at p: reuses an existing node, or splits a wall whose
 * centerline passes through p (T-junction), or creates a free node.
 */
export function getOrCreateNodeAt(ed: FloorEditor, p: Vec2, tol = NODE_MERGE_TOLERANCE): Id {
  const existing = findNodeAt(ed, p, tol);
  if (existing) return existing;
  for (const w of Object.values(ed.walls)) {
    const a = pos(ed, w.a);
    const b = pos(ed, w.b);
    const hit = closestPointOnSegment(p, a, b);
    if (hit.distance <= tol && hit.t > 0 && hit.t < 1) {
      return splitWallAt(ed, w.id, hit.point).nodeId;
    }
  }
  return ed.addNode(p.x, p.y).id;
}

/**
 * Splits a wall at a point on (or projected onto) its centerline. Openings are
 * redistributed to whichever piece contains their center.
 */
export function splitWallAt(ed: FloorEditor, wallId: Id, point: Vec2): { nodeId: Id; first: Id; second: Id } {
  const w = ed.walls[wallId];
  const a = pos(ed, w.a);
  const b = pos(ed, w.b);
  const L = dist(a, b);
  const t = Math.max(0, Math.min(1, dot(sub(point, a), sub(b, a)) / (L * L)));
  const at = add(a, scale(sub(b, a), t));
  const splitLen = L * t;
  const node = ed.addNode(at.x, at.y);
  const second: Wall = { ...w, id: newId('wall'), a: node.id, b: w.b, locks: { ...w.locks }, lockedLength: undefined };
  ed.patchWall(w.id, { b: node.id, lockedLength: undefined, locks: { ...w.locks, length: false } });
  second.locks.length = false;
  ed.putWall(second);
  for (const o of ed.openingsOnWall(w.id)) {
    const center = o.offset + o.width / 2;
    if (center > splitLen) ed.patchOpening(o.id, { wallId: second.id, offset: Math.max(0, o.offset - splitLen) });
    else ed.patchOpening(o.id, { offset: Math.min(o.offset, Math.max(0, splitLen - o.width)) });
  }
  return { nodeId: node.id, first: w.id, second: second.id };
}

/** Splits two crossing walls at their intersection so rooms can be detected. */
function splitCrossings(ed: FloorEditor, wallId: Id): void {
  const queue = [wallId];
  const guard = new Set<string>();
  while (queue.length) {
    const id = queue.pop()!;
    const w = ed.walls[id];
    if (!w) continue;
    for (const other of Object.values(ed.walls)) {
      if (other.id === w.id) continue;
      if (other.a === w.a || other.a === w.b || other.b === w.a || other.b === w.b) continue;
      const a = pos(ed, w.a);
      const b = pos(ed, w.b);
      const c = pos(ed, other.a);
      const d = pos(ed, other.b);
      // Collinear overlap: split both walls at each other's endpoints, then
      // the coincident pieces collapse into one shared wall.
      if (collinearOverlap(a, b, c, d)) {
        const key = [w.id, other.id].sort().join('|') + '|col';
        if (guard.has(key)) continue;
        guard.add(key);
        let changed = false;
        for (const [p, nodeId] of [
          [c, other.a],
          [d, other.b],
        ] as const) {
          const cur = ed.walls[id];
          if (!cur) break;
          const A = pos(ed, cur.a);
          const B = pos(ed, cur.b);
          const t = dot(sub(p, A), sub(B, A)) / dot(sub(B, A), sub(B, A));
          if (t > 1e-6 && t < 1 - 1e-6 && dist(p, A) > NODE_MERGE_TOLERANCE && dist(p, B) > NODE_MERGE_TOLERANCE) {
            const s = splitWallAt(ed, cur.id, p);
            mergeNodeInto(ed, s.nodeId, nodeId);
            queue.push(s.first, s.second);
            changed = true;
            break;
          }
        }
        if (changed) break;
        for (const [p, nodeId] of [
          [a, w.a],
          [b, w.b],
        ] as const) {
          const o = ed.walls[other.id];
          if (!o) break;
          const C = pos(ed, o.a);
          const D = pos(ed, o.b);
          const t = dot(sub(p, C), sub(D, C)) / dot(sub(D, C), sub(D, C));
          if (t > 1e-6 && t < 1 - 1e-6 && dist(p, C) > NODE_MERGE_TOLERANCE && dist(p, D) > NODE_MERGE_TOLERANCE) {
            const s = splitWallAt(ed, o.id, p);
            mergeNodeInto(ed, s.nodeId, nodeId);
            queue.push(id);
            changed = true;
            break;
          }
        }
        if (changed) break;
        continue;
      }
      const hit = segmentIntersection(a, b, c, d, 1e-9);
      if (!hit) continue;
      const key = [w.id, other.id].sort().join('|');
      if (guard.has(key)) continue;
      guard.add(key);
      const nearA = dist(hit.point, a) <= NODE_MERGE_TOLERANCE;
      const nearB = dist(hit.point, b) <= NODE_MERGE_TOLERANCE;
      const nearC = dist(hit.point, c) <= NODE_MERGE_TOLERANCE;
      const nearD = dist(hit.point, d) <= NODE_MERGE_TOLERANCE;
      let nodeId: Id;
      if (nearA || nearB) {
        nodeId = nearA ? w.a : w.b;
        if (!nearC && !nearD) {
          const s = splitWallAt(ed, other.id, hit.point);
          mergeNodeInto(ed, s.nodeId, nodeId);
          queue.push(s.second);
        }
      } else if (nearC || nearD) {
        nodeId = nearC ? other.a : other.b;
        const s = splitWallAt(ed, w.id, hit.point);
        mergeNodeInto(ed, s.nodeId, nodeId);
        queue.push(s.first, s.second);
        break;
      } else {
        const s1 = splitWallAt(ed, w.id, hit.point);
        const s2 = splitWallAt(ed, other.id, hit.point);
        mergeNodeInto(ed, s2.nodeId, s1.nodeId);
        queue.push(s1.first, s1.second, s2.second);
        break;
      }
    }
  }
}

/** True when two segments lie on the same line (within 1 mm) and overlap by more than a point. */
function collinearOverlap(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const L = dist(a, b);
  if (L < 1e-9) return false;
  const u = norm(sub(b, a));
  const off = (p: Vec2) => Math.abs(u.x * (p.y - a.y) - u.y * (p.x - a.x));
  if (off(c) > NODE_MERGE_TOLERANCE || off(d) > NODE_MERGE_TOLERANCE) return false;
  const tc = dot(sub(c, a), u);
  const td = dot(sub(d, a), u);
  const lo = Math.max(0, Math.min(tc, td));
  const hi = Math.min(L, Math.max(tc, td));
  return hi - lo > NODE_MERGE_TOLERANCE;
}

/** Re-points every wall from `from` to `into` and deletes `from`. Drops degenerate walls. */
export function mergeNodeInto(ed: FloorEditor, from: Id, into: Id): void {
  if (from === into) return;
  for (const w of ed.wallsAtNode(from)) {
    const a = w.a === from ? into : w.a;
    const b = w.b === from ? into : w.b;
    if (a === b) {
      removeWallInternal(ed, w.id);
      continue;
    }
    ed.patchWall(w.id, { a, b });
  }
  ed.removeNode(from);
  dedupeParallelWalls(ed, into);
}

/** Removes duplicate walls connecting the same pair of nodes. */
function dedupeParallelWalls(ed: FloorEditor, nodeId: Id): void {
  const seen = new Map<string, Id>();
  for (const w of ed.wallsAtNode(nodeId)) {
    const key = [w.a, w.b].sort().join('|');
    const prev = seen.get(key);
    if (prev) {
      for (const o of ed.openingsOnWall(w.id)) ed.patchOpening(o.id, { wallId: prev });
      ed.removeWall(w.id);
    } else seen.set(key, w.id);
  }
}

function removeWallInternal(ed: FloorEditor, wallId: Id): void {
  for (const o of ed.openingsOnWall(wallId)) ed.removeOpening(o.id);
  ed.removeWall(wallId);
}

/** Deletes nodes that no longer have walls. */
export function removeOrphanNodes(ed: FloorEditor): void {
  const used = new Set<Id>();
  for (const w of Object.values(ed.walls)) {
    used.add(w.a);
    used.add(w.b);
  }
  for (const id of Object.keys(ed.nodes)) if (!used.has(id)) ed.removeNode(id);
}

/**
 * Adds a polyline of walls. Endpoints snap onto existing junctions, T-junction
 * into existing walls, and crossings are split so room detection works.
 */
export function addWallChain(
  floor: Floor,
  points: Vec2[],
  props: WallProps,
  opts: { closed?: boolean } = {},
): { floor: Floor; wallIds: Id[] } {
  const ed = new FloorEditor(floor);
  const wallIds = addWallChainTo(ed, points, props, opts);
  return { floor: ed.floor, wallIds };
}

export function addWallChainTo(ed: FloorEditor, points: Vec2[], props: WallProps, opts: { closed?: boolean } = {}): Id[] {
  const pts = [...points];
  if (opts.closed && pts.length > 2) pts.push(pts[0]);
  const created: Id[] = [];
  let prevNode: Id | null = null;
  for (let i = 0; i < pts.length; i++) {
    const nodeId = getOrCreateNodeAt(ed, pts[i]);
    if (prevNode && prevNode !== nodeId) {
      const exists = Object.values(ed.walls).some(
        (w) => (w.a === prevNode && w.b === nodeId) || (w.a === nodeId && w.b === prevNode),
      );
      if (!exists) {
        const wall = makeWall(prevNode, nodeId, props);
        ed.putWall(wall);
        created.push(wall.id);
      }
    }
    prevNode = nodeId;
  }
  const all = new Set(created);
  for (const id of created) {
    const before = new Set(Object.keys(ed.walls));
    splitCrossings(ed, id);
    for (const k of Object.keys(ed.walls)) if (!before.has(k)) all.add(k);
  }
  return [...all].filter((id) => ed.walls[id]);
}

export function deleteWalls(floor: Floor, wallIds: Id[]): Floor {
  const ed = new FloorEditor(floor);
  for (const id of wallIds) removeWallInternal(ed, id);
  removeOrphanNodes(ed);
  return ed.floor;
}

/** Reverses direction a↔b while keeping openings physically in place. */
export function reverseWall(floor: Floor, wallId: Id): Floor {
  const ed = new FloorEditor(floor);
  const w = ed.walls[wallId];
  const L = dist(pos(ed, w.a), pos(ed, w.b));
  ed.patchWall(wallId, {
    a: w.b,
    b: w.a,
    materialId: w.materialIdRight ?? w.materialId,
    materialIdRight: w.materialIdRight ? w.materialId : undefined,
    lockedAngle: w.lockedAngle !== undefined ? (w.lockedAngle + 180) % 360 : undefined,
  });
  for (const o of ed.openingsOnWall(wallId)) {
    const patch: Partial<Opening> = { offset: Math.max(0, L - o.offset - o.width) };
    if (o.door)
      patch.door = { ...o.door, hinge: o.door.hinge === 'start' ? 'end' : 'start', swing: o.door.swing === 'left' ? 'right' : 'left' };
    ed.patchOpening(o.id, patch);
  }
  return ed.floor;
}

/**
 * Merges two collinear walls sharing a junction that has no other walls.
 * Returns null when they can't be merged.
 */
export function mergeWalls(floor: Floor, w1Id: Id, w2Id: Id): Floor | null {
  const ed = new FloorEditor(floor);
  const w1 = ed.walls[w1Id];
  const w2 = ed.walls[w2Id];
  if (!w1 || !w2 || w1.id === w2.id) return null;
  const shared = [w1.a, w1.b].find((n) => n === w2.a || n === w2.b);
  if (!shared || ed.wallsAtNode(shared).length !== 2) return null;
  const s = pos(ed, shared);
  const o1 = w1.a === shared ? w1.b : w1.a;
  const o2 = w2.a === shared ? w2.b : w2.a;
  if (dot(norm(sub(pos(ed, o1), s)), norm(sub(pos(ed, o2), s))) > -COS_PARALLEL) return null;
  // Keep w1's orientation for the merged wall.
  const start = w1.a === o1 ? o1 : o2;
  const end = start === o1 ? o2 : o1;
  const P = pos(ed, start);
  const u = norm(sub(pos(ed, end), P));
  const moved: Array<{ o: Opening; center: Vec2; reversed: boolean }> = [];
  for (const w of [w1, w2]) {
    const wa = pos(ed, w.a);
    const wd = norm(sub(pos(ed, w.b), wa));
    for (const o of ed.openingsOnWall(w.id)) {
      moved.push({ o, center: add(wa, scale(wd, o.offset + o.width / 2)), reversed: dot(wd, u) < 0 });
    }
  }
  ed.patchWall(w1.id, { a: start, b: end, lockedLength: undefined, locks: { ...w1.locks, length: false } });
  ed.removeWall(w2.id);
  ed.removeNode(shared);
  for (const { o, center, reversed } of moved) {
    const patch: Partial<Opening> = { wallId: w1.id, offset: Math.max(0, dot(sub(center, P), u) - o.width / 2) };
    if (reversed && o.door)
      patch.door = { ...o.door, hinge: o.door.hinge === 'start' ? 'end' : 'start', swing: o.door.swing === 'left' ? 'right' : 'left' };
    ed.patchOpening(o.id, patch);
  }
  return ed.floor;
}

/** Nodes of other walls at `nodeId` excluding `wallId`, as (otherNode, direction-from-node). */
function spokes(ed: FloorEditor, nodeId: Id, excludeWall: Id): Array<{ wall: Wall; other: Id; dir: Vec2 }> {
  const p = pos(ed, nodeId);
  return ed
    .wallsAtNode(nodeId)
    .filter((w) => w.id !== excludeWall)
    .map((w) => {
      const other = w.a === nodeId ? w.b : w.a;
      return { wall: w, other, dir: norm(sub(pos(ed, other), p)) };
    });
}

/**
 * Moves a wall perpendicular to itself by `offset` mm (positive = toward its
 * left normal). Each endpoint slides along the connected wall's line when
 * there is a single non-parallel neighbor line, so neighbor angles are
 * preserved and connectivity is never broken.
 */
export function moveWallPerpendicular(floor: Floor, wallId: Id, offset: number): Floor {
  const ed = new FloorEditor(floor);
  moveWallPerpendicularIn(ed, wallId, offset);
  return ed.floor;
}

export function moveWallPerpendicularIn(ed: FloorEditor, wallId: Id, offset: number): void {
  const w = ed.walls[wallId];
  const a = pos(ed, w.a);
  const b = pos(ed, w.b);
  const d = norm(sub(b, a));
  const n = perp(d);
  const shift = scale(n, offset);
  const newA = add(a, shift);
  const newB = add(b, shift);
  const place = (nodeId: Id, fallback: Vec2) => {
    const lines = spokes(ed, nodeId, wallId).filter((s) => Math.abs(dot(s.dir, d)) < COS_PARALLEL);
    const p = pos(ed, nodeId);
    const distinct: Vec2[] = [];
    for (const s of lines) if (!distinct.some((q) => Math.abs(Math.abs(dot(q, s.dir)) - 1) < 1e-6)) distinct.push(s.dir);
    if (distinct.length === 1) {
      const hit = lineIntersection(p, distinct[0], newA, d);
      if (hit) {
        ed.setNode(nodeId, hit.point.x, hit.point.y);
        return;
      }
    }
    ed.setNode(nodeId, fallback.x, fallback.y);
  };
  place(w.a, newA);
  place(w.b, newB);
}

/** Translates a set of walls (their nodes) rigidly. Connected walls stretch. */
export function translateWalls(floor: Floor, wallIds: Id[], delta: Vec2): Floor {
  const ed = new FloorEditor(floor);
  const nodes = new Set<Id>();
  for (const id of wallIds) {
    const w = ed.walls[id];
    if (!w) continue;
    nodes.add(w.a);
    nodes.add(w.b);
  }
  for (const id of nodes) {
    const p = pos(ed, id);
    ed.setNode(id, p.x + delta.x, p.y + delta.y);
  }
  return ed.floor;
}

export type ResizeAnchor = 'start' | 'center' | 'end';
export type ResizeMode = 'connected' | 'stretch' | 'endpoint';

export interface ResizeResult {
  floor: Floor;
  movedNodes: Id[];
}

/**
 * Changes a wall's centerline length.
 *
 * Modes:
 *  - `connected` (default): the moving end carries along every wall reachable
 *    through non-parallel connections (they translate rigidly, preserving
 *    angles); walls parallel to the resize direction absorb the change. This
 *    keeps rectangles rectangular and only touches the local structure.
 *  - `stretch`: every node beyond the moving end (projected on the wall axis)
 *    shifts, like inserting a strip into the whole plan.
 *  - `endpoint`: only the wall's own endpoint moves.
 */
export function resizeWall(
  floor: Floor,
  wallId: Id,
  newLength: number,
  anchor: ResizeAnchor = 'start',
  mode: ResizeMode = 'connected',
): ResizeResult {
  const ed = new FloorEditor(floor);
  const w = ed.walls[wallId];
  if (!w || newLength <= 0) return { floor, movedNodes: [] };
  const a = pos(ed, w.a);
  const b = pos(ed, w.b);
  const u = norm(sub(b, a));
  // Exact target endpoints; every carried node gets the identical shift vector
  // so axis-aligned walls stay exactly axis-aligned.
  const moves = new Map<Id, Vec2>();
  const plan: Array<{ node: Id; shift: Vec2; frozen: Id }> = [];
  if (anchor === 'start') plan.push({ node: w.b, shift: sub(add(a, scale(u, newLength)), b), frozen: w.a });
  else if (anchor === 'end') plan.push({ node: w.a, shift: sub(sub(b, scale(u, newLength)), a), frozen: w.b });
  else {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    plan.push({ node: w.b, shift: sub(add(m, scale(u, newLength / 2)), b), frozen: w.a });
    plan.push({ node: w.a, shift: sub(sub(m, scale(u, newLength / 2)), a), frozen: w.b });
  }
  const claimed = new Set<Id>([w.a, w.b]);
  for (const step of plan) {
    const set =
      mode === 'endpoint'
        ? new Set([step.node])
        : mode === 'stretch'
          ? nodesBeyond(ed, step.node, step.shift, claimed, step.frozen)
          : connectedCarry(ed, step.node, step.shift, wallId, claimed, step.frozen);
    for (const id of set) {
      moves.set(id, step.shift);
      claimed.add(id);
    }
  }
  for (const [id, s] of moves) {
    const p = pos(ed, id);
    ed.setNode(id, p.x + s.x, p.y + s.y);
  }
  if (w.locks.length) ed.patchWall(wallId, { lockedLength: newLength });
  return { floor: ed.floor, movedNodes: [...moves.keys()] };
}

function connectedCarry(ed: FloorEditor, start: Id, shift: Vec2, resizedWall: Id, claimed: Set<Id>, frozen: Id): Set<Id> {
  const u = norm(shift);
  const moved = new Set<Id>([start]);
  if (len(shift) < 1e-12) return moved;
  const queue = [start];
  while (queue.length) {
    const n = queue.pop()!;
    for (const s of spokes(ed, n, resizedWall)) {
      if (moved.has(s.other) || s.other === frozen || (claimed.has(s.other) && s.other !== start)) continue;
      if (Math.abs(dot(s.dir, u)) >= COS_PARALLEL) continue; // parallel: this wall stretches
      moved.add(s.other);
      queue.push(s.other);
    }
  }
  return moved;
}

function nodesBeyond(ed: FloorEditor, start: Id, shift: Vec2, claimed: Set<Id>, frozen: Id): Set<Id> {
  const u = norm(shift);
  const origin = pos(ed, start);
  const out = new Set<Id>([start]);
  for (const n of Object.values(ed.nodes)) {
    if (n.id === frozen || (claimed.has(n.id) && n.id !== start)) continue;
    if (dot(sub({ x: n.x, y: n.y }, origin), u) >= -NODE_MERGE_TOLERANCE) out.add(n.id);
  }
  return out;
}

/** Rotates a wall to an absolute direction (deg), keeping `anchor` fixed. */
export function setWallAngle(floor: Floor, wallId: Id, angleDeg: number, anchor: 'start' | 'end' | 'center' = 'start'): Floor {
  const ed = new FloorEditor(floor);
  const w = ed.walls[wallId];
  const a = pos(ed, w.a);
  const b = pos(ed, w.b);
  const L = dist(a, b);
  const r = (angleDeg * Math.PI) / 180;
  const exact = (x: number) => (Math.abs(x) < 1e-12 ? 0 : Math.abs(Math.abs(x) - 1) < 1e-12 ? Math.sign(x) : x);
  const d = { x: exact(Math.cos(r)), y: exact(Math.sin(r)) };
  if (anchor === 'start') ed.setNode(w.b, a.x + d.x * L, a.y + d.y * L);
  else if (anchor === 'end') ed.setNode(w.a, b.x - d.x * L, b.y - d.y * L);
  else {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ed.setNode(w.a, m.x - (d.x * L) / 2, m.y - (d.y * L) / 2);
    ed.setNode(w.b, m.x + (d.x * L) / 2, m.y + (d.y * L) / 2);
  }
  if (w.locks.angle) ed.patchWall(wallId, { lockedAngle: angleDeg });
  return ed.floor;
}

/** Moves a junction node. If it lands on another node, they merge. */
export function moveNode(floor: Floor, nodeId: Id, p: Vec2, mergeOnDrop = false): Floor {
  const ed = new FloorEditor(floor);
  ed.setNode(nodeId, p.x, p.y);
  if (mergeOnDrop) {
    const other = Object.values(ed.nodes).find((n) => n.id !== nodeId && Math.hypot(n.x - p.x, n.y - p.y) <= NODE_MERGE_TOLERANCE);
    if (other) mergeNodeInto(ed, nodeId, other.id);
    else {
      for (const w of ed.wallsAtNode(nodeId)) splitCrossings(ed, w.id);
      const target = Object.values(ed.walls).find((w) => {
        if (w.a === nodeId || w.b === nodeId) return false;
        const hit = closestPointOnSegment(p, pos(ed, w.a), pos(ed, w.b));
        return hit.distance <= NODE_MERGE_TOLERANCE && hit.t > 0 && hit.t < 1;
      });
      if (target) {
        const s = splitWallAt(ed, target.id, p);
        mergeNodeInto(ed, s.nodeId, nodeId);
        ed.setNode(nodeId, p.x, p.y);
      }
    }
  }
  return ed.floor;
}

/** Duplicates walls (and their openings) with an offset. Returns new wall ids. */
export function duplicateWalls(floor: Floor, wallIds: Id[], delta: Vec2): { floor: Floor; wallIds: Id[] } {
  const ed = new FloorEditor(floor);
  const nodeMap = new Map<Id, Id>();
  const created: Id[] = [];
  const mapNode = (id: Id) => {
    if (!nodeMap.has(id)) {
      const p = pos(ed, id);
      nodeMap.set(id, ed.addNode(p.x + delta.x, p.y + delta.y).id);
    }
    return nodeMap.get(id)!;
  };
  for (const id of wallIds) {
    const w = floor.walls[id];
    if (!w) continue;
    const nw: Wall = { ...w, id: newId('wall'), a: mapNode(w.a), b: mapNode(w.b), status: w.status === 'demolish' ? 'new' : w.status };
    ed.putWall(nw);
    created.push(nw.id);
    for (const o of Object.values(floor.openings).filter((op) => op.wallId === id)) {
      ed.putOpening({ ...o, id: newId(o.type), wallId: nw.id });
    }
  }
  return { floor: ed.floor, wallIds: created };
}
