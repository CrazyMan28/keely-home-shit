import { derivePlan } from '../geometry/derive';
import { editors } from '../editor/registry';
import { documentStore, getActiveFloor } from '../state/documentStore';
import { select, ui } from '../state/uiStore';

/**
 * Small inspection hook used by the browser tests (and handy in devtools):
 * a summary of the canonical model as the app currently holds it.
 */
export function installTestHooks(): void {
  (window as unknown as { __homePlanner: unknown }).__homePlanner = {
    doc() {
      const f = getActiveFloor();
      const s = documentStore.getState();
      if (!f || !s.doc) return null;
      return {
        variant: s.doc.variants[s.variantId].name,
        walls: Object.values(f.walls).map((w) => ({ id: w.id, status: w.status, length: Math.hypot(f.nodes[w.b].x - f.nodes[w.a].x, f.nodes[w.b].y - f.nodes[w.a].y) })),
        rooms: derivePlan(f, 'proposed').rooms.map((r) => ({ name: r.room.name, area: r.area })),
        openings: Object.keys(f.openings).length,
        items: Object.keys(f.items).length,
        selection: ui().selection,
      };
    },
    selectFirstWall() {
      const f = getActiveFloor();
      const w = f && Object.values(f.walls).find((x) => x.wallType === 'interior');
      if (w) select([w.id]);
    },
    sceneMeshes() {
      const scene = (editors.scene as unknown as { scene?: { traverse: (fn: (o: { isMesh?: boolean }) => void) => void } } | null)?.scene;
      let n = 0;
      scene?.traverse((o) => {
        if (o.isMesh) n++;
      });
      return n;
    },
  };
}
