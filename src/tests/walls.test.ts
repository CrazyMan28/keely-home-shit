import { describe, expect, it } from 'vitest';
import { addWallChain, deleteWalls, mergeWalls, moveWallPerpendicular, resizeWall, reverseWall, setWallAngle, splitWallAt } from '../geometry/walls/wallOps';
import { computeWallGeometry, faceLength, wallAngleDeg } from '../geometry/walls/wallGeometry';
import { FloorEditor } from '../model/floorEditor';
import { createFloor } from '../model/factory';
import { createOpening } from '../geometry/openings/openings';
import { finalizeFloor } from '../model/pipeline';
import { detectFaces } from '../geometry/rooms/roomDetection';
import { WALL, ft, rect, roomFloor, wallLen, wallNear } from './helpers';

describe('wall creation', () => {
  it('creates a closed chain sharing junction nodes', () => {
    const { floor, wallIds } = roomFloor(ft(15, 2), ft(11, 6));
    expect(wallIds).toHaveLength(4);
    expect(Object.keys(floor.nodes)).toHaveLength(4);
    const lengths = wallIds.map((id) => wallLen(floor, id)).sort((a, b) => a - b);
    expect(lengths[0]).toBeCloseTo(ft(11, 6), 9);
    expect(lengths[3]).toBeCloseTo(ft(15, 2), 9);
  });

  it('T-junctions split the existing wall', () => {
    const { floor } = roomFloor(ft(20), ft(10));
    const r = addWallChain(floor, [{ x: ft(8), y: 0 }, { x: ft(8), y: ft(10) }], WALL);
    // North and south walls are split: 4 + 2 + 1 new wall = 7
    expect(Object.keys(r.floor.walls)).toHaveLength(7);
    expect(Object.keys(r.floor.nodes)).toHaveLength(6);
  });

  it('splits crossing walls at their intersection', () => {
    const f0 = addWallChain(createFloor(), [{ x: 0, y: 0 }, { x: 1000, y: 0 }], WALL).floor;
    const f1 = addWallChain(f0, [{ x: 500, y: -500 }, { x: 500, y: 500 }], WALL).floor;
    expect(Object.keys(f1.walls)).toHaveLength(4);
    const center = Object.values(f1.nodes).find((n) => n.x === 500 && n.y === 0);
    expect(center).toBeDefined();
  });

  it('adjacent rooms sharing an edge share one wall', () => {
    const f0 = addWallChain(createFloor(), rect(ft(10), ft(10)), WALL, { closed: true }).floor;
    // Second room shares the east wall but is taller (partial overlap).
    const f1 = addWallChain(f0, rect(ft(8), ft(14), { x: ft(10), y: -ft(2) }), WALL, { closed: true }).floor;
    const vertical = Object.values(f1.walls).filter((w) => f1.nodes[w.a].x === ft(10) && f1.nodes[w.b].x === ft(10));
    // x = 10' line: -2'..0, 0..10', 10'..12' — the 0..10' span exists exactly once.
    expect(vertical).toHaveLength(3);
    const faces = detectFaces(f1);
    expect(faces).toHaveLength(2);
  });

  it('identical coincident walls collapse', () => {
    const f0 = addWallChain(createFloor(), rect(ft(10), ft(10)), WALL, { closed: true }).floor;
    const f1 = addWallChain(f0, rect(ft(10), ft(10), { x: ft(10), y: 0 }), WALL, { closed: true }).floor;
    expect(Object.keys(f1.walls)).toHaveLength(7);
    expect(detectFaces(f1)).toHaveLength(2);
  });

  it('delete removes walls, their openings, and orphan nodes', () => {
    const { floor, wallIds } = roomFloor(ft(10), ft(10));
    const ed = new FloorEditor(floor);
    ed.putOpening(createOpening('door', wallIds[0], 300, 'existing'));
    const f = deleteWalls(ed.floor, [wallIds[0]]);
    expect(Object.keys(f.walls)).toHaveLength(3);
    expect(Object.keys(f.openings)).toHaveLength(0);
    expect(Object.keys(f.nodes)).toHaveLength(4);
    const f2 = deleteWalls(f, [wallIds[1]]);
    expect(Object.keys(f2.nodes)).toHaveLength(3);
  });
});

