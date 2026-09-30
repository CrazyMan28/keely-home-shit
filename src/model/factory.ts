import { DEFAULT_UNIT_SETTINGS } from '../geometry/measurement/units';
import { newId } from './ids';
import { defaultMaterialRecord } from './materials';
import type { Floor, ProjectDoc, Variant } from './types';

/** Typical US framing: 2x4 stud + drywall both sides ≈ 4½". */
export const DEFAULT_INTERIOR_THICKNESS = 114.3;
/** 2x6 exterior + sheathing + siding ≈ 6½". */
export const DEFAULT_EXTERIOR_THICKNESS = 165.1;
/** 8'-0" ceilings. */
export const DEFAULT_WALL_HEIGHT = 2438.4;

export function createFloor(name = 'Main Floor'): Floor {
  return {
    id: newId('floor'),
    name,
    elevation: 0,
    defaultWallHeight: DEFAULT_WALL_HEIGHT,
    defaultWallThickness: DEFAULT_INTERIOR_THICKNESS,
    nodes: {},
    walls: {},
    openings: {},
    items: {},
    rooms: {},
    annotations: {},
    dimensions: {},
    constraints: {},
  };
}

export function createBaseVariant(): Variant {
  const floor = createFloor();
  const now = Date.now();
  return {
    id: newId('variant'),
    name: 'Measured Plan',
    kind: 'base',
    createdAt: now,
    updatedAt: now,
    floors: { [floor.id]: floor },
    floorOrder: [floor.id],
  };
}

export function createProject(name = 'Untitled House'): ProjectDoc {
  const base = createBaseVariant();
  const now = Date.now();
  return {
    schema: 'house-project',
    version: 1,
    id: newId('project'),
    name,
    createdAt: now,
    updatedAt: now,
    settings: {
      units: { ...DEFAULT_UNIT_SETTINGS },
      dimensionReference: 'centerline',
      gridSize: 152.4,
    },
    materials: defaultMaterialRecord(),
    variants: { [base.id]: base },
    variantOrder: [base.id],
    baseVariantId: base.id,
    baseLocked: false,
    sources: {},
    observations: {},
  };
}

/**
 * Deep-copies a variant for a new design option. Element ids are preserved on
 * purpose: the same id in base and option means "the same physical thing",
 * which is what makes comparison and demolition tracking possible.
 */
export function cloneVariantAsOption(source: Variant, name: string): Variant {
  const now = Date.now();
  const floors = structuredClone(source.floors);
  return {
    id: newId('variant'),
    name,
    kind: 'option',
    parentId: source.id,
    createdAt: now,
    updatedAt: now,
    floors,
    floorOrder: [...source.floorOrder],
  };
}
