import { newId } from './ids';
import type { Annotation, Constraint, DimensionLine, Floor, Id, Item, Opening, Room, Wall, WallNode } from './types';

type Rec<T> = Record<Id, T>;

/**
 * Stored coordinates are quantized to 1 nanometer (1e-6 mm). This is far
 * below any physical tolerance, but it snaps away float noise such as
 * 3962.3999999999996 vs 3962.4, so walls that should be exactly vertical or
 * horizontal stay exactly so and repeated edits never accumulate drift.
 */
export const COORD_QUANTUM = 1e-6;
export const q = (v: number): number => Math.round(v / COORD_QUANTUM) * COORD_QUANTUM;
const qq = (v: number): number => {
  const r = q(v);
  // Re-parse to get the shortest decimal double (e.g. 3962.4, not 3962.4000000000005).
  return Number(r.toFixed(6));
};

/**
 * Copy-on-write helper for producing a new immutable Floor. Each record map is
 * shallow-copied the first time it is written; untouched elements keep their
 * object identity so renderers can diff cheaply by reference.
 */
export class FloorEditor {
  private readonly base: Floor;
  private copies: Partial<Record<keyof Floor, Rec<unknown>>> = {};
  private extra: Partial<Floor> = {};

  constructor(base: Floor) {
    this.base = base;
  }

  private rec<K extends 'nodes' | 'walls' | 'openings' | 'items' | 'rooms' | 'annotations' | 'dimensions' | 'constraints'>(
    key: K,
    write: boolean,
  ): Floor[K] {
    if (!write) return (this.copies[key] as Floor[K]) ?? this.base[key];
    if (!this.copies[key]) this.copies[key] = { ...this.base[key] } as Rec<unknown>;
    return this.copies[key] as Floor[K];
  }

  get nodes(): Readonly<Rec<WallNode>> {
    return this.rec('nodes', false);
  }
  get walls(): Readonly<Rec<Wall>> {
    return this.rec('walls', false);
  }
  get openings(): Readonly<Rec<Opening>> {
    return this.rec('openings', false);
  }
  get items(): Readonly<Rec<Item>> {
    return this.rec('items', false);
  }
  get rooms(): Readonly<Rec<Room>> {
    return this.rec('rooms', false);
  }
  get annotations(): Readonly<Rec<Annotation>> {
    return this.rec('annotations', false);
  }
  get dimensions(): Readonly<Rec<DimensionLine>> {
    return this.rec('dimensions', false);
  }
  get constraints(): Readonly<Rec<Constraint>> {
    return this.rec('constraints', false);
  }

  /** A snapshot of the current state (cheap; shares element objects). */
  get floor(): Floor {
    return {
      ...this.base,
      ...this.extra,
      nodes: this.nodes,
      walls: this.walls,
      openings: this.openings,
      items: this.items,
      rooms: this.rooms,
      annotations: this.annotations,
      dimensions: this.dimensions,
      constraints: this.constraints,
    };
  }

  setFloorProps(patch: Partial<Pick<Floor, 'name' | 'elevation' | 'defaultWallHeight' | 'defaultWallThickness' | 'underlay'>>): void {
    this.extra = { ...this.extra, ...patch };
  }

  addNode(x: number, y: number, id = newId('node')): WallNode {
    const node: WallNode = { id, x: qq(x), y: qq(y) };
    this.rec('nodes', true)[id] = node;
    return node;
  }

  setNode(id: Id, x: number, y: number): void {
    const n = this.nodes[id];
    x = qq(x);
    y = qq(y);
    if (!n || (n.x === x && n.y === y)) return;
    this.rec('nodes', true)[id] = { ...n, x, y };
  }

  patchNode(id: Id, patch: Partial<WallNode>): void {
    const n = this.nodes[id];
    if (n) this.rec('nodes', true)[id] = { ...n, ...patch, id };
  }

  removeNode(id: Id): void {
    if (this.nodes[id]) delete this.rec('nodes', true)[id];
  }

  putWall(wall: Wall): void {
    this.rec('walls', true)[wall.id] = wall;
  }
  patchWall(id: Id, patch: Partial<Wall>): void {
    const w = this.walls[id];
    if (w) this.rec('walls', true)[id] = { ...w, ...patch, id };
  }
  removeWall(id: Id): void {
    if (this.walls[id]) delete this.rec('walls', true)[id];
  }

  putOpening(o: Opening): void {
    this.rec('openings', true)[o.id] = o;
  }
  patchOpening(id: Id, patch: Partial<Opening>): void {
    const o = this.openings[id];
    if (o) this.rec('openings', true)[id] = { ...o, ...patch, id };
  }
  removeOpening(id: Id): void {
    if (this.openings[id]) delete this.rec('openings', true)[id];
  }

  putItem(item: Item): void {
    this.rec('items', true)[item.id] = item;
  }
  patchItem(id: Id, patch: Partial<Item>): void {
    const it = this.items[id];
    if (it) this.rec('items', true)[id] = { ...it, ...patch, id };
  }
  removeItem(id: Id): void {
    if (this.items[id]) delete this.rec('items', true)[id];
  }

  setRooms(rooms: Rec<Room>): void {
    if (rooms === this.rooms) return;
    this.copies.rooms = rooms as Rec<unknown>;
  }
  patchRoom(id: Id, patch: Partial<Room>): void {
    const r = this.rooms[id];
    if (r) this.rec('rooms', true)[id] = { ...r, ...patch, id };
  }

  putAnnotation(a: Annotation): void {
    this.rec('annotations', true)[a.id] = a;
  }
  patchAnnotation(id: Id, patch: Partial<Annotation>): void {
    const a = this.annotations[id];
    if (a) this.rec('annotations', true)[id] = { ...a, ...patch, id };
  }
  removeAnnotation(id: Id): void {
    if (this.annotations[id]) delete this.rec('annotations', true)[id];
  }

  putDimension(d: DimensionLine): void {
    this.rec('dimensions', true)[d.id] = d;
  }
  patchDimension(id: Id, patch: Partial<DimensionLine>): void {
    const d = this.dimensions[id];
    if (d) this.rec('dimensions', true)[id] = { ...d, ...patch, id };
  }
  removeDimension(id: Id): void {
    if (this.dimensions[id]) delete this.rec('dimensions', true)[id];
  }

  putConstraint(c: Constraint): void {
    this.rec('constraints', true)[c.id] = c;
  }
  removeConstraint(id: Id): void {
    if (this.constraints[id]) delete this.rec('constraints', true)[id];
  }

  /** Walls attached to a node. */
  wallsAtNode(nodeId: Id): Wall[] {
    return Object.values(this.walls).filter((w) => w.a === nodeId || w.b === nodeId);
  }

  openingsOnWall(wallId: Id): Opening[] {
    return Object.values(this.openings).filter((o) => o.wallId === wallId);
  }
}
