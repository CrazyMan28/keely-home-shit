import { documentStore } from '../state/documentStore';
import { setUi } from '../state/uiStore';
import { getRepository } from './repository';

/**
 * Debounced autosave: watches the document revision and writes to the
 * repository ~600 ms after the last change. Also flushes on page hide so
 * closing the tab / switching apps on iOS never loses work.
 */
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let savedRevision = 0;
let thumbnailProvider: (() => string | undefined) | null = null;

export function setThumbnailProvider(fn: () => string | undefined): void {
  thumbnailProvider = fn;
}

async function flush(): Promise<void> {
  const { doc, revision } = documentStore.getState();
  if (!doc || revision === savedRevision) return;
  if (saving) await saving;
  setUi({ saveStatus: 'saving' });
  const target = revision;
  saving = getRepository()
    .save(doc, thumbnailProvider?.())
    .then(() => {
      savedRevision = target;
      setUi({ saveStatus: documentStore.getState().revision === target ? 'saved' : 'unsaved' });
    })
    .catch((e) => {
      console.error('Autosave failed', e);
      setUi({ saveStatus: 'error' });
    })
    .finally(() => {
      saving = null;
    });
  await saving;
}

export function saveNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  return flush();
}

export function startAutosave(): () => void {
  savedRevision = documentStore.getState().revision;
  const unsub = documentStore.subscribe((s, prev) => {
    if (s.doc && prev.doc && s.doc.id !== prev.doc.id) {
      savedRevision = s.revision;
      return;
    }
    if (s.revision === prev.revision || !s.doc) return;
    setUi({ saveStatus: 'unsaved' });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 600);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') void saveNow();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
  };
}

export function markSaved(): void {
  savedRevision = documentStore.getState().revision;
  setUi({ saveStatus: 'saved' });
}
