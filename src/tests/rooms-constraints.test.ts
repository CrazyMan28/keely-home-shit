import { describe, expect, it } from 'vitest';
import { detectFaces, syncRooms } from '../geometry/rooms/roomDetection';
import { solveConstraints } from '../geometry/constraints/solver';
import { addWallChain, moveNode, resizeWall } from '../geometry/walls/wallOps';
import { FloorEditor } from '../model/floorEditor';
import { finalizeFloor } from '../model/pipeline';
import { createFloor } from '../model/factory';
import { MM2_PER_FT2 } from '../geometry/measurement/units';
import { WALL, ft, roomFloor, wallLen, wallNear } from './helpers';

describe('room detection', () => {
  it('detects a rectangle and computes finished interior area', () => {
    const { floor } = roomFloor(ft(12), ft(10));
    const faces = detectFaces(floor);
    expect(faces).toHaveLength(1);
    const t = WALL.thickness;
    expect(faces[0].area).toBeCloseTo((ft(12) - t) * (ft(10) - t), 3);
  });

  it('detects two rooms after a partition and ignores dangling walls', () => {
    const { floor } = roomFloor(ft(20), ft(10));
    let f = addWallChain(floor, [{ x: ft(8), y: 0 }, { x: ft(8), y: ft(10) }], WALL).floor;
    f = addWallChain(f, [{ x: ft(14), y: 0 }, { x: ft(14), y: ft(4) }], WALL).floor; // stub wall
    const faces = detectFaces(f);
    expect(faces).toHaveLength(2);
  });

  it('detects L-shaped (non-rectangular) rooms', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: ft(20), y: 0 },
      { x: ft(20), y: ft(8) },
      { x: ft(12), y: ft(8) },
      { x: ft(12), y: ft(16) },
      { x: 0, y: ft(16) },
    ];
    const f = addWallChain(createFloor(), pts, WALL, { closed: true }).floor;
    const faces = detectFaces(f);
    expect(faces).toHaveLength(1);
    const centerArea = (ft(20) * ft(8) + ft(12) * ft(8)) / MM2_PER_FT2;
    expect(faces[0].area / MM2_PER_FT2).toBeLessThan(centerArea);
    expect(faces[0].area / MM2_PER_FT2).toBeGreaterThan(centerArea - 20);
  });

  it('preserves room names across edits', () => {
    const { floor } = roomFloor(ft(12), ft(10));
    const ed = new FloorEditor(floor);
    ed.setRooms(syncRooms(floor));
    const roomId = Object.keys(ed.rooms)[0];
    ed.patchRoom(roomId, { name: 'Kitchen' });
    const named = ed.floor;
    const north = wallNear(named, { x: ft(6), y: 0 });
    const fin = finalizeFloor(named, resizeWall(named, north, ft(14)).floor).floor;
    expect(Object.values(fin.rooms).map((r) => r.name)).toEqual(['Kitchen']);
  });

  it('room area updates immediately with geometry', () => {
    const { floor } = roomFloor(ft(12), ft(10));
    const north = wallNear(floor, { x: ft(6), y: 0 });
    const a0 = detectFaces(floor)[0].area;
    const a1 = detectFaces(resizeWall(floor, north, ft(15)).floor)[0].area;
    expect(a1).toBeGreaterThan(a0);
  });
});

describe('constraint solver', () => {
  it('keeps a locked wall length when a neighbor node is dragged', () => {
    const { floor } = roomFloor(ft(10), ft(10));
    const north = wallNear(floor, { x: ft(5), y: 0 });
    const ed = new FloorEditor(floor);
    ed.patchWall(north, { locks: { length: true, angle: false, position: false }, lockedLength: ft(10) });
    const locked = ed.floor;
    const w = locked.walls[north];
    // Drag the east end further east — lock must win.
    const dragged = moveNode(locked, w.b, { x: ft(12), y: 0 });
    const res = solveConstraints(dragged, [w.b]);
    expect(res.ok).toBe(true);
    expect(wallLen(res.floor, north)).toBeCloseTo(ft(10), 1);
    // The dragged corner stays under the cursor; the free end follows.
    expect(res.overrodePins).toBe(false);
    expect(res.floor.nodes[w.a].x).toBeCloseTo(ft(2), 1);
  });

  it('releases the dragged node when the lock cannot otherwise hold', () => {
    const { floor } = roomFloor(ft(10), ft(10));
    const north = wallNear(floor, { x: ft(5), y: 0 });
    const ed = new FloorEditor(floor);
    const w = floor.walls[north];
    ed.patchNode(w.a, { fixed: true });
    ed.patchWall(north, { locks: { length: true, angle: false, position: false }, lockedLength: ft(10) });
    const res = solveConstraints(moveNode(ed.floor, w.b, { x: ft(12), y: 0 }), [w.b]);
    expect(res.ok).toBe(true);
    expect(res.overrodePins).toBe(true);
    expect(wallLen(res.floor, north)).toBeCloseTo(ft(10), 1);
  });

  it('reports over-constrained geometry instead of distorting it', () => {
    const { floor } = roomFloor(ft(10), ft(10));
    const ed = new FloorEditor(floor);
    for (const w of Object.values(floor.walls)) ed.patchWall(w.id, { locks: { length: true, angle: true, position: false }, lockedLength: wallLen(floor, w.id), lockedAngle: undefined });
    // Pin every node, then demand the north wall be 11'.
    for (const n of Object.keys(floor.nodes)) ed.patchNode(n, { fixed: true });
    const north = wallNear(floor, { x: ft(5), y: 0 });
    ed.patchWall(north, { lockedLength: ft(11) });
    const res = solveConstraints(ed.floor);
    expect(res.ok).toBe(false);
    expect(res.violations[0].label).toMatch(/Locked length/);
    expect(res.violations[0].residual).toBeCloseTo(ft(1), 0);
  });

  it('solves horizontal / perpendicular constraints to tolerance', () => {
    const f0 = addWallChain(createFloor(), [{ x: 0, y: 0 }, { x: 3000, y: 40 }, { x: 3050, y: 2000 }], WALL);
    const ed = new FloorEditor(f0.floor);
    const [w1, w2] = f0.wallIds;
    ed.putConstraint({ id: 'c1', kind: 'constraint', type: 'horizontal', refs: [w1], enabled: true });
    ed.putConstraint({ id: 'c2', kind: 'constraint', type: 'perpendicular', refs: [w1, w2], enabled: true });
    const res = solveConstraints(ed.floor);
    expect(res.ok).toBe(true);
    const f = res.floor;
    const a = f.nodes[f.walls[w1].a];
    const b = f.nodes[f.walls[w1].b];
    expect(Math.abs(a.y - b.y)).toBeLessThan(0.01);
    const c = f.nodes[f.walls[w2].b];
    expect(Math.abs(c.x - b.x)).toBeLessThan(0.05);
  });
});
