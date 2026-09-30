import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { parseLength } from '../../geometry/measurement/parse';
import { inchesToMm } from '../../geometry/measurement/units';
import type { ObservationAlternative } from '../../model/types';
import { toJpegBase64 } from '../images/images';
import { statusFor, type ExtractionImage, type MeasurementExtractionProvider, type ProposedObservation } from './provider';

/**
 * Claude vision provider. Runs in the browser with the user's own API key
 * (stored only on their device). The model returns structured readings; this
 * module re-parses every handwritten string with the app's own measurement
 * parser so the number we use is deterministic, and flags any disagreement
 * between the model's number and the text as ambiguous.
 */

const Box = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe('Box around the handwriting, as fractions (0–1) of image width/height');
const Reading = z.object({ text: z.string(), inches: z.number().nullable(), confidence: z.number() });
const Edge = z.object({
  direction: z.enum(['N', 'E', 'S', 'W']).describe('Which way this wall runs when walking the room clockwise; up on the page is N'),
  text: z.string().describe('The handwritten measurement exactly as written, e.g. 15\'2"'),
  inches: z.number().nullable().describe('Your numeric reading in inches, or null if unreadable'),
  confidence: z.number().describe('0–1 confidence in the reading'),
  alternatives: z.array(Reading).describe('Other plausible readings when the handwriting is unclear'),
  box: Box.nullable(),
  measured: z.boolean().describe('false when this wall has no written measurement on the sketch'),
});
const OpeningZ = z.object({
  type: z.enum(['door', 'window', 'opening']),
  edge_index: z.number().describe('Index into this room’s edges list of the wall it is on'),
  width_text: z.string(),
  width_inches: z.number().nullable(),
  offset_inches: z.number().nullable().describe('Written distance from the start corner of that edge to the opening, or null'),
  confidence: z.number(),
  box: Box.nullable(),
});
const Room = z.object({
  name: z.string(),
  edges: z.array(Edge),
  openings: z.array(OpeningZ),
  items: z.array(z.object({ label: z.string(), text: z.string(), box: Box.nullable() })).describe('Counters, cabinets, islands, fixtures, closets with any written sizes'),
});
const Result = z.object({ rooms: z.array(Room), notes: z.array(z.object({ text: z.string(), box: Box.nullable() })) });

const SYSTEM = `You read hand-drawn house measurement sketches for a renovation planner.

Rules:
- The WRITTEN numbers are authoritative. Never estimate a length from how long a line looks; sketches are not to scale.
- For each room, list its walls in order, walking CLOCKWISE starting at the north-west (top-left) corner. Up on the page is North.
- Give each wall's direction of travel (N/E/S/W), the handwriting exactly as written, and your reading in inches.
- Include jogs, alcoves and offsets as separate edges so the outline closes.
- If a wall has no written number, still include it with measured=false and inches=null. Do not invent a value.
- If handwriting is unclear, give your best reading, a lower confidence, and the other plausible readings as alternatives.
- Doors, windows and openings: record which edge they are on and any written width/offset.
- Boxes are fractions (0–1) of the image width and height around the handwriting.
- If you cannot tell something, say so with low confidence rather than guessing.`;

function toMm(text: string, inches: number | null): { mm?: number; disagree?: number } {
  const parsed = parseLength(text, { system: 'imperial' });
  const fromModel = inches !== null ? inchesToMm(inches) : undefined;
  if (parsed.ok && fromModel !== undefined && Math.abs(parsed.mm - fromModel) > 12.7) return { mm: parsed.mm, disagree: fromModel };
  if (parsed.ok) return { mm: parsed.mm };
  return { mm: fromModel };
}

