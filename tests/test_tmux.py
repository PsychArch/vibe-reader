from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.services.tmux_service import (
    InvalidScrollbackError,
    TmuxPaneNotFoundError,
    TmuxService,
    TmuxSessionNotFoundError,
    TmuxWindowNotFoundError,
)


@dataclass
class FakePane:
    index: str
    id: str
    pane_active: str = "0"
    content: list[str] = field(default_factory=list)
    starts: list[str] = field(default_factory=list)

    def capture_pane(self, start: str):
        self.starts.append(start)
        return self.content


@dataclass
class FakeWindow:
    index: str
    name: str
    id: str
    panes: list[FakePane]


@dataclass
class FakeSession:
    name: str
    id: str
    windows: list[FakeWindow]


class FakeSessions(list):
    def get(self, session_name: str):
        for session in self:
            if session.name == session_name:
                return session
        return None


class FakeServer:
    def __init__(self, sessions):
        self.sessions = FakeSessions(sessions)


def make_service(sessions) -> TmuxService:
    return TmuxService(server_factory=lambda: FakeServer(sessions))


def test_tree_returns_empty_list_when_no_sessions():
    service = make_service([])

    assert service.tree_payload() == []


def test_tree_serializes_sessions_windows_and_panes():
    service = make_service(
        [
            FakeSession(
                name="dev",
                id="$1",
                windows=[
                    FakeWindow(
                        index="0",
                        name="shell",
                        id="@1",
                        panes=[
                            FakePane(index="0", id="%1", pane_active="1"),
                            FakePane(index="1", id="%2", pane_active="0"),
                        ],
                    )
                ],
            )
        ]
    )

    assert service.tree_payload() == [
        {
            "name": "dev",
            "id": "$1",
            "windows": [
                {
                    "index": "0",
                    "name": "shell",
                    "id": "@1",
                    "panes": [
                        {"index": "0", "id": "%1", "active": True},
                        {"index": "1", "id": "%2", "active": False},
                    ],
                }
            ],
        }
    ]


def test_capture_pane_returns_joined_scrollback():
    pane = FakePane(index="2", id="%2", content=["line 1", "line 2"])
    service = make_service(
        [
            FakeSession(
                name="dev",
                id="$1",
                windows=[FakeWindow(index="1", name="editor", id="@1", panes=[pane])],
            )
        ]
    )

    assert service.capture_pane("dev", "1", "2", scrollback=500) == "line 1\nline 2"
    assert pane.starts == ["-500"]


def test_capture_pane_rejects_invalid_scrollback():
    service = make_service([])

    with pytest.raises(InvalidScrollbackError, match="Scrollback must be between 100 and 10000"):
        service.capture_pane("dev", "1", "2", scrollback=99)


def test_capture_pane_reports_missing_session_window_and_pane():
    service = make_service(
        [
            FakeSession(
                name="dev",
                id="$1",
                windows=[FakeWindow(index="1", name="editor", id="@1", panes=[])],
            )
        ]
    )

    with pytest.raises(TmuxSessionNotFoundError, match="Session not found"):
        service.capture_pane("missing", "1", "0", scrollback=100)

    with pytest.raises(TmuxWindowNotFoundError, match="Window not found"):
        service.capture_pane("dev", "2", "0", scrollback=100)

    with pytest.raises(TmuxPaneNotFoundError, match="Pane not found"):
        service.capture_pane("dev", "1", "0", scrollback=100)


def test_tmux_tree_endpoint_uses_service_payload(monkeypatch):
    class FakeService:
        def tree_payload(self):
            return [{"name": "dev", "id": "$1", "windows": []}]

    monkeypatch.setattr("backend.tmux.get_tmux_service", lambda: FakeService())

    with TestClient(app) as client:
        response = client.get("/api/tmux/tree")

    assert response.status_code == 200
    assert response.json() == [{"name": "dev", "id": "$1", "windows": []}]
