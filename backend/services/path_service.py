"""Project-root and path validation helpers."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


class PathServiceError(RuntimeError):
    """Base class for project path validation failures."""

    status_code = 400


class PathOutsideProjectError(PathServiceError):
    """Raised when a requested path escapes the configured project root."""

    status_code = 403


class ProjectPathNotFoundError(PathServiceError):
    """Raised when a requested path does not exist."""

    status_code = 404


class ProjectPathTypeError(PathServiceError):
    """Raised when a requested path is not the expected filesystem type."""


def get_project_root() -> Path:
    """Get configurable project root. Defaults to current working directory."""
    configured_root = os.getenv("VIBE_READER_ROOT")
    root_path = Path(configured_root).expanduser() if configured_root else Path.cwd()
    resolved_root = root_path.resolve()

    if not resolved_root.exists():
        raise RuntimeError("Configured VIBE_READER_ROOT does not exist")

    if not resolved_root.is_dir():
        raise RuntimeError("Configured VIBE_READER_ROOT is not a directory")

    return resolved_root


def resolve_path_within_project(path: str, project_root: Optional[Path] = None) -> Path:
    """Resolve a path relative to the project root, allowing missing targets."""
    root = (project_root or get_project_root()).resolve()
    raw_path = Path(path)

    if raw_path.is_absolute():
        target_path = raw_path.resolve(strict=False)
    else:
        target_path = (root / raw_path).resolve(strict=False)

    try:
        target_path.relative_to(root)
    except ValueError as exc:
        raise PathOutsideProjectError("Access denied: path outside project root") from exc

    return target_path


def resolve_and_validate_path(
    path: str,
    *,
    must_be_dir: bool = False,
    must_be_file: bool = False,
    project_root: Optional[Path] = None,
) -> Path:
    """Resolve path and validate it is within the project root."""
    target_path = resolve_path_within_project(path, project_root=project_root)

    if not target_path.exists():
        raise ProjectPathNotFoundError("Path not found")

    if must_be_dir and not target_path.is_dir():
        raise ProjectPathTypeError("Path is not a directory")

    if must_be_file and target_path.is_dir():
        raise ProjectPathTypeError("Path is a directory")

    return target_path


def display_path(project_root: Path, target: Path) -> str:
    """Return a stable API path relative to the project root when possible."""
    try:
        relative = target.relative_to(project_root).as_posix()
    except ValueError:
        return target.as_posix()
    return "." if relative == "." else relative


def scope_from_path(project_root: Path, target: Path) -> Optional[str]:
    """Convert an absolute project path to a git/file scope string."""
    try:
        relative = target.relative_to(project_root).as_posix()
    except ValueError:
        return None
    return None if relative in {"", "."} else relative
