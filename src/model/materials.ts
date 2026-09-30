import type { Material } from './types';

const m = (
  id: string,
  name: string,
  category: Material['category'],
  color: string,
  pattern: Material['pattern'] = 'none',
  patternScale = 300,
  roughness = 0.85,
  metalness = 0,
): Material => ({ id, name, category, color, pattern, patternScale, roughness, metalness });

/** Built-in material library. Projects copy these so saved files are self-contained. */
export const DEFAULT_MATERIALS: Material[] = [
  m('mat-paint-white', 'Painted drywall – White', 'wall', '#eeebe5'),
  m('mat-paint-greige', 'Painted drywall – Greige', 'wall', '#d8d0c4'),
  m('mat-paint-sage', 'Painted drywall – Sage', 'wall', '#b9c4b0'),
  m('mat-paint-navy', 'Painted drywall – Navy', 'wall', '#3c4a63'),
  m('mat-brick', 'Brick', 'wall', '#a35a42', 'brick', 230),
  m('mat-wall-wood', 'Wood paneling', 'wall', '#9a7350', 'wood', 150),
  m('mat-wall-tile', 'Wall tile – White subway', 'wall', '#f2f1ee', 'tile', 150, 0.3),
  m('mat-floor-oak', 'Oak hardwood', 'floor', '#b98d5f', 'wood', 180, 0.6),
  m('mat-floor-walnut', 'Walnut hardwood', 'floor', '#6e4a33', 'wood', 180, 0.55),
  m('mat-floor-tile', 'Porcelain tile – Light', 'floor', '#dcd8d0', 'tile', 600, 0.4),
  m('mat-floor-slate', 'Slate tile', 'floor', '#5d6166', 'tile', 400, 0.7),
  m('mat-floor-carpet', 'Carpet – Oatmeal', 'floor', '#c9bda9', 'carpet', 100, 1),
  m('mat-floor-concrete', 'Polished concrete', 'floor', '#a4a39f', 'concrete', 1000, 0.5),
  m('mat-counter-quartz', 'Quartz – White', 'counter', '#f4f3f0', 'stone', 600, 0.25),
  m('mat-counter-granite', 'Granite – Dark', 'counter', '#34332f', 'stone', 400, 0.3),
  m('mat-counter-butcher', 'Butcher block', 'counter', '#c08a55', 'wood', 60, 0.6),
  m('mat-counter-laminate', 'Laminate – Gray', 'counter', '#9d9c97', 'none', 300, 0.5),
  m('mat-cabinet-white', 'Cabinet – Shaker white', 'cabinet', '#f1f0ec', 'none', 300, 0.5),
  m('mat-cabinet-navy', 'Cabinet – Navy', 'cabinet', '#2f3d55', 'none', 300, 0.5),
  m('mat-cabinet-oak', 'Cabinet – Natural oak', 'cabinet', '#c29a6b', 'wood', 150, 0.6),
  m('mat-door-white', 'Door – Painted white', 'door', '#f5f4f0', 'none', 300, 0.5),
  m('mat-door-wood', 'Door – Stained wood', 'door', '#7a5236', 'wood', 120, 0.55),
  m('mat-glass', 'Glass', 'glass', '#bcd6e6', 'none', 300, 0.05, 0),
  m('mat-fabric-gray', 'Fabric – Gray', 'fabric', '#8b8e93', 'none', 300, 1),
  m('mat-fabric-cream', 'Fabric – Cream', 'fabric', '#e6ddcb', 'none', 300, 1),
  m('mat-steel', 'Stainless steel', 'generic', '#c8cacc', 'none', 300, 0.3, 0.8),
  m('mat-porcelain', 'Porcelain – White', 'generic', '#fbfbf9', 'none', 300, 0.15),
  m('mat-generic-dark', 'Matte black', 'generic', '#2a2a2c', 'none', 300, 0.6),
];

export const DEFAULT_WALL_MATERIAL = 'mat-paint-white';
export const DEFAULT_FLOOR_MATERIAL = 'mat-floor-oak';

export function defaultMaterialRecord(): Record<string, Material> {
  return Object.fromEntries(DEFAULT_MATERIALS.map((mat) => [mat.id, { ...mat }]));
}
