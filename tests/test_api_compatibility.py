"""Public request and static asset contracts across dependency upgrades."""
import asyncio
from pathlib import Path
import sys

import httpx2
import pytest
from dulwich import porcelain
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.main import FRONTEND_DIR, app
from backend.services.git_diff_service import reset_git_diff_service_cache


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VIBE_READER_ROOT", str(tmp_path))
    (tmp_path / "中文 & note.md").write_text(
        "# 阅读\n\n|A|B|\n|---|---|\n|1|2|\n\n```python\nprint('<ok>')\n```\n",
        encoding="utf-8",
    )
    repo = porcelain.init(str(tmp_path))
    porcelain.add(repo, paths=["中文 & note.md"])
    porcelain.commit(repo, message=b"Seed", author=b"Test <test@example.com>")
    (tmp_path / "new.txt").write_text("untracked", encoding="utf-8")
    reset_git_diff_service_cache()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        reset_git_diff_service_cache()
        repo.close()


@pytest.mark.parametrize("url", [
    "/api/files", "/api/files/content?path=中文%20%26%20note.md",
    "/api/git/status", "/api/git/diff/staged", "/api/git/diff/unstaged",
])
def test_unknown_query_header_and_cookie_do_not_change_response(client, url):
    baseline = client.get(url)
    separator = "&" if "?" in url else "?"
    response = client.get(
        f"{url}{separator}unused=1", headers={"X-Reader-Extra": "1", "Cookie": "unused=1"},
    )
    assert baseline.status_code == response.status_code == 200
    assert response.json() == baseline.json()


@pytest.mark.parametrize("value", ["false", "0", "off"])
def test_boolean_query_coercion_preserves_plain_reading(client, value):
    response = client.get("/api/files/content", params={"path": "中文 & note.md", "highlight": value})
    assert response.status_code == 200
    payload = response.json()
    assert payload["path"] == "中文 & note.md"
    assert "<table>" in payload["html"]
    assert 'class="code-container plain-code"' in payload["html"]
    assert "tok-" not in payload["html"]
    status = client.get("/api/git/status", params={"include_untracked": value, "unused": "1"})
    assert status.status_code == 200
    assert status.json()["untracked"] == []


@pytest.mark.parametrize("url,field,kind", [
    ("/api/files/content", "path", "missing"),
    ("/api/files/content?path=new.txt&highlight=invalid", "highlight", "bool_parsing"),
    ("/api/git/status?include_untracked=invalid", "include_untracked", "bool_parsing"),
    ("/api/tmux/pane/dev/0/0?scrollback=invalid", "scrollback", "int_parsing"),
])
def test_invalid_queries_keep_validation_contract(client, url, field, kind):
    response = client.get(url)
    assert response.status_code == 422
    error = response.json()["detail"][0]
    assert error["loc"] == ["query", field]
    assert error["type"] == kind


def test_repeated_query_uses_last_value(client):
    response = client.get("/api/files/content?path=missing&path=new.txt&highlight=true&highlight=false")
    assert response.status_code == 200
    assert response.json()["path"] == "new.txt"


def test_tmux_path_and_integer_query_contract(client, monkeypatch):
    calls = []

    class FakeService:
        def capture_pane(self, **kwargs):
            calls.append(kwargs)
            return "终端\nready"

    monkeypatch.setattr("backend.tmux.get_tmux_service", FakeService)
    response = client.get("/api/tmux/pane/work%20session/0/1?scrollback=800&unused=1")
    assert response.status_code == 200
    assert response.json() == {"content": "终端\nready"}
    assert calls == [{"session_name": "work session", "window_index": "0", "pane_index": "1", "scrollback": 800}]


@pytest.mark.parametrize("url,name", [("/", "index.html"), ("/sw.js", "sw.js"),
                                      ("/static/styles.css", "styles.css"),
                                      ("/static/manifest.json", "manifest.json")])
def test_reader_assets_keep_bytes_and_cache_headers(client, url, name):
    response = client.get(url)
    assert response.status_code == 200
    assert response.content == (FRONTEND_DIR / name).read_bytes()
    assert response.headers["content-length"] == str(len(response.content))
    assert "etag" in response.headers
    assert "last-modified" in response.headers
    if url.startswith("/static/"):
        cached = client.get(url, headers={"If-None-Match": response.headers["etag"]})
        assert cached.status_code == 304
        assert cached.content == b""


def test_testclient_redirect_and_range_support(client):
    redirect = client.get("/api/files/", follow_redirects=False)
    assert redirect.status_code == 307
    assert redirect.headers["location"].endswith("/api/files")
    assert client.get("/api/files/").json() == client.get("/api/files").json()
    response = client.get("/static/styles.css", headers={"Range": "bytes=0-15"})
    assert response.status_code == 206
    assert response.content == (FRONTEND_DIR / "styles.css").read_bytes()[:16]


def test_httpx2_async_transport_ignores_unrelated_cookies(client):
    async def request():
        async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://testserver") as http:
            http.cookies.set("reader", "same-host", domain="testserver.local", path="/api")
            http.cookies.set("reader", "other-host", domain="example.org", path="/")
            response = await http.get("/api/files/content", params={"path": "new.txt", "highlight": "false"})
            assert "other-host" not in response.request.headers.get("cookie", "")
            assert response.status_code == 200
            return response.json()

    assert asyncio.run(request()) == client.get("/api/files/content?path=new.txt&highlight=false").json()
