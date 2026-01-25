"""Git diff aggregation helpers for Vibe Reader."""
from __future__ import annotations

import io
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Literal, Optional, Sequence, Tuple

from dulwich import porcelain
from dulwich.errors import NotGitRepository
from dulwich.repo import Repo

ChangeType = Literal["added", "modified", "deleted", "renamed", "typechange"]
DiffSource = Literal["unstaged", "staged"]


class GitRepositoryNotFound(RuntimeError):
    """Raised when a git repository cannot be discovered."""


class DiffTooLargeError(RuntimeError):
    """Raised when a generated diff exceeds configured caps."""


@dataclass(frozen=True)
class StatusEntry:
    """Normalized status entry."""

    path: str
    change: ChangeType


@dataclass(frozen=True)
class StatusSummary:
    """Captured git status data scoped to the project root."""

    staged: List[StatusEntry]
    unstaged: List[StatusEntry]
    untracked: List[str]
    deleted: List[str]


@dataclass(frozen=True)
class DiffResult:
    """Unified diff output and provenance."""

    path: Optional[str]
    source: DiffSource
    text: str


@dataclass
class _StatusCacheEntry:
    signature: Tuple[Optional[str], int, int, Optional[str], bool]
    summary: StatusSummary


_MAX_DIFF_BYTES = 2 * 1024 * 1024


