import { defaultMaterialRecord } from '../model/materials';
import { newId } from '../model/ids';
import type { Floor, ProjectDoc } from '../model/types';
import { DEFAULT_UNIT_SETTINGS } from '../geometry/measurement/units';

/**
 * Project file format: `house-project-v1.json`.
 *
 * {
 *   "format": "house-project",
 *   "version": 1,
 *   "exportedAt": "...",
 *   "project": ProjectDoc,               // canonical model, mm units
 *   "blobs": { [blobKey]: "data:..." }   // optional embedded sketch images
 * }
 *
 * The file contains no UI state. Readers must migrate older versions forward
 * through `migrate()`.
 */
export const FILE_FORMAT = 'house-project';
export const FILE_VERSION = 1;

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  version: number;
  exportedAt: string;
  project: ProjectDoc;
  blobs?: Record<string, string>;
}

export class ProjectFileError extends Error {}

export function serializeProject(doc: ProjectDoc, blobs?: Record<string, string>): string {
  const file: ProjectFile = { format: FILE_FORMAT, version: FILE_VERSION, exportedAt: new Date().toISOString(), project: doc, blobs };
  return JSON.stringify(file, null, 2);
}

/** Parses and validates a project file. Accepts a bare ProjectDoc too. */
export function parseProjectFile(text: string): { doc: ProjectDoc; blobs: Record<string, string> } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('This file is not valid JSON.');
  }
  if (!raw || typeof raw !== 'object') throw new ProjectFileError('Unrecognized project file.');
  const obj = raw as Record<string, unknown>;
  let project: unknown;
  let blobs: Record<string, string> = {};
  if (obj.format === FILE_FORMAT) {
    if (typeof obj.version !== 'number' || obj.version > FILE_VERSION)
      throw new ProjectFileError(`This project was saved by a newer version (v${String(obj.version)}).`);
    project = obj.project;
    blobs = (obj.blobs as Record<string, string>) ?? {};
  } else if (obj.schema === 'house-project') {
    project = obj;
  } else {
    throw new ProjectFileError('This is not a house project file.');
  }
  return { doc: migrate(validate(project)), blobs };
}

function validate(p: unknown): ProjectDoc {
  const d = p as ProjectDoc;
  if (!d || typeof d !== 'object' || !d.variants || typeof d.variants !== 'object' || !d.baseVariantId)
    throw new ProjectFileError('Project file is missing its plan data.');
  if (!d.variants[d.baseVariantId]) throw new ProjectFileError('Project file has no measured base plan.');
  for (const v of Object.values(d.variants)) {
    for (const f of Object.values(v.floors ?? {})) {
      for (const w of Object.values(f.walls ?? {})) {
        if (!f.nodes?.[w.a] || !f.nodes?.[w.b]) throw new ProjectFileError(`Wall ${w.id} references a missing junction.`);
        if (!(w.thickness > 0) || !(w.height > 0)) throw new ProjectFileError(`Wall ${w.id} has invalid dimensions.`);
      }
      for (const n of Object.values(f.nodes ?? {})) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new ProjectFileError(`Junction ${n.id} has invalid coordinates.`);
      }
    }
  }
  return d;
}

/** Fills defaults for fields added after v1 files were written; forward-migrates versions. */
export function migrate(d: ProjectDoc): ProjectDoc {
  const fillFloor = (f: Floor): Floor => ({
    ...f,
    nodes: f.nodes ?? {},
    walls: f.walls ?? {},
    openings: f.openings ?? {},
    items: f.items ?? {},
    rooms: f.rooms ?? {},
    annotations: f.annotations ?? {},
    dimensions: f.dimensions ?? {},
    constraints: f.constraints ?? {},
  });
  return {
    ...d,
    schema: 'house-project',
    version: 1,
    id: d.id ?? newId('project'),
    name: d.name ?? 'Imported House',
    settings: {
      units: { ...DEFAULT_UNIT_SETTINGS, ...(d.settings?.units ?? {}) },
      dimensionReference: d.settings?.dimensionReference ?? 'centerline',
      gridSize: d.settings?.gridSize ?? 152.4,
    },
    materials: { ...defaultMaterialRecord(), ...(d.materials ?? {}) },
    variantOrder: d.variantOrder?.length ? d.variantOrder : Object.keys(d.variants),
    baseLocked: d.baseLocked ?? false,
    sources: d.sources ?? {},
    observations: d.observations ?? {},
    variants: Object.fromEntries(
      Object.entries(d.variants).map(([id, v]) => [
        id,
        { ...v, floorOrder: v.floorOrder?.length ? v.floorOrder : Object.keys(v.floors), floors: Object.fromEntries(Object.entries(v.floors).map(([fid, f]) => [fid, fillFloor(f)])) },
      ]),
    ),
  };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'house';
}
