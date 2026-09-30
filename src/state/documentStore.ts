import { createStore, useStore } from 'zustand';
import type { Violation } from '../geometry/constraints/solver';
import { finalizeFloor } from '../model/pipeline';
import type { Floor, Id, ProjectDoc, Variant } from '../model/types';

/**
 * Persistent document state + command history.
 *
 * Every mutation goes through `editFloor` / `editDoc` with a human label
 * ("Move wall", "Add door"). History entries store the full document before
 * and after; because updates are immutable with structural sharing, a
 * snapshot costs only the objects that actually changed.
 *
 * Continuous interactions (drags) use transactions: `beginTransaction`,
 * any number of `editFloor(..., { transient: true })`, then `commit` — one
 * undo step for the whole gesture.
 */

export interface HistoryEntry {
  id: number;
  label: string;
  before: ProjectDoc;
  after: ProjectDoc;
  time: number;
  variantId: Id;
  floorId: Id;
}

export interface DocumentState {
  doc: ProjectDoc | null;
  variantId: Id;
  floorId: Id;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Increments on every document change (drives autosave). */
  revision: number;
  /** Constraint violations from the last geometry edit. */
  violations: Violation[];
}

export const documentStore = createStore<DocumentState>(() => ({
  doc: null,
  variantId: '',
  floorId: '',
  past: [],
  future: [],
  revision: 0,
  violations: [],
}));

export const useDocument = <T>(selector: (s: DocumentState) => T): T => useStore(documentStore, selector);

const HISTORY_LIMIT = 250;
let entrySeq = 1;
let tx: { label: string; before: ProjectDoc; variantId: Id; floorId: Id } | null = null;
let lastCoalesce: { key: string; time: number } | null = null;

export type EditFailure = 'no-document' | 'base-locked' | 'constraint-violation' | 'no-change';

export interface EditResult {
  ok: boolean;
  reason?: EditFailure;
  violations: Violation[];
  overrodePins?: boolean;
}

export function loadDocument(doc: ProjectDoc, opts: { variantId?: Id; floorId?: Id } = {}): void {
  const variantId = opts.variantId && doc.variants[opts.variantId] ? opts.variantId : doc.variantOrder[doc.variantOrder.length - 1] ?? doc.baseVariantId;
  const variant = doc.variants[variantId];
  const floorId = opts.floorId && variant.floors[opts.floorId] ? opts.floorId : variant.floorOrder[0];
  tx = null;
  documentStore.setState({ doc, variantId, floorId, past: [], future: [], revision: 0, violations: [] });
}

export function closeDocument(): void {
  tx = null;
  documentStore.setState({ doc: null, variantId: '', floorId: '', past: [], future: [], revision: 0, violations: [] });
}

export function getDoc(): ProjectDoc | null {
  return documentStore.getState().doc;
}

export function getActiveVariant(): Variant | null {
  const s = documentStore.getState();
  return s.doc?.variants[s.variantId] ?? null;
}

export function getActiveFloor(): Floor | null {
  const s = documentStore.getState();
  return s.doc?.variants[s.variantId]?.floors[s.floorId] ?? null;
}

export function isBaseActive(): boolean {
  const s = documentStore.getState();
  return !!s.doc && s.doc.baseVariantId === s.variantId;
}

export function isActiveVariantLocked(): boolean {
  const s = documentStore.getState();
  return !!s.doc && s.doc.baseLocked && s.doc.baseVariantId === s.variantId;
}

function withFloor(doc: ProjectDoc, variantId: Id, floor: Floor): ProjectDoc {
  const v = doc.variants[variantId];
  const now = Date.now();
  return {
    ...doc,
    updatedAt: now,
    variants: { ...doc.variants, [variantId]: { ...v, updatedAt: now, floors: { ...v.floors, [floor.id]: floor } } },
  };
}

function pushHistory(label: string, before: ProjectDoc, after: ProjectDoc, coalesceKey?: string): void {
  const s = documentStore.getState();
  const now = Date.now();
  let past = s.past;
  if (coalesceKey && lastCoalesce?.key === coalesceKey && now - lastCoalesce.time < 1200 && past.length) {
    const top = past[past.length - 1];
    past = [...past.slice(0, -1), { ...top, after, time: now }];
  } else {
    past = [...past, { id: entrySeq++, label, before, after, time: now, variantId: s.variantId, floorId: s.floorId }];
    if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT);
  }
  lastCoalesce = coalesceKey ? { key: coalesceKey, time: now } : null;
  documentStore.setState({ past, future: [] });
}

export interface EditOptions {
  /** Nodes the user is directly manipulating (held by the solver when possible). */
  pinned?: Iterable<Id>;
  /** Part of an open transaction; don't record history. */
  transient?: boolean;
  /** Merge with the previous entry if it had the same key and was recent. */
  coalesceKey?: string;
  /** Reject the edit if constraints can't be satisfied. Default true. */
  strictConstraints?: boolean;
  /** Allow editing the locked base plan (used by import confirmation). */
  force?: boolean;
  /**
   * Floor to compute from instead of the current one. Drags pass their
   * gesture-start floor so every frame is computed from the same origin
   * (no accumulated error) and post-processing diffs against it.
   */
  base?: Floor;
}

