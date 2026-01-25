from fastapi import APIRouter, HTTPException
import libtmux

router = APIRouter(prefix="/api/tmux", tags=["tmux"])

@router.get("/tree")
async def get_tmux_tree():
    """Get complete tmux hierarchy: sessions > windows > panes"""
    try:
        server = libtmux.Server()
        tree = []

        for session in server.sessions:
            session_data = {
                "name": session.name,
                "id": session.id,
                "windows": []
            }

            for window in session.windows:
                window_data = {
                    "index": window.index,
                    "name": window.name,
                    "id": window.id,
                    "panes": []
                }

                for pane in window.panes:
                    pane_data = {
                        "index": pane.index,
                        "id": pane.id,
                        "active": pane.pane_active == '1'
                    }
                    window_data["panes"].append(pane_data)

                session_data["windows"].append(window_data)

            tree.append(session_data)

        return tree
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pane/{session_name}/{window_index}/{pane_index}")
async def get_pane_content(session_name: str, window_index: str, pane_index: str, scrollback: int = 400):
    """Get content from a specific tmux pane"""
    try:
        # Validate scrollback parameter
        if not 100 <= scrollback <= 10000:
            raise HTTPException(status_code=400, detail="Scrollback must be between 100 and 10000")

        server = libtmux.Server()
        session = server.sessions.get(session_name=session_name)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        # Find window by index (not array position)
        window = None
        for w in session.windows:
            if w.index == window_index:
                window = w
                break

        if not window:
            raise HTTPException(status_code=404, detail="Window not found")

        # Find pane by index (not array position)
        pane = None
        for p in window.panes:
            if p.index == pane_index:
                pane = p
                break

        if not pane:
            raise HTTPException(status_code=404, detail="Pane not found")

        # Capture scrollback history
        content = pane.capture_pane(start=f'-{scrollback}')

        return {
            "content": "\n".join(content)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
