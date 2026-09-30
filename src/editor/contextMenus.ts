import type { Vec2 } from '../geometry/primitives/vec';
import type { Id } from '../model/types';
import {
  convertWallType,
  copySelection,
  deleteSelection,
  duplicateSelection,
  flipDoor,
  mergeSelectedWalls,
  pasteClipboard,
  rotateItems,
  setFlag,
  setStatus,
  showAllHidden,
  splitWall,
  toggleWallLock,
} from '../state/actions';
import { getActiveFloor } from '../state/documentStore';
import { setTool, setUi, ui, type ContextMenuItem } from '../state/uiStore';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

function openInspector(focus?: string) {
  setUi({ rightPanel: 'inspector', rightPanelOpen: true, contextMenu: null });
  if (focus) requestAnimationFrame(() => (document.querySelector(`[data-focus="${focus}"]`) as HTMLInputElement | null)?.select());
}

/** Builds the right-click menu for an element (or empty canvas). */
export function contextMenuFor(id: Id | null, world: Vec2 | null, _surface: 'plan' | '3d'): ContextMenuItem[] {
  const floor = getActiveFloor();
  if (!floor) return [];
  const sel = ui().selection;
  const sep: ContextMenuItem = { label: '', separator: true };

  if (!id) {
    return [
      { label: 'Paste', shortcut: `${mod}V`, run: pasteClipboard },
      { label: 'Draw walls', shortcut: 'W', run: () => setTool('wall') },
      { label: 'Draw room', shortcut: 'R', run: () => setTool('room') },
      { label: 'Add note', run: () => setTool('text') },
      sep,
      { label: 'Show all hidden', run: showAllHidden },
    ];
  }

  const w = floor.walls[id];
  if (w) {
    const multiWalls = sel.filter((s) => floor.walls[s]).length === 2;
    return [
      { label: 'Edit dimensions', run: () => openInspector('wall-length') },
      { label: 'Split wall', run: () => splitWall(id, world ?? undefined) },
      ...(multiWalls ? [{ label: 'Merge walls', run: mergeSelectedWalls }] : []),
      { label: 'Add door', shortcut: 'D', run: () => setTool('door') },
      { label: 'Add window', shortcut: 'N', run: () => setTool('window') },
      sep,
      { label: 'Duplicate', shortcut: `${mod}D`, run: duplicateSelection },
      { label: 'Copy', shortcut: `${mod}C`, run: copySelection },
      { label: w.locks.length ? 'Unlock length' : 'Lock length', run: () => toggleWallLock(id, 'length') },
      { label: w.locks.position ? 'Unlock position' : 'Lock position', run: () => toggleWallLock(id, 'position') },
      { label: w.wallType === 'exterior' ? 'Convert to interior' : 'Convert to exterior', run: () => convertWallType(id, w.wallType === 'exterior' ? 'interior' : 'exterior') },
      { label: 'Hide', run: () => setFlag(sel, 'hidden', true) },
      sep,
      ...(w.status === 'demolish'
        ? [{ label: 'Keep (undo demolish)', run: () => setStatus(sel, 'existing') }]
        : [{ label: 'Demolish', danger: true, run: () => setStatus(sel, 'demolish') }]),
      { label: 'Delete', shortcut: '⌫', danger: true, run: () => deleteSelection() },
    ];
  }

  const o = floor.openings[id];
  if (o) {
    return [
      { label: 'Edit size & position', run: () => openInspector('opening-width') },
      ...(o.door
        ? [
            { label: 'Flip hinge side', run: () => flipDoor(id, 'hinge') },
            { label: 'Flip swing direction', run: () => flipDoor(id, 'swing') },
          ]
        : []),
      sep,
      o.status === 'demolish' ? { label: 'Keep (undo demolish)', run: () => setStatus([id], 'existing') } : { label: 'Demolish', danger: true, run: () => setStatus([id], 'demolish') },
      { label: 'Delete', shortcut: '⌫', danger: true, run: () => deleteSelection([id]) },
    ];
  }

  const it = floor.items[id];
  if (it) {
    return [
      { label: 'Exact dimensions', run: () => openInspector('item-width') },
      { label: 'Distance to wall', run: () => openInspector('item-distance') },
      { label: 'Rotate 90°', shortcut: 'R', run: () => rotateItems(sel.length ? sel : [id], 90) },
      { label: 'Duplicate', shortcut: `${mod}D`, run: duplicateSelection },
      { label: 'Copy', shortcut: `${mod}C`, run: copySelection },
      { label: it.locked ? 'Unlock' : 'Lock', run: () => setFlag([id], 'locked', !it.locked) },
      { label: 'Hide', run: () => setFlag(sel.length ? sel : [id], 'hidden', true) },
      sep,
      it.status === 'demolish' ? { label: 'Keep (undo remove)', run: () => setStatus([id], 'existing') } : { label: 'Delete', shortcut: '⌫', danger: true, run: () => deleteSelection() },
    ];
  }

  const room = floor.rooms[id];
  if (room) {
    return [
      { label: 'Rename room', run: () => openInspector('room-name') },
      { label: 'Change floor finish', run: () => openInspector('room-floor') },
    ];
  }

  if (floor.annotations[id] || floor.dimensions[id]) {
    return [
      ...(floor.annotations[id] ? [{ label: 'Edit text', run: () => openInspector('note-text') }] : []),
      { label: 'Delete', shortcut: '⌫', danger: true, run: () => deleteSelection([id]) },
    ];
  }
  return [];
}
