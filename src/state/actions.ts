import { CATALOG_BY_ID } from '../assets/catalog';
import { createItem, distancesToWalls, setDistanceToWall, type ItemSide } from '../geometry/items/items';
import { derivePlan } from '../geometry/derive';
import { clampOffset, createOpening, OPENING_DEFAULTS } from '../geometry/openings/openings';
import { add, type Vec2 } from '../geometry/primitives/vec';
import { computeWallGeometry, faceLength } from '../geometry/walls/wallGeometry';
import {
  addWallChainTo,
  deleteWalls,
  duplicateWalls,
  mergeWalls,
  moveWallPerpendicular,
  resizeWall,
  reverseWall,
  setWallAngle,
  splitWallAt,
  translateWalls,
  type ResizeAnchor,
  type ResizeMode,
} from '../geometry/walls/wallOps';
import { DEFAULT_EXTERIOR_THICKNESS, DEFAULT_INTERIOR_THICKNESS, cloneVariantAsOption } from '../model/factory';
import { FloorEditor } from '../model/floorEditor';
import { newId } from '../model/ids';
import type { ElementStatus, Floor, Id, Item, Opening, OpeningType, ProjectDoc, Room, Wall, WallLocks } from '../model/types';
import {
  documentStore,
  editDoc,
  editFloor,
  getActiveFloor,
  getDoc,
  isBaseActive,
  setActiveVariant,
  type EditOptions,
  type EditResult,
} from './documentStore';
import { clearSelection, select, setUi, toast, ui } from './uiStore';

/** Status for newly created elements: base plan records what exists; options propose new work. */
export function newElementStatus(): ElementStatus {
  return isBaseActive() ? 'existing' : 'new';
}

/** Surfaces edit failures to the user consistently. */
export function report(result: EditResult, what = 'That change'): boolean {
  if (result.ok) {
    if (result.overrodePins) toast('Adjusted to keep locked dimensions', 'info');
    return true;
  }
  if (result.reason === 'base-locked') {
    toast('The measured plan is locked. Create a design option to try changes.', 'warning', {
      label: 'Create option',
      run: () => createVariant(),
    });
  } else if (result.reason === 'constraint-violation') {
    const v = result.violations[0];
    toast(`${what} conflicts with “${v.label}”${v.unit === 'mm' ? '' : ''}. Unlock it to continue.`, 'error');
  }
  return false;
}

function floorEdit(label: string, fn: (f: Floor) => Floor, opts?: EditOptions): boolean {
  return report(editFloor(label, fn, opts), label);
}

// ── Walls ────────────────────────────────────────────────────────────────

export function wallDefaults(type: Wall['wallType'] = 'interior') {
  const floor = getActiveFloor();
  return {
    thickness: type === 'exterior' ? DEFAULT_EXTERIOR_THICKNESS : (floor?.defaultWallThickness ?? DEFAULT_INTERIOR_THICKNESS),
    height: floor?.defaultWallHeight ?? 2438.4,
    wallType: type,
    status: newElementStatus(),
  };
}

export function addWalls(points: Vec2[], closed = false, type: Wall['wallType'] = 'interior'): Id[] {
  let created: Id[] = [];
  const ok = floorEdit(closed ? 'Draw room' : points.length > 2 ? 'Draw walls' : 'Draw wall', (f) => {
    const ed = new FloorEditor(f);
    created = addWallChainTo(ed, points, wallDefaults(type), { closed });
    return ed.floor;
  });
  return ok ? created : [];
}

export interface SetLengthOptions {
  anchor: ResizeAnchor;
  mode: ResizeMode;
  /** Measure against a wall face instead of the centerline. */
  face?: 'left' | 'right';
}

/**
 * Sets a wall's length exactly. For face-referenced (finished interior)
 * lengths it iterates until the face measures exactly the target, because
 * face length depends on the joints at both ends.
 */
