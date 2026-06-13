"""Tmux traversal and pane capture helpers."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Callable, List

import libtmux


MIN_SCROLLBACK = 100
MAX_SCROLLBACK = 10000


class TmuxServiceError(RuntimeError):
    """Base class for tmux service failures."""

    status_code = 500


class InvalidScrollbackError(TmuxServiceError):
    """Raised when a scrollback request is outside supported bounds."""

    status_code = 400


class TmuxSessionNotFoundError(TmuxServiceError):
    """Raised when a requested tmux session does not exist."""

    status_code = 404


class TmuxWindowNotFoundError(TmuxServiceError):
    """Raised when a requested tmux window does not exist."""

    status_code = 404


class TmuxPaneNotFoundError(TmuxServiceError):
    """Raised when a requested tmux pane does not exist."""

    status_code = 404


class TmuxBackendError(TmuxServiceError):
    """Raised when tmux/libtmux cannot fulfill a request."""


@dataclass(frozen=True)
class PaneInfo:
    index: str
    id: str
    active: bool


@dataclass(frozen=True)
class WindowInfo:
    index: str
    name: str
    id: str
    panes: List[PaneInfo]


@dataclass(frozen=True)
class SessionInfo:
    name: str
    id: str
    windows: List[WindowInfo]


class TmuxService:
    """Encapsulates libtmux access used by the API layer."""

    def __init__(self, server_factory: Callable[[], Any] = libtmux.Server) -> None:
        self._server_factory = server_factory

    def tree(self) -> List[SessionInfo]:
        try:
            server = self._server_factory()
            return [
                SessionInfo(
                    name=session.name,
                    id=session.id,
                    windows=[
                        WindowInfo(
                            index=window.index,
                            name=window.name,
                            id=window.id,
                            panes=[
                                PaneInfo(
                                    index=pane.index,
                                    id=pane.id,
                                    active=self._is_active_pane(pane),
                                )
                                for pane in window.panes
                            ],
                        )
                        for window in session.windows
                    ],
                )
                for session in server.sessions
            ]
        except TmuxServiceError:
            raise
        except Exception as exc:
            raise TmuxBackendError(str(exc)) from exc

    def capture_pane(self, session_name: str, window_index: str, pane_index: str, scrollback: int) -> str:
        if not MIN_SCROLLBACK <= scrollback <= MAX_SCROLLBACK:
            raise InvalidScrollbackError("Scrollback must be between 100 and 10000")

        try:
            server = self._server_factory()
            session = server.sessions.get(session_name=session_name)
            if not session:
                raise TmuxSessionNotFoundError("Session not found")

            window = self._find_by_index(session.windows, window_index)
            if not window:
                raise TmuxWindowNotFoundError("Window not found")

            pane = self._find_by_index(window.panes, pane_index)
            if not pane:
                raise TmuxPaneNotFoundError("Pane not found")

            content = pane.capture_pane(start=f"-{scrollback}")
            return "\n".join(content)
        except TmuxServiceError:
            raise
        except Exception as exc:
            raise TmuxBackendError(str(exc)) from exc

    def tree_payload(self) -> list[dict[str, Any]]:
        """Return tmux tree data in the existing API response shape."""
        return [asdict(session) for session in self.tree()]

    def _find_by_index(self, items: list[Any], index: str) -> Any:
        for item in items:
            if str(item.index) == str(index):
                return item
        return None

    def _is_active_pane(self, pane: Any) -> bool:
        return str(getattr(pane, "pane_active", "")) == "1"


def get_tmux_service() -> TmuxService:
    return TmuxService()
