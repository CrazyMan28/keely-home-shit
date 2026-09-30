import { CATALOG_BY_ID } from '../../../assets/catalog';
import { distancesToWalls, normalizeRotation, snapItemToWall } from '../../../geometry/items/items';
import { formatAngle, formatLength, formatSignedLength } from '../../../geometry/measurement/format';
import { clampOffset } from '../../../geometry/openings/openings';
import { add, dist, dot, norm, perp, rotate, scale, sub, type Vec2 } from '../../../geometry/primitives/vec';
import { moveNode, moveWallPerpendicular, translateWalls } from '../../../geometry/walls/wallOps';
import { FloorEditor } from '../../../model/floorEditor';
import type { Floor, Id } from '../../../model/types';
import { pinnedNodesFor, report } from '../../../state/actions';
import {
  beginTransaction,
  cancelTransaction,
  commitTransaction,
  editFloor,
  getActiveFloor,
  isActiveVariantLocked,
} from '../../../state/documentStore';
import { select, setUi, ui } from '../../../state/uiStore';
import { elementsInBox } from '../hitTest';
import { dirOf } from '../renderer';
import type { Tool2D, ToolEvent, ToolHost } from './types';

type Drag =
  | { mode: 'pending'; start: ToolEvent; hitId: Id | null; kind: string; additive: boolean }
  | { mode: 'marquee'; start: Vec2; additive: boolean; base: Id[] }
  | { mode: 'moveWall'; wallId: Id; start: Vec2; floor: Floor; normal: Vec2; offset: number }
  | { mode: 'moveNode'; nodeId: Id; wallId: Id; start: Vec2; floor: Floor; last: Vec2 }
  | { mode: 'moveSelection'; ids: Id[]; start: Vec2; floor: Floor; delta: Vec2 }
  | { mode: 'moveOpening'; openingId: Id; grab: number; floor: Floor }
  | { mode: 'resizeOpening'; openingId: Id; edge: 'start' | 'end'; floor: Floor }
  | { mode: 'rotateItem'; itemId: Id; floor: Floor }
  | { mode: 'resizeItem'; itemId: Id; corner: number; floor: Floor }
  | { mode: 'roomLabel'; roomId: Id; start: Vec2; floor: Floor }
  | { mode: 'awaitExact'; apply: (mm: number) => void };

const DRAG_THRESHOLD = 4;

export class SelectTool implements Tool2D {
  readonly id = 'select';
  cursor = 'default';
  private drag: Drag | null = null;
  private host: ToolHost;

  constructor(host: ToolHost) {
    this.host = host;
  }

  deactivate(): void {
    this.cancel();
  }

  pointerDown(e: ToolEvent): void {
    if (e.button !== 0) return;
    const hit = this.host.hit(e);
    const sel = ui().selection;
    const additive = e.shift || e.mod;

    if (hit?.kind === 'label') {
      const t = hit.label.target;
      this.host.openValueInput(t, { x: e.client.x, y: e.client.y }, hit.label.value);
      if (t.kind === 'wallLength') select([t.wallId]);
      return;
    }
    if (hit?.kind === 'handle' && !isActiveVariantLocked()) {
      const floor = getActiveFloor()!;
      beginTransaction('Edit');
      if (hit.handle === 'node') this.drag = { mode: 'moveNode', nodeId: hit.nodeId, wallId: hit.wallId, start: e.world, floor, last: e.world };
      else if (hit.handle === 'itemRotate') this.drag = { mode: 'rotateItem', itemId: hit.itemId, floor };
      else if (hit.handle === 'itemCorner') this.drag = { mode: 'resizeItem', itemId: hit.itemId, corner: hit.corner, floor };
      else if (hit.handle === 'openingEdge') this.drag = { mode: 'resizeOpening', openingId: hit.openingId, edge: hit.edge, floor };
      return;
    }
    if (hit?.kind === 'roomLabel') {
      if (!additive) select([hit.roomId]);
      else select([hit.roomId], 'toggle');
      this.drag = { mode: 'pending', start: e, hitId: hit.roomId, kind: 'roomLabel', additive };
      return;
    }
    if (hit?.kind === 'element') {
      if (additive) select([hit.id], 'toggle');
      else if (!sel.includes(hit.id)) select([hit.id]);
      this.drag = { mode: 'pending', start: e, hitId: hit.id, kind: hit.elementKind, additive };
      return;
    }
    this.drag = { mode: 'pending', start: e, hitId: null, kind: 'empty', additive };
  }