export function setWallLength(wallId: Id, target: number, opts: SetLengthOptions): boolean {
  return floorEdit('Change wall length', (floor) => {
    let f = floor;
    const w = f.walls[wallId];
    if (!w) return floor;
    const centerLen = (fl: Floor) => Math.hypot(fl.nodes[w.b].x - fl.nodes[w.a].x, fl.nodes[w.b].y - fl.nodes[w.a].y);
    if (!opts.face) return resizeWall(f, wallId, target, opts.anchor, opts.mode).floor;
    for (let i = 0; i < 6; i++) {
      const fp = computeWallGeometry(f).footprints.get(wallId);
      if (!fp) break;
      const err = target - faceLength(fp, opts.face);
      if (Math.abs(err) < 0.005) break;
      f = resizeWall(f, wallId, centerLen(f) + err, opts.anchor, opts.mode).floor;
    }
    return f;
  });
}

export function moveWall(wallId: Id, offset: number, opts?: EditOptions): boolean {
  return floorEdit('Move wall', (f) => moveWallPerpendicular(f, wallId, offset), opts);
}

export function updateWall(wallId: Id, patch: Partial<Wall>, label = 'Edit wall'): boolean {
  return floorEdit(label, (f) => {
    const ed = new FloorEditor(f);
    ed.patchWall(wallId, patch);
    return ed.floor;
  }, { coalesceKey: `wall-${wallId}-${Object.keys(patch).join(',')}` });
}

export function updateWalls(ids: Id[], patch: Partial<Wall>, label = 'Edit walls'): boolean {
  return floorEdit(label, (f) => {
    const ed = new FloorEditor(f);
    for (const id of ids) ed.patchWall(id, patch);
    return ed.floor;
  });
}

export function setWallDirection(wallId: Id, deg: number, anchor: 'start' | 'end' | 'center' = 'start'): boolean {
  return floorEdit('Change wall angle', (f) => setWallAngle(f, wallId, deg, anchor));
}

export function setWallEndpoint(wallId: Id, end: 'a' | 'b', p: Vec2): boolean {
  return floorEdit('Move wall endpoint', (f) => {
    const ed = new FloorEditor(f);
    ed.setNode(f.walls[wallId][end], p.x, p.y);
    return ed.floor;
  }, { pinned: [getActiveFloor()!.walls[wallId][end]] });
}

export function toggleWallLock(wallId: Id, key: keyof WallLocks): boolean {
  const f = getActiveFloor();
  const w = f?.walls[wallId];
  if (!f || !w) return false;
  const on = !w.locks[key];
  const len = Math.hypot(f.nodes[w.b].x - f.nodes[w.a].x, f.nodes[w.b].y - f.nodes[w.a].y);
  const ang = ((Math.atan2(f.nodes[w.b].y - f.nodes[w.a].y, f.nodes[w.b].x - f.nodes[w.a].x) * 180) / Math.PI + 360) % 360;
  return updateWall(
    wallId,
    {
      locks: { ...w.locks, [key]: on },
      ...(key === 'length' ? { lockedLength: on ? len : undefined } : {}),
      ...(key === 'angle' ? { lockedAngle: on ? ang : undefined } : {}),
    },
    on ? `Lock ${key}` : `Unlock ${key}`,
  );
}

export function splitWall(wallId: Id, at?: Vec2): boolean {
  return floorEdit('Split wall', (f) => {
    const w = f.walls[wallId];
    if (!w) return f;
    const a = f.nodes[w.a];
    const b = f.nodes[w.b];
    const p = at ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ed = new FloorEditor(f);
    splitWallAt(ed, wallId, p);
    return ed.floor;
  });
}

export function mergeSelectedWalls(): boolean {
  const walls = ui().selection.filter((id) => getActiveFloor()?.walls[id]);
  if (walls.length !== 2) {
    toast('Select two connected, straight-in-line walls to merge', 'info');
    return false;
  }
  const f = getActiveFloor()!;
  if (!mergeWalls(f, walls[0], walls[1])) {
    toast('Those walls must share a junction and be in line to merge', 'warning');
    return false;
  }
  const ok = floorEdit('Merge walls', (fl) => mergeWalls(fl, walls[0], walls[1]) ?? fl);
  if (ok) select([walls[0]]);
  return ok;
}

export function reverseWallDirection(wallId: Id): boolean {
  return floorEdit('Reverse wall', (f) => reverseWall(f, wallId));
}

export function convertWallType(wallId: Id, type: Wall['wallType']): boolean {
  const thickness = type === 'exterior' ? DEFAULT_EXTERIOR_THICKNESS : DEFAULT_INTERIOR_THICKNESS;
  return updateWall(wallId, { wallType: type, thickness }, type === 'exterior' ? 'Convert to exterior' : 'Convert to interior');
}

