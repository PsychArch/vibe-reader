export function createViewState() {
    return {
        currentView: 'tmux',
        sidebarCollapsed: false
    };
}

export function createTmuxState() {
    return {
        selectedPane: null,
        shouldAutoScroll: true,
        pendingTmuxSnapshot: null,
        refreshIntervalId: null,
        autoRefreshEnabled: false,
        currentRefreshInterval: 5,
        idleTimeoutId: null,
        currentIdleTimeoutMinutes: 10
    };
}

export function createFilesState() {
    return {
        selectedFile: null,
        currentDirectory: '.',
        diffModeEnabled: false,
        diffSource: 'unstaged',
        currentDiffRequestId: 0,
        selectedFileIsDeleted: false,
        currentFileRenderToken: 0
    };
}

export function createConfigState() {
    return {
        initialized: false
    };
}

export function createMermaidState() {
    return {
        modulePromise: null,
        diagramId: 0
    };
}