  pointerMove(e: ToolEvent): void {
    const d = this.drag;
    if (!d) {
      this.hover(e);
      return;
    }
    if (d.mode === 'pending') {
      if (dist(d.start.screen, e.screen) < DRAG_THRESHOLD) return;
      this.beginDrag(d, e);
      return;
    }
    this.updateDrag(d, e);
  }

  private hover(e: ToolEvent): void {
    const hit = this.host.hit(e);
    const id = hit?.kind === 'element' ? hit.id : hit?.kind === 'roomLabel' ? hit.roomId : null;
    const labelKey = hit?.kind === 'label' ? hit.label.key : null;
    if (ui().hover !== id) setUi({ hover: id });
    this.host.setCursor(
      hit?.kind === 'label'
        ? 'text'
        : hit?.kind === 'handle'
          ? hit.handle === 'itemRotate'
            ? 'grab'
            : 'crosshair'
          : hit?.kind === 'element' || hit?.kind === 'roomLabel'
            ? 'move'
            : 'default',
    );
    (this.host as ToolHost & { setHoverLabel?: (k: string | null) => void }).setHoverLabel?.(labelKey);
  }

  private beginDrag(d: Extract<Drag, { mode: 'pending' }>, e: ToolEvent): void {
    const floor = getActiveFloor()!;
    const start = d.start.world;
    if (d.kind === 'empty') {
      this.drag = { mode: 'marquee', start, additive: d.additive, base: d.additive ? ui().selection : [] };
      this.updateDrag(this.drag, e);
      return;
    }
    if (isActiveVariantLocked()) {
      report({ ok: false, reason: 'base-locked', violations: [] });
      this.drag = null;
      return;
    }
    const sel = ui().selection;
    if (d.kind === 'roomLabel' && d.hitId) {
      beginTransaction('Move room label');
      this.drag = { mode: 'roomLabel', roomId: d.hitId, start, floor };
    } else if (d.kind === 'wall' && d.hitId && sel.length === 1 && sel[0] === d.hitId) {
      const w = floor.walls[d.hitId];
      if (w.locked || w.locks.position) {
        report({ ok: false, reason: 'constraint-violation', violations: [{ constraintId: '', label: 'Locked position', residual: 0, unit: 'mm' }] });
        this.drag = null;
        return;
      }
      const a = floor.nodes[w.a];
      const b = floor.nodes[w.b];
      beginTransaction('Move wall');
      this.drag = { mode: 'moveWall', wallId: w.id, start, floor, normal: perp(norm(sub(b, a))), offset: 0 };
    } else if (d.kind === 'opening' && d.hitId && sel.length === 1) {
      const o = floor.openings[d.hitId];
      const w = floor.walls[o.wallId];
      const a = floor.nodes[w.a];
      const dir = norm(sub(floor.nodes[w.b], a));
      beginTransaction('Move opening');
      this.drag = { mode: 'moveOpening', openingId: o.id, grab: dot(sub(start, a), dir) - o.offset, floor };
    } else if (d.kind === 'room') {
      this.drag = { mode: 'marquee', start, additive: d.additive, base: d.additive ? sel : [] };
    } else {
      const ids = sel.filter((id) => floor.walls[id] || floor.items[id] || floor.annotations[id] || floor.dimensions[id]);
      if (!ids.length) {
        this.drag = null;
        return;
      }
      beginTransaction(ids.length === 1 && floor.items[ids[0]] ? 'Move item' : 'Move');
      this.drag = { mode: 'moveSelection', ids, start, floor, delta: { x: 0, y: 0 } };
    }
    this.updateDrag(this.drag!, e);
  }

