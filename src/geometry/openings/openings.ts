import { FloorEditor } from '../../model/floorEditor';
import { newId } from '../../model/ids';
import type { ElementStatus, Floor, Id, Opening, OpeningType } from '../../model/types';
import { inchesToMm } from '../measurement/units';
import { add, dist, dot, norm, perp, scale, sub, type Vec2 } from '../primitives/vec';

export const OPENING_DEFAULTS: Record<OpeningType, { width: number; height: number; sill: number }> = {
  door: { width: inchesToMm(32), height: inchesToMm(80), sill: 0 },
  window: { width: inchesToMm(36), height: inchesToMm(48), sill: inchesToMm(36) },
  opening: { width: inchesToMm(36), height: inchesToMm(80), sill: 0 },
};

export interface OpeningFrame {
  start: Vec2;
  end: Vec2;
  center: Vec2;
  dir: Vec2;
  normal: Vec2;
  wallLength: number;
  thickness: number;
}

export function openingFrame(floor: Floor, o: Opening): OpeningFrame | null {
  const w = floor.walls[o.wallId];
  if (!w) return null;
  const a = floor.nodes[w.a];
  const b = floor.nodes[w.b];
  if (!a || !b) return null;
  const A = { x: a.x, y: a.y };
  const B = { x: b.x, y: b.y };
  const dir = norm(sub(B, A));
  const start = add(A, scale(dir, o.offset));
  const end = add(A, scale(dir, o.offset + o.width));
  return {
    start,
    end,
    center: add(A, scale(dir, o.offset + o.width / 2)),
    dir,
    normal: perp(dir),
    wallLength: dist(A, B),
    thickness: w.thickness,
  };
}

export function createOpening(
  type: OpeningType,
  wallId: Id,
  offset: number,
  status: ElementStatus,
  overrides: Partial<Opening> = {},
): Opening {
  const d = OPENING_DEFAULTS[type];
  return {
    id: newId(type),
    kind: 'opening',
    type,
    wallId,
    offset,
    width: d.width,
    height: d.height,
    sill: d.sill,
    status,
    ...(type === 'door' ? { door: { style: 'single', hinge: 'start', swing: 'left' } } : {}),
    ...(type === 'window' ? { window: { style: 'double-hung' } } : {}),
    ...overrides,
  } as Opening;
}

/** Offset so an opening of `width` is centered at the projection of `point` on the wall, clamped inside it. */
export function offsetForPoint(floor: Floor, wallId: Id, point: Vec2, width: number): number {
  const w = floor.walls[wallId];
  const A = floor.nodes[w.a];
  const B = floor.nodes[w.b];
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  const dir = norm({ x: B.x - A.x, y: B.y - A.y });
  const t = dot(sub(point, A), dir);
  return clampOffset(t - width / 2, width, L);
}

export function clampOffset(offset: number, width: number, wallLength: number): number {
  if (width >= wallLength) return 0;
  return Math.max(0, Math.min(wallLength - width, offset));
}

/**
 * After a geometry edit, keeps each opening at the same physical place on its
 * wall (projecting its previous center onto the new wall line), clamped to
 * the wall. Openings on unchanged walls are untouched.
 */
export function reattachOpenings(prev: Floor, next: Floor): Floor {
  let ed: FloorEditor | null = null;
  for (const o of Object.values(next.openings)) {
    const w = next.walls[o.wallId];
    const pw = prev.walls[o.wallId];
    const po = prev.openings[o.id];
    if (!w || !pw || !po || po.wallId !== o.wallId) continue;
    const a0 = prev.nodes[pw.a];
    const b0 = prev.nodes[pw.b];
    const a1 = next.nodes[w.a];
    const b1 = next.nodes[w.b];
    if (!a0 || !b0 || !a1 || !b1) continue;
    if (a0 === a1 && b0 === b1 && pw.a === w.a && pw.b === w.b && po.offset === o.offset && po.width === o.width) continue;
    if (po !== o) continue; // the opening itself was edited explicitly — respect it
    const d0 = norm({ x: b0.x - a0.x, y: b0.y - a0.y });
    const center = { x: a0.x + d0.x * (o.offset + o.width / 2), y: a0.y + d0.y * (o.offset + o.width / 2) };
    const d1 = norm({ x: b1.x - a1.x, y: b1.y - a1.y });
    const L1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
    const t = dot(sub(center, a1), d1);
    const offset = clampOffset(t - o.width / 2, o.width, L1);
    if (Math.abs(offset - o.offset) > 1e-9) {
      ed ??= new FloorEditor(next);
      ed.patchOpening(o.id, { offset });
    }
  }
  return ed ? ed.floor : next;
}

export interface OpeningIssue {
  openingId: Id;
  message: string;
}

export function validateOpenings(floor: Floor): OpeningIssue[] {
  const issues: OpeningIssue[] = [];
  const byWall = new Map<Id, Opening[]>();
  for (const o of Object.values(floor.openings)) {
    if (o.status === 'demolish') continue;
    const list = byWall.get(o.wallId) ?? [];
    list.push(o);
    byWall.set(o.wallId, list);
  }
  for (const [wallId, list] of byWall) {
    const w = floor.walls[wallId];
    if (!w) continue;
    const L = Math.hypot(floor.nodes[w.b].x - floor.nodes[w.a].x, floor.nodes[w.b].y - floor.nodes[w.a].y);
    list.sort((p, q) => p.offset - q.offset);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o.offset + o.width > L + 0.5) issues.push({ openingId: o.id, message: `${label(o)} is wider than its wall` });
      if (o.sill + o.height > w.height + 0.5) issues.push({ openingId: o.id, message: `${label(o)} is taller than its wall` });
      const nxt = list[i + 1];
      if (nxt && o.offset + o.width > nxt.offset + 0.5) issues.push({ openingId: nxt.id, message: `${label(nxt)} overlaps ${label(o).toLowerCase()}` });
    }
  }
  return issues;
}

const label = (o: Opening) => (o.type === 'door' ? 'Door' : o.type === 'window' ? 'Window' : 'Opening');
