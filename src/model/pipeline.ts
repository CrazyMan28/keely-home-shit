import { solveConstraints, type Violation } from '../geometry/constraints/solver';
import { reattachOpenings } from '../geometry/openings/openings';
import { detectFaces, syncRooms } from '../geometry/rooms/roomDetection';
import { FloorEditor } from './floorEditor';
import type { Floor, Id } from './types';

export interface FinalizeResult {
  floor: Floor;
  violations: Violation[];
  overrodePins: boolean;
}

/**
 * Runs after every geometry edit:
 *  1. constraint solving (locks win over free geometry),
 *  2. opening re-attachment (openings stay physically in place),
 *  3. room sync (closed loops → room records, preserving names).
 */
export function finalizeFloor(prev: Floor, next: Floor, pinned: Iterable<Id> = []): FinalizeResult {
  if (prev === next) return { floor: next, violations: [], overrodePins: false };
  const geometryChanged = prev.nodes !== next.nodes || prev.walls !== next.walls;
  let floor = next;
  let violations: Violation[] = [];
  let overrodePins = false;
  if (geometryChanged) {
    const solved = solveConstraints(floor, pinned);
    floor = solved.floor;
    violations = solved.violations;
    overrodePins = solved.overrodePins;
  }
  if (geometryChanged || prev.openings !== next.openings) floor = reattachOpenings(prev, floor);
  if (geometryChanged) {
    const rooms = syncRooms(floor, detectFaces(floor));
    if (rooms !== floor.rooms) {
      const ed = new FloorEditor(floor);
      ed.setRooms(rooms);
      floor = ed.floor;
    }
  }
  return { floor, violations, overrodePins };
}
