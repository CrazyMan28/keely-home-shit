import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProjectDoc } from '../model/types';

/**
 * Storage abstraction. The app talks only to `ProjectRepository`; the
 * IndexedDB implementation is the local-first default and a cloud-sync
 * implementation can be added behind the same interface later.
 */
export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  floors: number;
  variants: number;
  walls: number;
  thumbnail?: string;
}

export interface ProjectRepository {
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<ProjectDoc | null>;
  save(doc: ProjectDoc, thumbnail?: string): Promise<void>;
  remove(id: string): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
}

interface Schema extends DBSchema {
  projects: { key: string; value: ProjectDoc };
  meta: { key: string; value: ProjectMeta; indexes: { updatedAt: number } };
  blobs: { key: string; value: Blob };
}

export function metaFor(doc: ProjectDoc, thumbnail?: string): ProjectMeta {
  const base = doc.variants[doc.baseVariantId];
  return {
    id: doc.id,
    name: doc.name,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    floors: base ? base.floorOrder.length : 1,
    variants: doc.variantOrder.length,
    walls: base ? Object.values(base.floors).reduce((s, f) => s + Object.keys(f.walls).length, 0) : 0,
    thumbnail,
  };
}

export class IndexedDbRepository implements ProjectRepository {
  private db: Promise<IDBPDatabase<Schema>>;

  constructor(name = 'keely-home-planner') {
    this.db = openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('projects');
        const meta = db.createObjectStore('meta');
        meta.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('blobs');
      },
    });
  }

  async list(): Promise<ProjectMeta[]> {
    const all = await (await this.db).getAll('meta');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<ProjectDoc | null> {
    return (await (await this.db).get('projects', id)) ?? null;
  }

  async save(doc: ProjectDoc, thumbnail?: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['projects', 'meta'], 'readwrite');
    const prev = await tx.objectStore('meta').get(doc.id);
    await tx.objectStore('projects').put(doc, doc.id);
    await tx.objectStore('meta').put(metaFor(doc, thumbnail ?? prev?.thumbnail), doc.id);
    await tx.done;
  }

  async remove(id: string): Promise<void> {
    const db = await this.db;
    const doc = await db.get('projects', id);
    const tx = db.transaction(['projects', 'meta', 'blobs'], 'readwrite');
    await tx.objectStore('projects').delete(id);
    await tx.objectStore('meta').delete(id);
    if (doc) for (const s of Object.values(doc.sources)) await tx.objectStore('blobs').delete(s.blobKey);
    await tx.done;
  }

  async putBlob(key: string, blob: Blob): Promise<void> {
    await (await this.db).put('blobs', blob, key);
  }

  async getBlob(key: string): Promise<Blob | null> {
    return (await (await this.db).get('blobs', key)) ?? null;
  }
}

let repo: ProjectRepository | null = null;
export function getRepository(): ProjectRepository {
  repo ??= new IndexedDbRepository();
  return repo;
}

/** Ask the browser not to evict our data (important on Safari / iOS). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* unsupported */
  }
  return false;
}
