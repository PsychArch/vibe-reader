import * as api from './api.js';
import { createConfigController } from './config.js';
import { createContentRenderer } from './content-renderer.js';
import { createFilesViewController } from './files-view.js';
import { createGitStatusStore } from './file-status.js';
import { createMermaidRenderer } from './mermaid-renderer.js';
import { createTmuxViewController } from './tmux-view.js';
import { createToastController, updateViewControlsVisibility } from './ui.js';

const dom = {
    tmuxBtn: document.getElementById('tmuxBtn'),
    filesBtn: document.getElementById('filesBtn'),
    configBtn: document.getElementById('configBtn'),
    tmuxView: document.getElementById('tmuxView'),
    filesView: document.getElementById('filesView'),
    configView: document.getElementById('configView'),
    paneRefreshBtn: document.getElementById('paneRefreshBtn'),
    toggleSidebar: document.getElementById('toggleSidebar'),
    autoRefreshBtn: document.getElementById('autoRefreshBtn'),
    tmuxNavControls: document.getElementById('tmuxNavControls'),
    filesNavControls: document.getElementById('filesNavControls'),

    scrollbackLinesSelect: document.getElementById('scrollbackLines'),
    fontSizeSelect: document.getElementById('fontSize'),
    markdownFontFamilySelect: document.getElementById('markdownFontFamily'),
    refreshIntervalSelect: document.getElementById('refreshInterval'),
    refreshIdleTimeoutSelect: document.getElementById('refreshIdleTimeout'),
    enableSyntaxHighlightingCheckbox: document.getElementById('enableSyntaxHighlighting'),
    diffSourcePreferenceSelect: document.getElementById('diffSourcePreference'),

    tmuxSidebar: document.getElementById('tmuxSidebar'),
    filesSidebar: document.getElementById('filesSidebar'),

    tmuxTree: document.getElementById('tmuxTree'),
    tmuxContent: document.getElementById('tmuxContent'),
    pageUpTmux: document.getElementById('pageUpTmux'),
    pageDownTmux: document.getElementById('pageDownTmux'),
    tmuxTreeRefreshBtn: document.getElementById('refreshTmuxTreeBtn'),

    currentPathDisplay: document.getElementById('currentPath'),
    loadFiles: document.getElementById('loadFiles'),
    fileList: document.getElementById('fileList'),
    fileContentContainer: document.getElementById('fileContentContainer'),
    fileContent: document.getElementById('fileContent'),
    pageUpFiles: document.getElementById('pageUpFiles'),
    pageDownFiles: document.getElementById('pageDownFiles'),
    diffModeToggle: document.getElementById('diffModeToggle')
};

const state = {
    currentView: 'tmux',
    selectedPane: null,
    selectedFile: null,
    currentDirectory: '.',
    shouldAutoScroll: true,
    pendingTmuxSnapshot: null,
    sidebarCollapsed: false,
    refreshIntervalId: null,
    autoRefreshEnabled: false,
    currentRefreshInterval: 5,
    idleTimeoutId: null,
    currentIdleTimeoutMinutes: 10,
    configInitialized: false,
    diffModeEnabled: false,
    diffSource: 'unstaged',
    currentDiffRequestId: 0,
    selectedFileIsDeleted: false,
    currentFileRenderToken: 0,
    mermaidModulePromise: null,
    mermaidDiagramId: 0
};

const { showToast } = createToastController();
const mermaidRenderer = createMermaidRenderer({ dom, state });
const contentRenderer = createContentRenderer({
    dom,
    state,
    mermaidRenderer,
    isDiffModeEnabled: () => state.diffModeEnabled
});
const gitStatus = createGitStatusStore({ loadGitStatus: api.loadGitStatus });

const tmuxController = createTmuxViewController({
    dom,
    state,
    api,
    callbacks: { showToast }
});

const filesController = createFilesViewController({
    dom,
    state,
    api,
    contentRenderer,
    gitStatus,
    callbacks: {
        markInteraction: tmuxController.markInteraction,
        showToast
    }
});

const configController = createConfigController({
    dom,
    state,
    callbacks: {
        onConfigLoaded: () => {
            tmuxController.disableAutoRefresh();
            tmuxController.syncAutoRefreshState();
        },
        onConfigApplied: (config, { notify }) => {
            if (state.autoRefreshEnabled) {
                tmuxController.syncAutoRefreshState();
            } else {
                tmuxController.stopAutoRefreshTimers();
            }

            tmuxController.syncAutoRefreshButtonState();
            tmuxController.markInteraction();

            if (notify) {
                showToast('Settings updated');
            }

            tmuxController.refreshTmux();
            filesController.handleConfigChanged();
        }
    }
});

function setView(view) {
    state.currentView = view;
    tmuxController.markInteraction();

    dom.tmuxView.classList.toggle('active', view === 'tmux');
    dom.filesView.classList.toggle('active', view === 'files');
    dom.configView.classList.toggle('active', view === 'config');

    dom.tmuxBtn.classList.toggle('active', view === 'tmux');
    dom.filesBtn.classList.toggle('active', view === 'files');
    dom.configBtn.classList.toggle('active', view === 'config');

    updateViewControlsVisibility(dom, state.currentView);

    if (view === 'tmux') {
        dom.tmuxSidebar.classList.toggle('collapsed', state.sidebarCollapsed);
        dom.filesSidebar.classList.remove('collapsed');
        tmuxController.loadTmuxTree();
    } else if (view === 'files') {
        state.sidebarCollapsed = false;
        dom.filesSidebar.classList.remove('collapsed');
        dom.tmuxSidebar.classList.remove('collapsed');
        filesController.loadFileList();
    } else if (view === 'config') {
        dom.tmuxSidebar.classList.remove('collapsed');
        dom.filesSidebar.classList.remove('collapsed');
    }

    tmuxController.syncAutoRefreshState();
}

function setupAppListeners() {
    dom.toggleSidebar.addEventListener('click', () => {
        state.sidebarCollapsed = !state.sidebarCollapsed;
        if (state.currentView === 'tmux') {
            dom.tmuxSidebar.classList.toggle('collapsed', state.sidebarCollapsed);
        } else {
            dom.filesSidebar.classList.toggle('collapsed', state.sidebarCollapsed);
            requestAnimationFrame(() => {
                mermaidRenderer.refreshVisibleMermaidDiagrams();
            });
        }
    });

    dom.tmuxBtn.addEventListener('click', () => setView('tmux'));
    dom.filesBtn.addEventListener('click', () => setView('files'));
    dom.configBtn.addEventListener('click', () => setView('config'));

    window.addEventListener('resize', () => {
        if (state.currentView === 'files') {
            mermaidRenderer.refreshVisibleMermaidDiagrams();
        }
    });

    ['pointerdown', 'keydown', 'touchstart'].forEach(eventName => {
        document.addEventListener(eventName, tmuxController.markInteraction);
    });

    window.addEventListener('wheel', tmuxController.markInteraction, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            tmuxController.stopAutoRefreshTimers();
        } else {
            tmuxController.markInteraction();
            tmuxController.syncAutoRefreshState();
        }
    });
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(() => {
                console.log('ServiceWorker registered');
            })
            .catch((error) => {
                console.log('ServiceWorker registration failed:', error);
            });
    });
}

configController.setupListeners();
tmuxController.setupListeners();
filesController.setupListeners();
setupAppListeners();

updateViewControlsVisibility(dom, state.currentView);
filesController.setCurrentDirectory(state.currentDirectory);
filesController.updateDiffModeUI();
configController.loadConfig();
registerServiceWorker();
tmuxController.loadTmuxTree();
