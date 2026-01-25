import os
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest
from dulwich import porcelain
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.main import app  # noqa: E402
from backend.services.git_diff_service import (  # noqa: E402
    GitDiffService,
    reset_git_diff_service_cache,
)


AUTHOR = b"Vibe Reader <vibe@example.com>"


def _seed_repo(repo_path: Path) -> None:
    repo_path.mkdir(parents=True, exist_ok=True)
    porcelain.init(str(repo_path))

    # Seed initial tracked files.
    (repo_path / "tracked.txt").write_text("line 1\n", encoding="utf-8")
    (repo_path / "remove.txt").write_text("remove me\n", encoding="utf-8")
    (repo_path / "nested").mkdir()
    (repo_path / "nested" / "scoped.txt").write_text("scoped content\n", encoding="utf-8")

    porcelain.add(str(repo_path), paths=["tracked.txt", "remove.txt", "nested/scoped.txt"])
    porcelain.commit(str(repo_path), message=b"Initial commit", author=AUTHOR, committer=AUTHOR)

    # Introduce staged, unstaged, and untracked changes.
    (repo_path / "tracked.txt").write_text("line 1\nline 2\n", encoding="utf-8")  # unstaged modification
    (repo_path / "nested" / "scoped.txt").write_text(
        "scoped content\nupdated\n", encoding="utf-8"
    )  # unstaged modification

    (repo_path / "staged.txt").write_text("staged addition\n", encoding="utf-8")
    porcelain.add(str(repo_path), paths=["staged.txt"])

    porcelain.rm(str(repo_path), paths=["remove.txt"])  # staged deletion

    (repo_path / "untracked.txt").write_text("untracked file\n", encoding="utf-8")


@pytest.fixture()
def git_repo(tmp_path: Path) -> Path:
    repo_path = tmp_path / "repo"
    _seed_repo(repo_path)
    return repo_path


@pytest.fixture()
def git_service(git_repo: Path) -> GitDiffService:
    reset_git_diff_service_cache()
    service = GitDiffService(git_repo)
    try:
        yield service
    finally:
        reset_git_diff_service_cache()


@contextmanager
def client_for_repo(root: Path):
    previous = os.environ.get("VIBE_READER_ROOT")
    os.environ["VIBE_READER_ROOT"] = str(root)
    reset_git_diff_service_cache()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        reset_git_diff_service_cache()
        if previous is None:
            os.environ.pop("VIBE_READER_ROOT", None)
        else:
            os.environ["VIBE_READER_ROOT"] = previous


def _paths(entries):
    return {entry.path for entry in entries}


def test_status_summary_captures_all_changes(git_service: GitDiffService):
    summary = git_service.status_summary()

    staged_paths = {entry.path: entry.change for entry in summary.staged}
    assert staged_paths["staged.txt"] == "added"
    assert staged_paths["remove.txt"] == "deleted"

    unstaged_paths = {entry.path: entry.change for entry in summary.unstaged}
    assert unstaged_paths["tracked.txt"] == "modified"
    assert unstaged_paths["nested/scoped.txt"] == "modified"

    assert "untracked.txt" in summary.untracked
    assert "remove.txt" in summary.deleted


def test_status_summary_scope_filters_results(git_service: GitDiffService):
    scoped = git_service.status_summary(scope="nested")

    assert _paths(scoped.staged) == set()
    assert _paths(scoped.unstaged) == {"nested/scoped.txt"}
    assert scoped.untracked == []
    assert scoped.deleted == []


def test_diff_unstaged_returns_patch(git_service: GitDiffService):
    diff = git_service.diff_unstaged(scope="tracked.txt")

    assert diff.path == "tracked.txt"
    assert diff.source == "unstaged"
    assert "diff --git a/tracked.txt b/tracked.txt" in diff.text
    assert "+line 2" in diff.text


def test_diff_staged_new_file(git_service: GitDiffService):
    diff = git_service.diff_staged(scope="staged.txt")

    assert diff.path == "staged.txt"
    assert diff.source == "staged"
    assert "diff --git a/staged.txt b/staged.txt" in diff.text
    assert "+++ b/staged.txt" in diff.text
    assert "+staged addition" in diff.text


def test_status_endpoint_matches_service(git_repo: Path):
    with client_for_repo(git_repo) as client:
        response = client.get("/api/git/status")

    assert response.status_code == 200
    payload = response.json()

    assert {"path": "staged.txt", "change": "added"} in payload["staged"]
    assert {"path": "remove.txt", "change": "deleted"} in payload["staged"]
    assert {"path": "tracked.txt", "change": "modified"} in payload["unstaged"]
    assert {"path": "nested/scoped.txt", "change": "modified"} in payload["unstaged"]
    assert "untracked.txt" in payload["untracked"]
    assert "remove.txt" in payload["deleted"]


def test_diff_endpoints_return_render_payload(git_repo: Path):
    with client_for_repo(git_repo) as client:
        unstaged = client.get("/api/git/diff/unstaged", params={"path": "tracked.txt"})
        staged = client.get("/api/git/diff/staged", params={"path": "staged.txt"})

    assert unstaged.status_code == 200
    unstaged_payload = unstaged.json()
    assert unstaged_payload["path"] == "tracked.txt"
    assert unstaged_payload["metadata"]["source"] == "unstaged"
    assert unstaged_payload["metadata"]["language"] == "diff"
    assert "diff --git" in unstaged_payload["text"]

    assert staged.status_code == 200
    staged_payload = staged.json()
    assert staged_payload["path"] == "staged.txt"
    assert staged_payload["metadata"]["source"] == "staged"
    assert staged_payload["metadata"]["language"] == "diff"
    assert "diff --git" in staged_payload["text"]


def test_git_status_requires_repository(tmp_path: Path):
    empty_root = tmp_path / "empty"
    empty_root.mkdir()

    with client_for_repo(empty_root) as client:
        response = client.get("/api/git/status")

    assert response.status_code == 503
    assert response.json()["detail"] == "Git repository not found"


def test_diff_endpoint_rejects_path_outside_root(git_repo: Path):
    with client_for_repo(git_repo) as client:
        response = client.get("/api/git/diff/unstaged", params={"path": "../outside"})

    assert response.status_code == 403