describe('resizeWall', () => {
  it('keeps a rectangle rectangular when lengthening (connected mode)', () => {
    const { floor } = roomFloor(ft(15, 2), ft(11, 6));
    const north = wallNear(floor, { x: ft(7), y: 0 });
    const r = resizeWall(floor, north, ft(15, 8), 'start');
    expect(wallLen(r.floor, north)).toBeCloseTo(ft(15, 8), 9);
    const south = wallNear(r.floor, { x: ft(7), y: ft(11, 6) });
    expect(wallLen(r.floor, south)).toBeCloseTo(ft(15, 8), 9);
    const east = wallNear(r.floor, { x: ft(15, 8), y: ft(5) });
    expect(wallLen(r.floor, east)).toBeCloseTo(ft(11, 6), 9);
    // East wall stays exactly vertical.
    const e = r.floor.walls[east];
    expect(r.floor.nodes[e.a].x).toBe(r.floor.nodes[e.b].x);
  });

  it('respects the anchor', () => {
    const { floor } = roomFloor(ft(10), ft(10));
    const north = wallNear(floor, { x: ft(5), y: 0 });
    const w = floor.walls[north];
    const a0 = floor.nodes[w.a];
    const b0 = floor.nodes[w.b];
    const endAnchored = resizeWall(floor, north, ft(12), 'end').floor;
    expect(endAnchored.nodes[w.b]).toEqual(b0);
    const centered = resizeWall(floor, north, ft(12), 'center').floor;
    const mid0 = (a0.x + b0.x) / 2;
    expect((centered.nodes[w.a].x + centered.nodes[w.b].x) / 2).toBeCloseTo(mid0, 9);
    expect(wallLen(centered, north)).toBeCloseTo(ft(12), 9);
  });

  it('local mode moves an interior partition, not the whole house', () => {
    const { floor } = roomFloor(ft(30), ft(10));
    const withPartition = addWallChain(floor, [{ x: ft(12), y: 0 }, { x: ft(12), y: ft(10) }], WALL).floor;
    // West room's north wall runs from x=0 to x=12'.
    const westNorth = wallNear(withPartition, { x: ft(6), y: 0 });
    const r = resizeWall(withPartition, westNorth, ft(13), 'start').floor;
    const partition = Object.values(r.walls).find((w) => {
      const a = r.nodes[w.a];
      const b = r.nodes[w.b];
      return a.x === b.x && a.x > ft(1) && a.x < ft(29);
    })!;
    expect(r.nodes[partition.a].x).toBeCloseTo(ft(13), 9);
    // Exterior east wall untouched.
    expect(Math.max(...Object.values(r.nodes).map((n) => n.x))).toBeCloseTo(ft(30), 9);
  });

  it('stretch mode shifts everything beyond the moving end', () => {
    const { floor } = roomFloor(ft(30), ft(10));
    const withPartition = addWallChain(floor, [{ x: ft(12), y: 0 }, { x: ft(12), y: ft(10) }], WALL).floor;
    const westNorth = wallNear(withPartition, { x: ft(6), y: 0 });
    const r = resizeWall(withPartition, westNorth, ft(13), 'start', 'stretch').floor;
    expect(Math.max(...Object.values(r.nodes).map((n) => n.x))).toBeCloseTo(ft(31), 9);
  });
});

describe('moveWallPerpendicular', () => {
  it('slides endpoints along connected walls, keeping them connected', () => {
    const { floor } = roomFloor(ft(10), ft(10));
    const north = wallNear(floor, { x: ft(5), y: 0 });
    // North wall runs west→east; its left normal points south (+y). Move north by 2'.
    const f = moveWallPerpendicular(floor, north, -ft(2));
    const w = f.walls[north];
    expect(f.nodes[w.a].y).toBeCloseTo(-ft(2), 9);
    expect(f.nodes[w.b].y).toBeCloseTo(-ft(2), 9);
    const west = wallNear(f, { x: 0, y: ft(4) });
    expect(wallLen(f, west)).toBeCloseTo(ft(12), 9);
  });
});

