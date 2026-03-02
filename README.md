# RL Local Dashboard (V1.0.0)

Local Rocket League replay analytics dashboard.

The app parses `.replay` files with `boxcars`, stores optional local cache/raw artifacts, and exposes a React dashboard with aggregate and per-match analysis views.

## What Is Included

- Replay ingestion from local demos folder with date filters.
- Configurable parse workers and replay count limit.
- Optional cache/raw write mode with open/clear folder actions.
- Aggregate stats + single match analysis panels.
- Team and player metric scope tags.
- Search, sort, rows-per-page, and pagination on the matches table.
- Boost, performance, distribution, and trend visualizations.
- Global tooltips and a dedicated stats info modal.
- CSV, PNG, and PDF export actions.

## Repository Layout

- [`backend/main.py`](backend/main.py): FastAPI endpoints and replay load orchestration.
- [`backend/replay.py`](backend/replay.py): replay parsing + stats derivation.
- [`backend/cache.py`](backend/cache.py): cache index and file management.
- [`frontend/src/App.jsx`](frontend/src/App.jsx): dashboard UI/state.
- [`scripts/release.sh`](scripts/release.sh): Ubuntu release build script.
- [`scripts/release.ps1`](scripts/release.ps1): Windows release build script used by CI asset packaging.
- [`.github/workflows/release.yml`](.github/workflows/release.yml): single end-to-end release workflow (semantic-release + Windows runtime ZIP upload).

## Tech Stack

- Backend: Python, FastAPI, Uvicorn
- Frontend: React, Vite, Recharts
- Replay parser: `boxcars` executable
- Packaging: PyInstaller (backend binary), GitHub Actions artifacts

## Requirements

### Runtime

- Python `>=3.11`
- Node.js `>=18` + npm
- `boxcars` executable available locally (dev/runtime requirement)

### Recommended Tooling

- `uv` for Python dependency and command management

### Optional (only if building parser from source)

- Rust toolchain + Cargo

## Install & Run (Dev)

1. Install backend dependencies:

```powershell
uv sync
```

2. Install frontend dependencies:

```powershell
cd frontend
npm install
cd ..
```

3. Start backend:

```powershell
uv run python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

4. Start frontend:

```powershell
cd frontend
npm run dev -- --host --port 5173
```

Open `http://localhost:5173`.

## Replay Config (UI) Reference

- `Load replays` / `Stop parsing`: primary parse control.
- `Quick load dates`: shortcut date presets (`7D` default).
- `Load start date` / `Load end date`: replay time filter window.
- `Demos directory`: folder containing `.replay` files.
- `Boxcars exe`: parser executable path.
- `Write to cache` (switch): enables cache/raw persistence behavior.
- `Cache directory` + `Raw directory`: required only when `Write to cache` is enabled.
- `Replay count`: optional max number of replays to process (`0` means no explicit limit).
- `Parse workers`: parallel parse worker count.
- `Open cache folder`, `Open raw folder`, `Clear cache`: storage management actions.

Validation rules:

- Parsing requires `Demos directory` and `Boxcars exe`.
- If `Write to cache` is enabled, both `Cache directory` and `Raw directory` are mandatory.

## Dashboard Behavior

- When no match is selected, analysis defaults to all loaded matches.
- Selecting a row highlights that match and opens single-match analysis details.
- Aggregate stats remain visible for the full loaded dataset.
- Player selection changes highlight/focus, not dataset scope.
- Matches table supports:
  - free-text search
  - sortable headers
  - rows-per-page control (for example 5, 10, 25)
  - pagination

## Metrics & Documentation

- Every main control and chart has tooltip help text.
- The `Stats Info` modal documents all metrics by category.
- Metrics are grouped and labeled with scope where relevant:
  - `Team`
  - `Player`

## Export

Export actions are available under the right analysis panel:

- `Export CSV`
- `Export PNG`
- `Export PDF`

## Build / Release

### Frontend Production Build

```powershell
cd frontend
npm run build
```

### CI-Compatible Release Artifacts (Ubuntu)

```bash
bash scripts/release.sh
```

The script:

1. Builds frontend static assets.
2. Builds backend one-file binary with PyInstaller.
3. Produces `dist/` artifacts:
   - `dist/backend/rl-dashboard-api` (or `.exe` when generated)
   - `dist/frontend/*`
   - `dist/run-backend.sh`
   - `dist/release-dist.tar.gz` (portable archive)
   - `dist/release-dist.zip` (when `zip` is available on builder)
   - `dist/tools/boxcars` (or `.exe`) when a local boxcars binary is found

`run-backend.sh` auto-sets `BOXCARS_EXE` to the bundled parser path when it exists.

### GitHub Release (From Scratch)

Single workflow: [`.github/workflows/release.yml`](.github/workflows/release.yml)

1. On `push` to `main`, it runs semantic-release (version + publish).
2. If a new tag/release is created, it checks out that tag on Windows.
3. It runs `scripts/release.ps1`.
4. It removes previous custom release assets.
5. It uploads only:
   - `release-dist.zip` (runtime package: backend/frontend launcher + optional bundled boxcars)

GitHub default source archives (`Source code (zip/tar.gz)`) remain, plus this runtime zip.

Manual recovery/rebuild:

- Trigger `Release` workflow with `workflow_dispatch`.
- Optionally provide `tag` to rebuild/re-upload assets for a specific existing release.

## Verification Checklist (V1)

- `npm run build` succeeds in `frontend/`.
- Backend module compiles:

```powershell
uv run python -m compileall backend\main.py backend\replay.py backend\cache.py
```

- Parse flow works with valid `Demos directory` and `Boxcars exe`.
- Stats tooltips and `Stats Info` modal are populated.
- Table search/sort/pagination and rows-per-page controls are functional.