// ── Openings ─────────────────────────────────────────────────────────────

export function addOpening(type: OpeningType, wallId: Id, offset: number, overrides: Partial<Opening> = {}): Id | null {
  const o = createOpening(type, wallId, offset, newElementStatus(), overrides);
  const ok = floorEdit(`Add ${type}`, (f) => {
    const ed = new FloorEditor(f);
    const w = f.walls[wallId];
    const L = Math.hypot(f.nodes[w.b].x - f.nodes[w.a].x, f.nodes[w.b].y - f.nodes[w.a].y);
    const width = Math.min(o.width, L);
    const height = Math.min(o.height, w.height - o.sill);
    ed.putOpening({ ...o, width, height, offset: clampOffset(offset, width, L) });
    return ed.floor;
  });
  return ok ? o.id : null;
}

export function updateOpening(id: Id, patch: Partial<Opening>, label = 'Edit opening'): boolean {
  return floorEdit(label, (f) => {
    const o = f.openings[id];
    if (!o) return f;
    const w = f.walls[patch.wallId ?? o.wallId];
    const L = Math.hypot(f.nodes[w.b].x - f.nodes[w.a].x, f.nodes[w.b].y - f.nodes[w.a].y);
    const merged = { ...o, ...patch };
    merged.width = Math.max(50, Math.min(merged.width, L));
    merged.offset = clampOffset(merged.offset, merged.width, L);
    const ed = new FloorEditor(f);
    ed.patchOpening(id, merged);
    return ed.floor;
  }, { coalesceKey: `opening-${id}-${Object.keys(patch).join(',')}` });
}

export function flipDoor(id: Id, what: 'hinge' | 'swing'): boolean {
  const o = getActiveFloor()?.openings[id];
  if (!o?.door) return false;
  const door = { ...o.door };
  if (what === 'hinge') door.hinge = door.hinge === 'start' ? 'end' : 'start';
  else door.swing = door.swing === 'left' ? 'right' : 'left';
  return updateOpening(id, { door }, what === 'hinge' ? 'Flip hinge side' : 'Flip swing direction');
}

export const openingDefaults = OPENING_DEFAULTS;

// ── Items ────────────────────────────────────────────────────────────────

export function addItem(catalogId: string, at: Vec2, rotation = 0): Id | null {
  const entry = CATALOG_BY_ID[catalogId];
  if (!entry) return null;
  const item = createItem(entry, at, rotation, newElementStatus());
  const ok = floorEdit(`Add ${entry.name.toLowerCase()}`, (f) => {
    const ed = new FloorEditor(f);
    ed.putItem(item);
    return ed.floor;
  });
  if (ok && ui().strictMode) enforceStrict([item.id]);
  return ok ? item.id : null;
}

export function updateItem(id: Id, patch: Partial<Item>, label = 'Edit item', opts: EditOptions = {}): boolean {
  return floorEdit(label, (f) => {
    const ed = new FloorEditor(f);
    ed.patchItem(id, patch);
    return ed.floor;
  }, { coalesceKey: `item-${id}-${Object.keys(patch).join(',')}`, ...opts });
}

export function setItemDistance(itemId: Id, side: ItemSide, value: number): boolean {
  const floor = getActiveFloor();
  const item = floor?.items[itemId];
  if (!floor || !item) return false;
  const derived = derivePlan(floor, 'proposed');
  const cur = distancesToWalls(item, derived.geometry).find((d) => d.side === side);
  if (!cur) return false;
  return updateItem(itemId, setDistanceToWall(item, cur, value), 'Set distance to wall');
}

export function rotateItems(ids: Id[], deg: number): boolean {
  return floorEdit('Rotate', (f) => {
    const ed = new FloorEditor(f);
    for (const id of ids) {
      const it = f.items[id];
      if (it) ed.patchItem(id, { rotation: (((it.rotation + deg) % 360) + 360) % 360 });
    }
    return ed.floor;
  });
}

