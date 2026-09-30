import type { ItemCategory } from '../model/types';
import { inchesToMm } from '../geometry/measurement/units';

/**
 * Object library. Every entry has real-world default dimensions. `shape`
 * selects a procedural placeholder model (and 2D symbol); `assetRef` can
 * later point at a GLB/GLTF that replaces the placeholder at the same size.
 */
export type ItemShape =
  | 'bed'
  | 'sofa'
  | 'chair'
  | 'table'
  | 'roundTable'
  | 'desk'
  | 'box'
  | 'shelf'
  | 'baseCabinet'
  | 'wallCabinet'
  | 'tallCabinet'
  | 'counter'
  | 'island'
  | 'fridge'
  | 'range'
  | 'dishwasher'
  | 'sink'
  | 'toilet'
  | 'shower'
  | 'bathtub'
  | 'vanity'
  | 'lamp'
  | 'plant'
  | 'rug'
  | 'tv'
  | 'column'
  | 'stairs'
  | 'washer';

export interface CatalogEntry {
  id: string;
  name: string;
  category: ItemCategory;
  shape: ItemShape;
  width: number;
  depth: number;
  height: number;
  elevation?: number;
  materialId?: string;
  resizable?: boolean;
  assetRef?: string;
  /** Snap this item's back against walls when placed near one. */
  wallAligned?: boolean;
}

const i = inchesToMm;

