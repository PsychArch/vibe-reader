// UI Elements
const tmuxBtn = document.getElementById('tmuxBtn');
const filesBtn = document.getElementById('filesBtn');
const configBtn = document.getElementById('configBtn');
const tmuxView = document.getElementById('tmuxView');
const filesView = document.getElementById('filesView');
const configView = document.getElementById('configView');
const paneRefreshBtn = document.getElementById('paneRefreshBtn');
const toggleSidebar = document.getElementById('toggleSidebar');
const autoRefreshBtn = document.getElementById('autoRefreshBtn');
const tmuxNavControls = document.getElementById('tmuxNavControls');
const filesNavControls = document.getElementById('filesNavControls');

// Config elements
const scrollbackLinesSelect = document.getElementById('scrollbackLines');
const fontSizeSelect = document.getElementById('fontSize');
const markdownFontFamilySelect = document.getElementById('markdownFontFamily');
const refreshIntervalSelect = document.getElementById('refreshInterval');
const refreshIdleTimeoutSelect = document.getElementById('refreshIdleTimeout');
const enableSyntaxHighlightingCheckbox = document.getElementById('enableSyntaxHighlighting');
const diffSourcePreferenceSelect = document.getElementById('diffSourcePreference');

// Sidebar elements
const tmuxSidebar = document.getElementById('tmuxSidebar');
const filesSidebar = document.getElementById('filesSidebar');

// Tmux elements
const tmuxTree = document.getElementById('tmuxTree');
const tmuxContent = document.getElementById('tmuxContent');
const pageUpTmux = document.getElementById('pageUpTmux');
const pageDownTmux = document.getElementById('pageDownTmux');
const tmuxTreeRefreshBtn = document.getElementById('refreshTmuxTreeBtn');

// Files elements
const currentPathDisplay = document.getElementById('currentPath');
const loadFiles = document.getElementById('loadFiles');
const fileList = document.getElementById('fileList');
const fileContentContainer = document.getElementById('fileContentContainer');
const fileContent = document.getElementById('fileContent');
const pageUpFiles = document.getElementById('pageUpFiles');
const pageDownFiles = document.getElementById('pageDownFiles');
const diffModeToggle = document.getElementById('diffModeToggle');

// Current view state
const DEFAULT_REFRESH_INTERVAL = 5;
const SCROLL_LOCK_EPSILON = 4;
let currentView = 'tmux';
let selectedPane = null;
let selectedFile = null;
let currentDirectory = '.';
let shouldAutoScroll = true;
let sidebarCollapsed = false;
let refreshIntervalId = null;
let autoRefreshEnabled = false;
let currentRefreshInterval = DEFAULT_REFRESH_INTERVAL;
let idleTimeoutId = null;
let currentIdleTimeoutMinutes = 10;
let toastTimeoutId = null;
let configInitialized = false;
let diffModeEnabled = false;
let diffSource = 'unstaged';
let gitStatusCache = new Map();
let currentDiffRequestId = 0;
let selectedFileIsDeleted = false;