/** In strict mode, undo placements that collide with walls/items. */
function enforceStrict(ids: Id[]): void {
  const f = getActiveFloor();
  if (!f) return;
  const issues = derivePlan(f, 'proposed').clearance.filter((c) => c.message.includes('overlaps') && c.elementIds.some((id) => ids.includes(id)));
  if (issues.length) toast(`Strict mode: ${issues[0].message}`, 'warning');
}

// ── Rooms, annotations, dimensions ───────────────────────────────────────

export function updateRoom(id: Id, patch: Partial<Room>, label = 'Edit room'): boolean {
  return floorEdit(label, (f) => {
    const ed = new FloorEditor(f);
    ed.patchRoom(id, patch);
    return ed.floor;
  }, { coalesceKey: `room-${id}-${Object.keys(patch).join(',')}` });
}

export function addAnnotation(at: Vec2, text: string): Id | null {
  const id = newId('note');
  const ok = floorEdit('Add note', (f) => {
    const ed = new FloorEditor(f);
    ed.putAnnotation({ id, kind: 'annotation', x: at.x, y: at.y, text, fontSize: 14, status: newElementStatus() });
    return ed.floor;
  });
  return ok ? id : null;
}

export function addDimensionLine(a: Vec2, b: Vec2, offset: number): Id | null {
  const id = newId('dim');
  const ok = floorEdit('Add dimension', (f) => {
    const ed = new FloorEditor(f);
    ed.putDimension({ id, kind: 'dimension', a, b, offset, mode: 'manual', status: 'existing' });
    return ed.floor;
  });
  return ok ? id : null;
}

// ── Selection-wide operations ────────────────────────────────────────────

function classify(floor: Floor, ids: Id[]) {
  return {
    walls: ids.filter((id) => floor.walls[id]),
    openings: ids.filter((id) => floor.openings[id]),
    items: ids.filter((id) => floor.items[id]),
    notes: ids.filter((id) => floor.annotations[id]),
    dims: ids.filter((id) => floor.dimensions[id]),
    rooms: ids.filter((id) => floor.rooms[id]),
  };
}

/**
 * Deletes the selection. In a design option, existing elements are marked
 * "demolish" instead of disappearing, so the plan records what gets torn out.
 * Deleting an element already marked for demolition restores it.
 */
export function deleteSelection(ids = ui().selection): void {
  const floor = getActiveFloor();
  if (!floor || !ids.length) return;
  const c = classify(floor, ids);
  const renovation = !isBaseActive();
  let demolished = 0;
  const ok = floorEdit(ids.length === 1 ? 'Delete' : `Delete ${ids.length} items`, (f) => {
    const ed = new FloorEditor(f);
    const hardWalls: Id[] = [];
    for (const id of c.walls) {
      const w = f.walls[id];
      if (renovation && w.status === 'existing') {
        ed.patchWall(id, { status: 'demolish' });
        for (const o of ed.openingsOnWall(id)) if (o.status === 'existing') ed.patchOpening(o.id, { status: 'demolish' });
        demolished++;
      } else hardWalls.push(id);
    }
    for (const id of c.openings) {
      const o = f.openings[id];
      if (renovation && o.status === 'existing') {
        ed.patchOpening(id, { status: 'demolish' });
        demolished++;
      } else ed.removeOpening(id);
    }
    for (const id of c.items) {
      const it = f.items[id];
      if (renovation && it.status === 'existing') {
        ed.patchItem(id, { status: 'demolish' });
        demolished++;
      } else ed.removeItem(id);
    }
    for (const id of c.notes) ed.removeAnnotation(id);
    for (const id of c.dims) ed.removeDimension(id);
    let out = ed.floor;
    if (hardWalls.length) out = deleteWalls(out, hardWalls);
    return out;
  });
  if (ok) {
    clearSelection();
    if (demolished) toast(`${demolished === 1 ? 'Marked' : `${demolished} elements marked`} for demolition`, 'info');
  }
}

export function setStatus(ids: Id[], status: ElementStatus): boolean {
  return floorEdit(status === 'demolish' ? 'Mark for demolition' : status === 'new' ? 'Mark as new' : 'Mark as existing', (f) => {
    const ed = new FloorEditor(f);
    for (const id of ids) {
      if (f.walls[id]) ed.patchWall(id, { status });
      if (f.openings[id]) ed.patchOpening(id, { status });
      if (f.items[id]) ed.patchItem(id, { status });
    }
    return ed.floor;
  });
}

