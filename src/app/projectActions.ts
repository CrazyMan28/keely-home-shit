import { createProject } from '../model/factory';
import { newId } from '../model/ids';
import type { ProjectDoc } from '../model/types';
import { markSaved, saveNow, setThumbnailProvider } from '../persistence/autosave';
import { blobToDataUrl, dataUrlToBlob, migrate, parseProjectFile, ProjectFileError, safeFileName, serializeProject } from '../persistence/fileFormat';
import { getRepository, requestPersistentStorage } from '../persistence/repository';
import { closeDocument, documentStore, loadDocument } from '../state/documentStore';
import { setUi, toast } from '../state/uiStore';
import { editors } from '../editor/registry';
import { createSampleProject } from './sample';

setThumbnailProvider(() => editors.plan?.thumbnail());

async function openDoc(doc: ProjectDoc, screen: 'editor' | 'import' = 'editor'): Promise<void> {
  loadDocument(doc);
  markSaved();
  setUi({ screen, selection: [], hover: null, tool: 'select', dialog: null, walkMode: false });
  void requestPersistentStorage();
}

export async function newProject(opts: { name?: string; screen?: 'editor' | 'import' } = {}): Promise<void> {
  const doc = createProject(opts.name ?? 'Untitled House');
  await getRepository().save(doc);
  await openDoc(doc, opts.screen ?? 'editor');
}

export async function openSampleProject(): Promise<void> {
  const doc = createSampleProject();
  await getRepository().save(doc);
  await openDoc(doc);
}

export async function openProject(id: string): Promise<void> {
  const doc = await getRepository().load(id);
  if (!doc) {
    toast('That project could not be found', 'error');
    return;
  }
  await openDoc(migrate(doc));
}

export async function closeProject(): Promise<void> {
  await saveNow();
  // Save a fresh thumbnail on the way out.
  const doc = documentStore.getState().doc;
  if (doc) await getRepository().save(doc, editors.plan?.thumbnail());
  closeDocument();
  setUi({ screen: 'home', selection: [], dialog: null, walkMode: false });
}

export async function deleteProject(id: string): Promise<void> {
  await getRepository().remove(id);
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportProjectFile(): Promise<void> {
  const doc = documentStore.getState().doc;
  if (!doc) return;
  const blobs: Record<string, string> = {};
  for (const s of Object.values(doc.sources)) {
    const b = await getRepository().getBlob(s.blobKey);
    if (b) blobs[s.blobKey] = await blobToDataUrl(b);
  }
  download(new Blob([serializeProject(doc, blobs)], { type: 'application/json' }), `${safeFileName(doc.name)}.house-project-v1.json`);
  toast('Project file exported', 'success');
}

export async function importProjectFile(file: File): Promise<void> {
  try {
    const { doc, blobs } = parseProjectFile(await file.text());
    const repo = getRepository();
    const existing = await repo.load(doc.id);
    const finalDoc = existing ? { ...doc, id: newId('project'), name: `${doc.name} (imported)` } : doc;
    for (const [key, url] of Object.entries(blobs)) await repo.putBlob(key, await dataUrlToBlob(url));
    await repo.save(finalDoc);
    await openDoc(finalDoc);
    toast(`Opened “${finalDoc.name}”`, 'success');
  } catch (e) {
    toast(e instanceof ProjectFileError ? e.message : 'Could not open that file', 'error');
  }
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.click();
  });
}