/**
 * Applies a floor edit to the active floor of the active variant. The result
 * is post-processed (constraints, opening attachment, rooms) before commit.
 */
export function editFloor(label: string, fn: (floor: Floor) => Floor, opts: EditOptions = {}): EditResult {
  const s = documentStore.getState();
  const doc = s.doc;
  if (!doc) return { ok: false, reason: 'no-document', violations: [] };
  if (!opts.force && doc.baseLocked && doc.baseVariantId === s.variantId) return { ok: false, reason: 'base-locked', violations: [] };
  const current = doc.variants[s.variantId].floors[s.floorId];
  const prev = opts.base ?? current;
  const raw = fn(prev);
  if (raw === current) return { ok: false, reason: 'no-change', violations: [] };
  const fin = finalizeFloor(prev, raw, opts.pinned);
  if (fin.violations.length && opts.strictConstraints !== false) {
    documentStore.setState({ violations: fin.violations });
    return { ok: false, reason: 'constraint-violation', violations: fin.violations };
  }
  const next = withFloor(doc, s.variantId, fin.floor);
  documentStore.setState({ doc: next, revision: s.revision + 1, violations: fin.violations });
  if (!opts.transient && !tx) pushHistory(label, doc, next, opts.coalesceKey);
  return { ok: true, violations: fin.violations, overrodePins: fin.overrodePins };
}

/** Document-level edit (settings, variants, materials, observations). */
export function editDoc(label: string, fn: (doc: ProjectDoc) => ProjectDoc, opts: { transient?: boolean; coalesceKey?: string; history?: boolean } = {}): boolean {
  const s = documentStore.getState();
  if (!s.doc) return false;
  const next = fn(s.doc);
  if (next === s.doc) return false;
  const stamped = { ...next, updatedAt: Date.now() };
  documentStore.setState({ doc: stamped, revision: s.revision + 1 });
  if (opts.history !== false && !opts.transient && !tx) pushHistory(label, s.doc, stamped, opts.coalesceKey);
  return true;
}

export function beginTransaction(label: string): void {
  const s = documentStore.getState();
  if (!s.doc) return;
  tx = { label, before: s.doc, variantId: s.variantId, floorId: s.floorId };
}

export function setTransactionLabel(label: string): void {
  if (tx) tx.label = label;
}

export function commitTransaction(): void {
  if (!tx) return;
  const t = tx;
  tx = null;
  const s = documentStore.getState();
  if (s.doc && s.doc !== t.before) pushHistory(t.label, t.before, s.doc);
}

export function cancelTransaction(): void {
  if (!tx) return;
  const t = tx;
  tx = null;
  const s = documentStore.getState();
  if (s.doc !== t.before) documentStore.setState({ doc: t.before, revision: s.revision + 1 });
}

export const inTransaction = (): boolean => tx !== null;

export function undo(): HistoryEntry | null {
  if (tx) cancelTransaction();
  const s = documentStore.getState();
  const entry = s.past[s.past.length - 1];
  if (!entry) return null;
  lastCoalesce = null;
  documentStore.setState({
    doc: entry.before,
    past: s.past.slice(0, -1),
    future: [entry, ...s.future],
    revision: s.revision + 1,
    ...focusFor(entry.before, entry),
    violations: [],
  });
  return entry;
}

export function redo(): HistoryEntry | null {
  const s = documentStore.getState();
  const entry = s.future[0];
  if (!entry) return null;
  lastCoalesce = null;
  documentStore.setState({
    doc: entry.after,
    past: [...s.past, entry],
    future: s.future.slice(1),
    revision: s.revision + 1,
    ...focusFor(entry.after, entry),
    violations: [],
  });
  return entry;
}

/** Jump to any point in history (history panel). */
export function travelTo(entryId: number): void {
  const s = documentStore.getState();
  if (s.past.some((e) => e.id === entryId)) {
    while (documentStore.getState().past.at(-1)?.id !== entryId) if (!undo()) break;
  } else if (s.future.some((e) => e.id === entryId)) {
    while (documentStore.getState().past.at(-1)?.id !== entryId) if (!redo()) break;
  }
}

/** Keep the view on the variant/floor the undone edit happened in, if it still exists. */
function focusFor(doc: ProjectDoc, entry: HistoryEntry): Partial<DocumentState> {
  const v = doc.variants[entry.variantId];
  if (v && v.floors[entry.floorId]) return { variantId: entry.variantId, floorId: entry.floorId };
  const s = documentStore.getState();
  if (doc.variants[s.variantId]?.floors[s.floorId]) return {};
  const vid = doc.variantOrder[0];
  return { variantId: vid, floorId: doc.variants[vid].floorOrder[0] };
}

export function setActiveVariant(variantId: Id): void {
  const s = documentStore.getState();
  const v = s.doc?.variants[variantId];
  if (!v) return;
  const floorId = v.floors[s.floorId] ? s.floorId : v.floorOrder[0];
  documentStore.setState({ variantId, floorId, violations: [] });
}

export function setActiveFloor(floorId: Id): void {
  const v = getActiveVariant();
  if (v?.floors[floorId]) documentStore.setState({ floorId });
}
