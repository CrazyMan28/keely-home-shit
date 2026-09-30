# Measurement sketch fixtures

Put the real hand-drawn measurement photos/screenshots here (`.jpg`, `.png`, `.heic` converted to `.jpg`).

They are reference inputs for the **Import sketches** workflow:

1. Open the app → *Import measurement sketches* → drag these files in.
2. Either run **Read with AI** (needs an Anthropic API key, kept only in your browser) or transcribe by
   drawing a box around each handwritten number and typing it.
3. Review: every reading shows its source box, confidence and status (Likely / Ambiguous / Conflicting / Confirmed).
4. Resolve conflicts explicitly — the app never changes a written measurement to make the geometry fit.

The written numbers are authoritative; line lengths in the sketch are only used for topology.

`src/tests/fixtures/sampleObservations.ts` contains a synthetic transcription of a typical sheet
(L-shaped kitchen with an alcove, a room with contradictory measurements, and an ambiguous reading)
that the test-suite uses until transcriptions of these real images are added next to it.