export const CATALOG: CatalogEntry[] = [
  // Beds
  { id: 'bed-king', name: 'King bed', category: 'bed', shape: 'bed', width: i(76), depth: i(80), height: i(24), materialId: 'mat-fabric-cream', wallAligned: true },
  { id: 'bed-queen', name: 'Queen bed', category: 'bed', shape: 'bed', width: i(60), depth: i(80), height: i(24), materialId: 'mat-fabric-cream', wallAligned: true },
  { id: 'bed-full', name: 'Full bed', category: 'bed', shape: 'bed', width: i(54), depth: i(75), height: i(24), materialId: 'mat-fabric-cream', wallAligned: true },
  { id: 'bed-twin', name: 'Twin bed', category: 'bed', shape: 'bed', width: i(39), depth: i(75), height: i(24), materialId: 'mat-fabric-cream', wallAligned: true },
  { id: 'nightstand', name: 'Nightstand', category: 'storage', shape: 'box', width: i(22), depth: i(16), height: i(24), materialId: 'mat-cabinet-oak', wallAligned: true },
  { id: 'dresser', name: 'Dresser', category: 'storage', shape: 'box', width: i(60), depth: i(18), height: i(32), materialId: 'mat-cabinet-oak', wallAligned: true },
  // Seating
  { id: 'sofa-3', name: 'Sofa (3 seat)', category: 'seating', shape: 'sofa', width: i(84), depth: i(36), height: i(34), materialId: 'mat-fabric-gray', wallAligned: true },
  { id: 'loveseat', name: 'Loveseat', category: 'seating', shape: 'sofa', width: i(60), depth: i(36), height: i(34), materialId: 'mat-fabric-gray', wallAligned: true },
  { id: 'armchair', name: 'Armchair', category: 'seating', shape: 'sofa', width: i(32), depth: i(34), height: i(34), materialId: 'mat-fabric-gray' },
  { id: 'dining-chair', name: 'Dining chair', category: 'seating', shape: 'chair', width: i(18), depth: i(20), height: i(36), materialId: 'mat-cabinet-oak' },
  { id: 'office-chair', name: 'Office chair', category: 'seating', shape: 'chair', width: i(26), depth: i(26), height: i(40), materialId: 'mat-generic-dark' },
  // Tables
  { id: 'dining-table-6', name: 'Dining table (6)', category: 'table', shape: 'table', width: i(72), depth: i(38), height: i(30), materialId: 'mat-cabinet-oak' },
  { id: 'dining-table-round', name: 'Round table', category: 'table', shape: 'roundTable', width: i(48), depth: i(48), height: i(30), materialId: 'mat-cabinet-oak' },
  { id: 'coffee-table', name: 'Coffee table', category: 'table', shape: 'table', width: i(48), depth: i(24), height: i(18), materialId: 'mat-cabinet-oak' },
  { id: 'desk', name: 'Desk', category: 'table', shape: 'desk', width: i(60), depth: i(30), height: i(30), materialId: 'mat-cabinet-oak', wallAligned: true },
  // Storage
  { id: 'bookshelf', name: 'Bookshelf', category: 'storage', shape: 'shelf', width: i(36), depth: i(12), height: i(72), materialId: 'mat-cabinet-white', wallAligned: true },
  { id: 'tv-stand', name: 'TV stand', category: 'storage', shape: 'box', width: i(60), depth: i(18), height: i(22), materialId: 'mat-generic-dark', wallAligned: true },
  { id: 'tv-65', name: 'TV 65"', category: 'electronics', shape: 'tv', width: i(57), depth: i(3), height: i(33), elevation: i(24), materialId: 'mat-generic-dark', wallAligned: true },
  // Kitchen
  { id: 'base-cabinet', name: 'Base cabinet', category: 'cabinet', shape: 'baseCabinet', width: i(30), depth: i(24), height: i(34.5), materialId: 'mat-cabinet-white', resizable: true, wallAligned: true },
  { id: 'wall-cabinet', name: 'Wall cabinet', category: 'cabinet', shape: 'wallCabinet', width: i(30), depth: i(12), height: i(30), elevation: i(54), materialId: 'mat-cabinet-white', resizable: true, wallAligned: true },
  { id: 'tall-cabinet', name: 'Pantry cabinet', category: 'cabinet', shape: 'tallCabinet', width: i(24), depth: i(24), height: i(84), materialId: 'mat-cabinet-white', resizable: true, wallAligned: true },
  { id: 'counter', name: 'Countertop run', category: 'counter', shape: 'counter', width: i(96), depth: i(25.5), height: i(36), materialId: 'mat-counter-quartz', resizable: true, wallAligned: true },
  { id: 'island', name: 'Kitchen island', category: 'counter', shape: 'island', width: i(72), depth: i(36), height: i(36), materialId: 'mat-counter-quartz', resizable: true },
  { id: 'fridge', name: 'Refrigerator', category: 'appliance', shape: 'fridge', width: i(36), depth: i(30), height: i(70), materialId: 'mat-steel', wallAligned: true },
  { id: 'range', name: 'Range / stove', category: 'appliance', shape: 'range', width: i(30), depth: i(26), height: i(36), materialId: 'mat-steel', wallAligned: true },
  { id: 'dishwasher', name: 'Dishwasher', category: 'appliance', shape: 'dishwasher', width: i(24), depth: i(24), height: i(34.5), materialId: 'mat-steel', wallAligned: true },
  { id: 'kitchen-sink', name: 'Kitchen sink base', category: 'appliance', shape: 'sink', width: i(33), depth: i(24), height: i(36), materialId: 'mat-cabinet-white', wallAligned: true },
  { id: 'washer', name: 'Washer / dryer', category: 'appliance', shape: 'washer', width: i(27), depth: i(30), height: i(38), materialId: 'mat-porcelain', wallAligned: true },
  // Bath
  { id: 'toilet', name: 'Toilet', category: 'bath', shape: 'toilet', width: i(20), depth: i(28), height: i(30), materialId: 'mat-porcelain', wallAligned: true },
  { id: 'vanity-36', name: 'Vanity 36"', category: 'bath', shape: 'vanity', width: i(36), depth: i(21), height: i(34), materialId: 'mat-cabinet-white', resizable: true, wallAligned: true },
  { id: 'shower', name: 'Shower 36×36', category: 'bath', shape: 'shower', width: i(36), depth: i(36), height: i(78), materialId: 'mat-wall-tile', resizable: true },
  { id: 'bathtub', name: 'Bathtub 60"', category: 'bath', shape: 'bathtub', width: i(60), depth: i(30), height: i(20), materialId: 'mat-porcelain', wallAligned: true },
  // Lighting & decor
  { id: 'floor-lamp', name: 'Floor lamp', category: 'lighting', shape: 'lamp', width: i(14), depth: i(14), height: i(62), materialId: 'mat-generic-dark' },
  { id: 'plant', name: 'Plant', category: 'decor', shape: 'plant', width: i(18), depth: i(18), height: i(40) },
  { id: 'rug-5x8', name: "Rug 5'×8'", category: 'decor', shape: 'rug', width: i(96), depth: i(60), height: i(0.5), materialId: 'mat-floor-carpet', resizable: true },
  // Structure
  { id: 'column', name: 'Column', category: 'structure', shape: 'column', width: i(12), depth: i(12), height: i(96), materialId: 'mat-paint-white', resizable: true },
  { id: 'stairs', name: 'Straight stairs', category: 'structure', shape: 'stairs', width: i(36), depth: i(120), height: i(96), materialId: 'mat-floor-oak', resizable: true },
];

export const CATALOG_BY_ID: Record<string, CatalogEntry> = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  bed: 'Beds',
  seating: 'Seating',
  table: 'Tables',
  storage: 'Storage',
  cabinet: 'Cabinets',
  counter: 'Counters',
  appliance: 'Appliances',
  bath: 'Bath',
  lighting: 'Lighting',
  decor: 'Decor',
  electronics: 'Electronics',
  structure: 'Structure',
};

export function shapeOf(catalogId: string): ItemShape {
  return CATALOG_BY_ID[catalogId]?.shape ?? 'box';
}
