from fastapi import APIRouter, HTTPException

from backend.services.tmux_service import TmuxServiceError, get_tmux_service

router = APIRouter(prefix="/api/tmux", tags=["tmux"])

@router.get("/tree")
async def get_tmux_tree():
    """Get complete tmux hierarchy: sessions > windows > panes"""
    try:
        return get_tmux_service().tree_payload()
    except TmuxServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

@router.get("/pane/{session_name}/{window_index}/{pane_index}")
async def get_pane_content(session_name: str, window_index: str, pane_index: str, scrollback: int = 400):
    """Get content from a specific tmux pane"""
    try:
        return {
            "content": get_tmux_service().capture_pane(
                session_name=session_name,
                window_index=window_index,
                pane_index=pane_index,
                scrollback=scrollback,
            )
        }
    except TmuxServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
