import type { Id, Observation, ObservationStatus } from '../../model/types';

/**
 * Provider-independent sketch reading.
 *
 * A provider looks at sketch images and PROPOSES observations (readings with
 * confidence, alternatives and source boxes). It never produces geometry and
 * never marks anything "confirmed" — only the user does that. The
 * reconciliation engine decides whether the readings form a valid plan.
 */
export interface ExtractionImage {
  id: Id;
  name: string;
  blob: Blob;
  width: number;
  height: number;
}

export type ProposedObservation = Omit<Observation, 'id'>;

export interface ExtractionOptions {
  apiKey?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, message: string) => void;
}

export interface MeasurementExtractionProvider {
  id: string;
  label: string;
  description: string;
  needsApiKey: boolean;
  extract(images: ExtractionImage[], opts: ExtractionOptions): Promise<ProposedObservation[]>;
}

/** Status for a machine reading. Never "confirmed". */
export function statusFor(valueMm: number | undefined, confidence: number, alternatives: number): ObservationStatus {
  if (valueMm === undefined) return 'missing';
  if (alternatives > 1 || confidence < 0.8) return 'ambiguous';
  return 'likely';
}

/** Manual transcription: the user boxes each number on the sketch and types it. */
export const manualProvider: MeasurementExtractionProvider = {
  id: 'manual',
  label: 'Transcribe by hand',
  description: 'Draw a box around each handwritten number and type it. Works offline, no account needed.',
  needsApiKey: false,
  async extract() {
    return [];
  },
};

export const PROVIDERS: Array<{ id: string; label: string; description: string; needsApiKey: boolean; load: () => Promise<MeasurementExtractionProvider> }> = [
  { id: 'manual', label: manualProvider.label, description: manualProvider.description, needsApiKey: false, load: async () => manualProvider },
  {
    id: 'anthropic',
    label: 'Read with Claude (AI)',
    description: 'Claude reads every sketch and proposes measurements with confidence scores. You review everything before it becomes geometry.',
    needsApiKey: true,
    load: async () => (await import('./anthropicProvider')).anthropicProvider,
  },
];

const KEY = 'keely.anthropicKey';
export function readApiKey(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
