import type { ElementStatus } from './types';

/**
 * Renovation views:
 *  - existing:   the house as it stands today (existing + to-be-demolished)
 *  - demolition: existing with demolished elements highlighted
 *  - proposed:   the finished result (existing + new)
 *  - combined:   everything, colour-coded by status
 */
export type RenovationView = 'existing' | 'demolition' | 'proposed' | 'combined';

export function isVisibleInView(status: ElementStatus, view: RenovationView): boolean {
  switch (view) {
    case 'existing':
    case 'demolition':
      return status !== 'new';
    case 'proposed':
      return status !== 'demolish';
    case 'combined':
      return true;
  }
}

/** Whether a status should be drawn with its highlight style in this view. */
export function isHighlighted(status: ElementStatus, view: RenovationView): boolean {
  if (status === 'existing') return false;
  if (view === 'combined') return true;
  if (view === 'demolition') return status === 'demolish';
  return false;
}

export const STATUS_LABEL: Record<ElementStatus, string> = {
  existing: 'Existing',
  demolish: 'Demolish',
  new: 'New',
};
