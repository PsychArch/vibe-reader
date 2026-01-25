# Git Diff Integration Design

## Purpose
Augment Vibe Reader with a lightweight view over git working tree changes so users can read staged/unstaged diffs, added files, and deletions without leaving the eink-friendly interface.

## Goals
- Surface staged vs unstaged vs untracked (added/removed) paths via a clear API.
- Render unified diffs with the existing syntax-highlighting and markdown pipeline.
- Keep backend logic reusable and testable through a dedicated service layer.
- Fit into the existing Files view with minimal UI disruption.

## Non-Goals
- Full git porcelain parity (no commit creation, branching, or push/pull).
- Historical blame/history beyond the latest staged or unstaged snapshots.
- Advanced diff presentation such as side-by-side or inline comments.

## Architecture Overview
```
frontend/app.js
  ↕ REST
backend/git.py (router)
  ↕ service abstraction
backend/services/git_diff_service.py
  ↔ dulwich.repo.Repo / git CLI fallback
backend/files.get_project_root
  ↕ filesystem validation
```

- All git calls anchor to `get_project_root()` to respect `VIBE_READER_ROOT`.
- `GitDiffService` encapsulates repository discovery, status aggregation, and diff generation, decoupling FastAPI endpoints from dulwich specifics.
- The router focuses on validation, marshaling service results into JSON, and translating errors into HTTP responses.

## Backend Components

### `backend/services/git_diff_service.py`
- Exposes:
  - `status_summary(include_untracked: bool = True)`
    - Returns staged, unstaged, untracked, and deleted arrays with `{ path, change }` objects (`change` ∈ `{"added","modified","deleted","renamed","typechange"}`).
  - `diff_unstaged(path: Optional[Path])`
  - `diff_staged(path: Optional[Path])`
    - Produce unified diff text filtered to a single file or the entire working tree.
- Repository access:
  - Prefer `dulwich.repo.Repo.discover(path)`; fall back to invoking the `git` CLI if dulwich is unavailable (raise `RuntimeError` with human-readable detail).
  - Wrap in `_ensure_repo()` that caches the repo handle (LRU by root path).
- Diff formatting:
  - Generate unified diff text (`str`) and return alongside metadata `{ "path": "...", "source": "unstaged|staged" }`.
  - `render_text_content` integration is handled in the router by passing a fake filename ending in `.diff`.

### `backend/git.py`
- `router = APIRouter(prefix="/api/git", tags=["git"])`.
- Endpoints:
  - `GET /api/git/status`
    - Query params: `include_untracked` (bool, default `true`), `path` (optional relative path).
    - Response:
      ```json
      {
        "staged": [{"path": "backend/files.py", "change": "modified"}],
        "unstaged": [{"path": "frontend/app.js", "change": "modified"}],
        "untracked": ["docs/new.md"],
        "deleted": ["tests/old_test.py"]
      }
      ```
  - `GET /api/git/diff/unstaged`
  - `GET /api/git/diff/staged`
    - Query params: `path` (optional, relative; empty ⇒ aggregated diff).
    - Response integrates with the renderer:
      ```json
      {
        "path": "frontend/app.js",
        "render_mode": "code",
        "html": "...",
        "metadata": {"language": "diff", "source": "unstaged"}
      }
      ```
- Error handling:
  - `HTTPException(503, "Git repository not found")` if no repo detected.
  - `HTTPException(400, "Invalid path")` when outside project root or not tracked.
  - `HTTPException(500, "Git diff failed")` for unexpected dulwich errors.

## Frontend Changes (`frontend/app.js`)
- After `loadFileList()`, fetch `/api/git/status?path=${currentDir}` to annotate entries:
  - Add CSS badges (`file-item--staged`, `file-item--unstaged`, `file-item--untracked`).
  - Maintain a local cache keyed by directory to avoid redundant calls when toggling files or diff view.
- Introduce a “Diff mode” toggle in the Files pane header:
  - When active and a file is selected, load `/api/git/diff/unstaged?path=...` by default; provide a staged/unstaged switch near the content header.
  - If both diffs are empty, fall back to the existing `loadFileContent` behavior.
- Reuse the current content container: set `data-language="DIFF"` and `data-mode="CODE"` to align styling.

## Data Contracts
| Endpoint | Request Params | Response Highlights |
|----------|----------------|---------------------|
| `/api/git/status` | `path`, `include_untracked` | `staged[]`, `unstaged[]`, `untracked[]`, `deleted[]` |
| `/api/git/diff/unstaged` | `path` | `render_mode`, `html`, `metadata.language="diff"` |
| `/api/git/diff/staged` | `path` | Same as unstaged but `metadata.source="staged"` |

- All paths are returned relative to the project root for consistency with `/api/files`.

## Caching Strategy
- `GitDiffService` caches:
  - Repository handle (until process exit or `VIBE_READER_ROOT` change).
  - Last computed status keyed by `(HEAD SHA, index mtime, working tree snapshot, scoped path)` to minimize repeated scans.
- The frontend caches the last status fetch per directory; invalidate on manual refresh or after performing a diff fetch.

## Security and Limits
- All paths validated through `resolve_and_validate_path()` before git operations.
- Respect existing `MAX_FILE_SIZE` indirectly—diff text is generated in-memory but cap responses (e.g., 2 MB). Return 413 with a concise message when exceeded.
- Do not expose commit hashes or author details to keep scope minimal.

## Testing Plan

### Backend (`tests/test_git_diff.py`)
- Fixtures:
  - `tmp_git_repo` fixture initializing a dulwich repo with commits, staged file, unstaged modifications, deleted file, and untracked file.
- Tests:
  - `test_status_lists_staged_unstaged_deleted`.
  - `test_status_scoped_to_subdirectory`.
  - `test_diff_unstaged_returns_unified_patch`.
  - `test_diff_staged_for_new_file`.
  - `test_diff_endpoint_requires_repo`.
  - `test_invalid_path_outside_root_is_rejected`.

### Frontend
- Manual acceptance steps:
  1. Navigate to Files tab.
  2. Toggle Diff mode and verify staged/unstaged badges and diff rendering.
  3. Confirm graceful messaging when there are no diffs.

## Rollout Steps
1. Add `dulwich` dependency in `pyproject.toml` (or document CLI fallback).
2. Implement `GitDiffService` and router, then register it in `backend/main.py`.
3. Update the frontend diff toggle workflow and styling.
4. Write backend tests and run `uv run pytest`.
5. Document usage in `README.md`.

## Future Considerations
- Add `?source=both` to diff endpoints to return staged and unstaged together.
- Expose limited commit history once diff reading sees adoption.
- Explore background polling to refresh status badges when auto-refresh is enabled.
