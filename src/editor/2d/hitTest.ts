import type { PlanDerived } from '../../geometry/derive';
import { itemFootprint } from '../../geometry/items/items';
import { openingFrame } from '../../geometry/openings/openings';
import { pointInPolygon } from '../../geometry/primitives/polygon';
import { closestPointOnSegment } from '../../geometry/primitives/segment';
import { add, dist, norm, perp, scale, sub, type Vec2 } from '../../geometry/primitives/vec';
import { isVisibleInView, type RenovationView } from '../../model/renovation';
import type { Floor, Id } from '../../model/types';
import type { LabelHit, RoomLabelHit } from './renderer';
import { dirOf } from './renderer';
import type { Viewport } from './viewport';

export type HandleHit =
  | { handle: 'node'; wallId: Id; nodeId: Id }
  | { handle: 'itemCorner'; itemId: Id; corner: number }
  | { handle: 'itemRotate'; itemId: Id }
  | { handle: 'openingEdge'; openingId: Id; edge: 'start' | 'end' };

export type ElementKind2D = 'wall' | 'opening' | 'item' | 'annotation' | 'dimension' | 'room';

export type Hit =
  | { kind: 'label'; label: LabelHit }
  | { kind: 'roomLabel'; roomId: Id }
  | ({ kind: 'handle' } & HandleHit)
  | { kind: 'element'; id: Id; elementKind: ElementKind2D };

export interface HitContext {
  floor: Floor;
  derived: PlanDerived;
  vp: Viewport;
  selection: Set<Id>;
  labels: LabelHit[];
  roomLabels: RoomLabelHit[];
  view: RenovationView;
  showFurniture: boolean;
}

const inBox = (p: Vec2, b: { x: number; y: number; w: number; h: number }, pad = 0) =>
  p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

