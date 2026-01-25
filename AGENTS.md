# Repository Guidelines

## Project Structure & Module Organization
- `backend/` keeps FastAPI routers (`main.py`, `tmux.py`, `files.py`) and shared backend helpers; place new services here and centralize reusable logic.
- `frontend/` owns the eink interface (`index.html`, `app.js`, `styles.css`); declare DOM references near the top of `app.js` and lean on utility-style CSS classes.
- `backend/services/` stores reusable backend services, configuration adapters, and typing support used across routers.
- `tests/` mirrors backend modules (`tests/test_tmux.py`, `tests/test_files.py`); add new suites alongside features they cover.

## Build, Test, and Development Commands
- `uv sync` — install or update dependencies described in `pyproject.toml`.
- `uv run vibe-reader` — start the FastAPI server via the packaged console entry point.
- `uv run uvicorn backend.main:app --host 0.0.0.0 --port 28000 --reload` — launch the live-reload API server for iteration.
- `uv run uvicorn backend.main:app --host 0.0.0.0 --port 28000` — preview production behavior without reload overhead.
- `uv run pytest` — execute the full test suite; add `-k pattern` to target specific features.

## Coding Style & Naming Conventions
- Python: target 3.10+, use four-space indents, and annotate public functions with explicit type hints. Surface API errors through `HTTPException` with clear user messages.
- JavaScript: stay framework-free, use camelCase for DOM refs, and keep helpers concise.
- CSS: retain high-contrast, animation-free utilities tuned for eink displays; reuse tokens before adding rules.
- Share backend logic via dedicated modules rather than duplicating code inside routers.

## Testing Guidelines
- `pytest` with `pytest-asyncio` covers async flows; mock `libtmux.Server` to isolate tmux behavior.
- Maintain ≥80% coverage on new paths and assert boundary cases such as empty sessions, missing panes, or rejected binary uploads.
- Name tests `test_*`, scope fixtures near their usage, and run `uv run pytest` before each pull request.

## Commit & Pull Request Guidelines
- Write commit subjects in imperative mood (e.g., "Add tmux pane guard") and keep bodies focused on rationale and side effects.
- Reference tracked issues with `Fixes #123` when applicable.
- Pull requests should summarize intent, list validation steps (`uv run pytest`, tmux capture checks, file-browser smoke tests), include eink UI screenshots for frontend changes, and request cross-review when work spans backend and frontend.

## Security & Configuration Tips
- Serve the backend through VPN or SSH tunnels; never expose tmux endpoints publicly.
- Document new configuration flags in `README.md` and the Config view.
- Keep proxy credentials and other secrets out of version control by relying on local environment variables.
