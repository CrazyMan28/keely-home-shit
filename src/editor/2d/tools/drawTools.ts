import { CATALOG_BY_ID } from '../../../assets/catalog';
import { snapItemToWall } from '../../../geometry/items/items';
import { formatAngle, formatLength } from '../../../geometry/measurement/format';
import { parseLength } from '../../../geometry/measurement/parse';
import { createOpening, offsetForPoint, OPENING_DEFAULTS } from '../../../geometry/openings/openings';
import { signedDistance } from '../../../geometry/primitives/segment';
import { add, angleOf, dist, norm, radToDeg, scale, sub, type Vec2 } from '../../../geometry/primitives/vec';
import type { OpeningType } from '../../../model/types';
import { addAnnotation, addDimensionLine, addItem, addOpening, addWalls, newElementStatus, wallDefaults } from '../../../state/actions';
import { getActiveFloor } from '../../../state/documentStore';
import { select, setTool, setUi, toast, ui } from '../../../state/uiStore';
import type { Tool2D, ToolEvent, ToolHost } from './types';

const fmtDeg = (a: Vec2, b: Vec2) => formatAngle(-radToDeg(angleOf(sub(b, a))), 1);

/** Click-click polyline wall drawing with snapping and typed lengths. */
export class WallTool implements Tool2D {
  readonly id = 'wall';
  cursor = 'crosshair';
  private points: Vec2[] = [];
  private cursorPt: Vec2 | null = null;
  private lastDownAt = 0;
  private lastDownScreen: Vec2 | null = null;
  private host: ToolHost;
  constructor(host: ToolHost) {
    this.host = host;
  }

  activate(): void {
    this.host.setHint('Click to start a wall · Enter or double-click to finish · type a length for an exact wall');
  }
  deactivate(): void {
    this.cancel();
  }

  private snap(e: ToolEvent) {
    const from = this.points[this.points.length - 1];
    const s = this.host.snap(e, { from, lengthStep: true });
    if (e.shift && from) {
      // Constrain to the dominant axis.
      const d = sub(s.point, from);
      s.point = Math.abs(d.x) > Math.abs(d.y) ? { x: s.point.x, y: from.y } : { x: from.x, y: s.point.y };
      s.kind = 'angle';
    }
    return s;
  }

  pointerDown(e: ToolEvent): void {
    if (e.button !== 0) return;
    // Swallow only the second click of a double-click (same spot, quick).
    const now = performance.now();
    const isDouble = now - this.lastDownAt < 320 && this.lastDownScreen && dist(this.lastDownScreen, e.screen) < 6;
    this.lastDownAt = now;
    this.lastDownScreen = e.screen;
    if (isDouble) return;
    const s = this.snap(e);
    const p = s.point;
    if (this.points.length >= 3 && dist(p, this.points[0]) < this.host.vp.px(10)) {
      this.finish(true);
      return;
    }
    const last = this.points[this.points.length - 1];
    if (last && dist(last, p) < 1) return;
    this.points.push(p);
    this.update(e);
  }

  pointerMove(e: ToolEvent): void {
    this.update(e);
  }

  pointerUp(): void {}

  doubleClick(): void {
    this.finish(false);
  }

  private update(e: ToolEvent): void {
    const s = this.snap(e);
    this.cursorPt = s.point;
    const last = this.points[this.points.length - 1];
    const units = this.host.units();
    const th = wallDefaults().thickness;
    this.host.setOverlay({
      chain: this.points,
      cursorPoint: last ? s.point : undefined,
      previewThickness: th,
      snap: s,
      segmentLabel: last && dist(last, s.point) > 1 ? { a: last, b: s.point, text: formatLength(dist(last, s.point), units), angle: fmtDeg(last, s.point) } : undefined,
    });
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') {
      this.finish(false);
      return true;
    }
    if (e.key === 'Backspace' && this.points.length) {
      this.points.pop();
      this.host.setOverlay({ chain: this.points });
      return true;
    }
    if (/^[0-9.]$/.test(e.key) && this.points.length && this.cursorPt) {
      const last = this.points[this.points.length - 1];
      const client = this.host.vp.toScreen(this.cursorPt);
      this.host.openValueInput({ kind: 'drawLength' }, { x: client.x, y: client.y }, dist(last, this.cursorPt), e.key);
      return true;
    }
    return false;
  }

  submitValue(mm: number): void {
    const last = this.points[this.points.length - 1];
    if (!last || !this.cursorPt) return;
    const dir = norm(sub(this.cursorPt, last));
    if (!dir.x && !dir.y) return;
    const p = add(last, scale(dir, mm));
    this.points.push({ x: p.x, y: p.y });
    this.cursorPt = p;
    this.host.setOverlay({ chain: this.points });
  }

  private finish(closed: boolean): void {
    if (this.points.length >= 2) {
      const ids = addWalls(this.points, closed);
      if (ids.length) select(ids);
    }
    this.points = [];
    this.host.setOverlay({});
  }

  cancel(): boolean {
    if (this.points.length) {
      this.points = [];
      this.host.setOverlay({});
      return true;
    }
    return false;
  }
}