export function hitTest(world: Vec2, screen: Vec2, ctx: HitContext, opts: { labels?: boolean; handles?: boolean } = {}): Hit | null {
  const { floor, derived, vp, selection } = ctx;
  const tol = vp.px(6);

  if (opts.handles !== false) {
    for (const id of selection) {
      const w = floor.walls[id];
      if (w && !w.locked) {
        for (const nodeId of [w.a, w.b]) {
          const n = floor.nodes[nodeId];
          if (dist(vp.toScreen(n), screen) <= 8) return { kind: 'handle', handle: 'node', wallId: id, nodeId };
        }
      }
      const it = floor.items[id];
      if (it && !it.locked && selection.size === 1) {
        const rot = add({ x: it.x, y: it.y }, scale(perp(dirOf(it.rotation)), -(it.depth / 2 + vp.px(26))));
        if (dist(vp.toScreen(rot), screen) <= 9) return { kind: 'handle', handle: 'itemRotate', itemId: id };
        const corners = itemFootprint(it);
        for (let i = 0; i < 4; i++) if (dist(vp.toScreen(corners[i]), screen) <= 7) return { kind: 'handle', handle: 'itemCorner', itemId: id, corner: i };
      }
      const o = floor.openings[id];
      if (o) {
        const f = openingFrame(floor, o);
        if (f) {
          if (dist(vp.toScreen(f.start), screen) <= 7) return { kind: 'handle', handle: 'openingEdge', openingId: id, edge: 'start' };
          if (dist(vp.toScreen(f.end), screen) <= 7) return { kind: 'handle', handle: 'openingEdge', openingId: id, edge: 'end' };
        }
      }
    }
  }

  if (opts.labels !== false) {
    for (let i = ctx.labels.length - 1; i >= 0; i--) if (inBox(screen, ctx.labels[i], 2)) return { kind: 'label', label: ctx.labels[i] };
  }

  // Openings (thin — test before walls so they're clickable)
  for (const o of Object.values(floor.openings)) {
    if (o.hidden || !isVisibleInView(o.status, ctx.view)) continue;
    const f = openingFrame(floor, o);
    if (!f) continue;
    const c = closestPointOnSegment(world, f.start, f.end);
    if (c.distance <= f.thickness / 2 + tol) return { kind: 'element', id: o.id, elementKind: 'opening' };
    if (o.type === 'door' && o.door) {
      // Door leaf region counts too.
      const side = o.door.swing === 'left' ? 1 : -1;
      const hinge = o.door.hinge === 'start' ? f.start : f.end;
      const leafEnd = add(hinge, scale(f.normal, side * (f.thickness / 2 + o.width)));
      if (closestPointOnSegment(world, add(hinge, scale(f.normal, side * f.thickness / 2)), leafEnd).distance <= tol) return { kind: 'element', id: o.id, elementKind: 'opening' };
    }
  }

  for (const a of Object.values(floor.annotations)) {
    if (a.hidden) continue;
    const p = vp.toScreen(a);
    if (Math.abs(screen.x - p.x) < Math.max(30, a.text.length * a.fontSize * 0.3) && Math.abs(screen.y - p.y) < a.fontSize) return { kind: 'element', id: a.id, elementKind: 'annotation' };
  }

  for (const r of ctx.roomLabels) if (inBox(screen, r)) return { kind: 'roomLabel', roomId: r.roomId };

  // Walls: inside footprint or near centerline
  let bestWall: { id: Id; d: number } | null = null;
  for (const fp of derived.geometry.footprints.values()) {
    const w = floor.walls[fp.wallId];
    const inside = pointInPolygon(world, fp.polygon);
    const d = closestPointOnSegment(world, fp.a, fp.b).distance;
    if ((inside || d <= w.thickness / 2 + tol) && (!bestWall || d < bestWall.d)) bestWall = { id: w.id, d };
  }

  // Items: prefer smaller / higher items when stacked
  if (ctx.showFurniture) {
    const items = Object.values(floor.items)
      .filter((it) => !it.hidden && isVisibleInView(it.status, ctx.view))
      .sort((a, b) => a.width * a.depth - b.width * b.depth);
    for (const it of items) {
      if (pointInPolygon(world, itemFootprint(it))) {
        // A wall centerline click still wins over an item hugging the wall.
        if (bestWall && bestWall.d < floor.walls[bestWall.id].thickness / 2 - tol) break;
        return { kind: 'element', id: it.id, elementKind: 'item' };
      }
    }
  }
  if (bestWall) return { kind: 'element', id: bestWall.id, elementKind: 'wall' };

  for (const d of Object.values(floor.dimensions)) {
    const n = perp(norm(sub(d.b, d.a)));
    const a = add(d.a, scale(n, d.offset));
    const b = add(d.b, scale(n, d.offset));
    if (closestPointOnSegment(world, a, b).distance <= tol * 1.5) return { kind: 'element', id: d.id, elementKind: 'dimension' };
  }

  for (const r of derived.rooms) if (pointInPolygon(world, r.interiorPolygon)) return { kind: 'element', id: r.room.id, elementKind: 'room' };
  return null;
}

/** Ids of elements intersecting a world-space box (marquee). */
export function elementsInBox(a: Vec2, b: Vec2, ctx: HitContext, fully: boolean): Id[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  const inside = (p: Vec2) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  const test = (pts: Vec2[]) => (fully ? pts.every(inside) : pts.some(inside));
  const out: Id[] = [];
  const { floor } = ctx;
  for (const fp of ctx.derived.geometry.footprints.values()) {
    const w = floor.walls[fp.wallId];
    if (w.locked) continue;
    const mid = scale(add(fp.a, fp.b), 0.5);
    if (test(fully ? [fp.a, fp.b] : [fp.a, fp.b, mid])) out.push(w.id);
  }
  if (ctx.showFurniture)
    for (const it of Object.values(floor.items)) {
      if (it.hidden || it.locked || !isVisibleInView(it.status, ctx.view)) continue;
      if (test(itemFootprint(it))) out.push(it.id);
    }
  for (const o of Object.values(floor.openings)) {
    const f = openingFrame(floor, o);
    if (f && !o.hidden && test([f.start, f.end]) && fully) out.push(o.id);
  }
  for (const n of Object.values(floor.annotations)) if (inside(n)) out.push(n.id);
  return out;
}
