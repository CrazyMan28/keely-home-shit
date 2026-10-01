import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createProject } from '../model/factory';
import { DEFAULT_MATERIALS, defaultMaterialRecord, TRIM_MATERIAL } from '../model/materials';
import { migrate } from '../persistence/fileFormat';
import { createOpening } from '../geometry/openings/openings';
import { computeWallGeometry } from '../geometry/walls/wallGeometry';
import { buildOpening, buildWall } from '../editor/3d/builders';
import { roomFloor, ft } from './helpers';

describe('gray finishes and white trim', () => {
  it('ships light/dark gray laminate, medium/dark gray paint and white trim', () => {
    const byId = Object.fromEntries(DEFAULT_MATERIALS.map((m) => [m.id, m]));
    expect(byId['mat-floor-laminate-light-gray'].category).toBe('floor');
    expect(byId['mat-floor-laminate-dark-gray'].category).toBe('floor');
    expect(byId['mat-paint-gray-medium'].category).toBe('wall');
    expect(byId['mat-paint-gray-dark'].category).toBe('wall');
    expect(byId[TRIM_MATERIAL].category).toBe('trim');
  });

  it('adds the new materials to projects saved before they existed', () => {
    const doc = createProject('Old');
    const old = { ...doc, materials: { 'mat-paint-white': defaultMaterialRecord()['mat-paint-white'] } };
    const migrated = migrate(old);
    expect(migrated.materials['mat-floor-laminate-dark-gray']).toBeDefined();
    expect(migrated.materials[TRIM_MATERIAL]).toBeDefined();
  });
});

describe('baseboards and casing', () => {
  const { floor, wallIds } = roomFloor(ft(12), ft(10));
  const geo = computeWallGeometry(floor);
  const mats = defaultMaterialRecord();
  const wallId = wallIds[0];
  const wall = floor.walls[wallId];
  const fp = geo.footprints.get(wallId)!;
  const trimmed = (g: THREE.Group) => g.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.BoxGeometry);

  it('puts a baseboard on each requested face', () => {
    expect(trimmed(buildWall(wall, fp, [], mats, 'normal', { left: true, right: true }))).toHaveLength(2);
    expect(trimmed(buildWall(wall, fp, [], mats, 'normal', { left: true, right: false }))).toHaveLength(1);
    expect(trimmed(buildWall(wall, fp, [], mats, 'normal', { left: false, right: false }))).toHaveLength(0);
  });

  it('breaks the baseboard at a doorway but runs it under a window', () => {
    const door = createOpening('door', wallId, ft(4), 'existing');
    const win = createOpening('window', wallId, ft(4), 'existing');
    expect(trimmed(buildWall(wall, fp, [door], mats, 'normal', { left: true, right: false }))).toHaveLength(2);
    expect(trimmed(buildWall(wall, fp, [win], mats, 'normal', { left: true, right: false }))).toHaveLength(1);
  });

  it('casing is white trim on both faces of a window', () => {
    const win = createOpening('window', wallId, ft(4), 'existing');
    const g = buildOpening(win, fp, wall.thickness, mats, 'normal');
    const zs = new Set<number>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.position.z !== 0 && (m.geometry as THREE.BoxGeometry).parameters?.depth === 0.016) zs.add(Math.sign(m.position.z));
    });
    expect([...zs].sort()).toEqual([-1, 1]);
  });
});
