import { formatLength } from '../geometry/measurement/format';
import { newId } from '../model/ids';
import type { Id, ImportSettings, Observation, ProjectDoc, SourceImage } from '../model/types';
import { getRepository } from '../persistence/repository';
import { documentStore, editDoc, getDoc, setActiveVariant } from '../state/documentStore';
import { setUi, toast } from '../state/uiStore';
import { imageSize } from './images/images';
import { PROVIDERS, type ExtractionImage } from './extraction/provider';
import { buildFloorFromReconstruction } from './reconciliation/buildPlan';
import { defaultLayout, reconstruct, type ResolutionAction } from './reconciliation/reconcile';

export const DEFAULT_IMPORT_SETTINGS: ImportSettings = { interiorMeasurements: true, lockMeasured: true };

export function importSettings(doc: ProjectDoc | null = getDoc()): ImportSettings {
  return { ...DEFAULT_IMPORT_SETTINGS, ...(doc?.importSettings ?? {}) };
}

export async function addSketchFiles(files: File[]): Promise<Id[]> {
  const repo = getRepository();
  const created: SourceImage[] = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const { width, height } = await imageSize(f);
      const id = newId('sketch');
      const blobKey = `blob-${id}`;
      await repo.putBlob(blobKey, f);
      created.push({ id, name: f.name, width, height, mime: f.type, blobKey, addedAt: Date.now() });
    } catch {
      toast(`Couldn’t open ${f.name}. Try a JPEG or PNG (HEIC may need converting).`, 'warning');
    }
  }
  if (created.length) editDoc(`Add ${created.length} sketch${created.length === 1 ? '' : 'es'}`, (d) => ({ ...d, sources: { ...d.sources, ...Object.fromEntries(created.map((s) => [s.id, s])) } }));
  return created.map((s) => s.id);
}

export function removeSketch(id: Id): void {
  editDoc('Remove sketch', (d) => {
    const sources = { ...d.sources };
    delete sources[id];
    const observations = Object.fromEntries(Object.entries(d.observations).filter(([, o]) => o.sourceImageId !== id));
    return { ...d, sources, observations };
  });
}

export async function runExtraction(providerId: string, apiKey: string, onProgress: (done: number, total: number, msg: string) => void, signal?: AbortSignal): Promise<number> {
  const doc = getDoc();
  if (!doc) return 0;
  const meta = PROVIDERS.find((p) => p.id === providerId)!;
  const provider = await meta.load();
  const repo = getRepository();
  const images: ExtractionImage[] = [];
  for (const s of Object.values(doc.sources)) {
    const blob = await repo.getBlob(s.blobKey);
    if (blob) images.push({ id: s.id, name: s.name, blob, width: s.width, height: s.height });
  }
  const proposed = await provider.extract(images, { apiKey, onProgress, signal });
  // Room names that appear on several sketches are kept apart until the user merges them.
  const perImageGroups = new Map<string, Set<Id>>();
  for (const p of proposed) if (p.group) perImageGroups.set(p.group, (perImageGroups.get(p.group) ?? new Set()).add(p.sourceImageId));
  const names = Object.values(doc.sources).map((s) => s.id);
  const rename = (p: (typeof proposed)[number]) => {
    if (!p.group) return p.group;
    const imgs = perImageGroups.get(p.group)!;
    return imgs.size > 1 ? `${p.group} (sketch ${names.indexOf(p.sourceImageId) + 1})` : p.group;
  };
  editDoc('Read sketches', (d) => {
    // Replace earlier unconfirmed machine readings; keep anything the user touched.
    const kept = Object.fromEntries(Object.entries(d.observations).filter(([, o]) => o.provider === 'manual' || o.status === 'confirmed' || o.approximate));
    const added = Object.fromEntries(proposed.map((p) => {
      const id = newId('obs');
      return [id, { ...p, id, group: rename(p) } as Observation];
    }));
    return { ...d, observations: { ...kept, ...added } };
  });
  return proposed.length;
}

export function updateObservation(id: Id, patch: Partial<Observation>, label = 'Edit measurement'): void {
  editDoc(label, (d) => (d.observations[id] ? { ...d, observations: { ...d.observations, [id]: { ...d.observations[id], ...patch } } } : d), { coalesceKey: `obs-${id}-${Object.keys(patch).join(',')}` });
}

export function addObservation(o: Omit<Observation, 'id'>): Id {
  const id = newId('obs');
  editDoc('Add measurement', (d) => ({ ...d, observations: { ...d.observations, [id]: { ...o, id } } }));
  return id;
}

export function deleteObservation(id: Id): void {
  editDoc('Delete measurement', (d) => {
    const observations = { ...d.observations };
    delete observations[id];
    return { ...d, observations };
  });
}

