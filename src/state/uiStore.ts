import { createStore, useStore } from 'zustand';
import { DEFAULT_SNAP_OPTIONS, type SnapOptions } from '../geometry/snapping/snap';
import type { RenovationView } from '../model/renovation';
import type { Id } from '../model/types';
import type { ResizeAnchor, ResizeMode } from '../geometry/walls/wallOps';

/**
 * Transient UI state: never saved into the project file. Kept apart from the
 * document store so hover/selection changes don't touch geometry and vice
 * versa. High-frequency pointer state (cursor, snap preview, drag) lives in
 * the editor controllers, not here.
 */

export type Tool =
  | 'select'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'opening'
  | 'item'
  | 'dimension'
  | 'measure'
  | 'text'
  | 'pan';

export type ViewMode = '2d' | '3d' | 'split';
export type Theme = 'dark' | 'light' | 'system';
export type Screen = 'home' | 'editor' | 'import';
export type RightPanel = 'inspector' | 'library' | 'issues' | 'history' | 'variants';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  action?: { label: string; run: () => void };
}

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  run?: () => void;
  separator?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Target of an on-canvas dimension being edited. */
export type DimensionTarget =
  | {
      kind: 'wallLength';
      wallId: Id;
      reference: 'centerline' | 'face';
      /** Face measured when reference = 'face'. */
      side?: 'left' | 'right';
      /** Length of collinear pieces included in the displayed value but not part of this wall. */
      extra?: number;
    }
  | { kind: 'itemDistance'; itemId: Id; side: 'back' | 'front' | 'left' | 'right' }
  | { kind: 'openingOffset'; openingId: Id; from: 'start' | 'end' }
  | { kind: 'openingWidth'; openingId: Id }
  | { kind: 'dimensionLine'; dimensionId: Id }
  | { kind: 'drawLength' }
  | { kind: 'moveOffset' };

export interface DimensionEditState {
  target: DimensionTarget;
  /** Screen position (client coords) for the popover. */
  x: number;
  y: number;
  current: number;
  anchor: ResizeAnchor;
  mode: ResizeMode;
  /** Optional initial text (e.g. user started typing a digit). */
  initialText?: string;
}

export interface UiState {
  screen: Screen;
  tool: Tool;
  /** Catalog entry being placed by the item tool. */
  placingCatalogId: string | null;
  selection: Id[];
  hover: Id | null;
  viewMode: ViewMode;
  renovationView: RenovationView;
  theme: Theme;
  snap: SnapOptions;
  snapEnabled: boolean;
  strictMode: boolean;
  showDimensions: boolean;
  showRoomLabels: boolean;
  showFurniture: boolean;
  showGrid: boolean;
  /** Ghost of the base plan under an option (comparison). */
  showBaseGhost: boolean;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  rightPanel: RightPanel;
  rightPanelWidth: number;
  splitRatio: number;
  toasts: Toast[];
  contextMenu: ContextMenuState | null;
  dimensionEdit: DimensionEditState | null;
  saveStatus: 'saved' | 'saving' | 'unsaved' | 'error';
  /** Status-bar readouts updated by editors (throttled). */
  cursor: { x: number; y: number } | null;
  zoomPercent: number;
  hint: string;
  /** Request for the 3D view to focus/animate (incremented token). */
  focusRequest: { ids: Id[]; token: number } | null;
  walkMode: boolean;
  cameraPreset: string | null;
  dialog: null | { kind: 'compare' } | { kind: 'export' } | { kind: 'shortcuts' } | { kind: 'settings' } | { kind: 'newVariant' } | { kind: 'roomFromDims' };
}

const THEME_KEY = 'keely.theme';
function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'dark' || t === 'light' || t === 'system') return t;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

export const uiStore = createStore<UiState>(() => ({
  screen: 'home',
  tool: 'select',
  placingCatalogId: null,
  selection: [],
  hover: null,
  viewMode: '2d',
  renovationView: 'combined',
  theme: readTheme(),
  snap: { ...DEFAULT_SNAP_OPTIONS },
  snapEnabled: true,
  strictMode: false,
  showDimensions: true,
  showRoomLabels: true,
  showFurniture: true,
  showGrid: true,
  showBaseGhost: false,
  leftPanelOpen: true,
  rightPanelOpen: typeof window === 'undefined' || window.innerWidth > 860,
  rightPanel: 'inspector',
  rightPanelWidth: 320,
  splitRatio: 0.5,
  toasts: [],
  contextMenu: null,
  dimensionEdit: null,
  saveStatus: 'saved',
  cursor: null,
  zoomPercent: 100,
  hint: '',
  focusRequest: null,
  walkMode: false,
  cameraPreset: null,
  dialog: null,
}));

export const useUi = <T>(selector: (s: UiState) => T): T => useStore(uiStore, selector);
export const ui = () => uiStore.getState();
export const setUi = (patch: Partial<UiState>) => uiStore.setState(patch);

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  setUi({ theme });
}

export function setTool(tool: Tool, placingCatalogId: string | null = null): void {
  setUi({ tool, placingCatalogId, dimensionEdit: null, contextMenu: null, hint: '' });
}

export function select(ids: Id[], mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
  const cur = ui().selection;
  let next: Id[];
  if (mode === 'replace') next = ids;
  else if (mode === 'add') next = [...new Set([...cur, ...ids])];
  else {
    const set = new Set(cur);
    for (const id of ids) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    next = [...set];
  }
  if (next.length === cur.length && next.every((id, i) => id === cur[i])) return;
  setUi({ selection: next });
}

export function clearSelection(): void {
  if (ui().selection.length) setUi({ selection: [] });
}

export function setHover(id: Id | null): void {
  if (ui().hover !== id) setUi({ hover: id });
}

let toastSeq = 1;
export function toast(message: string, tone: Toast['tone'] = 'info', action?: Toast['action'], ms = 3600): void {
  const t: Toast = { id: toastSeq++, message, tone, action };
  setUi({ toasts: [...ui().toasts.slice(-3), t] });
  setTimeout(() => setUi({ toasts: ui().toasts.filter((x) => x.id !== t.id) }), action ? ms + 2400 : ms);
}

export function openContextMenu(x: number, y: number, items: ContextMenuItem[]): void {
  setUi({ contextMenu: { x, y, items } });
}

let focusToken = 1;
export function requestFocus(ids: Id[]): void {
  setUi({ focusRequest: { ids, token: focusToken++ } });
}
