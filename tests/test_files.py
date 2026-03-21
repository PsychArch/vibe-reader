import os
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest

# Ensure project root is importable when running in isolated environments
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from fastapi.testclient import TestClient

from backend.main import app


@contextmanager
def client_with_root(root: Path):
    previous = os.environ.get("VIBE_READER_ROOT")
    os.environ["VIBE_READER_ROOT"] = str(root)
    try:
        with TestClient(app) as client:
            yield client
    finally:
        if previous is None:
            os.environ.pop("VIBE_READER_ROOT", None)
        else:
            os.environ["VIBE_READER_ROOT"] = previous


def test_markdown_rendering_with_tables(tmp_path):
    project_root = tmp_path / "proj"
    project_root.mkdir()
    markdown_file = project_root / "doc.md"
    markdown_file.write_text(
        "# Sample\n\n|A|B|\n|---|---|\n|1|2|\n\n```python\nprint('ok')\n```\n",
        encoding="utf-8",
    )

    with client_with_root(project_root) as client:
        response = client.get(
            "/api/files/content",
            params={"path": str(markdown_file)},
        )

    payload = response.json()

    assert payload["render_mode"] == "markdown"
    assert "<table" in payload["html"]
    assert "code-line" in payload["html"]


def test_markdown_mermaid_blocks_render_as_placeholders(tmp_path):
    project_root = tmp_path / "proj"
    project_root.mkdir()
    markdown_file = project_root / "diagram.md"
    markdown_file.write_text(
        (
            "# Diagram\n\n"
            "```mermaid\n"
            "graph TD\n"
            "  Start --> Stop\n"
            "```\n\n"
            "```python\n"
            "print('ok')\n"
            "```\n"
        ),
        encoding="utf-8",
    )

    with client_with_root(project_root) as client:
        response = client.get(
            "/api/files/content",
            params={"path": str(markdown_file)},
        )

    payload = response.json()

    assert payload["render_mode"] == "markdown"
    assert 'class="mermaid-block"' in payload["html"]
    assert 'data-language="MERMAID"' in payload["html"]
    assert 'class="mermaid-source"' in payload["html"]
    assert 'class="code-container code-block"' in payload["html"]
    assert "graph TD" in payload["html"]


def test_markdown_mermaid_blocks_fall_back_to_plain_code_when_highlighting_disabled(tmp_path):
    project_root = tmp_path / "proj"
    project_root.mkdir()
    markdown_file = project_root / "diagram.md"
    markdown_file.write_text(
        "```mermaid\ngraph TD\n  Start --> Stop\n```\n",
        encoding="utf-8",
    )

    with client_with_root(project_root) as client:
        response = client.get(
            "/api/files/content",
            params={"path": str(markdown_file), "highlight": "false"},
        )

    payload = response.json()

    assert payload["render_mode"] == "markdown"
    assert 'class="mermaid-block"' not in payload["html"]
    assert 'class="code-container plain-code"' in payload["html"]
    assert "graph TD" in payload["html"]


def test_code_rendering_returns_language_metadata(tmp_path):
    project_root = tmp_path / "proj"
    project_root.mkdir()
    code_file = project_root / "main.py"
    code_file.write_text("def hello():\n    return 'world'\n", encoding="utf-8")

    with client_with_root(project_root) as client:
        response = client.get(
            "/api/files/content",
            params={"path": str(code_file)},
        )

    payload = response.json()

    assert payload["render_mode"] == "code"
    assert payload["metadata"]["language"] == "python"
    assert "tok-" in payload["html"]


def test_plain_mode_when_no_lexer(tmp_path):
    project_root = tmp_path / "proj"
    project_root.mkdir()
    text_file = project_root / "README"
    text_file.write_text("just some notes", encoding="utf-8")

    with client_with_root(project_root) as client:
        response = client.get(
            "/api/files/content",
            params={"path": str(text_file)},
        )

    payload = response.json()

    assert payload["render_mode"] == "plain"
    assert "line-code" in payload["html"]


def test_list_files_respects_configured_root(tmp_path):
    project_root = tmp_path / "proj"
    project_root.mkdir()
    (project_root / "child.txt").write_text("hello", encoding="utf-8")

    with client_with_root(project_root) as client:
        response = client.get("/api/files")

    assert response.status_code == 200
    payload = response.json()
    names = {entry["name"] for entry in payload}
    assert "child.txt" in names


def test_relative_paths_resolve_from_project_root(tmp_path):
    project_root = tmp_path / "proj"
    project_root.mkdir()
    note = project_root / "note.txt"
    note.write_text("notes", encoding="utf-8")

    with client_with_root(project_root) as client:
        response = client.get(
            "/api/files/content",
            params={"path": "note.txt"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["path"] == "note.txt"


def test_startup_fails_when_root_is_not_directory(tmp_path):
    bogus_root = tmp_path / "bogus"
    bogus_root.write_text("not a directory", encoding="utf-8")

    previous = os.environ.get("VIBE_READER_ROOT")
    os.environ["VIBE_READER_ROOT"] = str(bogus_root)

    try:
        with pytest.raises(RuntimeError):
            with TestClient(app):
                pass
    finally:
        if previous is None:
            os.environ.pop("VIBE_READER_ROOT", None)
        else:
            os.environ["VIBE_READER_ROOT"] = previous