/** Rectangle room: drag or click-click; type "12' x 10'" for exact size. */
export class RoomTool implements Tool2D {
  readonly id = 'room';
  cursor = 'crosshair';
  private start: Vec2 | null = null;
  private end: Vec2 | null = null;
  private host: ToolHost;
  constructor(host: ToolHost) {
    this.host = host;
  }
  activate(): void {
    this.host.setHint('Drag a rectangle for a room · type a size like 12\' x 10\' for exact dimensions');
  }
  deactivate(): void {
    this.cancel();
  }
  pointerDown(e: ToolEvent): void {
    if (e.button !== 0) return;
    const p = this.host.snap(e).point;
    if (!this.start) this.start = p;
    else {
      this.end = p;
      this.commit();
    }
  }
  pointerMove(e: ToolEvent): void {
    const s = this.host.snap(e);
    if (!this.start) {
      this.host.setOverlay({ snap: s });
      return;
    }
    this.end = s.point;
    this.preview(s);
  }
  pointerUp(e: ToolEvent): void {
    if (this.start && this.end && dist(this.start, this.end) > this.host.vp.px(12)) {
      this.end = this.host.snap(e).point;
      this.commit();
    }
  }
  private preview(s?: ReturnType<ToolHost['snap']>) {
    if (!this.start || !this.end) return;
    const u = this.host.units();
    this.host.setOverlay({
      rect: { a: this.start, b: this.end, wText: formatLength(Math.abs(this.end.x - this.start.x), u), hText: formatLength(Math.abs(this.end.y - this.start.y), u) },
      previewThickness: wallDefaults().thickness,
      snap: s,
    });
  }
  keyDown(e: KeyboardEvent): boolean {
    if (/^[0-9.]$/.test(e.key)) {
      const c = this.start ? this.host.vp.toScreen(this.start) : { x: this.host.vp.width / 2, y: this.host.vp.height / 2 };
      this.host.openValueInput({ kind: 'drawLength' }, c, 0, e.key);
      return true;
    }
    return false;
  }
  /** Accepts "W x H" text (both parts parsed with the length parser). */
  submitValue(_mm: number, text: string): void {
    const parts = text.split(/\s*[x×*]\s*|\s*,\s*|\s+by\s+/i);
    const units = this.host.units();
    const w = parseLength(parts[0] ?? '', { system: units.system, metricUnit: units.metricUnit });
    const h = parseLength(parts[1] ?? parts[0] ?? '', { system: units.system, metricUnit: units.metricUnit });
    if (!w.ok || !h.ok) {
      toast('Type a size like 12\' x 10\'', 'warning');
      return;
    }
    const origin = this.start ?? this.host.vp.toWorld({ x: this.host.vp.width / 2, y: this.host.vp.height / 2 });
    const sx = this.end && this.end.x < origin.x ? -1 : 1;
    const sy = this.end && this.end.y < origin.y ? -1 : 1;
    this.start = origin;
    this.end = { x: origin.x + sx * w.mm, y: origin.y + sy * h.mm };
    this.commit();
  }
  private commit() {
    if (!this.start || !this.end) return;
    const a = this.start;
    const b = this.end;
    if (Math.abs(b.x - a.x) > 50 && Math.abs(b.y - a.y) > 50) {
      const ids = addWalls([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], true);
      if (ids.length) select(ids);
    }
    this.start = this.end = null;
    this.host.setOverlay({});
  }
  cancel(): boolean {
    if (this.start) {
      this.start = this.end = null;
      this.host.setOverlay({});
      return true;
    }
    return false;
  }
}

