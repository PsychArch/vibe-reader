from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.files import router as files_router
from backend.git import router as git_router
from backend.tmux import router as tmux_router

app = FastAPI()

# Include routers
app.include_router(tmux_router)
app.include_router(files_router)
app.include_router(git_router)

# Determine frontend directory path (works in both dev and installed package)
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# Serve frontend
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
async def root():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

@app.get("/static/manifest.json")
async def manifest():
    return FileResponse(
        str(FRONTEND_DIR / "manifest.json"),
        media_type="application/manifest+json"
    )

@app.get("/sw.js")
async def service_worker():
    return FileResponse(
        str(FRONTEND_DIR / "sw.js"),
        media_type="application/javascript"
    )

def main():
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(
        description="Vibe Reader - Web application for reading terminal output and code files on eink devices"
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind to (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=28000,
        help="Port to bind to (default: 28000)"
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development"
    )

    args = parser.parse_args()

    uvicorn.run(
        "backend.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload
    )

if __name__ == "__main__":
    main()
