# Home Planner

A 2D + 3D home renovation planner for homeowners who measured their house by hand.
Upload the measurement sketches, review every reading, get an exact floor plan, then
try renovation ideas in design options, all at real-world scale.

- **One canonical model** (millimeters): the 2D plan, the 3D model, the inspector and the
  importer all read and write the same data.
- **Exact dimensions everywhere**: click any measurement on the plan and type `15'8"`,
  `5' 10 1/2"`, `1778 mm`, `12' + 3"`…; choose which end stays put.
- **Sketch import that never fakes precision**: readings carry confidence, alternatives and
  a box on the source photo. If the numbers can't all be true, you're told which ones and
  you decide.
- **Renovation-aware**: a locked *measured plan*, design options, existing / demolish / new,
  and comparisons.
- Works in Safari on Mac, iPhone and iPad; can be added to the Home Screen / Dock.

## Run it on your own Mac (one command)

1. Open **Terminal** (press ⌘ Space, type *Terminal*, press Return).
2. Paste this and press Return:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/CrazyMan28/keely-home-shit/main/deploy/local.sh | bash
   ```

3. After about a minute it says **Home Planner is running: http://localhost:8787** and opens it
   in your browser. Keep the Terminal window open while you use it.

- No password, no Homebrew: everything lives in the **HomePlanner** folder in your home folder
  (drag that folder to the Trash to remove it).
- **Next time:** double-click **Start Home Planner.command** in the HomePlanner folder.
  (If macOS asks, right-click it → Open.)
- Always use the same address, `http://localhost:8787`: projects are saved in the browser for
  that address. Use *Export → Project file* for backups.
- **Update:** run the same command again.
- Works on Linux too.

## Host it for someone with Tailscale (one command)

On a Linux server (Ubuntu, Debian, Fedora, Raspberry Pi OS…):

```bash
curl -fsSL https://raw.githubusercontent.com/CrazyMan28/keely-home-shit/main/deploy/install.sh | sudo bash
```

If the repository is private, clone it and run the installer from the checkout:

```bash
git clone https://github.com/CrazyMan28/keely-home-shit.git && sudo bash keely-home-shit/deploy/install.sh
```

The installer:

1. installs a private copy of Node.js (under `/opt/home-planner`, the system is untouched),
2. builds the app and runs it as a small hardened systemd service on `127.0.0.1:8787`,
3. installs Tailscale if needed and prints a login link,
4. publishes it over HTTPS with **Tailscale Funnel**, a normal `https://…ts.net` link that
   opens on any iPhone or Mac without installing anything.

Options: `MODE=private` (only devices on your tailnet), `TS_AUTHKEY=tskey-…` (no login
prompt), `BRANCH=…`, `PORT=…`. Example: `curl … | sudo MODE=private bash`.

Re-run the same command to update. If Funnel isn't enabled for your tailnet yet, Tailscale
prints a one-click link to enable it; do that and re-run.

**On her Apple devices:** open the link in Safari, then *Share → Add to Home Screen* (iPhone/iPad)
or *File → Add to Dock* (Mac). Installed web apps keep their data; ordinary Safari tabs may be
cleared after weeks without use. Projects live on each device. Use *Export → Project file*
and AirDrop to move one between iPhone and Mac.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run check        # lint + typecheck + unit tests + production build
npm run e2e          # browser tests (Playwright)
```

### Architecture

```
src/
  model/        canonical document types, factories, copy-on-write FloorEditor, edit pipeline
  geometry/     pure geometry engine (no React): measurement parsing/formatting, walls
                (mitered footprints, ops, stretch/resize), rooms, openings, constraints solver,
                snapping, items/clearances, spatial index
  state/        document store + command history (transactions for drags), UI store, actions
  editor/2d/    canvas renderer, viewport, hit testing, tools (imperative, no React re-renders)
  editor/3d/    Three.js scene: incremental sync from the model, builders, materials, walk mode
  import/       extraction providers (manual, Claude vision), reconciliation, plan builder
  persistence/  IndexedDB repository, autosave, versioned project file (house-project v1)
  export/       SVG / print / GLB / measurement report
  components/   React UI (shell, inspector, panels, dialogs, import workspace)
deploy/         local.sh (run on your own computer), install.sh (server + Tailscale),
                serve.mjs (zero-dependency static server)
```

**Units & precision.** All lengths are stored as millimeters (`1 in = 25.4 mm` exactly) and
node coordinates are quantized to 1 nm so repeated edits never drift. Values are only rounded
for display (1" … 1/16", or mm/cm/m).

**Walls** are centerlines between shared junction nodes plus a thickness; faces are derived
with miter joins. Connected walls share nodes, so connectivity can't break. Dimensions can be
shown on centerlines or as finished inside-room (wall-to-wall) measurements. Tape-measured
sketches are usually the latter.

**Sketch import.** Readers (manual transcription, or Claude vision with your own API key kept
in the browser) only *propose* observations. The reconciliation engine owns geometry: it
closes each room loop, derives at most what the measurements imply, and reports conflicts with
explicit choices (keep one reading, mark approximate, fix manually). Real sketch photos go in
`fixtures/measurement-sketches/`.