/** Hover a wall to preview a door/window/opening; click to place. */
export class OpeningTool implements Tool2D {
  readonly id: OpeningType;
  cursor = 'copy';
  private swingFlip = false;
  private host: ToolHost;
  constructor(host: ToolHost, type: OpeningType) {
    this.host = host;
    this.id = type;
  }
  activate(): void {
    this.host.setHint(`Hover a wall and click to place a ${this.id} · move across the wall to flip the swing · Shift flips the hinge`);
  }
  deactivate(): void {
    this.host.setOverlay({});
  }
  private candidate(e: ToolEvent) {
    const floor = getActiveFloor();
    if (!floor) return null;
    const hit = this.host.hit(e, { labels: false, handles: false });
    let wallId: string | null = hit?.kind === 'element' && hit.elementKind === 'wall' ? hit.id : null;
    if (!wallId && hit?.kind === 'element' && hit.elementKind === 'opening') wallId = floor.openings[hit.id].wallId;
    if (!wallId) {
      // Within a comfortable distance of a wall also counts.
      let best = this.host.vp.px(24);
      for (const fp of this.host.derived().geometry.footprints.values()) {
        const d = Math.abs(signedDistance(e.world, fp.a, fp.b));
        const t = ((e.world.x - fp.a.x) * fp.dir.x + (e.world.y - fp.a.y) * fp.dir.y) / fp.length;
        if (t > 0 && t < 1 && d < best) {
          best = d;
          wallId = fp.wallId;
        }
      }
    }
    if (!wallId) return null;
    const w = floor.walls[wallId];
    const width = Math.min(OPENING_DEFAULTS[this.id].width, dist(floor.nodes[w.a], floor.nodes[w.b]));
    const offset = Math.round(offsetForPoint(floor, wallId, e.world, width) / this.host.roundStep()) * this.host.roundStep();
    const side = signedDistance(e.world, floor.nodes[w.a], floor.nodes[w.b]) >= 0 ? 'left' : 'right';
    const opening = createOpening(this.id, wallId, Math.max(0, offset), newElementStatus(), {
      width,
      ...(this.id === 'door' ? { door: { style: 'single', hinge: e.shift !== this.swingFlip ? 'end' : 'start', swing: side } } : {}),
    });
    return opening;
  }
  pointerMove(e: ToolEvent): void {
    const o = this.candidate(e);
    const units = this.host.units();
    this.host.setOverlay(o ? { ghostOpening: { wallId: o.wallId, opening: o }, readout: { at: e.world, text: `${formatLength(o.offset, units)} from wall start` } } : {});
    this.host.setCursor(o ? 'copy' : 'not-allowed');
  }
  pointerDown(e: ToolEvent): void {
    if (e.button !== 0) return;
    const o = this.candidate(e);
    if (!o) {
      toast('Click on a wall to place it', 'info', undefined, 1800);
      return;
    }
    const id = addOpening(o.type, o.wallId, o.offset, { door: o.door, width: o.width });
    if (id) {
      select([id]);
      if (!e.mod) setTool('select');
    }
    this.host.setOverlay({});
  }
  pointerUp(): void {}
  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'f' || e.key === 'F') {
      this.swingFlip = !this.swingFlip;
      return true;
    }
    return false;
  }
  cancel(): boolean {
    setTool('select');
    return true;
  }
}

/** Places a library object. Wall-aligned objects snap their back to walls. R rotates. */
export class ItemTool implements Tool2D {
  readonly id = 'item';
  cursor = 'copy';
  private rotation = 0;
  private last: { x: number; y: number; rotation: number } | null = null;
  private host: ToolHost;
  constructor(host: ToolHost) {
    this.host = host;
  }
  activate(): void {
    this.rotation = 0;
    this.host.setHint('Click to place · R to rotate · hold ⌘/Ctrl to place several · Alt disables wall snapping');
  }
  deactivate(): void {
    this.host.setOverlay({});
  }
  private place(e: ToolEvent) {
    const entry = CATALOG_BY_ID[ui().placingCatalogId ?? ''];
    const floor = getActiveFloor();
    if (!entry || !floor) return null;
    let pos = { x: e.world.x, y: e.world.y, rotation: this.rotation };
    if (entry.wallAligned && !e.alt) {
      const s = snapItemToWall(entry, e.world, floor, this.host.derived().geometry, Math.max(entry.depth, this.host.vp.px(30)));
      if (s) pos = s;
    }
    if (pos.rotation === this.rotation) {
      const step = this.host.roundStep();
      pos = { ...pos, x: Math.round(pos.x / step) * step, y: Math.round(pos.y / step) * step };
    }
    return { entry, pos };
  }
  pointerMove(e: ToolEvent): void {
    const p = this.place(e);
    if (!p) return;
    this.last = p.pos;
    this.host.setOverlay({ ghostItem: { item: { ...p.pos, width: p.entry.width, depth: p.entry.depth, catalogId: p.entry.id }, valid: true } });
  }
  pointerDown(e: ToolEvent): void {
    if (e.button !== 0) return;
    const p = this.place(e);
    if (!p) return;
    const id = addItem(p.entry.id, p.pos, p.pos.rotation);
    if (id) {
      select([id]);
      if (!e.mod && !e.shift) {
        setTool('select');
        // Show exact size and wall distances for what was just placed.
        setUi({ rightPanel: 'inspector' });
      }
    }
  }
  pointerUp(): void {}
  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'r' || e.key === 'R') {
      this.rotation = (this.rotation + 90) % 360;
      if (this.last) {
        const entry = CATALOG_BY_ID[ui().placingCatalogId ?? ''];
        if (entry) this.host.setOverlay({ ghostItem: { item: { ...this.last, rotation: this.rotation, width: entry.width, depth: entry.depth, catalogId: entry.id }, valid: true } });
      }
      return true;
    }
    return false;
  }
  cancel(): boolean {
    setTool('select');
    return true;
  }
}

