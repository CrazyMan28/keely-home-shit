import { shapeOf, type ItemShape } from '../../assets/catalog';
import type { PlanDerived } from '../../geometry/derive';
import { distancesToWalls, itemFootprint } from '../../geometry/items/items';
import { formatAngle, formatArea, formatLength } from '../../geometry/measurement/format';
import type { UnitSettings } from '../../geometry/measurement/units';
import { openingFrame } from '../../geometry/openings/openings';
import { bounds, ensureWinding, pointInPolygon } from '../../geometry/primitives/polygon';
import { add, dist, dot, len, norm, perp, scale, sub, type Vec2 } from '../../geometry/primitives/vec';
import type { SnapResult } from '../../geometry/snapping/snap';
import type { WallFootprint } from '../../geometry/walls/wallGeometry';
import { openingRect, wallSpans } from '../../geometry/walls/wallPieces';
import { isHighlighted, isVisibleInView, type RenovationView } from '../../model/renovation';
import type { ElementStatus, Floor, Id, Item, Opening, Underlay } from '../../model/types';
import type { DimensionTarget } from '../../state/uiStore';
import type { PlanPalette } from './palette';
import { drawSymbol } from './symbols';
import type { Viewport } from './viewport';

export interface LabelHit {
  x: number;
  y: number;
  w: number;
  h: number;
  target: DimensionTarget;
  value: number;
  key: string;
}

export interface RoomLabelHit {
  roomId: Id;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GhostItem {
  item: Pick<Item, 'x' | 'y' | 'width' | 'depth' | 'rotation' | 'catalogId'>;
  valid: boolean;
}

export interface GhostOpening {
  wallId: Id;
  opening: Opening;
}

export interface ToolOverlay {
  chain?: Vec2[];
  cursorPoint?: Vec2;
  segmentLabel?: { a: Vec2; b: Vec2; text: string; angle?: string };
  previewThickness?: number;
  rect?: { a: Vec2; b: Vec2; wText: string; hText: string };
  snap?: SnapResult | null;
  marquee?: { a: Vec2; b: Vec2 };
  measure?: { a: Vec2; b: Vec2; text: string };
  dimension?: { a: Vec2; b: Vec2; offset: number; text: string };
  ghostItem?: GhostItem;
  ghostOpening?: GhostOpening;
  readout?: { at: Vec2; text: string };
}

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  vp: Viewport;
  derived: PlanDerived;
  floor: Floor;
  palette: PlanPalette;
  units: UnitSettings;
  dimensionReference: 'centerline' | 'interior';
  view: RenovationView;
  selection: Set<Id>;
  hover: Id | null;
  hoverLabel: string | null;
  editingLabel: string | null;
  showDimensions: boolean;
  showGrid: boolean;
  showRoomLabels: boolean;
  showFurniture: boolean;
  gridSize: number;
  overlay: ToolOverlay;
  underlay?: { image: CanvasImageSource; underlay: Underlay } | null;
  ghost?: PlanDerived | null;
  time: number;
}

export interface RenderOutput {
  labels: LabelHit[];
  roomLabels: RoomLabelHit[];
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box, pad = 2) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