class GitDiffService:
    """Encapsulates dulwich interactions used by the API layer."""

    def __init__(self, project_root: Path) -> None:
        self._project_root = project_root.resolve()
        self._repo: Optional[Repo] = None
        self._repo_root: Optional[Path] = None
        self._project_prefix: Optional[str] = None
        self._status_cache: Dict[Tuple[Optional[str], bool], _StatusCacheEntry] = {}

    def status_summary(self, include_untracked: bool = True, scope: Optional[str] = None) -> StatusSummary:
        repo = self._ensure_repo()
        scope_key = self._normalize_scope(scope)
        signature = self._build_status_signature(repo, scope_key, include_untracked)

        cache_key = (scope_key, include_untracked)
        cached = self._status_cache.get(cache_key)
        if cached and cached.signature == signature:
            return cached.summary

        untracked_mode = "normal" if include_untracked else "no"
        status = porcelain.status(repo, untracked_files=untracked_mode)

        staged = self._collect_staged(status.staged, scope_key)
        unstaged = self._collect_unstaged(status.unstaged, scope_key)
        untracked = self._collect_untracked(status.untracked, scope_key, include_untracked)
        deleted_paths = sorted({entry.path for entry in staged if entry.change == "deleted"} |
                               {entry.path for entry in unstaged if entry.change == "deleted"})

        summary = StatusSummary(
            staged=staged,
            unstaged=unstaged,
            untracked=untracked,
            deleted=deleted_paths,
        )
        self._status_cache[cache_key] = _StatusCacheEntry(signature=signature, summary=summary)
        return summary

    def diff_unstaged(self, scope: Optional[str] = None) -> DiffResult:
        return self._diff(scope=scope, staged=False)

    def diff_staged(self, scope: Optional[str] = None) -> DiffResult:
        return self._diff(scope=scope, staged=True)

    def _diff(self, scope: Optional[str], staged: bool) -> DiffResult:
        repo = self._ensure_repo()
        scope_key = self._normalize_scope(scope)
        repo_paths = self._to_repo_paths(scope_key)

        buffer = io.BytesIO()
        porcelain.diff(repo, staged=staged, paths=repo_paths, outstream=buffer)
        diff_bytes = buffer.getvalue()

        if len(diff_bytes) > _MAX_DIFF_BYTES:
            raise DiffTooLargeError("Diff output exceeds 2MB limit")

        text = diff_bytes.decode("utf-8", errors="replace")
        return DiffResult(path=scope_key, source="staged" if staged else "unstaged", text=text)

    def _ensure_repo(self) -> Repo:
        if self._repo is not None:
            return self._repo

        try:
            repo = Repo.discover(str(self._project_root))
        except NotGitRepository as exc:
            raise GitRepositoryNotFound("Git repository not found") from exc

        repo_root = Path(repo.path).resolve()
        try:
            project_prefix = self._project_root.relative_to(repo_root)
            prefix = project_prefix.as_posix()
            if prefix == ".":
                prefix = ""
        except ValueError as exc:
            raise GitRepositoryNotFound("Project root is not inside the git repository") from exc

        self._repo = repo
        self._repo_root = repo_root
        self._project_prefix = prefix or None
        return repo

    def _collect_staged(self, staged: Dict[str, Sequence[bytes]], scope: Optional[str]) -> List[StatusEntry]:
        entries: List[StatusEntry] = []
        for change_key, raw_paths in staged.items():
            change = self._map_change(change_key)
            for raw_path in raw_paths:
                rel = self._strip_prefix(self._decode_path(raw_path))
                if rel is None or not self._in_scope(rel, scope):
                    continue
                entries.append(StatusEntry(path=rel, change=change))
        return sorted(entries, key=lambda item: item.path)

    def _collect_unstaged(self, unstaged: Sequence[bytes], scope: Optional[str]) -> List[StatusEntry]:
        entries: List[StatusEntry] = []
        for raw_path in unstaged:
            rel = self._strip_prefix(self._decode_path(raw_path))
            if rel is None or not self._in_scope(rel, scope):
                continue
            abs_path = self._project_root if rel == "" else self._project_root / rel
            change: ChangeType = "modified" if abs_path.exists() else "deleted"
            entries.append(StatusEntry(path=rel, change=change))
        return sorted(entries, key=lambda item: item.path)

    def _collect_untracked(
        self,
        untracked: Sequence[str | bytes],
        scope: Optional[str],
        include_untracked: bool,
    ) -> List[str]:
        if not include_untracked:
            return []
        results: List[str] = []
        for raw in untracked:
            rel = self._strip_prefix(self._decode_path(raw))
            if rel is None or not self._in_scope(rel, scope):
                continue
            results.append(rel)
        return sorted({path.rstrip("/") for path in results if path})

    def _map_change(self, change_key: str) -> ChangeType:
        mapping = {
            "add": "added",
            "modify": "modified",
            "delete": "deleted",
            "rename": "renamed",
            "typechange": "typechange",
        }
        return mapping.get(change_key, "modified")

    def _decode_path(self, value: str | bytes) -> str:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return value

    def _strip_prefix(self, path: str) -> Optional[str]:
        path = path.replace("\\", "/")
        prefix = self._project_prefix
        if not prefix:
            return path
        if path == prefix:
            return ""
        if path.startswith(prefix + "/"):
            stripped = path[len(prefix) + 1 :]
            return stripped.replace("\\", "/")
        return None

    def _normalize_scope(self, scope: Optional[str]) -> Optional[str]:
        if scope is None:
            return None
        normalized = scope.strip().replace("\\", "/")
        if normalized.startswith("./"):
            normalized = normalized[2:]
        if normalized in {"", "."}:
            return None
        return normalized

    def _in_scope(self, path: str, scope: Optional[str]) -> bool:
        if scope is None or scope == "":
            return True
        if path == scope:
            return True
        return path.startswith(scope.rstrip("/") + "/")

    def _to_repo_paths(self, scope: Optional[str]) -> Optional[List[str]]:
        prefix = self._project_prefix
        if scope is None:
            if prefix:
                return [prefix]
            return None

        if prefix:
            if not scope:
                return [prefix]
            return [f"{prefix}/{scope}".strip("/")]

        return [scope]

    def _build_status_signature(
        self,
        repo: Repo,
        scope: Optional[str],
        include_untracked: bool,
    ) -> Tuple[Optional[str], int, int, Optional[str], bool]:
        head_hex = self._read_head_hex(repo)
        index_stat = self._stat_path(Path(repo.index_path()))
        worktree_signature = self._fingerprint_scope(scope)
        return (
            head_hex,
            index_stat.st_mtime_ns if index_stat else 0,
            index_stat.st_size if index_stat else 0,
            worktree_signature,
            include_untracked,
        )

    def _read_head_hex(self, repo: Repo) -> Optional[str]:
        try:
            head_bytes = repo.head()
        except Exception:
            head_bytes = None

        if isinstance(head_bytes, bytes):
            try:
                return head_bytes.decode("ascii")
            except UnicodeDecodeError:
                return head_bytes.hex()
        if isinstance(head_bytes, str):
            return head_bytes
        return None

    def _stat_path(self, path: Path):
        try:
            return path.stat()
        except FileNotFoundError:
            return None

    def _fingerprint_scope(self, scope: Optional[str]) -> Optional[str]:
        base = self._project_root if scope is None else (self._project_root / scope)
        if not base.exists():
            return None

        if base.is_file():
            stat = self._stat_path(base)
            if not stat:
                return None
            token = f"{base.relative_to(self._project_root).as_posix()}:{stat.st_size}:{stat.st_mtime_ns}"
            return token

        components: List[str] = []
        for root, dirs, files in os.walk(base):
            dirs[:] = [name for name in dirs if name != ".git"]
            root_path = Path(root)
            try:
                root_stat = root_path.stat()
            except FileNotFoundError:
                continue
            components.append(f"d:{root_path.relative_to(self._project_root).as_posix()}:{root_stat.st_mtime_ns}")
            for name in files:
                file_path = root_path / name
                try:
                    stat = file_path.stat()
                except FileNotFoundError:
                    components.append(f"f:{file_path.relative_to(self._project_root).as_posix()}:missing")
                    continue
                components.append(
                    f"f:{file_path.relative_to(self._project_root).as_posix()}:{stat.st_size}:{stat.st_mtime_ns}"
                )
        if not components:
            return None
        components.sort()
        return "|".join(components)


@lru_cache(maxsize=8)
def _service_cache(root: str) -> GitDiffService:
    return GitDiffService(Path(root))


def get_git_diff_service(project_root: Path) -> GitDiffService:
    return _service_cache(str(project_root.resolve()))


def reset_git_diff_service_cache() -> None:
    _service_cache.cache_clear()
