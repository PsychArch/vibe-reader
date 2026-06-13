"""Git-related API endpoints."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from backend.rendering import render_text_content
from backend.services.git_diff_service import (
    DiffTooLargeError,
    GitRepositoryNotFound,
    get_git_diff_service,
)
from backend.services.path_service import (
    PathServiceError,
    display_path as path_for_response,
    get_project_root,
    resolve_and_validate_path,
    resolve_path_within_project,
    scope_from_path,
)

router = APIRouter(prefix="/api/git", tags=["git"])


@router.get("/status")
async def git_status(
    include_untracked: bool = Query(True, description="Include untracked files in the response"),
    path: Optional[str] = Query(None, description="Optional path scoped to the project root"),
):
    project_root = get_project_root()
    service = get_git_diff_service(project_root)

    scope: Optional[str] = None
    if path:
        try:
            target = resolve_and_validate_path(path, project_root=project_root)
        except PathServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        scope = scope_from_path(project_root, target)

    try:
        summary = service.status_summary(include_untracked=include_untracked, scope=scope)
    except GitRepositoryNotFound as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "staged": [{"path": entry.path, "change": entry.change} for entry in summary.staged],
        "unstaged": [{"path": entry.path, "change": entry.change} for entry in summary.unstaged],
        "untracked": summary.untracked,
        "deleted": summary.deleted,
    }


def _render_diff(diff_text: str, source: str) -> dict:
    render_result = render_text_content(Path("virtual.diff"), diff_text, enable_highlighting=True)
    metadata = dict(render_result.metadata)
    metadata.update({"language": "diff", "source": source})
    return {
        "render_mode": render_result.mode,
        "html": render_result.html,
        "metadata": metadata,
        "text": diff_text,
    }


@router.get("/diff/unstaged")
async def git_diff_unstaged(
    path: Optional[str] = Query(None, description="Optional file or directory relative to the project root"),
):
    return await _diff_response(path=path, staged=False)


@router.get("/diff/staged")
async def git_diff_staged(
    path: Optional[str] = Query(None, description="Optional file or directory relative to the project root"),
):
    return await _diff_response(path=path, staged=True)


async def _diff_response(path: Optional[str], staged: bool) -> dict:
    project_root = get_project_root()
    service = get_git_diff_service(project_root)

    target_path: Optional[Path] = None
    scope: Optional[str] = None
    if path:
        try:
            target_path = resolve_path_within_project(path, project_root=project_root)
        except PathServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        scope = scope_from_path(project_root, target_path)

    try:
        diff_result = service.diff_staged(scope) if staged else service.diff_unstaged(scope)
    except GitRepositoryNotFound as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DiffTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc

    payload = _render_diff(diff_result.text, diff_result.source)
    response_path = diff_result.path
    if response_path is None and target_path is not None:
        response_path = path_for_response(project_root, target_path)
    payload.update({"path": response_path})
    return payload