export function renderPlan(input: RenderInput): RenderOutput {
  const { ctx, vp, palette: P, derived, floor } = input;
  const out: RenderOutput = { labels: [], roomLabels: [] };
  const placed: Box[] = [];
  const S = (p: Vec2) => vp.toScreen(p);

  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, vp.width, vp.height);

  if (input.showGrid) drawGrid(input);
  if (input.underlay?.underlay.visible) drawUnderlay(input);

  // Rooms
  const hoverRoom = input.hover && floor.rooms[input.hover] ? input.hover : null;
  for (const r of derived.rooms) {
    const sel = input.selection.has(r.room.id);
    pathPoly(ctx, r.interiorPolygon.map(S));
    ctx.fillStyle = sel ? P.accentSoft : hoverRoom === r.room.id ? P.roomFillHover : P.roomFill;
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (input.ghost) drawGhost(input, input.ghost);

  // Furniture below walls
  if (input.showFurniture) {
    const items = Object.values(floor.items)
      .filter((it) => !it.hidden && isVisibleInView(it.status, input.view))
      .sort((a, b) => a.elevation + a.height * 0.001 - (b.elevation + b.height * 0.001));
    for (const it of items) drawItem(input, it, input.selection.has(it.id), input.hover === it.id, 1);
  }

  drawWalls(input);
  drawOpenings(input);

  // Annotations
  for (const a of Object.values(floor.annotations)) {
    if (a.hidden) continue;
    const p = S(a);
    ctx.font = `500 ${a.fontSize}px ${P.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const sel = input.selection.has(a.id) || input.hover === a.id;
    if (sel) {
      const w = ctx.measureText(a.text).width + 12;
      roundRect(ctx, p.x - w / 2, p.y - a.fontSize * 0.8, w, a.fontSize * 1.6, 4);
      ctx.fillStyle = P.accentSoft;
      ctx.fill();
    }
    ctx.fillStyle = P.ink;
    ctx.fillText(a.text, p.x, p.y);
  }

  if (input.showDimensions) drawDimensions(input, out, placed);
  if (input.showRoomLabels) drawRoomLabels(input, out, placed);
  drawSelectionDetails(input, out, placed);
  drawOverlay(input, out, placed);
  return out;
}

// ── helpers ───────────────────────────────────────────────────────────────

function pathPoly(ctx: CanvasRenderingContext2D, pts: Vec2[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGrid({ ctx, vp, palette: P, gridSize, units }: RenderInput) {
  const minor = units.system === 'imperial' ? gridSize : 100;
  const majorEvery = units.system === 'imperial' ? 10 * 304.8 : 1000;
  const tl = vp.toWorld({ x: 0, y: 0 });
  const br = vp.toWorld({ x: vp.width, y: vp.height });
  const drawLines = (step: number, color: string) => {
    if (step * vp.scale < 7) return;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      const sx = Math.round(x * vp.scale + vp.panX) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vp.height);
    }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
      const sy = Math.round(y * vp.scale + vp.panY) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(vp.width, sy);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  drawLines(minor, P.grid);
  drawLines(majorEvery, P.gridMajor);
}

function drawUnderlay({ ctx, vp, underlay }: RenderInput) {
  if (!underlay) return;
  const u = underlay.underlay;
  const p = vp.toScreen({ x: u.x, y: u.y });
  ctx.save();
  ctx.globalAlpha = u.opacity;
  ctx.translate(p.x, p.y);
  ctx.rotate((u.rotation * Math.PI) / 180);
  ctx.scale(vp.scale * u.scale, vp.scale * u.scale);
  ctx.drawImage(underlay.image, 0, 0);
  ctx.restore();
}

function drawGhost({ ctx, vp, palette: P }: RenderInput, ghost: PlanDerived) {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = P.inkFaint;
  ctx.lineWidth = 1;
  for (const fp of ghost.geometry.footprints.values()) {
    pathPoly(ctx, fp.polygon.map((p) => vp.toScreen(p)));
    ctx.stroke();
  }
  ctx.restore();
}

function statusColors(P: PlanPalette, status: ElementStatus, view: RenovationView) {
  if (isHighlighted(status, view) || (status === 'new' && view !== 'existing')) {
    if (status === 'new') return { fill: P.wallNewFill, stroke: P.wallNew, dash: false };
    if (status === 'demolish') return { fill: P.wallDemoFill, stroke: P.wallDemo, dash: true };
  }
  return { fill: P.wall, stroke: P.wall, dash: false };
}

function drawWalls(input: RenderInput) {
  const { ctx, vp, floor, derived, palette: P, view } = input;
  const S = (p: Vec2) => vp.toScreen(p);
  const openingsByWall = groupOpenings(floor, view);

  // Pass 1: fills. All pieces of the same colour go into ONE path with a
  // uniform winding and are filled once (nonzero), so mitered joints and
  // junction hubs render as a single seamless shape (no anti-aliasing seams).
  const byFill = new Map<string, Vec2[][]>();
  const hatched: Array<{ fp: WallFootprint; polys: Vec2[][] }> = [];
  const addPoly = (fill: string, poly: Vec2[]) => {
    const list = byFill.get(fill) ?? [];
    list.push(ensureWinding(poly.map(S), true));
    byFill.set(fill, list);
  };
  for (const fp of derived.geometry.footprints.values()) {
    const w = floor.walls[fp.wallId];
    const c = statusColors(P, w.status, view);
    const spans = wallSpans(fp, openingsByWall.get(w.id) ?? []).filter((s) => !s.opening);
    for (const s of spans) addPoly(c.fill, s.polygon);
    if (c.dash) hatched.push({ fp, polys: spans.map((s) => s.polygon) });
  }
  for (const j of derived.geometry.junctions) {
    const walls = Object.values(floor.walls).filter((w) => (w.a === j.nodeId || w.b === j.nodeId) && derived.geometry.footprints.has(w.id));
    const c = statusColors(P, walls.every((w) => w.status === 'demolish') ? 'demolish' : walls.some((w) => w.status === 'existing') ? 'existing' : walls[0]?.status ?? 'existing', view);
    addPoly(c.fill, j.polygon);
  }
  for (const [fill, polys] of byFill) {
    ctx.beginPath();
    for (const poly of polys) {
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.fillStyle = fill;
    ctx.fill('nonzero');
  }
  for (const h of hatched) {
    ctx.save();
    ctx.beginPath();
    for (const poly of h.polys) {
      poly.map(S).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    }
    ctx.clip();
    hatch(ctx, h.fp, vp, P.wallDemo);
    ctx.restore();
  }

  // Pass 2: outlines for status walls, selection and hover.
  for (const fp of derived.geometry.footprints.values()) {
    const w = floor.walls[fp.wallId];
    const c = statusColors(P, w.status, view);
    const sel = input.selection.has(w.id);
    const hov = input.hover === w.id;
    if (c.stroke !== P.wall || sel || hov) {
      ctx.save();
      pathPoly(ctx, fp.polygon.map(S));
      if (c.dash) ctx.setLineDash([6, 4]);
      ctx.strokeStyle = sel ? P.accent : hov ? P.accent : c.stroke;
      ctx.lineWidth = sel ? 2 : hov ? 1.5 : 1.2;
      ctx.globalAlpha = hov && !sel ? 0.7 : 1;
      ctx.stroke();
      ctx.restore();
    }
    if (sel) {
      const sa = S(fp.a);
      const sb = S(fp.b);
      ctx.save();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = P.accent;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
      ctx.restore();
    }
    if (w.locks.length || w.locks.angle || w.locks.position) {
      const m = S({ x: (fp.a.x + fp.b.x) / 2, y: (fp.a.y + fp.b.y) / 2 });
      if (fp.length * vp.scale > 60) drawLockGlyph(ctx, m.x, m.y, P);
    }
  }
}

function hatch(ctx: CanvasRenderingContext2D, fp: WallFootprint, vp: Viewport, color: string) {
  const pts = fp.polygon.map((p) => vp.toScreen(p));
  const b = bounds(pts);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = 7;
  for (let x = b.minX - (b.maxY - b.minY); x < b.maxX; x += step) {
    ctx.moveTo(x, b.maxY);
    ctx.lineTo(x + (b.maxY - b.minY), b.minY);
  }
  ctx.stroke();
}

function drawLockGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, P: PlanPalette) {
  ctx.save();
  ctx.fillStyle = P.bg;
  ctx.strokeStyle = P.inkMuted;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.rect(x - 3, y - 1, 6, 4.5);
  ctx.moveTo(x - 2, y - 1);
  ctx.arc(x, y - 1.5, 2, Math.PI, 0);
  ctx.stroke();
  ctx.restore();
}

function groupOpenings(floor: Floor, view: RenovationView): Map<Id, Opening[]> {
  const map = new Map<Id, Opening[]>();
  for (const o of Object.values(floor.openings)) {
    if (o.hidden || !isVisibleInView(o.status, view)) continue;
    const list = map.get(o.wallId) ?? [];
    list.push(o);
    map.set(o.wallId, list);
  }
  return map;
}

function drawOpenings(input: RenderInput) {
  const { floor, derived, view } = input;
  for (const o of Object.values(floor.openings)) {
    if (o.hidden || !isVisibleInView(o.status, view)) continue;
    const fp = derived.geometry.footprints.get(o.wallId);
    if (!fp) continue;
    drawOpening(input, fp, o, input.selection.has(o.id), input.hover === o.id, 1);
  }
  const g = input.overlay.ghostOpening;
  if (g) {
    const fp = derived.geometry.footprints.get(g.wallId);
    if (fp) drawOpening(input, fp, g.opening, false, false, 0.8, true);
  }
}

function drawOpening(input: RenderInput, fp: WallFootprint, o: Opening, sel: boolean, hov: boolean, alpha: number, ghost = false) {
  const { ctx, vp, palette: P, floor, view } = input;
  const w = floor.walls[o.wallId];
  const S = (p: Vec2) => vp.toScreen(p);
  const rect = openingRect(fp, o, w.thickness);
  const c = statusColors(P, o.status, view);
  const color = sel || hov || ghost ? P.accent : c.stroke === P.wall ? P.ink : c.stroke;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (ghost) {
    pathPoly(ctx, rect.map(S));
    ctx.fillStyle = P.accentSoft;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = sel ? 2 : 1.25;
  if (c.dash) ctx.setLineDash([5, 4]);
  // Jambs
  const [s1, e1, e2, s2] = rect.map(S);
  ctx.beginPath();
  ctx.moveTo(s1.x, s1.y);
  ctx.lineTo(s2.x, s2.y);
  ctx.moveTo(e1.x, e1.y);
  ctx.lineTo(e2.x, e2.y);
  ctx.stroke();

  const h = w.thickness / 2;
  const start = add(fp.a, scale(fp.dir, o.offset));
  const end = add(fp.a, scale(fp.dir, o.offset + o.width));
  if (o.type === 'window') {
    ctx.beginPath();
    for (const k of [-h, h, -h * 0.25, h * 0.25]) {
      const a = S(add(start, scale(fp.normal, k)));
      const b = S(add(end, scale(fp.normal, k)));
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.strokeStyle = P.glass;
    ctx.beginPath();
    const ga = S(start);
    const gb = S(end);
    ctx.moveTo(ga.x, ga.y);
    ctx.lineTo(gb.x, gb.y);
    ctx.stroke();
  } else if (o.type === 'door' && o.door) {
    const side = o.door.swing === 'left' ? 1 : -1;
    const n = scale(fp.normal, side);
    const face = h;
    const leaves: Array<{ hinge: Vec2; closed: Vec2; r: number }> = [];
    const hingeStart = add(start, scale(n, face));
    const hingeEnd = add(end, scale(n, face));
    if (o.door.style === 'double') {
      leaves.push({ hinge: hingeStart, closed: fp.dir, r: o.width / 2 }, { hinge: hingeEnd, closed: scale(fp.dir, -1), r: o.width / 2 });
    } else if (o.door.style === 'single' || o.door.style === 'bifold') {
      leaves.push(o.door.hinge === 'start' ? { hinge: hingeStart, closed: fp.dir, r: o.width } : { hinge: hingeEnd, closed: scale(fp.dir, -1), r: o.width });
    }
    for (const leaf of leaves) {
      const open = add(leaf.hinge, scale(n, leaf.r));
      const hs = S(leaf.hinge);
      const os = S(open);
      ctx.lineWidth = sel ? 2.2 : 1.6;
      ctx.beginPath();
      ctx.moveTo(hs.x, hs.y);
      ctx.lineTo(os.x, os.y);
      ctx.stroke();
      // Swing arc
      const a0 = Math.atan2(leaf.closed.y, leaf.closed.x);
      const a1 = Math.atan2(n.y, n.x);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha *= 0.8;
      ctx.beginPath();
      ctx.arc(hs.x, hs.y, leaf.r * vp.scale, a0, a0 + d, d < 0);
      ctx.stroke();
      ctx.restore();
    }
    if (o.door.style === 'sliding' || o.door.style === 'pocket') {
      ctx.lineWidth = 2;
      const q = h * 0.3;
      const mid = o.offset + o.width / 2;
      const segs: Array<[number, number, number]> =
        o.door.style === 'sliding'
          ? [
              [o.offset, mid + o.width * 0.05, q],
              [mid - o.width * 0.05, o.offset + o.width, -q],
            ]
          : [[o.offset, o.offset + o.width * 0.9, 0]];
      ctx.beginPath();
      for (const [t0, t1, k] of segs) {
        const a = S(add(add(fp.a, scale(fp.dir, t0)), scale(fp.normal, k)));
        const b = S(add(add(fp.a, scale(fp.dir, t1)), scale(fp.normal, k)));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
  } else {
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(e1.x, e1.y);
    ctx.moveTo(s2.x, s2.y);
    ctx.lineTo(e2.x, e2.y);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawItem(input: RenderInput, it: Pick<Item, 'x' | 'y' | 'width' | 'depth' | 'rotation' | 'catalogId'> & Partial<Item>, sel: boolean, hov: boolean, alpha: number, invalid = false) {
  const { ctx, vp, palette: P, view } = input;
  const c = vp.toScreen(it);
  const shape: ItemShape = shapeOf(it.catalogId);
  const status = it.status ?? 'new';
  const sc = statusColors(P, status, view);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(c.x, c.y);
  ctx.rotate((it.rotation * Math.PI) / 180);
  ctx.lineWidth = sel ? 1.8 : 1.1;
  if (sc.dash) ctx.setLineDash([4, 3]);
  const stroke = invalid ? P.danger : sel || hov ? P.accent : sc.stroke !== P.wall ? sc.stroke : P.furnitureStroke;
  const fill = sel ? P.accentSoft : P.furniture;
  const isWallCab = shape === 'wallCabinet';
  if (isWallCab) ctx.globalAlpha *= 0.85;
  drawSymbol(ctx, shape, it.width * vp.scale, it.depth * vp.scale, fill, stroke);
  ctx.restore();
}

// ── dimensions ────────────────────────────────────────────────────────────

interface DimSpec {
  a: Vec2; // screen
  b: Vec2; // screen
  /** Screen-space normal pointing toward where the dimension line sits. */
  n: Vec2;
  offset: number;
  text: string;
  target?: DimensionTarget;
  value: number;
  key: string;
  emphasis?: 'accent' | 'muted';
  extension?: boolean;
}

function drawDimension(input: RenderInput, spec: DimSpec, out: RenderOutput, placed: Box[]): boolean {
  const { ctx, palette: P } = input;
  const L = dist(spec.a, spec.b);
  if (L < 28) return false;
  const dir = norm(sub(spec.b, spec.a));
  ctx.font = `600 11px ${P.font}`;
  const tw = ctx.measureText(spec.text).width + 12;
  const th = 18;
  let angle = Math.atan2(dir.y, dir.x);
  if (angle > Math.PI / 2 || angle <= -Math.PI / 2) angle += Math.PI;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const bw = tw * cos + th * sin;
  const bh = tw * sin + th * cos;

  let off = spec.offset;
  let box: Box | null = null;
  let mid: Vec2 = { x: 0, y: 0 };
  for (let attempt = 0; attempt < 4; attempt++) {
    const o = scale(spec.n, off);
    mid = add(scale(add(spec.a, spec.b), 0.5), o);
    const cand = { x: mid.x - bw / 2, y: mid.y - bh / 2, w: bw, h: bh };
    if (!placed.some((p) => overlaps(p, cand))) {
      box = cand;
      break;
    }
    off += Math.sign(spec.offset || 1) * 18;
  }
  const o = scale(spec.n, off);
  const a2 = add(spec.a, o);
  const b2 = add(spec.b, o);
  const hovered = input.hoverLabel === spec.key;
  const accent = spec.emphasis === 'accent' || hovered;
  const lineColor = accent ? P.accent : spec.emphasis === 'muted' ? P.inkFaint : P.dim;

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (spec.extension !== false) {
    const ext = scale(spec.n, Math.sign(off) * 4);
    ctx.moveTo(spec.a.x + spec.n.x * Math.sign(off) * 3, spec.a.y + spec.n.y * Math.sign(off) * 3);
    ctx.lineTo(a2.x + ext.x, a2.y + ext.y);
    ctx.moveTo(spec.b.x + spec.n.x * Math.sign(off) * 3, spec.b.y + spec.n.y * Math.sign(off) * 3);
    ctx.lineTo(b2.x + ext.x, b2.y + ext.y);
  }
  ctx.moveTo(a2.x, a2.y);
  ctx.lineTo(b2.x, b2.y);
  ctx.stroke();
  // Architectural ticks
  const t = scale(norm(add(dir, perp(dir))), 4);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const p of [a2, b2]) {
    ctx.moveTo(p.x - t.x, p.y - t.y);
    ctx.lineTo(p.x + t.x, p.y + t.y);
  }
  ctx.stroke();

  if (box && spec.key !== input.editingLabel) {
    placed.push(box);
    ctx.translate(mid.x, mid.y);
    ctx.rotate(angle);
    roundRect(ctx, -tw / 2, -th / 2, tw, th, 5);
    ctx.fillStyle = accent ? P.accent : P.labelBg;
    ctx.fill();
    if (spec.target && !accent) {
      ctx.strokeStyle = P.inkFaint;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
    ctx.fillStyle = accent ? P.accentInk : spec.emphasis === 'muted' ? P.inkMuted : P.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.text, 0, 0.5);
    if (spec.target) out.labels.push({ ...box, target: spec.target, value: spec.value, key: spec.key });
  }
  ctx.restore();
  return !!box;
}

function drawDimensions(input: RenderInput, out: RenderOutput, placed: Box[]) {
  const { vp, derived, floor, units } = input;
  const S = (p: Vec2) => vp.toScreen(p);
  const fmt = (mm: number) => formatLength(mm, units);
  const covered = new Set<Id>();

  if (input.dimensionReference === 'interior') {
    for (const r of derived.rooms) {
      const poly = r.interiorPolygon;
      const n = poly.length;
      // Merge consecutive collinear edges (a wall split by a T-junction on the far side).
      let i = 0;
      const start = findCornerStart(poly);
      const visited = new Set<number>();
      while (visited.size < n) {
        const i0 = (start + i) % n;
        let j = i0;
        const pieces: number[] = [];
        do {
          pieces.push(j);
          visited.add(j);
          j = (j + 1) % n;
        } while (!visited.has(j) && collinear(poly[(j + n - 1) % n], poly[j], poly[(j + 1) % n]));
        i += pieces.length;
        const a = poly[pieces[0]];
        const b = poly[(pieces[pieces.length - 1] + 1) % n];
        const total = dist(a, b);
        // Target the longest piece's wall; the rest is a fixed extra length.
        let best = pieces[0];
        for (const k of pieces) if (dist(poly[k], poly[(k + 1) % n]) > dist(poly[best], poly[(best + 1) % n])) best = k;
        const wallId = r.wallIds[best];
        const wall = floor.walls[wallId];
        if (!wall) continue;
        pieces.forEach((k) => covered.add(r.wallIds[k]));
        const side: 'left' | 'right' = wall.a === r.nodeIds[best] ? 'left' : 'right';
        const pieceLen = dist(poly[best], poly[(best + 1) % n]);
        const sa = S(a);
        const sb = S(b);
        const inward = perp(norm(sub(sb, sa)));
        drawDimension(
          input,
          {
            a: sa,
            b: sb,
            n: inward,
            offset: 16,
            text: fmt(total),
            value: total,
            key: `room-${r.room.id}-${pieces[0]}`,
            target: { kind: 'wallLength', wallId, reference: 'face', side, extra: total - pieceLen },
            emphasis: input.selection.has(wallId) ? 'accent' : undefined,
            extension: false,
          },
          out,
          placed,
        );
      }
    }
  }

  for (const fp of derived.geometry.footprints.values()) {
    const w = floor.walls[fp.wallId];
    if (covered.has(w.id)) continue;
    if (fp.length * vp.scale < 30) continue;
    // Put the dimension on the side away from rooms (outside the house).
    const h = w.thickness / 2;
    const mid = scale(add(fp.a, fp.b), 0.5);
    const probeLeft = add(mid, scale(fp.normal, h + 50));
    const inRoomLeft = derived.rooms.some((r) => pointInPolygon(probeLeft, r.interiorPolygon));
    const side = inRoomLeft ? -1 : 1;
    const n = perp(norm(sub(S(fp.b), S(fp.a))));
    const screenN = dot(n, sub(S(add(mid, scale(fp.normal, side))), S(mid))) > 0 ? n : scale(n, -1);
    const sel = input.selection.has(w.id);
    drawDimension(
      input,
      {
        a: S(fp.a),
        b: S(fp.b),
        n: screenN,
        offset: h * vp.scale + 16,
        text: fmt(fp.length),
        value: fp.length,
        key: `wall-${w.id}`,
        target: { kind: 'wallLength', wallId: w.id, reference: 'centerline' },
        emphasis: sel ? 'accent' : undefined,
      },
      out,
      placed,
    );
  }

  // Overall dimensions (outside the bounding box of all walls).
  const pts: Vec2[] = [];
  for (const fp of derived.geometry.footprints.values()) pts.push(...fp.polygon);
  if (derived.geometry.footprints.size >= 3 && pts.length) {
    const b = bounds(pts);
    const tl = S({ x: b.minX, y: b.minY });
    const tr = S({ x: b.maxX, y: b.minY });
    const bl = S({ x: b.minX, y: b.maxY });
    drawDimension(input, { a: tl, b: tr, n: { x: 0, y: -1 }, offset: 58, text: fmt(b.maxX - b.minX), value: b.maxX - b.minX, key: 'overall-w', emphasis: 'muted' }, out, placed);
    drawDimension(input, { a: tl, b: bl, n: { x: -1, y: 0 }, offset: 58, text: fmt(b.maxY - b.minY), value: b.maxY - b.minY, key: 'overall-h', emphasis: 'muted' }, out, placed);
  }

  // Manual dimension lines
  for (const d of Object.values(floor.dimensions)) {
    if (d.hidden) continue;
    const sa = S(d.a);
    const sb = S(d.b);
    const n = perp(norm(sub(sb, sa)));
    drawDimension(input, { a: sa, b: sb, n, offset: d.offset * vp.scale, text: fmt(dist(d.a, d.b)), value: dist(d.a, d.b), key: `dim-${d.id}`, emphasis: input.selection.has(d.id) ? 'accent' : undefined }, out, placed);
  }
}

function findCornerStart(poly: Vec2[]): number {
  const n = poly.length;
  for (let i = 0; i < n; i++) if (!collinear(poly[(i + n - 1) % n], poly[i], poly[(i + 1) % n])) return i;
  return 0;
}

function collinear(a: Vec2, b: Vec2, c: Vec2): boolean {
  const ab = norm(sub(b, a));
  const bc = norm(sub(c, b));
  return Math.abs(ab.x * bc.y - ab.y * bc.x) < 1e-4 && dot(ab, bc) > 0;
}

function drawRoomLabels(input: RenderInput, out: RenderOutput, placed: Box[]) {
  const { ctx, vp, derived, palette: P, units } = input;
  for (const r of derived.rooms) {
    if (r.room.hidden) continue;
    const p = vp.toScreen(add(r.labelPoint, r.room.labelOffset));
    const b = bounds(r.interiorPolygon.map((q) => vp.toScreen(q)));
    if (b.maxX - b.minX < 50 || b.maxY - b.minY < 30) continue;
    const sel = input.selection.has(r.room.id);
    const area = formatArea(r.area, units);
    ctx.font = `600 13px ${P.font}`;
    const w1 = ctx.measureText(r.room.name).width;
    ctx.font = `500 11px ${P.font}`;
    const w2 = ctx.measureText(area).width;
    const w = Math.max(w1, w2) + 16;
    const h = 38;
    const box = { x: p.x - w / 2, y: p.y - h / 2, w, h };
    if (sel || input.hover === r.room.id) {
      roundRect(ctx, box.x, box.y, box.w, box.h, 6);
      ctx.fillStyle = sel ? P.accentSoft : P.roomFillHover;
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = sel ? P.accent : P.ink;
    ctx.font = `600 13px ${P.font}`;
    ctx.fillText(r.room.name, p.x, p.y - 7);
    ctx.fillStyle = P.inkMuted;
    ctx.font = `500 11px ${P.font}`;
    ctx.fillText(area, p.x, p.y + 9);
    placed.push(box);
    out.roomLabels.push({ roomId: r.room.id, ...box });
  }
}

function drawSelectionDetails(input: RenderInput, out: RenderOutput, placed: Box[]) {
  const { ctx, vp, floor, derived, palette: P, units, selection } = input;
  const S = (p: Vec2) => vp.toScreen(p);
  const fmt = (mm: number) => formatLength(mm, units);
  if (selection.size === 0) return;

  for (const id of selection) {
    // Wall handles + angle
    const w = floor.walls[id];
    if (w) {
      const fp = derived.geometry.footprints.get(id);
      if (!fp) continue;
      for (const p of [fp.a, fp.b]) handle(ctx, S(p), P, 'circle');
      const orthogonal = Math.abs(fp.dir.x) < 1e-9 || Math.abs(fp.dir.y) < 1e-9;
      if (selection.size === 1 && !orthogonal && fp.length * vp.scale > 90) {
        const deg = (Math.atan2(fp.dir.y, fp.dir.x) * 180) / Math.PI;
        const at = S(add(fp.a, scale(fp.dir, Math.min(fp.length * 0.2, vp.px(46)))));
        const angText = formatAngle(-deg, 1);
        ctx.font = `500 10px ${P.font}`;
        ctx.fillStyle = P.inkMuted;
        ctx.textAlign = 'center';
        ctx.fillText(angText, at.x + fp.normal.x * -18, at.y + fp.normal.y * -18);
      }
      continue;
    }
    // Opening: chain dimensions along the wall
    const o = floor.openings[id];
    if (o) {
      const fp = derived.geometry.footprints.get(o.wallId);
      const f = openingFrame(floor, o);
      if (!fp || !f) continue;
      const wall = floor.walls[o.wallId];
      const h = wall.thickness / 2;
      const interior = input.dimensionReference === 'interior';
      // Measure from the face corners (interior) or wall nodes (centerline).
      const face = faceSide(fp);
      const fs = face === 'left' ? fp.leftStart : fp.rightStart;
      const fe = face === 'left' ? fp.leftEnd : fp.rightEnd;
      const t0 = interior ? dot(sub(fs, fp.a), fp.dir) : 0;
      const t1 = interior ? dot(sub(fe, fp.a), fp.dir) : fp.length;
      const sign = face === 'left' ? 1 : -1;
      const lineAt = (t: number) => S(add(add(fp.a, scale(fp.dir, t)), scale(fp.normal, sign * h)));
      const n0 = sub(S(add(fp.a, scale(fp.normal, sign))), S(fp.a));
      const n = norm(n0);
      const chain: Array<[number, number, DimensionTarget | undefined, string]> = [
        [t0, o.offset, { kind: 'openingOffset', openingId: o.id, from: 'start' }, 'start'],
        [o.offset, o.offset + o.width, { kind: 'openingWidth', openingId: o.id }, 'width'],
        [o.offset + o.width, t1, { kind: 'openingOffset', openingId: o.id, from: 'end' }, 'end'],
      ];
      for (const [ta, tb, target, k] of chain) {
        if (tb - ta < 1) continue;
        drawDimension(input, { a: lineAt(ta), b: lineAt(tb), n, offset: 26, text: fmt(tb - ta), value: tb - ta, key: `op-${o.id}-${k}`, target, emphasis: k === 'width' ? 'accent' : undefined }, out, placed);
      }
      handle(ctx, S(f.start), P, 'square');
      handle(ctx, S(f.end), P, 'square');
      continue;
    }
    // Item: distances to walls + handles
    const it = floor.items[id];
    if (it) {
      const dists = distancesToWalls(it, derived.geometry, 8000);
      for (const d of dists) {
        const a = S(d.from);
        const b = S(d.to);
        if (dist(a, b) < 4) continue;
        ctx.save();
        ctx.strokeStyle = P.accent;
        ctx.setLineDash([3, 3]);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
        const n = perp(norm(sub(b, a)));
        drawDimension(input, { a, b, n, offset: 0, text: fmt(d.distance), value: d.distance, key: `itd-${it.id}-${d.side}`, target: { kind: 'itemDistance', itemId: it.id, side: d.side }, extension: false }, out, placed);
      }
      if (selection.size === 1 && !it.locked) {
        const fpPts = itemFootprint(it).map(S);
        for (const p of fpPts) handle(ctx, p, P, 'square');
        const back = S(add({ x: it.x, y: it.y }, scale(perp(dirOf(it.rotation)), -(it.depth / 2 + vp.px(26)))));
        const backEdge = S(add({ x: it.x, y: it.y }, scale(perp(dirOf(it.rotation)), -it.depth / 2)));
        ctx.save();
        ctx.strokeStyle = P.accent;
        ctx.beginPath();
        ctx.moveTo(backEdge.x, backEdge.y);
        ctx.lineTo(back.x, back.y);
        ctx.stroke();
        ctx.restore();
        handle(ctx, back, P, 'rotate');
      }
    }
  }
  void placed;
}

export const dirOf = (deg: number): Vec2 => {
  const r = (deg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
};

/** Which face of a wall to measure from: the shorter (interior) face. */
export function faceSide(fp: WallFootprint): 'left' | 'right' {
  const l = Math.abs(dot(sub(fp.leftEnd, fp.leftStart), fp.dir));
  const r = Math.abs(dot(sub(fp.rightEnd, fp.rightStart), fp.dir));
  return l <= r ? 'left' : 'right';
}

function handle(ctx: CanvasRenderingContext2D, p: Vec2, P: PlanPalette, kind: 'circle' | 'square' | 'rotate') {
  ctx.save();
  ctx.fillStyle = P.bg;
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  if (kind === 'square') ctx.rect(p.x - 4, p.y - 4, 8, 8);
  else ctx.arc(p.x, p.y, kind === 'rotate' ? 6 : 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (kind === 'rotate') {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0.3, Math.PI * 1.6);
    ctx.stroke();
  }
  ctx.restore();
}

// ── tool overlay ─────────────────────────────────────────────────────────

function drawOverlay(input: RenderInput, out: RenderOutput, placed: Box[]) {
  const { ctx, vp, palette: P, overlay: O } = input;
  const S = (p: Vec2) => vp.toScreen(p);

  if (O.chain && O.chain.length) {
    const pts = [...O.chain, ...(O.cursorPoint ? [O.cursorPoint] : [])];
    const th = (O.previewThickness ?? 114) * vp.scale;
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = P.accentSoft;
    ctx.lineWidth = Math.max(th, 2);
    ctx.beginPath();
    pts.map(S).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (const p of O.chain) handle(ctx, S(p), P, 'circle');
    ctx.restore();
  }

  if (O.rect) {
    const a = O.rect.a;
    const b = O.rect.b;
    const pts = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map(S);
    ctx.save();
    pathPoly(ctx, pts);
    ctx.fillStyle = P.accentSoft;
    ctx.fill();
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = Math.max((O.previewThickness ?? 114) * vp.scale, 1.5);
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.restore();
    const top = a.y < b.y ? a.y : b.y;
    const left = a.x < b.x ? a.x : b.x;
    drawDimension(input, { a: S({ x: Math.min(a.x, b.x), y: top }), b: S({ x: Math.max(a.x, b.x), y: top }), n: { x: 0, y: -1 }, offset: 22, text: O.rect.wText, value: 0, key: 'rect-w', emphasis: 'accent' }, out, placed);
    drawDimension(input, { a: S({ x: left, y: Math.min(a.y, b.y) }), b: S({ x: left, y: Math.max(a.y, b.y) }), n: { x: -1, y: 0 }, offset: 22, text: O.rect.hText, value: 0, key: 'rect-h', emphasis: 'accent' }, out, placed);
  }

  if (O.segmentLabel) {
    const a = S(O.segmentLabel.a);
    const b = S(O.segmentLabel.b);
    const n = perp(norm(sub(b, a)));
    drawDimension(input, { a, b, n: len(n) ? n : { x: 0, y: -1 }, offset: -(((O.previewThickness ?? 114) * vp.scale) / 2 + 18), text: O.segmentLabel.text, value: 0, key: 'seg', emphasis: 'accent' }, out, placed);
    if (O.segmentLabel.angle) {
      ctx.font = `500 10px ${P.font}`;
      ctx.fillStyle = P.inkMuted;
      ctx.textAlign = 'left';
      ctx.fillText(O.segmentLabel.angle, b.x + 14, b.y + 22);
    }
  }

  if (O.ghostItem) drawItem(input, { ...O.ghostItem.item, status: 'new' } as Item, false, true, 0.75, !O.ghostItem.valid);

  if (O.measure) {
    const a = S(O.measure.a);
    const b = S(O.measure.b);
    ctx.save();
    ctx.strokeStyle = P.snap;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    for (const p of [a, b]) {
      ctx.fillStyle = P.snap;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const n = perp(norm(sub(b, a)));
    drawDimension(input, { a, b, n: len(n) ? n : { x: 0, y: -1 }, offset: 16, text: O.measure.text, value: 0, key: 'measure', emphasis: 'accent', extension: false }, out, placed);
  }

  if (O.dimension) {
    const a = S(O.dimension.a);
    const b = S(O.dimension.b);
    const n = perp(norm(sub(b, a)));
    drawDimension(input, { a, b, n: len(n) ? n : { x: 0, y: -1 }, offset: O.dimension.offset * vp.scale, text: O.dimension.text, value: 0, key: 'dimtool', emphasis: 'accent' }, out, placed);
  }

  if (O.marquee) {
    const a = S(O.marquee.a);
    const b = S(O.marquee.b);
    ctx.save();
    ctx.fillStyle = P.accentSoft;
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  }

  if (O.snap) drawSnap(input, O.snap);

  if (O.readout) {
    const p = S(O.readout.at);
    ctx.font = `600 12px ${P.font}`;
    const w = ctx.measureText(O.readout.text).width + 16;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 8;
    roundRect(ctx, p.x + 14, p.y + 14, w, 24, 7);
    ctx.fillStyle = P.accent;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = P.accentInk;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(O.readout.text, p.x + 22, p.y + 26.5);
  }
}

const SNAP_LABEL: Record<string, string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  intersection: 'Intersection',
  opening: 'Opening edge',
  wallCenter: 'On wall',
  wallFace: 'Wall face',
  angle: '',
  alignment: 'Aligned',
  grid: '',
};

function drawSnap(input: RenderInput, snap: SnapResult) {
  const { ctx, vp, palette: P } = input;
  ctx.save();
  for (const g of snap.guides) {
    const a = vp.toScreen(g.a);
    const b = vp.toScreen(g.b);
    ctx.strokeStyle = P.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash(g.kind === 'angle' ? [8, 5] : [2, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const p = vp.toScreen(snap.point);
  ctx.strokeStyle = P.snap;
  ctx.fillStyle = P.snap;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  switch (snap.kind) {
    case 'endpoint':
      ctx.rect(p.x - 5.5, p.y - 5.5, 11, 11);
      break;
    case 'midpoint':
      ctx.moveTo(p.x, p.y - 6.5);
      ctx.lineTo(p.x + 6, p.y + 4.5);
      ctx.lineTo(p.x - 6, p.y + 4.5);
      ctx.closePath();
      break;
    case 'intersection':
      ctx.moveTo(p.x - 5, p.y - 5);
      ctx.lineTo(p.x + 5, p.y + 5);
      ctx.moveTo(p.x + 5, p.y - 5);
      ctx.lineTo(p.x - 5, p.y + 5);
      break;
    case 'grid':
      ctx.moveTo(p.x - 4, p.y);
      ctx.lineTo(p.x + 4, p.y);
      ctx.moveTo(p.x, p.y - 4);
      ctx.lineTo(p.x, p.y + 4);
      break;
    case 'none':
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
  }
  ctx.stroke();
  const label = SNAP_LABEL[snap.kind];
  if (label) {
    ctx.font = `600 10px ${P.font}`;
    ctx.fillStyle = P.snap;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x + 10, p.y - 12);
  }
  ctx.restore();
}
