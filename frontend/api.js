export async function fetchJSON(url, errorContext, options = {}) {
    let response;
    try {
        response = await fetch(url, options);
    } catch (networkError) {
        if (networkError.name === 'AbortError') {
            throw networkError;
        }

        const error = new Error(`${errorContext}: ${networkError.message}`);
        error.context = errorContext;
        error.url = url;
        error.cause = networkError;
        throw error;
    }

    if (!response.ok) {
        let detail = '';
        try {
            const payload = await response.json();
            if (payload && typeof payload === 'object' && payload.detail) {
                detail = payload.detail;
            } else if (typeof payload === 'string') {
                detail = payload;
            }
        } catch {
            try {
                detail = await response.text();
            } catch {
                detail = '';
            }
        }

        const message = detail ? `${errorContext}: ${detail}` : `Failed to ${errorContext}`;
        const error = new Error(message);
        error.status = response.status;
        error.detail = detail;
        error.context = errorContext;
        error.url = url;
        throw error;
    }

    try {
        return await response.json();
    } catch {
        const error = new Error(`${errorContext}: Invalid JSON response`);
        error.context = errorContext;
        error.url = url;
        throw error;
    }
}

export function loadTmuxTree() {
    return fetchJSON('/api/tmux/tree', 'load tmux tree');
}

export function loadPaneContent({ session, window, pane, scrollbackLines }) {
    return fetchJSON(
        `/api/tmux/pane/${encodeURIComponent(session)}/${encodeURIComponent(window)}/${encodeURIComponent(pane)}?scrollback=${scrollbackLines}`,
        'load pane content'
    );
}

export function loadFiles(path) {
    return fetchJSON(`/api/files?path=${encodeURIComponent(path)}`, 'load files');
}

export function loadFileContent(path, { enableHighlighting, signal } = {}) {
    return fetchJSON(
        `/api/files/content?path=${encodeURIComponent(path)}&highlight=${enableHighlighting}`,
        'load file',
        { signal }
    );
}

export function loadGitStatus(path) {
    return fetchJSON(`/api/git/status?path=${encodeURIComponent(path)}`, 'load git status');
}

export function loadGitDiff(path, source) {
    const sourceLabel = source === 'staged' ? 'staged' : 'unstaged';
    return fetchJSON(
        `/api/git/diff/${sourceLabel}?path=${encodeURIComponent(path)}`,
        `load ${sourceLabel} diff`
    );
}
