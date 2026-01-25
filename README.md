# Vibe Reader

Read terminal output and code files on your eink device. Designed for comfortable reading during vibe coding sessions.

## Features

### Tmux Integration
- Browse and view tmux session/window/pane output
- **1000-line scrollback history** capture (configurable)
- **Smart auto-scroll**: Follow content end or freeze position
- **Visual scrollbar**: Shows position in scrollback and viewport size

### File Browser
- Navigate directories and view file contents
- Visual scrollbar showing file length and current position
- Server-side syntax highlighting for code and Markdown (tables supported)

### Configuration
- Adjustable scrollback lines (100-10000)
- Font size selection (12-20px)
- Settings persist via localStorage

### Eink-Optimized UI
- High contrast, large fonts, no animations
- Collapsible sidebar, compact window display
- Page up/down buttons for manual scrolling
- Single-page design that fits viewport

## Quick Start

```bash
# Install dependencies
uv sync

# Start server via packaged entry point (restricts file browsing to current directory by default)
uv run vibe-reader

# Or run uvicorn directly (same behavior as above)
uv run uvicorn backend.main:app --host 0.0.0.0 --port 28000

# Optional: Set custom project root for file browser (works with either command)
VIBE_READER_ROOT=/path/to/project uv run vibe-reader

# Open on your eink device
# Navigate to: http://YOUR_SERVER_IP:28000
```

## Usage

### Tmux View
- Click **☰** to toggle sidebar
- Select session → window (→ pane if multiple)
- Click **Refresh** to update content
- Use **Page ↑/↓** for manual scrolling
- Toggle **Auto↓** to enable/disable auto-scroll to end
- **Scrollbar** shows your position in scrollback history

### Files View
- Enter path or browse directories
- Click folders to navigate, files to view
- **Page ↑/↓** for scrolling
- **Scrollbar** shows file length and current position
- **Security**: File browsing is restricted to the project root (configurable via `VIBE_READER_ROOT`)
- **File size limit**: Maximum 10MB per file

### Config View
- Adjust scrollback lines (100-10000, default 1000)
- Change font size (12-20px, default 14px)
- Set auto-refresh interval (0-60 seconds, default 5s)
- Click **Save Settings** to persist changes

## Technical Details

**Backend**: FastAPI + libtmux
**Frontend**: Vanilla JS, eink-optimized CSS
**Package Manager**: uv

### Environment Variables

- `VIBE_READER_ROOT`: Sets the root directory for file browsing (default: current working directory)
  - Files outside this directory cannot be accessed
  - Use this to restrict file browsing to a specific project

### API Endpoints

**Tmux:**
- `GET /api/tmux/tree` - List all sessions/windows/panes
- `GET /api/tmux/pane/{session}/{window}/{pane}?scrollback=1000` - Get pane content with configurable scrollback

**Files:**
- `GET /api/files?path=.` - List directory contents (relative to project root)
- `GET /api/files/content?path=file.txt` - Render file content (max 10MB) with fields `path`, `render_mode`, `html`, and `metadata`

## Design Principles

1. **Eink-first**: No animations, high contrast, instant updates
2. **Minimal overhead**: Direct tmux capture, simple file operations
3. **Space-efficient**: Every pixel counts on small eink screens
4. **Single-page**: All content fits viewport, reduces refresh artifacts

## Project Structure

```
vibe-reader/
   backend/
      main.py          # FastAPI app with router includes
      tmux.py          # Tmux endpoints
      files.py         # File browser endpoints
   frontend/
      index.html       # Single-page UI (Tmux/Files/Config views)
      styles.css       # Eink-optimized styles
      app.js           # Client logic with scrollbar management
   pyproject.toml       # uv configuration
```


## Requirements

- Python 3.13+
- tmux (for tmux viewing feature)
- Modern browser on eink device

## License

MIT