export function setFlag(ids: Id[], flag: 'hidden' | 'locked', value: boolean): boolean {
  return floorEdit(value ? (flag === 'hidden' ? 'Hide' : 'Lock') : flag === 'hidden' ? 'Show' : 'Unlock', (f) => {
    const ed = new FloorEditor(f);
    for (const id of ids) {
      if (f.walls[id]) ed.patchWall(id, { [flag]: value });
      if (f.openings[id]) ed.patchOpening(id, { [flag]: value });
      if (f.items[id]) ed.patchItem(id, { [flag]: value });
      if (f.annotations[id]) ed.patchAnnotation(id, { [flag]: value });
    }
    return ed.floor;
  });
}

export function showAllHidden(): boolean {
  return floorEdit('Show all', (f) => {
    const ed = new FloorEditor(f);
    for (const w of Object.values(f.walls)) if (w.hidden) ed.patchWall(w.id, { hidden: false });
    for (const o of Object.values(f.openings)) if (o.hidden) ed.patchOpening(o.id, { hidden: false });
    for (const it of Object.values(f.items)) if (it.hidden) ed.patchItem(it.id, { hidden: false });
    return ed.floor;
  });
}

/** Moves the selection by a delta (walls translate rigidly; items/notes move). */
export function translateSelection(ids: Id[], delta: Vec2, opts: EditOptions = {}, label = 'Move'): boolean {
  return floorEdit(label, (f) => {
    const c = classify(f, ids);
    let out = c.walls.length ? translateWalls(f, c.walls.filter((id) => !f.walls[id].locked && !f.walls[id].locks.position), delta) : f;
    const ed = new FloorEditor(out);
    for (const id of c.items) {
      const it = f.items[id];
      if (!it.locked) ed.patchItem(id, { x: it.x + delta.x, y: it.y + delta.y });
    }
    for (const id of c.notes) {
      const n = f.annotations[id];
      ed.patchAnnotation(id, { x: n.x + delta.x, y: n.y + delta.y });
    }
    for (const id of c.dims) {
      const d = f.dimensions[id];
      ed.patchDimension(id, { a: add(d.a, delta), b: add(d.b, delta) });
    }
    out = ed.floor;
    return out;
  }, { pinned: pinnedNodesFor(ids), ...opts });
}

export function pinnedNodesFor(ids: Id[]): Id[] {
  const f = getActiveFloor();
  if (!f) return [];
  return ids.flatMap((id) => (f.walls[id] ? [f.walls[id].a, f.walls[id].b] : []));
}

// ── Clipboard ────────────────────────────────────────────────────────────

interface Clipboard {
  walls: Wall[];
  nodes: Floor['nodes'];
  openings: Opening[];
  items: Item[];
}
let clipboard: Clipboard | null = null;
let pasteCount = 0;

export function copySelection(): void {
  const f = getActiveFloor();
  if (!f) return;
  const c = classify(f, ui().selection);
  const walls = c.walls.map((id) => f.walls[id]);
  const nodes: Floor['nodes'] = {};
  for (const w of walls) {
    nodes[w.a] = f.nodes[w.a];
    nodes[w.b] = f.nodes[w.b];
  }
  clipboard = {
    walls,
    nodes,
    openings: Object.values(f.openings).filter((o) => c.walls.includes(o.wallId)),
    items: c.items.map((id) => f.items[id]),
  };
  pasteCount = 0;
  if (walls.length + clipboard.items.length) toast(`Copied ${walls.length + clipboard.items.length} element${walls.length + clipboard.items.length === 1 ? '' : 's'}`, 'info', undefined, 1600);
}

