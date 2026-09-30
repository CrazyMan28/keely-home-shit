import type { Floor } from '../model/types';
import { isVisibleInView, type RenovationView } from '../model/renovation';
import { analyzeClearances, type ClearanceIssue } from './items/clearance';
import { validateOpenings, type OpeningIssue } from './openings/openings';
import { detectFaces, resolveRooms, type DetectedRoom } from './rooms/roomDetection';
import { computeWallGeometry, type WallGeometry } from './walls/wallGeometry';

/**
 * Everything renderers need that is computed from the canonical floor.
 * Memoized per (floor object, view) so the 2D canvas, the 3D scene and the
 * inspector all share one computation per edit.
 */
export interface PlanDerived {
  floor: Floor;
  view: RenovationView;
  /** Mitered footprints for walls visible in this view. */
  geometry: WallGeometry;
  rooms: DetectedRoom[];
  clearance: ClearanceIssue[];
  openingIssues: OpeningIssue[];
}

const cache = new WeakMap<Floor, Map<RenovationView, PlanDerived>>();

export function derivePlan(floor: Floor, view: RenovationView): PlanDerived {
  let byView = cache.get(floor);
  if (!byView) {
    byView = new Map();
    cache.set(floor, byView);
  }
  const hit = byView.get(view);
  if (hit) return hit;
  const geometry = computeWallGeometry(floor, (w) => !w.hidden && isVisibleInView(w.status, view));
  const proposedGeometry = view === 'proposed' ? geometry : computeWallGeometry(floor, (w) => !w.hidden && w.status !== 'demolish');
  const rooms = resolveRooms(floor, detectFaces(floor));
  const derived: PlanDerived = {
    floor,
    view,
    geometry,
    rooms,
    clearance: analyzeClearances(floor, proposedGeometry),
    openingIssues: validateOpenings(floor),
  };
  byView.set(view, derived);
  return derived;
}