  private updateDrag(d: Drag, e: ToolEvent): void {
    const units = this.host.units();
    const step = e.alt ? 0 : this.host.roundStep();
    const round = (v: number) => (step ? Math.round(v / step) * step : v);
    switch (d.mode) {
      case 'marquee': {
        const fully = e.world.x > d.start.x;
        const ids = elementsInBox(d.start, e.world, this.host.hitContext(), fully);
        select(d.additive ? [...new Set([...d.base, ...ids])] : ids);
        this.host.setOverlay({ marquee: { a: d.start, b: e.world } });
        break;
      }
      case 'moveWall': {
        const off = round(dot(sub(e.world, d.start), d.normal));
        d.offset = off;
        editFloor('Move wall', () => moveWallPerpendicular(d.floor, d.wallId, off), { transient: true, base: d.floor, pinned: [d.floor.walls[d.wallId].a, d.floor.walls[d.wallId].b] });
        this.host.setOverlay({ readout: { at: e.world, text: `Moving wall ${formatSignedLength(off, units)}` } });
        this.host.setHint('Type a number for an exact offset · Alt for free movement');
        break;
      }
      case 'moveNode': {
        const w = d.floor.walls[d.wallId];
        const other = w.a === d.nodeId ? w.b : w.a;
        const from = { x: d.floor.nodes[other].x, y: d.floor.nodes[other].y };
        const snap = this.host.snap(e, { from, excludeNodes: [d.nodeId], lengthStep: true });
        d.last = snap.point;
        editFloor('Move endpoint', () => moveNode(d.floor, d.nodeId, snap.point), { transient: true, base: d.floor, pinned: [d.nodeId] });
        this.host.setOverlay({ snap, readout: { at: e.world, text: formatLength(dist(from, snap.point), units) } });
        break;
      }
      case 'moveSelection': {
        let delta = sub(e.world, d.start);
        const items = d.ids.map((id) => d.floor.items[id]).filter(Boolean);
        let rotation: number | undefined;
        if (d.ids.length === 1 && items.length === 1 && !e.alt) {
          const it = items[0];
          const entry = CATALOG_BY_ID[it.catalogId];
          const target = add({ x: it.x, y: it.y }, delta);
          if (entry?.wallAligned) {
            const snapped = snapItemToWall(it, target, d.floor, this.host.derived().geometry, Math.max(it.depth / 2 + this.host.vp.px(24), 250));
            if (snapped) {
              delta = sub(snapped, { x: it.x, y: it.y });
              rotation = snapped.rotation;
            }
          }
        }
        if (rotation === undefined) delta = { x: round(delta.x), y: round(delta.y) };
        d.delta = delta;
        const rot = rotation;
        editFloor(
          'Move',
          () => {
            const walls = d.ids.filter((id) => d.floor.walls[id] && !d.floor.walls[id].locked);
            const f0 = walls.length ? translateWalls(d.floor, walls, delta) : d.floor;
            const ed = new FloorEditor(f0);
            for (const id of d.ids) {
              const it = d.floor.items[id];
              if (it && !it.locked) ed.patchItem(id, { x: it.x + delta.x, y: it.y + delta.y, ...(rot !== undefined ? { rotation: rot } : {}) });
              const n = d.floor.annotations[id];
              if (n) ed.patchAnnotation(id, { x: n.x + delta.x, y: n.y + delta.y });
              const dim = d.floor.dimensions[id];
              if (dim) ed.patchDimension(id, { a: add(dim.a, delta), b: add(dim.b, delta) });
            }
            return ed.floor;
          },
          { transient: true, base: d.floor, pinned: pinnedNodesFor(d.ids) },
        );
        const single = d.ids.length === 1 ? getActiveFloor()?.items[d.ids[0]] : undefined;
        let text = `${formatLength(Math.hypot(delta.x, delta.y), units)}`;
        if (single) {
          const dists = distancesToWalls(single, this.host.derived().geometry, 6000);
          const back = dists.find((x) => x.side === 'back');
          if (back) text = `${formatLength(back.distance, units)} from wall`;
        }
        this.host.setOverlay({ readout: { at: e.world, text } });
        this.host.setHint('Alt: move freely · type a number for an exact distance');
        break;
      }
      case 'moveOpening': {
        const floor = d.floor;
        const o = floor.openings[d.openingId];
        // Allow dragging onto another wall.
        let wallId = o.wallId;
        const hit = this.host.hit(e, { labels: false, handles: false });
        if (hit?.kind === 'element' && hit.elementKind === 'wall' && hit.id !== o.wallId) wallId = hit.id;
        const w = floor.walls[wallId];
        const a = floor.nodes[w.a];
        const b = floor.nodes[w.b];
        const L = dist(a, b);
        const dir = norm(sub(b, a));
        const grab = wallId === o.wallId ? d.grab : o.width / 2;
        const offset = clampOffset(round(dot(sub(e.world, a), dir) - grab), o.width, L);
        editFloor('Move opening', () => {
          const ed = new FloorEditor(floor);
          ed.patchOpening(o.id, { wallId, offset });
          return ed.floor;
        }, { transient: true, base: floor });
        this.host.setOverlay({ readout: { at: e.world, text: `${formatLength(offset, units)} from wall start` } });
        break;
      }
      case 'resizeOpening': {
        const floor = d.floor;
        const o = floor.openings[d.openingId];
        const w = floor.walls[o.wallId];
        const a = floor.nodes[w.a];
        const dir = norm(sub(floor.nodes[w.b], a));
        const L = dist(a, floor.nodes[w.b]);
        const t = Math.max(0, Math.min(L, round(dot(sub(e.world, a), dir))));
        let s = o.offset;
        let en = o.offset + o.width;
        if (d.edge === 'start') s = Math.min(t, en - 100);
        else en = Math.max(t, s + 100);
        editFloor('Resize opening', () => {
          const ed = new FloorEditor(floor);
          ed.patchOpening(o.id, { offset: s, width: en - s });
          return ed.floor;
        }, { transient: true, base: floor });
        this.host.setOverlay({ readout: { at: e.world, text: `Width ${formatLength(en - s, units)}` } });
        break;
      }
      case 'rotateItem': {
        const it = d.floor.items[d.itemId];
        const v = sub(e.world, { x: it.x, y: it.y });
        // Handle sits behind the item (−front); front = perp(right).
        let deg = (Math.atan2(v.y, v.x) * 180) / Math.PI + 90;
        const snapStep = e.shift ? 1 : e.alt ? 0 : 15;
        if (snapStep) deg = Math.round(deg / snapStep) * snapStep;
        const rotation = normalizeRotation(deg);
        editFloor('Rotate item', () => {
          const ed = new FloorEditor(d.floor);
          ed.patchItem(it.id, { rotation });
          return ed.floor;
        }, { transient: true, base: d.floor });
        this.host.setOverlay({ readout: { at: e.world, text: formatAngle(rotation, 1) } });
        this.host.setHint('Snaps to 15° · Shift for 1° steps · Alt for free rotation');
        break;
      }
      case 'resizeItem': {
        const it = d.floor.items[d.itemId];
        const r = (it.rotation * Math.PI) / 180;
        const local = rotate(sub(e.world, { x: it.x, y: it.y }), -r);
        const signs = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ][d.corner];
        const oppLocal = { x: (-signs[0] * it.width) / 2, y: (-signs[1] * it.depth) / 2 };
        const width = Math.max(100, round(Math.abs(local.x - oppLocal.x)));
        const depth = Math.max(100, round(Math.abs(local.y - oppLocal.y)));
        const centerLocal = { x: oppLocal.x + (signs[0] * width) / 2, y: oppLocal.y + (signs[1] * depth) / 2 };
        const c = add({ x: it.x, y: it.y }, rotate(centerLocal, r));
        editFloor('Resize item', () => {
          const ed = new FloorEditor(d.floor);
          ed.patchItem(it.id, { width, depth, x: c.x, y: c.y });
          return ed.floor;
        }, { transient: true, base: d.floor });
        this.host.setOverlay({ readout: { at: e.world, text: `${formatLength(width, units)} × ${formatLength(depth, units)}` } });
        break;
      }
      case 'roomLabel': {
        const room = d.floor.rooms[d.roomId];
        const delta = sub(e.world, d.start);
        editFloor('Move room label', () => {
          const ed = new FloorEditor(d.floor);
          ed.patchRoom(room.id, { labelOffset: add(room.labelOffset, delta) });
          return ed.floor;
        }, { transient: true, base: d.floor });
        break;
      }
      default:
        break;
    }
  }

  pointerUp(_e: ToolEvent): void {
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'pending') {
      if (d.kind === 'empty' && !d.additive) select([]);
      this.drag = null;
      return;
    }
    if (d.mode === 'awaitExact') return;
    if (d.mode === 'moveNode') {
      // Final placement merges onto junctions / splits walls (T-junctions).
      editFloor('Move endpoint', () => moveNode(d.floor, d.nodeId, d.last, true), { transient: true, base: d.floor, pinned: [d.nodeId] });
    }
    if (d.mode === 'marquee') {
      this.host.setOverlay({});
      this.drag = null;
      return;
    }
    commitTransaction();
    this.drag = null;
    this.host.setOverlay({});
    this.host.setHint('');
  }

  doubleClick(e: ToolEvent): void {
    const hit = this.host.hit(e);
    if (hit?.kind === 'element' && hit.elementKind === 'wall') {
      const f = getActiveFloor()!;
      const w = f.walls[hit.id];
      this.host.openValueInput({ kind: 'wallLength', wallId: w.id, reference: 'centerline' }, e.client, dist(f.nodes[w.a], f.nodes[w.b]));
    } else if (hit?.kind === 'roomLabel' || (hit?.kind === 'element' && hit.elementKind === 'room')) {
      setUi({ rightPanel: 'inspector', rightPanelOpen: true });
      requestAnimationFrame(() => (document.querySelector('[data-focus="room-name"]') as HTMLInputElement | null)?.select());
    }
  }

  keyDown(e: KeyboardEvent): boolean {
    const d = this.drag;
    if (d && /^[0-9.]$/.test(e.key) && (d.mode === 'moveWall' || d.mode === 'moveSelection')) {
      const apply =
        d.mode === 'moveWall'
          ? (mm: number) => {
              const sign = d.offset < 0 ? -1 : 1;
              editFloor('Move wall', () => moveWallPerpendicular(d.floor, d.wallId, sign * mm), { transient: true, base: d.floor });
            }
          : (mm: number) => {
              const dir = Math.hypot(d.delta.x, d.delta.y) > 1e-9 ? norm(d.delta) : { x: 1, y: 0 };
              const delta = scale(dir, mm);
              const ids = d.ids;
              editFloor('Move', () => {
                const walls = ids.filter((id) => d.floor.walls[id]);
                const f0 = walls.length ? translateWalls(d.floor, walls, delta) : d.floor;
                const ed = new FloorEditor(f0);
                for (const id of ids) {
                  const it = d.floor.items[id];
                  if (it) ed.patchItem(id, { x: it.x + delta.x, y: it.y + delta.y });
                }
                return ed.floor;
              }, { transient: true, base: d.floor });
            };
      const current = d.mode === 'moveWall' ? Math.abs(d.offset) : Math.hypot(d.delta.x, d.delta.y);
      this.drag = { mode: 'awaitExact', apply };
      this.host.openValueInput({ kind: 'moveOffset' }, lastClient, current, e.key);
      this.host.setOverlay({});
      return true;
    }
    if (!d && ui().selection.length && e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 304.8 : this.host.units().system === 'imperial' ? 25.4 : 10;
      const delta = { x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0 };
      const ids = ui().selection;
      report(
        editFloor(
          'Nudge',
          (f) => {
            const walls = ids.filter((id) => f.walls[id]);
            const f0 = walls.length ? translateWalls(f, walls, delta) : f;
            const ed = new FloorEditor(f0);
            for (const id of ids) {
              const it = f.items[id];
              if (it && !it.locked) ed.patchItem(id, { x: it.x + delta.x, y: it.y + delta.y });
              const n = f.annotations[id];
              if (n) ed.patchAnnotation(id, { x: n.x + delta.x, y: n.y + delta.y });
            }
            return ed.floor;
          },
          { coalesceKey: `nudge-${ids.join(',')}`, pinned: pinnedNodesFor(ids) },
        ),
      );
      return true;
    }
    return false;
  }

  submitValue(mm: number): void {
    const d = this.drag;
    if (d?.mode === 'awaitExact') {
      d.apply(mm);
      commitTransaction();
      this.drag = null;
      this.host.setHint('');
    }
  }

  cancel(): boolean {
    if (this.drag) {
      if (this.drag.mode !== 'pending' && this.drag.mode !== 'marquee') cancelTransaction();
      this.drag = null;
      this.host.setOverlay({});
      this.host.closeValueInput();
      this.host.setHint('');
      return true;
    }
    return false;
  }
}

/** Last pointer client position (for placing popovers during keyboard entry). */
export let lastClient: Vec2 = { x: 0, y: 0 };
export function setLastClient(p: Vec2): void {
  lastClient = p;
}

export { dirOf };