export function pasteClipboard(): void {
  if (!clipboard) return;
  pasteCount++;
  const delta = { x: 304.8 * pasteCount, y: 304.8 * pasteCount };
  const created: Id[] = [];
  const status = newElementStatus();
  const clip = clipboard;
  floorEdit('Paste', (f) => {
    const ed = new FloorEditor(f);
    const nodeMap = new Map<Id, Id>();
    for (const [id, n] of Object.entries(clip.nodes)) nodeMap.set(id, ed.addNode(n.x + delta.x, n.y + delta.y).id);
    const wallMap = new Map<Id, Id>();
    for (const w of clip.walls) {
      const nw: Wall = { ...w, id: newId('wall'), a: nodeMap.get(w.a)!, b: nodeMap.get(w.b)!, status };
      ed.putWall(nw);
      wallMap.set(w.id, nw.id);
      created.push(nw.id);
    }
    for (const o of clip.openings) ed.putOpening({ ...o, id: newId(o.type), wallId: wallMap.get(o.wallId)!, status });
    for (const it of clip.items) {
      const ni: Item = { ...it, id: newId('item'), x: it.x + delta.x, y: it.y + delta.y, status };
      ed.putItem(ni);
      created.push(ni.id);
    }
    return ed.floor;
  });
  select(created);
}

export function duplicateSelection(): void {
  const f = getActiveFloor();
  if (!f) return;
  const c = classify(f, ui().selection);
  const created: Id[] = [];
  const delta = { x: 304.8, y: 304.8 };
  floorEdit('Duplicate', (fl) => {
    const d = duplicateWalls(fl, c.walls, delta);
    created.push(...d.wallIds);
    const ed = new FloorEditor(d.floor);
    for (const id of c.items) {
      const it = fl.items[id];
      const ni: Item = { ...it, id: newId('item'), x: it.x + delta.x, y: it.y + delta.y, status: newElementStatus() };
      ed.putItem(ni);
      created.push(ni.id);
    }
    return ed.floor;
  });
  if (created.length) select(created);
}

// ── Project settings ─────────────────────────────────────────────────────

export function updateSettings(patch: Partial<ProjectDoc['settings']>, label = 'Change settings'): void {
  editDoc(label, (d) => ({ ...d, settings: { ...d.settings, ...patch } }));
}

export function renameProject(name: string): void {
  editDoc('Rename project', (d) => ({ ...d, name }));
}

// ── Variants ─────────────────────────────────────────────────────────────

const OPTION_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function createVariant(name?: string, fromId?: Id): Id | null {
  const doc = getDoc();
  if (!doc) return null;
  const source = doc.variants[fromId ?? documentStore.getState().variantId] ?? doc.variants[doc.baseVariantId];
  const used = new Set(Object.values(doc.variants).map((v) => v.name));
  let label = name;
  if (!label) {
    for (const ch of OPTION_LETTERS) {
      if (!used.has(`Option ${ch}`)) {
        label = `Option ${ch}`;
        break;
      }
    }
  }
  const variant = cloneVariantAsOption(source, label ?? `Option ${doc.variantOrder.length}`);
  editDoc('Create design option', (d) => ({
    ...d,
    variants: { ...d.variants, [variant.id]: variant },
    variantOrder: [...d.variantOrder, variant.id],
  }));
  setActiveVariant(variant.id);
  clearSelection();
  toast(`${variant.name} created from ${source.name}. The measured plan stays untouched.`, 'success');
  return variant.id;
}

export function renameVariant(id: Id, name: string): void {
  editDoc('Rename option', (d) => ({ ...d, variants: { ...d.variants, [id]: { ...d.variants[id], name } } }));
}

export function deleteVariant(id: Id): void {
  const doc = getDoc();
  if (!doc || id === doc.baseVariantId) return;
  const wasActive = documentStore.getState().variantId === id;
  editDoc('Delete option', (d) => {
    const variants = { ...d.variants };
    delete variants[id];
    return { ...d, variants, variantOrder: d.variantOrder.filter((v) => v !== id) };
  });
  if (wasActive) setActiveVariant(doc.baseVariantId);
}

/** Replaces the base measured plan with an option's geometry (explicit, undoable). */
export function promoteVariantToBase(id: Id): void {
  const doc = getDoc();
  if (!doc) return;
  const v = doc.variants[id];
  editDoc('Restore option into measured plan', (d) => ({
    ...d,
    variants: { ...d.variants, [d.baseVariantId]: { ...d.variants[d.baseVariantId], floors: structuredClone(v.floors), floorOrder: [...v.floorOrder], updatedAt: Date.now() } },
  }));
}

export function setBaseLocked(locked: boolean): void {
  editDoc(locked ? 'Lock measured plan' : 'Unlock measured plan', (d) => ({ ...d, baseLocked: locked }));
}

export function setViewTool(): void {
  setUi({ tool: 'select' });
}