/** Two clicks + offset for a manual dimension line. */
export class DimensionTool implements Tool2D {
  readonly id = 'dimension';
  cursor = 'crosshair';
  private a: Vec2 | null = null;
  private b: Vec2 | null = null;
  private host: ToolHost;
  constructor(host: ToolHost) {
    this.host = host;
  }
  activate(): void {
    this.host.setHint('Click two points, then click to place the dimension line');
  }
  deactivate(): void {
    this.cancel();
  }
  pointerDown(e: ToolEvent): void {
    if (e.button !== 0) return;
    const p = this.host.snap(e, { from: this.a ?? undefined }).point;
    if (!this.a) this.a = p;
    else if (!this.b) this.b = p;
    else {
      const off = signedDistance(e.world, this.a, this.b);
      addDimensionLine(this.a, this.b, -off);
      this.a = this.b = null;
      this.host.setOverlay({});
    }
  }
  pointerMove(e: ToolEvent): void {
    const s = this.host.snap(e, { from: this.a ?? undefined });
    const u = this.host.units();
    if (this.a && !this.b) this.host.setOverlay({ snap: s, dimension: { a: this.a, b: s.point, offset: 0, text: formatLength(dist(this.a, s.point), u) } });
    else if (this.a && this.b) this.host.setOverlay({ dimension: { a: this.a, b: this.b, offset: -signedDistance(e.world, this.a, this.b), text: formatLength(dist(this.a, this.b), u) } });
    else this.host.setOverlay({ snap: s });
  }
  pointerUp(): void {}
  cancel(): boolean {
    if (this.a) {
      this.a = this.b = null;
      this.host.setOverlay({});
      return true;
    }
    return false;
  }
}

/** Tape measure: click-click, result stays until next click. */
export class MeasureTool implements Tool2D {
  readonly id = 'measure';
  cursor = 'crosshair';
  private a: Vec2 | null = null;
  private fixed: { a: Vec2; b: Vec2 } | null = null;
  private host: ToolHost;
  constructor(host: ToolHost) {
    this.host = host;
  }
  activate(): void {
    this.host.setHint('Click two points to measure · snaps to walls, corners and faces');
  }
  deactivate(): void {
    this.cancel();
  }
  pointerDown(e: ToolEvent): void {
    if (e.button !== 0) return;
    const p = this.host.snap(e, { from: this.a ?? undefined }).point;
    if (!this.a) {
      this.a = p;
      this.fixed = null;
    } else {
      this.fixed = { a: this.a, b: p };
      const u = this.host.units();
      const d = dist(this.a, p);
      setUi({ hint: `Measured ${formatLength(d, u)} · Δx ${formatLength(Math.abs(p.x - this.a.x), u)} · Δy ${formatLength(Math.abs(p.y - this.a.y), u)}` });
      this.a = null;
    }
  }
  pointerMove(e: ToolEvent): void {
    const s = this.host.snap(e, { from: this.a ?? undefined });
    const u = this.host.units();
    if (this.a) this.host.setOverlay({ snap: s, measure: { a: this.a, b: s.point, text: formatLength(dist(this.a, s.point), u) } });
    else if (this.fixed) this.host.setOverlay({ snap: s, measure: { ...this.fixed, text: formatLength(dist(this.fixed.a, this.fixed.b), u) } });
    else this.host.setOverlay({ snap: s });
  }
  pointerUp(): void {}
  cancel(): boolean {
    if (this.a || this.fixed) {
      this.a = null;
      this.fixed = null;
      this.host.setOverlay({});
      return true;
    }
    return false;
  }
}

export class TextTool implements Tool2D {
  readonly id = 'text';
  cursor = 'text';
  private host: ToolHost;
  constructor(host: ToolHost) {
    this.host = host;
  }
  activate(): void {
    this.host.setHint('Click to add a note');
  }
  pointerDown(e: ToolEvent): void {
    if (e.button !== 0) return;
    const id = addAnnotation(e.world, 'Note');
    if (id) {
      select([id]);
      setTool('select');
      setUi({ rightPanel: 'inspector', rightPanelOpen: true });
      requestAnimationFrame(() => (document.querySelector('[data-focus="note-text"]') as HTMLInputElement | null)?.select());
    }
  }
  pointerMove(): void {}
  pointerUp(): void {}
  cancel(): boolean {
    return false;
  }
}
