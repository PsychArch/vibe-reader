from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import APIRouter, FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool

from backend.rendering import render_text_content
from backend.services.path_service import (
    PathServiceError,
    display_path,
    get_project_root as _get_project_root,
    resolve_and_validate_path as _resolve_and_validate_path,
    resolve_path_within_project as _resolve_path_within_project,
)

# Maximum file size to read (10MB)
MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_HIGHLIGHT_FILE_SIZE = 512 * 1024
MAX_MARKDOWN_RENDER_FILE_SIZE = 1024 * 1024
LARGE_FILE_RENDER_NOTE = "Large file rendered without syntax highlighting."


def get_project_root() -> Path:
    return _get_project_root()


def resolve_path_within_project(path: str) -> Path:
    return _resolve_path_within_project(path)


def resolve_and_validate_path(path: str, must_be_dir: bool = False, must_be_file: bool = False) -> Path:
    return _resolve_and_validate_path(path, must_be_dir=must_be_dir, must_be_file=must_be_file)


@asynccontextmanager
async def files_lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Validate project root during FastAPI lifespan startup."""
    get_project_root()
    yield

router = APIRouter(prefix="/api/files", tags=["files"], lifespan=files_lifespan)


def _should_force_plain_render(path: Path, file_size: int, highlight: bool) -> bool:
    if path.suffix.lower() in {".md", ".markdown"}:
        return file_size > MAX_MARKDOWN_RENDER_FILE_SIZE
    return highlight and file_size > MAX_HIGHLIGHT_FILE_SIZE


def _read_and_render_file(target_path: Path, file_size: int, highlight: bool):
    force_plain = _should_force_plain_render(target_path, file_size, highlight)
    content = target_path.read_text()
    render_result = render_text_content(
        target_path,
        content,
        enable_highlighting=highlight,
        force_plain=force_plain,
    )
    metadata = dict(render_result.metadata)
    if force_plain:
        metadata["large_file"] = "true"
        metadata["render_note"] = LARGE_FILE_RENDER_NOTE
    return render_result, metadata

@router.get("")
async def list_files(path: str = "."):
    """List files in a directory"""
    try:
        project_root = _get_project_root()
        target_path = _resolve_and_validate_path(path, must_be_dir=True, project_root=project_root)

        files = []
        for item in sorted(target_path.iterdir()):
            files.append({
                "name": item.name,
                "path": display_path(project_root, item),
                "is_dir": item.is_dir()
            })
        return files
    except PathServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

@router.get("/content")
async def get_file_content(path: str, highlight: bool = True):
    """Get content of a file"""
    try:
        project_root = _get_project_root()
        target_path = _resolve_and_validate_path(path, must_be_file=True, project_root=project_root)

        # Check file size before reading
        file_size = target_path.stat().st_size
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"File too large (max {MAX_FILE_SIZE // 1024 // 1024}MB)")

        render_result, metadata = await run_in_threadpool(
            _read_and_render_file,
            target_path,
            file_size,
            highlight,
        )

        return {
            "path": display_path(project_root, target_path),
            "render_mode": render_result.mode,
            "html": render_result.html,
            "metadata": metadata,
        }
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Cannot read binary file")
    except PathServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