function isNearBottom(element) {
    if (!element) {
        return true;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom <= SCROLL_LOCK_EPSILON;
}

function clearTmuxSelectionHighlights() {
    if (!tmuxTree) {
        return;
    }

    tmuxTree
        .querySelectorAll(
            '.tree-session-name.active, .tree-window-name.active, .tree-pane.active'
        )
        .forEach((element) => element.classList.remove('active'));
}

function applyTmuxSelectionHighlight() {
    if (!tmuxTree || !selectedPane) {
        return false;
    }

    const sessionName = String(selectedPane.session);
    const windowIndex = String(selectedPane.window);
    const paneValue = selectedPane.pane;
    const paneIndex =
        paneValue === undefined || paneValue === null ? null : String(paneValue);

    const sessionEl = Array.from(tmuxTree.querySelectorAll('.tree-session-name')).find(
        (element) => element.dataset.sessionName === sessionName
    );
    const windowEl = Array.from(tmuxTree.querySelectorAll('.tree-window-name')).find(
        (element) =>
            element.dataset.sessionName === sessionName &&
            element.dataset.windowIndex === windowIndex
    );

    if (!sessionEl || !windowEl) {
        return false;
    }

    clearTmuxSelectionHighlights();
    sessionEl.classList.add('active');
    windowEl.classList.add('active');

    if (paneIndex !== null) {
        const paneEl = Array.from(tmuxTree.querySelectorAll('.tree-pane')).find(
            (element) =>
                element.dataset.sessionName === sessionName &&
                element.dataset.windowIndex === windowIndex &&
                element.dataset.paneIndex === paneIndex
        );

        if (paneEl) {
            paneEl.classList.add('active');
        }
    }

    return true;
}

// Sidebar toggle
toggleSidebar.addEventListener('click', () => {
    sidebarCollapsed = !sidebarCollapsed;
    if (currentView === 'tmux') {
        tmuxSidebar.classList.toggle('collapsed', sidebarCollapsed);
    } else {
        filesSidebar.classList.toggle('collapsed', sidebarCollapsed);
    }
});

// Auto-refresh toggle
autoRefreshBtn.addEventListener('click', () => {
    if (autoRefreshEnabled) {
        disableAutoRefresh();
    } else {
        enableAutoRefresh();
    }
});

// Page up/down for tmux
pageUpTmux.addEventListener('click', () => {
    const target = Math.max(tmuxContent.scrollTop - tmuxContent.clientHeight * 0.9, 0);
    tmuxContent.scrollTop = target;
    shouldAutoScroll = isNearBottom(tmuxContent);
});

pageDownTmux.addEventListener('click', () => {
    const maxScrollTop = Math.max(tmuxContent.scrollHeight - tmuxContent.clientHeight, 0);
    const target = Math.min(tmuxContent.scrollTop + tmuxContent.clientHeight * 0.9, maxScrollTop);
    tmuxContent.scrollTop = target;
    shouldAutoScroll = isNearBottom(tmuxContent);
});

tmuxContent.addEventListener('scroll', () => {
    shouldAutoScroll = isNearBottom(tmuxContent);
});

// Page up/down for files
pageUpFiles.addEventListener('click', () => {
    fileContentContainer.scrollTop = Math.max(
        fileContentContainer.scrollTop - fileContentContainer.clientHeight * 0.9,
        0
    );
});

pageDownFiles.addEventListener('click', () => {
    const maxScrollTop = Math.max(
        fileContentContainer.scrollHeight - fileContentContainer.clientHeight,
        0
    );
    fileContentContainer.scrollTop = Math.min(
        fileContentContainer.scrollTop + fileContentContainer.clientHeight * 0.9,
        maxScrollTop
    );
});

// View switching helper
function setView(view) {
    currentView = view;
    markInteraction();

    // Update view visibility
    tmuxView.classList.toggle('active', view === 'tmux');
    filesView.classList.toggle('active', view === 'files');
    configView.classList.toggle('active', view === 'config');

    // Update button states
    tmuxBtn.classList.toggle('active', view === 'tmux');
    filesBtn.classList.toggle('active', view === 'files');
    configBtn.classList.toggle('active', view === 'config');

    updateViewControlsVisibility();

    // Handle sidebar state
    if (view === 'tmux') {
        tmuxSidebar.classList.toggle('collapsed', sidebarCollapsed);
        filesSidebar.classList.remove('collapsed');
        loadTmuxTree();
    } else if (view === 'files') {
        sidebarCollapsed = false;
        filesSidebar.classList.remove('collapsed');
        tmuxSidebar.classList.remove('collapsed');
        loadFileList();
    } else if (view === 'config') {
        tmuxSidebar.classList.remove('collapsed');
        filesSidebar.classList.remove('collapsed');
    }

    syncAutoRefreshState();
}

// View switching
tmuxBtn.addEventListener('click', () => setView('tmux'));
filesBtn.addEventListener('click', () => setView('files'));
configBtn.addEventListener('click', () => setView('config'));

// Shared fetch helper
async function fetchJSON(url, errorContext) {
    let response;
    try {
        response = await fetch(url);
    } catch (networkError) {
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

// Load tmux tree (sessions > windows > panes)
async function loadTmuxTree() {
    try {
        const tree = await fetchJSON('/api/tmux/tree', 'load tmux tree');
        tmuxTree.innerHTML = '';

        if (tree.length === 0) {
            selectedPane = null;
            tmuxTree.innerHTML = '<div style="padding: 20px;">No tmux sessions found</div>';
            tmuxContent.textContent = '';
            return;
        }

        tree.forEach(session => {
            const sessionDiv = document.createElement('div');
            sessionDiv.className = 'tree-session';

            const sessionName = document.createElement('div');
            sessionName.className = 'tree-session-name';
            sessionName.textContent = session.name;
            sessionName.dataset.sessionName = session.name;
            sessionDiv.appendChild(sessionName);

            session.windows.forEach(window => {
                const windowDiv = document.createElement('div');
                windowDiv.className = 'tree-window';

                // Mark single-pane windows
                if (window.panes.length === 1) {
                    windowDiv.classList.add('single-pane');
                }

                const windowName = document.createElement('div');
                windowName.className = 'tree-window-name';
                windowName.textContent = `${window.index}: ${window.name}`;
                windowName.dataset.sessionName = session.name;
                windowName.dataset.windowIndex = window.index;
                windowDiv.appendChild(windowName);

                // For single-pane windows, make window name clickable
                if (window.panes.length === 1) {
                    windowName.onclick = () => {
                        markInteraction();
                        selectedPane = {
                            session: session.name,
                            window: window.index,
                            pane: window.panes[0].index
                        };
                        shouldAutoScroll = true;
                        loadTmuxContent();
                        applyTmuxSelectionHighlight();
                    };
                } else {
                    // Multiple panes - show them
                    window.panes.forEach(pane => {
                        const paneDiv = document.createElement('div');
                        paneDiv.className = 'tree-pane';
                        paneDiv.textContent = `Pane ${pane.index}${pane.active ? ' *' : ''}`;
                        paneDiv.dataset.sessionName = session.name;
                        paneDiv.dataset.windowIndex = window.index;
                        paneDiv.dataset.paneIndex = pane.index;

                        paneDiv.onclick = () => {
                            markInteraction();
                            selectedPane = {
                                session: session.name,
                                window: window.index,
                                pane: pane.index
                            };
                            shouldAutoScroll = true;
                            loadTmuxContent();
                            applyTmuxSelectionHighlight();
                        };

                        windowDiv.appendChild(paneDiv);
                    });
                }

                sessionDiv.appendChild(windowDiv);
            });

            tmuxTree.appendChild(sessionDiv);
        });

        let selectionHighlighted = false;

        if (selectedPane) {
            selectionHighlighted = applyTmuxSelectionHighlight();
            if (!selectionHighlighted) {
                selectedPane = null;
            }
        }

        if (!selectionHighlighted) {
            for (const session of tree) {
                const firstWindow = session.windows.find(win => win.panes.length > 0);
                if (!firstWindow) {
                    continue;
                }

                const firstPane = firstWindow.panes[0];
                selectedPane = {
                    session: session.name,
                    window: firstWindow.index,
                    pane: firstPane.index
                };
                shouldAutoScroll = true;
                loadTmuxContent();
                applyTmuxSelectionHighlight();
                selectionHighlighted = true;
                break;
            }
        }

        if (!selectionHighlighted) {
            clearTmuxSelectionHighlights();
            tmuxContent.textContent = '';
        }
    } catch (error) {
        tmuxTree.innerHTML = `<div style="padding: 20px; color: red;">Error: ${error.message}</div>`;
    }
}

// Load tmux pane content
async function loadTmuxContent() {
    if (!selectedPane) return;

    try {
        const { session, window, pane } = selectedPane;

        // Track whether the pane was pinned to the bottom before updating content
        const wasPinned = shouldAutoScroll || isNearBottom(tmuxContent);
        const savedScrollTop = wasPinned ? null : tmuxContent.scrollTop;

        // Get scrollback config
        const config = JSON.parse(localStorage.getItem('vibeReaderConfig') || '{}');
        const scrollbackLines = config.scrollbackLines || 400;

        const data = await fetchJSON(
            `/api/tmux/pane/${encodeURIComponent(session)}/${encodeURIComponent(window)}/${encodeURIComponent(pane)}?scrollback=${scrollbackLines}`,
            'load pane content'
        );
        tmuxContent.textContent = data.content;

        // Smart scroll positioning based on whether the pane was pinned
        if (wasPinned) {
            tmuxContent.scrollTop = tmuxContent.scrollHeight;
        } else if (savedScrollTop !== null) {
            const maxScrollTop = Math.max(tmuxContent.scrollHeight - tmuxContent.clientHeight, 0);
            tmuxContent.scrollTop = Math.min(savedScrollTop, maxScrollTop);
        }

        shouldAutoScroll = isNearBottom(tmuxContent);
    } catch (error) {
        const detail = error && error.message ? error.message : 'Unknown error';
        const responseDetail = error && typeof error.detail === 'string' ? error.detail : '';
        const missingPane = Boolean(
            (error && error.status === 404) ||
                (responseDetail && /not found/i.test(responseDetail)) ||
                /not found/i.test(detail)
        );

        if (missingPane) {
            selectedPane = null;
            try {
                await loadTmuxTree();
            } catch (refreshError) {
                tmuxContent.textContent = `Error: ${refreshError.message}`;
            }
            return;
        }

        tmuxContent.textContent = `Error: ${detail}`;
    }
}

function updateCurrentPathDisplay() {
    if (!currentPathDisplay) {
        return;
    }

    const displayPath = currentDirectory && currentDirectory !== '' ? currentDirectory : '.';
    currentPathDisplay.textContent = displayPath;
    currentPathDisplay.title = displayPath;
}

function setCurrentDirectory(path) {
    currentDirectory = path && path !== '' ? path : '.';
    updateCurrentPathDisplay();
    if (diffModeEnabled && !selectedFile) {
        renderDiffPrompt();
    }
}

function resetFilePreview() {
    if (!fileContentContainer || !fileContent) {
        return;
    }

    fileContent.innerHTML = '';
    fileContentContainer.dataset.language = 'TEXT';
    fileContentContainer.dataset.mode = 'PLAIN';
    fileContentContainer.classList.remove('markdown-mode');
    fileContentContainer.classList.add('code-mode');
    if (diffModeEnabled) {
        renderDiffPrompt();
    }
}

function renderInlineMessage(message) {
    if (!fileContentContainer || !fileContent) {
        return;
    }
    fileContentContainer.dataset.language = 'TEXT';
    fileContentContainer.dataset.mode = 'PLAIN';
    fileContentContainer.classList.remove('markdown-mode');
    fileContentContainer.classList.add('code-mode');
    fileContent.innerHTML = `<div class="code-line"><span class="line-code">${escapeHtml(message)}</span></div>`;
}

function renderDiffPrompt(message) {
    renderInlineMessage(message || 'Select a file to view a diff.');
}

const BADGE_LABELS = {
    staged: { text: 'S', title: 'Staged change' },
    unstaged: { text: 'M', title: 'Unstaged modification' },
    untracked: { text: 'U', title: 'Untracked path' },
    deleted: { text: 'D', title: 'Deleted path' }
};

function normalizeDirectoryKey(path) {
    if (!path || path === '.' || path === '/') {
        return '.';
    }
    return path.replace(/\/+$/, '');
}

function getParentDirectory(path) {
    if (!path || path === '.') {
        return '.';
    }
    const segments = path.split('/');
    segments.pop();
    return segments.length === 0 ? '.' : segments.join('/');
}

function getDisplayNameForDirectory(path, directoryKey) {
    const normalizedDir = normalizeDirectoryKey(directoryKey);
    if (normalizedDir === '.' || !path.startsWith(`${normalizedDir}/`)) {
        return path;
    }
    return path.slice(normalizedDir.length + 1);
}

function highlightSelectedFile() {
    if (!fileList) {
        return;
    }
    Array.from(fileList.querySelectorAll('.file-item')).forEach(item => {
        const isActive = selectedFile && item.dataset.path === selectedFile;
        item.classList.toggle('active', Boolean(isActive));
    });
}

function buildGitStatusHelper(summary) {
    if (!summary) {
        return null;
    }
    return {
        staged: new Set(summary.staged.map(entry => entry.path)),
        unstaged: new Set(summary.unstaged.map(entry => entry.path)),
        untracked: new Set(summary.untracked),
        deleted: new Set(summary.deleted)
    };
}

function deriveStatusFlags(path, isDir, helper) {
    if (!helper) {
        return [];
    }
    const normalizedPath = normalizeDirectoryKey(path);
    const prefix = normalizedPath === '.' ? '' : `${normalizedPath}/`;
    const results = new Set();

    const evaluate = (set, flag) => {
        if (!set || set.size === 0) {
            return;
        }
        if (normalizedPath !== '.' && set.has(normalizedPath)) {
            results.add(flag);
            return;
        }
        if (!isDir) {
            return;
        }
        if (normalizedPath === '.' && set.size > 0) {
            results.add(flag);
            return;
        }
        if (prefix) {
            for (const value of set) {
                if (value.startsWith(prefix)) {
                    results.add(flag);
                    break;
                }
            }
        }
    };

    evaluate(helper.staged, 'staged');
    evaluate(helper.unstaged, 'unstaged');
    evaluate(helper.untracked, 'untracked');
    evaluate(helper.deleted, 'deleted');

    return Array.from(results);
}

function createBadgeElement(flag) {
    const definition = BADGE_LABELS[flag];
    if (!definition) {
        return null;
    }
    const badge = document.createElement('span');
    badge.className = `file-item-badge file-item-badge--${flag}`;
    badge.textContent = definition.text;
    badge.title = definition.title;
    return badge;
}

async function getGitStatusSummary(path, { force = false } = {}) {
    const key = normalizeDirectoryKey(path);
    if (force) {
        gitStatusCache.delete(key);
    }
    if (gitStatusCache.has(key)) {
        return gitStatusCache.get(key);
    }
    const summary = await fetchJSON(
        `/api/git/status?path=${encodeURIComponent(key)}`,
        'load git status'
    );
    gitStatusCache.set(key, summary);
    return summary;
}

function invalidateGitStatusCache(path) {
    if (!path) {
        gitStatusCache.clear();
        return;
    }
    gitStatusCache.delete(normalizeDirectoryKey(path));
}

function gatherDeletedEntries(summary, directoryKey) {
    if (!summary || !summary.deleted || summary.deleted.length === 0) {
        return [];
    }
    const normalizedDir = normalizeDirectoryKey(directoryKey);
    return summary.deleted.filter(item => getParentDirectory(item) === normalizedDir);
}

function describeDiffSource(source) {
    return source === 'staged' ? 'Staged' : 'Unstaged';
}

function openFile(path, { isDeleted = false } = {}) {
    if (!path) {
        return;
    }
    selectedFileIsDeleted = isDeleted;
    if (diffModeEnabled) {
        loadGitDiff(path, diffSource);
        return;
    }
    if (isDeleted) {
        showToast('Enable diff mode to inspect deleted files.');
        renderDiffPrompt();
        return;
    }
    loadFileContent(path);
}

async function loadGitDiff(path, source = diffSource) {
    if (!path) {
        renderDiffPrompt();
        return;
    }

    const requestId = ++currentDiffRequestId;
    const sourceLabel = describeDiffSource(source);
    renderInlineMessage(`Loading ${sourceLabel.toLowerCase()} diff…`);

    try {
        const payload = await fetchJSON(
            `/api/git/diff/${source}?path=${encodeURIComponent(path)}`,
            `load ${sourceLabel.toLowerCase()} diff`
        );

        if (requestId !== currentDiffRequestId) {
            return;
        }

        const diffText = (payload.text || '').trim();
        if (diffText.length === 0) {
            if (selectedFileIsDeleted) {
                renderDiffPrompt(`No ${sourceLabel.toLowerCase()} changes for deleted file.`);
            } else {
                showToast(`No ${sourceLabel.toLowerCase()} changes for ${path}.`);
                loadFileContent(path);
            }
            return;
        }

        renderFileContent(payload);
        fileContentContainer.scrollTop = 0;
    } catch (error) {
        if (requestId !== currentDiffRequestId) {
            return;
        }
        renderDiffPrompt(`Diff unavailable: ${error.message}`);
    }
}

function updateDiffModeUI() {
    if (!diffModeToggle) {
        return;
    }

    diffModeToggle.classList.toggle('active', diffModeEnabled);
    diffModeToggle.textContent = diffModeEnabled ? 'Diff On' : 'Diff Off';
    diffModeToggle.setAttribute('aria-pressed', diffModeEnabled ? 'true' : 'false');

    if (!diffModeEnabled) {
        if (selectedFile) {
            if (!selectedFileIsDeleted) {
                loadFileContent(selectedFile);
            } else {
                showToast('Diff mode is required to view deleted files.');
                selectedFile = null;
                selectedFileIsDeleted = false;
                highlightSelectedFile();
                resetFilePreview();
            }
        } else {
            resetFilePreview();
        }
        return;
    }

    if (selectedFile) {
        loadGitDiff(selectedFile, diffSource);
    } else {
        renderDiffPrompt();
    }
}

// Load files from directory
async function loadFileList({ forceStatusRefresh = false } = {}) {
    try {
        const path = currentDirectory || '.';
        updateCurrentPathDisplay();

        let statusSummary = null;
        let statusHelper = null;
        try {
            statusSummary = await getGitStatusSummary(path, { force: forceStatusRefresh });
            statusHelper = buildGitStatusHelper(statusSummary);
        } catch (statusError) {
            if (diffModeEnabled) {
                renderInlineMessage(statusError.message);
            }
        }

        const files = await fetchJSON(`/api/files?path=${encodeURIComponent(path)}`, 'load files');
        fileList.innerHTML = '';
        let appended = false;

        if (path !== '.' && path !== '/') {
            const parentDiv = document.createElement('div');
            parentDiv.className = 'file-item dir';
            parentDiv.textContent = '.. (parent)';
            parentDiv.onclick = () => {
                markInteraction();
                const parentPath = path.split('/').slice(0, -1).join('/') || '.';
                setCurrentDirectory(parentPath);
                selectedFile = null;
                selectedFileIsDeleted = false;
                resetFilePreview();
                loadFileList({ forceStatusRefresh: true });
            };
            fileList.appendChild(parentDiv);
            appended = true;
        }

        files.forEach(file => {
            const fileDiv = document.createElement('div');
            fileDiv.className = file.is_dir ? 'file-item dir' : 'file-item';
            fileDiv.dataset.path = file.path;
            fileDiv.dataset.type = file.is_dir ? 'dir' : 'file';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-name';
            nameSpan.textContent = file.is_dir ? `📁 ${file.name}` : file.name;
            fileDiv.appendChild(nameSpan);

            const badges = document.createElement('span');
            badges.className = 'file-badges';
            const flags = deriveStatusFlags(file.path, file.is_dir, statusHelper);
            flags.forEach(flag => {
                fileDiv.classList.add(`file-item--${flag}`);
                const badge = createBadgeElement(flag);
                if (badge) {
                    badges.appendChild(badge);
                }
            });
            if (!badges.childElementCount) {
                badges.classList.add('hidden');
            }
            fileDiv.appendChild(badges);

            if (!file.is_dir && selectedFile === file.path) {
                fileDiv.classList.add('active');
            }

            fileDiv.onclick = () => {
                markInteraction();
                if (file.is_dir) {
                    setCurrentDirectory(file.path);
                    selectedFile = null;
                    selectedFileIsDeleted = false;
                    resetFilePreview();
                    loadFileList();
                } else {
                    selectedFile = file.path;
                    selectedFileIsDeleted = false;
                    highlightSelectedFile();
                    openFile(file.path);
                }
            };

            fileList.appendChild(fileDiv);
            appended = true;
        });

        gatherDeletedEntries(statusSummary, path).forEach(deletedPath => {
            const deletedDiv = document.createElement('div');
            deletedDiv.className = 'file-item file-item--deleted';
            deletedDiv.dataset.path = deletedPath;
            deletedDiv.dataset.type = 'deleted';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-name';
            nameSpan.textContent = `${getDisplayNameForDirectory(deletedPath, path)} (deleted)`;
            deletedDiv.appendChild(nameSpan);

            const badges = document.createElement('span');
            badges.className = 'file-badges';
            const flags = deriveStatusFlags(deletedPath, false, statusHelper);
            flags.forEach(flag => {
                deletedDiv.classList.add(`file-item--${flag}`);
                const badge = createBadgeElement(flag);
                if (badge) {
                    badges.appendChild(badge);
                }
            });
            if (!badges.childElementCount) {
                badges.classList.add('hidden');
            }
            deletedDiv.appendChild(badges);

            deletedDiv.onclick = () => {
                markInteraction();
                selectedFile = deletedPath;
                selectedFileIsDeleted = true;
                highlightSelectedFile();
                openFile(deletedPath, { isDeleted: true });
            };

            fileList.appendChild(deletedDiv);
            appended = true;
        });

        if (!appended) {
            fileList.innerHTML = '<div class="file-item">Empty directory</div>';
        } else {
            highlightSelectedFile();
        }

        if (diffModeEnabled) {
            if (selectedFile) {
                loadGitDiff(selectedFile, diffSource);
            } else {
                renderDiffPrompt();
            }
        }
    } catch (error) {
        fileList.innerHTML = `<div class="file-item" style="color: red;">Error: ${error.message}</div>`;
    }
}

// Load file content
async function loadFileContent(path) {
    try {
        const config = JSON.parse(localStorage.getItem('vibeReaderConfig') || '{}');
        const enableHighlighting = config.enableSyntaxHighlighting !== false; // default true for backward compat

        const data = await fetchJSON(
            `/api/files/content?path=${encodeURIComponent(path)}&highlight=${enableHighlighting}`,
            'load file'
        );
        renderFileContent(data);
        fileContentContainer.scrollTop = 0;
    } catch (error) {
        fileContentContainer.dataset.language = 'TEXT';
        fileContentContainer.dataset.mode = 'PLAIN';
        fileContentContainer.classList.remove('markdown-mode');
        fileContentContainer.classList.add('code-mode');
        fileContent.innerHTML = `<div class="code-line"><span class="line-code">${escapeHtml(error.message)}</span></div>`;
    }
}

// Refresh current view
function refreshTmux() {
    if (currentView !== 'tmux') {
        return;
    }

    if (selectedPane) {
        loadTmuxContent();
    } else {
        loadTmuxTree();
    }
}

function showToast(message) {
    if (!message) {
        return;
    }

    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('visible');

    if (toastTimeoutId) {
        clearTimeout(toastTimeoutId);
    }

    toastTimeoutId = setTimeout(() => {
        toast.classList.remove('visible');
    }, 4000);
}

function stopAutoRefreshTimers() {
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
    }

    if (idleTimeoutId) {
        clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
    }
}

function disableAutoRefresh(message) {
    autoRefreshEnabled = false;
    autoRefreshBtn.classList.remove('active');
    stopAutoRefreshTimers();

    if (message) {
        showToast(message);
    }
}

function enableAutoRefresh() {
    if (currentRefreshInterval <= 0) {
        showToast('Set a refresh interval above 0 seconds to enable auto refresh.');
        return;
    }

    autoRefreshEnabled = true;
    autoRefreshBtn.classList.add('active');
    markInteraction();
    syncAutoRefreshState();
}

function scheduleIdleTimeout() {
    if (idleTimeoutId) {
        clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
    }

    if (!autoRefreshEnabled || currentIdleTimeoutMinutes <= 0 || currentView !== 'tmux') {
        return;
    }

    idleTimeoutId = setTimeout(() => {
        disableAutoRefresh(`Auto refresh paused after ${currentIdleTimeoutMinutes} minutes of inactivity.`);
    }, currentIdleTimeoutMinutes * 60 * 1000);
}

function markInteraction() {
    scheduleIdleTimeout();
}

function syncAutoRefreshState() {
    stopAutoRefreshTimers();

    if (!autoRefreshEnabled || currentRefreshInterval <= 0 || currentView !== 'tmux') {
        return;
    }

    if (document.visibilityState === 'hidden') {
        return;
    }

    refreshIntervalId = setInterval(() => {
        if (document.visibilityState === 'hidden') {
            return;
        }
        refreshTmux();
    }, currentRefreshInterval * 1000);

    scheduleIdleTimeout();
}

function updateViewControlsVisibility() {
    if (tmuxNavControls) {
        tmuxNavControls.classList.toggle('hidden', currentView !== 'tmux');
    }
    if (filesNavControls) {
        filesNavControls.classList.toggle('hidden', currentView !== 'files');
    }
}

// Event listeners
loadFiles.addEventListener('click', () => {
    markInteraction();
    invalidateGitStatusCache(currentDirectory);
    loadFileList({ forceStatusRefresh: true });
});

if (tmuxTreeRefreshBtn) {
    tmuxTreeRefreshBtn.addEventListener('click', () => {
        markInteraction();
        loadTmuxTree();
    });
}

if (diffModeToggle) {
    diffModeToggle.addEventListener('click', () => {
        markInteraction();
        diffModeEnabled = !diffModeEnabled;
        updateDiffModeUI();
    });
}
if (paneRefreshBtn) {
    paneRefreshBtn.addEventListener('click', () => {
        refreshTmux();
        markInteraction();
    });
}

function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderFileContent({ render_mode: renderMode, html, metadata = {} }) {
    const mode = (renderMode || 'plain').toUpperCase();
    const label = (metadata.language || (mode === 'MARKDOWN' ? 'MARKDOWN' : 'TEXT')).toUpperCase();

    fileContentContainer.dataset.language = label;
    fileContentContainer.dataset.mode = mode;
    const isMarkdown = mode === 'MARKDOWN';
    fileContentContainer.classList.toggle('markdown-mode', isMarkdown);
    fileContentContainer.classList.toggle('code-mode', !isMarkdown);

    fileContent.innerHTML = html || '';
}

function ensureSelectValue(selectElement, value) {
    if (!selectElement) {
        return;
    }

    const stringValue = String(value);
    const hasOption = Array.from(selectElement.options).some(option => option.value === stringValue);

    if (!hasOption) {
        const option = document.createElement('option');
        option.value = stringValue;
        option.textContent = stringValue;
        selectElement.appendChild(option);
    }

    selectElement.value = stringValue;
}

function normalizeMarkdownFontFamily(value) {
    return value === 'sans' ? 'sans' : 'serif';
}

function applyMarkdownFontPreference(fontFamily) {
    if (!fileContentContainer) {
        return;
    }

    const normalized = normalizeMarkdownFontFamily(fontFamily);
    fileContentContainer.classList.toggle('markdown-font-serif', normalized === 'serif');
    fileContentContainer.classList.toggle('markdown-font-sans', normalized === 'sans');
}

// Config management
function loadConfig() {
    const config = JSON.parse(localStorage.getItem('vibeReaderConfig') || '{}');
    const storedScrollback = Number.isInteger(config.scrollbackLines) ? config.scrollbackLines : 400;
    const storedFontSize = Number.isInteger(config.fontSize) ? config.fontSize : 14;
    const storedInterval = Number.isInteger(config.refreshInterval) && config.refreshInterval > 0
        ? config.refreshInterval
        : DEFAULT_REFRESH_INTERVAL;
    const storedIdleMinutes = Number.isInteger(config.refreshIdleMinutes) ? config.refreshIdleMinutes : 10;
    const storedEnableHighlighting = config.enableSyntaxHighlighting !== false; // default true for backward compat
    const storedDiffSource = config.diffSourcePreference === 'staged' ? 'staged' : 'unstaged';
    const storedMarkdownFontFamily = normalizeMarkdownFontFamily(config.markdownFontFamily);

    ensureSelectValue(scrollbackLinesSelect, storedScrollback);
    fontSizeSelect.value = storedFontSize;
    if (markdownFontFamilySelect) {
        markdownFontFamilySelect.value = storedMarkdownFontFamily;
    }
    refreshIntervalSelect.value = String(storedInterval);
    enableSyntaxHighlightingCheckbox.checked = storedEnableHighlighting;
    if (diffSourcePreferenceSelect) {
        diffSourcePreferenceSelect.value = storedDiffSource;
    }

    if (Array.from(refreshIdleTimeoutSelect.options).some(opt => parseInt(opt.value, 10) === storedIdleMinutes)) {
        refreshIdleTimeoutSelect.value = String(storedIdleMinutes);
    } else {
        refreshIdleTimeoutSelect.value = '10';
    }

    document.querySelectorAll('.content-box').forEach(el => {
        el.style.fontSize = storedFontSize + 'px';
    });

    applyMarkdownFontPreference(storedMarkdownFontFamily);

    currentRefreshInterval = storedInterval;
    currentIdleTimeoutMinutes = parseInt(refreshIdleTimeoutSelect.value, 10);
    diffSource = storedDiffSource;

    // Auto refresh always starts disabled; users must opt in via the toggle button.
    disableAutoRefresh();
    syncAutoRefreshState();
    configInitialized = true;
}

function applyConfig({ notify = true } = {}) {
    const parsedScrollback = parseInt(scrollbackLinesSelect.value, 10);
    const parsedFontSize = parseInt(fontSizeSelect.value, 10);
    const parsedRefreshInterval = parseInt(refreshIntervalSelect.value, 10);
    const parsedIdleMinutes = parseInt(refreshIdleTimeoutSelect.value, 10);
    const selectedMarkdownFont = markdownFontFamilySelect
        ? normalizeMarkdownFontFamily(markdownFontFamilySelect.value)
        : 'serif';

    const selectedDiffSource = diffSourcePreferenceSelect && diffSourcePreferenceSelect.value === 'staged'
        ? 'staged'
        : 'unstaged';

    const config = {
        scrollbackLines: Number.isNaN(parsedScrollback) ? 400 : parsedScrollback,
        fontSize: Number.isNaN(parsedFontSize) ? 14 : parsedFontSize,
        refreshInterval: Number.isNaN(parsedRefreshInterval) || parsedRefreshInterval <= 0
            ? DEFAULT_REFRESH_INTERVAL
            : parsedRefreshInterval,
        refreshIdleMinutes: Number.isNaN(parsedIdleMinutes) ? currentIdleTimeoutMinutes : parsedIdleMinutes,
        markdownFontFamily: selectedMarkdownFont,
        enableSyntaxHighlighting: enableSyntaxHighlightingCheckbox.checked,
        diffSourcePreference: selectedDiffSource
    };

    localStorage.setItem('vibeReaderConfig', JSON.stringify(config));

    // Apply font size immediately on all content containers.
    document.querySelectorAll('.content-box').forEach(el => {
        el.style.fontSize = config.fontSize + 'px';
    });

    applyMarkdownFontPreference(config.markdownFontFamily);

    currentRefreshInterval = config.refreshInterval;
    currentIdleTimeoutMinutes = config.refreshIdleMinutes;
    diffSource = config.diffSourcePreference;

    if (autoRefreshEnabled) {
        syncAutoRefreshState();
    } else {
        stopAutoRefreshTimers();
    }

    autoRefreshBtn.classList.toggle('active', autoRefreshEnabled);

    markInteraction();

    if (notify) {
        showToast('Settings updated');
    }

    refreshTmux();

    if (currentView === 'files') {
        if (diffModeEnabled) {
            if (selectedFile) {
                loadGitDiff(selectedFile, diffSource);
            } else {
                renderDiffPrompt();
            }
        } else if (selectedFile) {
            loadFileContent(selectedFile);
        }
    }
}

function setupConfigListeners() {
    const controlBindings = [
        [scrollbackLinesSelect, 'change'],
        [fontSizeSelect, 'change'],
        [markdownFontFamilySelect, 'change'],
        [refreshIntervalSelect, 'change'],
        [refreshIdleTimeoutSelect, 'change'],
        [enableSyntaxHighlightingCheckbox, 'change'],
        [diffSourcePreferenceSelect, 'change']
    ];

    controlBindings.forEach(([element, eventName]) => {
        if (!element) {
            return;
        }

        element.addEventListener(eventName, () => {
            if (!configInitialized) {
                return;
            }

            applyConfig();
        });
    });
}

setupConfigListeners();

['pointerdown', 'keydown', 'touchstart'].forEach(eventName => {
    document.addEventListener(eventName, markInteraction);
});

window.addEventListener('wheel', markInteraction, { passive: true });

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        stopAutoRefreshTimers();
    } else {
        markInteraction();
        syncAutoRefreshState();
    }
});

// Initialize
updateViewControlsVisibility();
setCurrentDirectory(currentDirectory);
updateDiffModeUI();
loadConfig();

// Register service worker for PWA installability
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then((registration) => {
                console.log('ServiceWorker registered');
            })
            .catch((error) => {
                console.log('ServiceWorker registration failed:', error);
            });
    });
}
loadTmuxTree();
