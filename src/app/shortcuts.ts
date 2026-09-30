import { editors } from '../editor/registry';
import { saveNow } from '../persistence/autosave';
import { copySelection, deleteSelection, duplicateSelection, pasteClipboard, rotateItems } from '../state/actions';
import { getActiveFloor, redo, undo } from '../state/documentStore';
import { select, setTool, setUi, toast, ui, type Tool } from '../state/uiStore';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

export const SHORTCUTS: Array<[string, string]> = [
  ['Select', 'V'],
  ['Pan', 'H / hold Space'],
  ['Wall', 'W'],
  ['Room (rectangle)', 'R'],
  ['Door', 'D'],
  ['Window', 'N'],
  ['Opening', 'O'],
  ['Furniture library', 'F'],
  ['Dimension', 'Shift D'],
  ['Measure', 'M'],
  ['Note', 'T'],
  ['2D / Split / 3D', '1 / 2 / 3'],
  ['Zoom to fit', 'Shift 1'],
  ['Undo', `${MOD} Z`],
  ['Redo', `${MOD} Shift Z`],
  ['Copy / Paste', `${MOD} C / ${MOD} V`],
  ['Duplicate', `${MOD} D`],
  ['Select all', `${MOD} A`],
  ['Delete', 'Delete / ⌫'],
  ['Rotate item 90°', 'R (with item selected)'],
  ['Nudge 1" (1\')', 'Arrows (+Shift)'],
  ['Cancel', 'Esc'],
  ['Finish wall', 'Enter / double-click'],
  ['Exact length while drawing', 'Type a number'],
  ['3D move/rotate gizmo', 'G'],
  ['Save now', `${MOD} S`],
];

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'pan', w: 'wall', d: 'door', n: 'window', o: 'opening', m: 'measure', t: 'text' };

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const s = ui();
    if (s.screen !== 'editor') return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (s.dialog && e.key === 'Escape') {
      setUi({ dialog: null });
      return;
    }
    if (s.contextMenu && e.key === 'Escape') {
      setUi({ contextMenu: null });
      return;
    }

    // Active editor gets first chance (typed lengths, Enter, Esc, arrows).
    const target = s.viewMode === '3d' ? editors.scene : s.viewMode === '2d' ? editors.plan : editors.focused === 'scene' ? editors.scene : editors.plan;
    if (!mod && target?.handleKey(e)) {
      e.preventDefault();
      return;
    }

    if (mod) {
      if (key === 'z') {
        e.preventDefault();
        const entry = e.shiftKey ? redo() : undo();
        if (entry) toast(`${e.shiftKey ? 'Redid' : 'Undid'}: ${entry.label}`, 'info', undefined, 1400);
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      } else if (key === 'c') {
        copySelection();
      } else if (key === 'v') {
        pasteClipboard();
      } else if (key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (key === 'a') {
        e.preventDefault();
        const f = getActiveFloor();
        if (f) select([...Object.keys(f.walls), ...Object.keys(f.items).filter((id) => !f.items[id].hidden), ...Object.keys(f.annotations)]);
      } else if (key === 's') {
        e.preventDefault();
        void saveNow().then(() => toast('Saved', 'success', undefined, 1200));
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === 'Escape') {
      if (s.walkMode) setUi({ walkMode: false });
      else if (s.selection.length) select([]);
      else if (s.tool !== 'select') setTool('select');
      return;
    }
    if (e.shiftKey && e.key === '!') {
      editors.plan?.zoomToFit();
      return;
    }
    if (e.key === '?') {
      setUi({ dialog: { kind: 'shortcuts' } });
      return;
    }
    if (e.shiftKey && key === 'd') {
      setTool('dimension');
      return;
    }
    if (key === 'r') {
      const f = getActiveFloor();
      const items = s.selection.filter((id) => f?.items[id]);
      if (items.length && s.tool === 'select') rotateItems(items, 90);
      else setTool('room');
      return;
    }
    if (key === 'f') {
      setUi({ rightPanel: 'library', rightPanelOpen: true });
      return;
    }
    if (TOOL_KEYS[key] && !e.shiftKey && !e.altKey) {
      setTool(TOOL_KEYS[key]);
      return;
    }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      setUi({ viewMode: e.key === '1' ? '2d' : e.key === '2' ? 'split' : '3d' });
      return;
    }
    if (e.key === '=' || e.key === '+') editors.plan?.zoomBy(1.25);
    if (e.key === '-') editors.plan?.zoomBy(0.8);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