describe('split / merge / reverse', () => {
  it('split keeps total length and redistributes openings', () => {
    const { floor } = roomFloor(ft(20), ft(10));
    const north = wallNear(floor, { x: ft(10), y: 0 });
    const ed = new FloorEditor(floor);
    const door = createOpening('door', north, ft(15), 'existing');
    ed.putOpening(door);
    const s = splitWallAt(ed, north, { x: ft(8), y: 0 });
    const f = ed.floor;
    expect(wallLen(f, s.first) + wallLen(f, s.second)).toBeCloseTo(ft(20), 9);
    expect(f.openings[door.id].wallId).toBe(s.second);
    expect(f.openings[door.id].offset).toBeCloseTo(ft(7), 9);
  });

  it('merge undoes a split', () => {
    const { floor } = roomFloor(ft(20), ft(10));
    const north = wallNear(floor, { x: ft(10), y: 0 });
    const ed = new FloorEditor(floor);
    const door = createOpening('door', north, ft(15), 'existing');
    ed.putOpening(door);
    const s = splitWallAt(ed, north, { x: ft(8), y: 0 });
    const merged = mergeWalls(ed.floor, s.first, s.second)!;
    expect(merged).not.toBeNull();
    expect(Object.keys(merged.walls)).toHaveLength(4);
    expect(wallLen(merged, s.first)).toBeCloseTo(ft(20), 9);
    expect(merged.openings[door.id].offset).toBeCloseTo(ft(15), 9);
  });

  it('reverse keeps openings physically in place', () => {
    const { floor } = roomFloor(ft(20), ft(10));
    const north = wallNear(floor, { x: ft(10), y: 0 });
    const ed = new FloorEditor(floor);
    const door = createOpening('door', north, ft(2), 'existing', { width: ft(3) });
    ed.putOpening(door);
    const f = reverseWall(ed.floor, north);
    expect(f.openings[door.id].offset).toBeCloseTo(ft(15), 9);
    expect(f.openings[door.id].door!.hinge).toBe('end');
  });
});

describe('wall faces', () => {
  it('computes mitered interior faces', () => {
    const { floor } = roomFloor(ft(12), ft(10));
    const g = computeWallGeometry(floor);
    const north = wallNear(floor, { x: ft(6), y: 0 });
    const fp = g.footprints.get(north)!;
    const faces = [faceLength(fp, 'left'), faceLength(fp, 'right')].sort((a, b) => a - b);
    expect(faces[0]).toBeCloseTo(ft(12) - WALL.thickness, 6);
    expect(faces[1]).toBeCloseTo(ft(12) + WALL.thickness, 6);
  });

  it('T-junction produces a hub polygon', () => {
    const { floor } = roomFloor(ft(20), ft(10));
    const f = addWallChain(floor, [{ x: ft(8), y: 0 }, { x: ft(8), y: ft(10) }], WALL).floor;
    const g = computeWallGeometry(f);
    expect(g.junctions.length).toBe(2);
  });
});

describe('setWallAngle', () => {
  it('rotates exactly to axis angles', () => {
    const f0 = addWallChain(createFloor(), [{ x: 0, y: 0 }, { x: 1000, y: 100 }], WALL);
    const f = setWallAngle(f0.floor, f0.wallIds[0], 90);
    const w = f.walls[f0.wallIds[0]];
    expect(f.nodes[w.b].x).toBe(0);
    expect(wallAngleDeg(f, w)).toBe(90);
  });
});

describe('opening re-attachment', () => {
  it('doors stay physically in place when the wall grows from its far end', () => {
    const { floor } = roomFloor(ft(12), ft(10));
    const north = wallNear(floor, { x: ft(6), y: 0 });
    const ed = new FloorEditor(floor);
    const door = createOpening('door', north, ft(3), 'existing');
    ed.putOpening(door);
    const prev = ed.floor;
    const r = resizeWall(prev, north, ft(14), 'end');
    const fin = finalizeFloor(prev, r.floor).floor;
    // Wall start moved 2' west, so offset from start grows by 2'.
    expect(fin.openings[door.id].offset).toBeCloseTo(ft(5), 9);
  });

  it('openings are clamped when a wall shrinks', () => {
    const f0 = addWallChain(createFloor(), rect(ft(12), ft(10)), WALL, { closed: true });
    const north = wallNear(f0.floor, { x: ft(6), y: 0 });
    const ed = new FloorEditor(f0.floor);
    const door = createOpening('door', north, ft(9), 'existing', { width: ft(3) });
    ed.putOpening(door);
    const prev = ed.floor;
    const fin = finalizeFloor(prev, resizeWall(prev, north, ft(8), 'start').floor).floor;
    expect(fin.openings[door.id].offset).toBeCloseTo(ft(5), 9);
  });
});