export function confirmObservations(ids: Id[]): void {
  editDoc(ids.length === 1 ? 'Confirm measurement' : `Confirm ${ids.length} measurements`, (d) => {
    const observations = { ...d.observations };
    for (const id of ids) if (observations[id] && observations[id].valueMm !== undefined) observations[id] = { ...observations[id], status: 'confirmed', confidence: 1 };
    return { ...d, observations };
  });
}

export function applyResolution(action: ResolutionAction): void {
  if (action.kind === 'markApproximate')
    editDoc('Mark approximate', (d) => {
      const observations = { ...d.observations };
      for (const id of action.obsIds) observations[id] = { ...observations[id], approximate: true };
      return { ...d, observations };
    });
  else if (action.kind === 'confirm') confirmObservations(action.obsIds);
}

export function renameGroup(from: string, to: string): void {
  if (!to.trim() || from === to) return;
  editDoc('Rename room', (d) => {
    const observations = Object.fromEntries(Object.entries(d.observations).map(([id, o]) => [id, o.group === from ? { ...o, group: to } : o]));
    const layout = { ...(d.importLayout ?? {}) };
    if (layout[from]) {
      layout[to] = layout[from];
      delete layout[from];
    }
    return { ...d, observations, importLayout: layout };
  });
}

export function deleteGroup(group: string): void {
  editDoc('Delete room', (d) => ({ ...d, observations: Object.fromEntries(Object.entries(d.observations).filter(([, o]) => o.group !== group)) }));
}

/** Moves an edge earlier/later in its room loop. */
export function moveEdge(id: Id, dir: -1 | 1): void {
  editDoc('Reorder edge', (d) => {
    const o = d.observations[id];
    const siblings = Object.values(d.observations)
      .filter((x) => x.group === o.group && x.direction !== undefined && ['wall_length', 'room_width', 'room_depth'].includes(x.type))
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const i = siblings.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return d;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    const observations = { ...d.observations };
    siblings.forEach((s, k) => (observations[s.id] = { ...observations[s.id], sequence: k }));
    return { ...d, observations };
  });
}

export function setLayout(group: string, pos: { x: number; y: number }, transient = false): void {
  editDoc('Move room', (d) => ({ ...d, importLayout: { ...(d.importLayout ?? {}), [group]: pos } }), { coalesceKey: `layout-${group}`, transient });
}

export function setImportSettings(patch: Partial<ImportSettings>): void {
  editDoc('Import settings', (d) => ({ ...d, importSettings: { ...importSettings(d), ...patch } }));
}

/**
 * Builds the measured base plan from the reviewed readings. Replaces the base
 * plan's first floor (undoable), links readings to walls and protects the
 * base plan afterwards.
 */
export function buildMeasuredPlan(): { rooms: number; skipped: string[] } | null {
  const doc = getDoc();
  if (!doc) return null;
  const obs = Object.values(doc.observations);
  const units = doc.settings.units;
  const recon = reconstruct(obs, (mm) => formatLength(mm, units));
  const layout = defaultLayout(recon.rooms, doc.importLayout ?? {});
  const base = doc.variants[doc.baseVariantId];
  const floorId = base.floorOrder[0];
  const floor = base.floors[floorId];
  const settings = importSettings(doc);
  const empty = { ...floor, nodes: {}, walls: {}, openings: {}, rooms: {}, constraints: {} };
  const res = buildFloorFromReconstruction(empty, recon, layout, obs, settings, floor.defaultWallHeight);
  const built = { ...res.floor, items: floor.items, annotations: floor.annotations, dimensions: floor.dimensions, underlay: floor.underlay };
  editDoc('Build measured plan', (d) => {
    const observations = { ...d.observations };
    for (const [obsId, elId] of Object.entries(res.links)) observations[obsId] = { ...observations[obsId], linkedElementId: elId };
    // Conflicts that remain are recorded on the readings themselves.
    for (const issue of recon.issues) if (issue.kind === 'conflict') for (const id of issue.obsIds) if (!observations[id].approximate) observations[id] = { ...observations[id], status: 'conflicting' };
    const b = d.variants[d.baseVariantId];
    return {
      ...d,
      observations,
      importLayout: layout,
      baseLocked: true,
      settings: { ...d.settings, dimensionReference: settings.interiorMeasurements ? 'interior' : d.settings.dimensionReference },
      variants: { ...d.variants, [d.baseVariantId]: { ...b, updatedAt: Date.now(), floors: { ...b.floors, [floorId]: built } } },
    };
  });
  setActiveVariant(doc.baseVariantId);
  documentStore.setState({ floorId });
  setUi({ screen: 'editor', viewMode: '2d', selection: [] });
  return { rooms: recon.rooms.length - res.skipped.length, skipped: res.skipped };
}