async function readOne(client: Anthropic, image: ExtractionImage, signal?: AbortSignal): Promise<ProposedObservation[]> {
  const jpeg = await toJpegBase64(image.blob);
  const res = await client.beta.messages.parse(
    {
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(Result) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.data } },
            { type: 'text', text: `Sketch file: "${image.name}". Extract every room outline, measurement, opening and fixture.` },
          ],
        },
      ],
    },
    { signal },
  );
  if (res.stop_reason === 'refusal') throw new Error('The sketch could not be read (request declined).');
  if (res.stop_reason === 'max_tokens') throw new Error('The sketch was too detailed to read in one pass.');
  const out = res.parsed_output;
  if (!out) throw new Error('The reader returned an unexpected format.');

  const obs: ProposedObservation[] = [];
  const base = { sourceImageId: image.id, provider: 'anthropic:claude-opus-5-5' };
  out.rooms.forEach((room) => {
    room.edges.forEach((e, idx) => {
      const { mm, disagree } = e.measured ? toMm(e.text, e.inches) : { mm: undefined };
      const alternatives: ObservationAlternative[] = e.alternatives
        .map((a) => ({ text: a.text, valueMm: toMm(a.text, a.inches).mm ?? NaN, confidence: a.confidence }))
        .filter((a) => Number.isFinite(a.valueMm));
      if (mm !== undefined && alternatives.length && !alternatives.some((a) => Math.abs(a.valueMm - mm) < 1)) alternatives.unshift({ text: e.text, valueMm: mm, confidence: e.confidence });
      if (disagree !== undefined) alternatives.push({ text: `${(disagree / 25.4).toFixed(1)}" (model’s number)`, valueMm: disagree, confidence: e.confidence * 0.5 });
      obs.push({
        ...base,
        type: 'wall_length',
        originalText: e.measured ? e.text : '',
        valueMm: mm,
        alternatives,
        confidence: disagree !== undefined ? Math.min(e.confidence, 0.6) : e.confidence,
        bbox: e.box ?? undefined,
        interpretation: e.measured ? `Wall running ${e.direction}` : `Unmeasured wall running ${e.direction}`,
        status: statusFor(mm, disagree !== undefined ? 0.6 : e.confidence, alternatives.length),
        group: room.name,
        direction: e.direction,
        sequence: idx,
      });
    });
    for (const o of room.openings) {
      const { mm } = toMm(o.width_text, o.width_inches);
      obs.push({
        ...base,
        type: o.type === 'door' ? 'door' : o.type === 'window' ? 'window' : 'opening_width',
        originalText: o.width_text,
        valueMm: mm,
        alternatives: [],
        confidence: o.confidence,
        bbox: o.box ?? undefined,
        interpretation: `${o.type} on edge ${o.edge_index + 1}`,
        status: statusFor(mm, o.confidence, 0),
        group: room.name,
        edgeIndex: Math.max(0, Math.round(o.edge_index)),
        offsetMm: o.offset_inches !== null ? inchesToMm(o.offset_inches) : undefined,
      });
    }
    for (const it of room.items)
      obs.push({ ...base, type: 'fixture', originalText: it.text, alternatives: [], confidence: 0.7, bbox: it.box ?? undefined, interpretation: it.label, status: 'likely', group: room.name, valueMm: toMm(it.text, null).mm });
  });
  for (const n of out.notes) obs.push({ ...base, type: 'note', originalText: n.text, alternatives: [], confidence: 0.7, bbox: n.box ?? undefined, interpretation: 'Note', status: 'likely' });
  return obs;
}

export const anthropicProvider: MeasurementExtractionProvider = {
  id: 'anthropic',
  label: 'Read with Claude (AI)',
  description: 'Claude reads every sketch and proposes measurements.',
  needsApiKey: true,
  async extract(images, opts) {
    if (!opts.apiKey) throw new Error('Add an Anthropic API key first.');
    const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const all: ProposedObservation[] = [];
    let done = 0;
    // Two at a time keeps things quick without tripping rate limits.
    const queue = [...images];
    const worker = async () => {
      while (queue.length) {
        const img = queue.shift()!;
        opts.onProgress?.(done, images.length, `Reading ${img.name}…`);
        try {
          all.push(...(await readOne(client, img, opts.signal)));
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) throw new Error('That API key was rejected.', { cause: e });
          if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited — wait a minute and try again.', { cause: e });
          if (e instanceof Anthropic.APIConnectionError) throw new Error('Couldn’t reach the AI service. Check the connection.', { cause: e });
          throw e;
        }
        done++;
        opts.onProgress?.(done, images.length, `Read ${done} of ${images.length}`);
      }
    };
    await Promise.all([worker(), worker()]);
    return all;
  },
};
