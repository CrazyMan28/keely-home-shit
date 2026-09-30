import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../model/factory';
import {
  beginTransaction,
  cancelTransaction,
  commitTransaction,
  documentStore,
  editFloor,
  getActiveFloor,
  loadDocument,
  redo,
  undo,
} from '../state/documentStore';
import { addWallChain, moveWallPerpendicular, resizeWall } from '../geometry/walls/wallOps';
import { parseProjectFile, ProjectFileError, serializeProject } from '../persistence/fileFormat';
import { IndexedDbRepository } from '../persistence/repository';
import { WALL, ft, rect, wallLen, wallNear } from './helpers';

function drawRoom() {
  let ids: string[] = [];
  editFloor('Draw room', (f) => {
    const r = addWallChain(f, rect(ft(12), ft(10)), WALL, { closed: true });
    ids = r.wallIds;
    return r.floor;
  });
  return ids;
}

describe('history', () => {
  beforeEach(() => loadDocument(createProject('Test')));

  it('undo/redo across several edits', () => {
    drawRoom();
    const f1 = getActiveFloor()!;
    const north = wallNear(f1, { x: ft(6), y: 0 });
    editFloor('Resize', (f) => resizeWall(f, north, ft(14)).floor);
    editFloor('Move', (f) => moveWallPerpendicular(f, north, -ft(1)));
    expect(documentStore.getState().past.map((e) => e.label)).toEqual(['Draw room', 'Resize', 'Move']);
    undo();
    undo();
    expect(wallLen(getActiveFloor()!, north)).toBeCloseTo(ft(12), 9);
    redo();
    expect(wallLen(getActiveFloor()!, north)).toBeCloseTo(ft(14), 9);
    undo();
    undo();
    expect(Object.keys(getActiveFloor()!.walls)).toHaveLength(0);
    redo();
    redo();
    redo();
    expect(getActiveFloor()!.walls[north]).toBeDefined();
    expect(documentStore.getState().future).toHaveLength(0);
  });

  it('a new edit clears the redo stack', () => {
    drawRoom();
    undo();
    expect(documentStore.getState().future).toHaveLength(1);
    drawRoom();
    expect(documentStore.getState().future).toHaveLength(0);
  });

  it('transactions collapse a drag into one undo step and can be cancelled', () => {
    drawRoom();
    const north = wallNear(getActiveFloor()!, { x: ft(6), y: 0 });
    beginTransaction('Drag wall');
    for (let i = 1; i <= 10; i++) editFloor('Drag wall', (f) => moveWallPerpendicular(f, north, -10), { transient: true });
    commitTransaction();
    expect(documentStore.getState().past).toHaveLength(2);
    undo();
    const w = getActiveFloor()!.walls[north];
    expect(getActiveFloor()!.nodes[w.a].y).toBe(0);

    beginTransaction('Drag wall');
    editFloor('Drag wall', (f) => moveWallPerpendicular(f, north, -500), { transient: true });
    cancelTransaction();
    expect(getActiveFloor()!.nodes[w.a].y).toBe(0);
  });

  it('the locked base plan rejects edits', () => {
    const doc = createProject('Locked');
    loadDocument({ ...doc, baseLocked: true });
    const r = editFloor('Draw', (f) => addWallChain(f, rect(1000, 1000), WALL, { closed: true }).floor);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('base-locked');
  });
});

describe('project file', () => {
  it('round-trips exactly', () => {
    loadDocument(createProject('Round Trip'));
    drawRoom();
    const doc = documentStore.getState().doc!;
    const back = parseProjectFile(serializeProject(doc)).doc;
    expect(back).toEqual(doc);
  });

  it('rejects malformed files with a clear message', () => {
    expect(() => parseProjectFile('nope')).toThrow(ProjectFileError);
    expect(() => parseProjectFile('{"format":"house-project","version":99,"project":{}}')).toThrow(/newer version/);
    expect(() => parseProjectFile('{"foo":1}')).toThrow(/not a house project/);
  });
});

describe('IndexedDB repository', () => {
  it('saves, lists and reloads projects', async () => {
    const repo = new IndexedDbRepository(`test-${Math.random()}`);
    loadDocument(createProject('Sister’s House'));
    drawRoom();
    const doc = documentStore.getState().doc!;
    await repo.save(doc, 'data:thumb');
    const list = await repo.list();
    expect(list[0]).toMatchObject({ name: 'Sister’s House', variants: 1, floors: 1, walls: 4, thumbnail: 'data:thumb' });
    expect(await repo.load(doc.id)).toEqual(doc);
    await repo.remove(doc.id);
    expect(await repo.list()).toHaveLength(0);
  });
});
