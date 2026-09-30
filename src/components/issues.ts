import { useMemo } from 'react';
import { derivePlan } from '../geometry/derive';
import { formatLength } from '../geometry/measurement/format';
import type { Id } from '../model/types';
import { useDocument } from '../state/documentStore';
import { useUi } from '../state/uiStore';

export interface Issue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail?: string;
  ids: Id[];
  source: 'geometry' | 'measurement' | 'unconstrained' | 'clearance';
  openImport?: boolean;
}

/** Everything the "Check" panel reports, derived from the canonical model. */
export function useIssues(): Issue[] {
  const floor = useDocument((s) => s.doc?.variants[s.variantId]?.floors[s.floorId]);
  const observations = useDocument((s) => s.doc?.observations);
  const units = useDocument((s) => s.doc?.settings.units);
  const violations = useDocument((s) => s.violations);
  const view = useUi((s) => s.renovationView);
  return useMemo(() => {
    if (!floor || !units) return [];
    const out: Issue[] = [];
    const d = derivePlan(floor, view);
    for (const v of violations) out.push({ id: `v-${v.constraintId}`, severity: 'error', title: `${v.label} can’t be satisfied`, detail: `Off by ${v.unit === 'mm' ? formatLength(v.residual, units) : `${v.residual.toFixed(2)}°`}`, ids: [], source: 'geometry' });
    for (const o of d.openingIssues) out.push({ id: `op-${o.openingId}-${o.message}`, severity: 'warning', title: o.message, ids: [o.openingId], source: 'geometry' });
    // Dangling wall ends (walls that don't close into rooms).
    const degree = new Map<Id, number>();
    for (const w of Object.values(floor.walls)) {
      if (w.status === 'demolish') continue;
      degree.set(w.a, (degree.get(w.a) ?? 0) + 1);
      degree.set(w.b, (degree.get(w.b) ?? 0) + 1);
    }
    for (const w of Object.values(floor.walls)) {
      if (w.status === 'demolish') continue;
      if ((degree.get(w.a) ?? 0) === 1 && (degree.get(w.b) ?? 0) === 1) continue; // freestanding wall — intentional
      if ((degree.get(w.a) ?? 0) === 1 || (degree.get(w.b) ?? 0) === 1)
        out.push({ id: `dangle-${w.id}`, severity: 'info', title: 'Wall end isn’t connected', detail: 'Connect it to close the room, or leave it as a partial wall.', ids: [w.id], source: 'geometry' });
    }
    for (const c of d.clearance)
      out.push({ id: c.id, severity: c.severity === 'warning' ? 'warning' : 'info', title: c.message, detail: c.distance !== undefined ? `Currently ${formatLength(c.distance, units)}` : undefined, ids: c.elementIds, source: 'clearance' });
    const obs = Object.values(observations ?? {});
    if (obs.length) {
      for (const o of obs) {
        if (o.approximate || o.status === 'confirmed' || o.status === 'rejected') continue;
        if (o.status === 'conflicting')
          out.push({ id: `obs-${o.id}`, severity: 'error', title: `Conflicting measurement “${o.originalText}”`, detail: o.interpretation, ids: o.linkedElementId ? [o.linkedElementId] : [], source: 'measurement', openImport: true });
        else if (o.status === 'ambiguous' || o.status === 'likely' || o.status === 'missing')
          out.push({ id: `obs-${o.id}`, severity: 'warning', title: `${o.status === 'missing' ? 'Missing' : 'Unconfirmed'} measurement “${o.originalText || '?'}”`, detail: `${Math.round(o.confidence * 100)}% confident · ${o.interpretation}`, ids: o.linkedElementId ? [o.linkedElementId] : [], source: 'measurement', openImport: true });
      }
      const measured = new Set(obs.filter((o) => o.status === 'confirmed' || o.approximate).map((o) => o.linkedElementId));
      for (const w of Object.values(floor.walls)) {
        if (w.status !== 'existing' || measured.has(w.id) || w.locks.length) continue;
        out.push({ id: `unc-${w.id}`, severity: 'info', title: 'Wall has no confirmed measurement', detail: 'Its length comes from the surrounding geometry, not a tape reading.', ids: [w.id], source: 'unconstrained' });
      }
    }
    return out;
  }, [floor, observations, units, violations, view]);
}
