import { readConfig } from './config.js';
import { createTmuxRefreshController } from './tmux-refresh.js';
import {
    createTmuxTreeRenderer,
    findFirstSelectablePane,
    getSelectedPaneKey as getPaneKey
} from './tmux-tree.js';
import { isNearBottom, pageScroll } from './ui.js';

export function createTmuxViewController({ dom, state, viewState, api, callbacks }) {
    let treeRenderer;
    let refreshController;

    function getSelectedPaneKey() {
        return getPaneKey(state.selectedPane);
    }

    function clearPendingTmuxSnapshot() {
        state.pendingTmuxSnapshot = null;
        syncAutoRefreshButtonState();
    }

    function hasActiveTmuxTextSelection() {
        if (!dom.tmuxContent || typeof window.getSelection !== 'function') {
            return false;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return false;
        }

        for (let index = 0; index < selection.rangeCount; index += 1) {
            const range = selection.getRangeAt(index);
            if (range.collapsed) {
                continue;
            }

            const commonAncestor = range.commonAncestorContainer;
            const commonElement = commonAncestor.nodeType === Node.ELEMENT_NODE
                ? commonAncestor
                : commonAncestor.parentElement;

            if (commonElement && dom.tmuxContent.contains(commonElement)) {
                return true;
            }

            try {
                if (range.intersectsNode(dom.tmuxContent)) {
                    return true;
                }
            } catch {
                // Some older engines can throw for detached nodes.
            }
        }

        return false;
    }

    function getTmuxUpdateHoldReason() {
        if (viewState.currentView !== 'tmux' || !state.selectedPane) {
            return null;
        }

        if (hasActiveTmuxTextSelection()) {
            return 'selection';
        }

        if (!isNearBottom(dom.tmuxContent)) {
            return 'scroll';
        }

        return null;
    }

    function isTmuxUpdateHeld() {
        return getTmuxUpdateHoldReason() !== null;
    }

    function canApplyTmuxSnapshot(snapshot = state.pendingTmuxSnapshot) {
        return Boolean(
                snapshot &&
                snapshot.paneKey === getSelectedPaneKey() &&
                viewState.currentView === 'tmux' &&
                !isTmuxUpdateHeld()
        );
    }

    function applyPendingTmuxSnapshot() {
        if (!state.pendingTmuxSnapshot || state.pendingTmuxSnapshot.paneKey !== getSelectedPaneKey()) {
            clearPendingTmuxSnapshot();
            return false;
        }

        if (!canApplyTmuxSnapshot()) {
            syncAutoRefreshButtonState();
            return false;
        }

        dom.tmuxContent.textContent = state.pendingTmuxSnapshot.content;
        clearPendingTmuxSnapshot();
        dom.tmuxContent.scrollTop = dom.tmuxContent.scrollHeight;
        state.shouldAutoScroll = isNearBottom(dom.tmuxContent);
        syncAutoRefreshButtonState();
        return true;
    }

    function applyPendingTmuxSnapshotWhenIdle() {
        state.shouldAutoScroll = isNearBottom(dom.tmuxContent);
        if (!canApplyTmuxSnapshot()) {
            syncAutoRefreshButtonState();
            return false;
        }

        return applyPendingTmuxSnapshot();
    }

    function applyTmuxSelectionHighlight() {
        return treeRenderer.applySelectionHighlight(state.selectedPane);
    }

    function selectPane(sessionName, windowIndex, paneIndex) {
        markInteraction();
        state.selectedPane = {
            session: sessionName,
            window: windowIndex,
            pane: paneIndex
        };
        state.shouldAutoScroll = true;
        clearPendingTmuxSnapshot();
        loadTmuxContent();
        treeRenderer.applySelectionHighlight(state.selectedPane);
        syncAutoRefreshButtonState();
    }

    async function loadTmuxTree() {
        try {
            const tree = await api.loadTmuxTree();

            if (tree.length === 0) {
                state.selectedPane = null;
                treeRenderer.renderEmpty();
                dom.tmuxContent.textContent = '';
                syncAutoRefreshButtonState();
                return;
            }

            treeRenderer.renderTree(tree);

            let selectionHighlighted = false;

            if (state.selectedPane) {
                selectionHighlighted = applyTmuxSelectionHighlight();
                if (!selectionHighlighted) {
                    state.selectedPane = null;
                }
            }

            if (!selectionHighlighted) {
                const firstPane = findFirstSelectablePane(tree);
                if (firstPane) {
                    state.selectedPane = firstPane;
                    state.shouldAutoScroll = true;
                    clearPendingTmuxSnapshot();
                    loadTmuxContent();
                    applyTmuxSelectionHighlight();
                    syncAutoRefreshButtonState();
                    selectionHighlighted = true;
                }
            }

            if (!selectionHighlighted) {
                treeRenderer.clearSelectionHighlights();
                dom.tmuxContent.textContent = '';
                syncAutoRefreshButtonState();
            }
        } catch (error) {
            treeRenderer.renderError(error.message);
        }
    }

    async function loadTmuxContent({ deferWhenDetached = false } = {}) {
        if (!state.selectedPane) {
            return;
        }

        const { session, window, pane } = state.selectedPane;
        const paneKey = getSelectedPaneKey();
        const wasPinned = state.shouldAutoScroll || isNearBottom(dom.tmuxContent);
        const savedScrollTop = wasPinned ? null : dom.tmuxContent.scrollTop;

        try {
            const config = readConfig();
            const data = await api.loadPaneContent({
                session,
                window,
                pane,
                scrollbackLines: config.scrollbackLines
            });

            if (paneKey !== getSelectedPaneKey()) {
                return;
            }

            if (deferWhenDetached && isTmuxUpdateHeld()) {
                state.pendingTmuxSnapshot = {
                    paneKey,
                    content: data.content
                };
                syncAutoRefreshButtonState();
                return;
            }

            clearPendingTmuxSnapshot();
            const shouldPinAfterUpdate = wasPinned || isNearBottom(dom.tmuxContent);
            dom.tmuxContent.textContent = data.content;

            if (shouldPinAfterUpdate) {
                dom.tmuxContent.scrollTop = dom.tmuxContent.scrollHeight;
            } else if (savedScrollTop !== null) {
                const maxScrollTop = Math.max(dom.tmuxContent.scrollHeight - dom.tmuxContent.clientHeight, 0);
                dom.tmuxContent.scrollTop = Math.min(savedScrollTop, maxScrollTop);
            }

            state.shouldAutoScroll = isNearBottom(dom.tmuxContent);
            syncAutoRefreshButtonState();
        } catch (error) {
            if (deferWhenDetached && isTmuxUpdateHeld()) {
                syncAutoRefreshButtonState();
                return;
            }

            const detail = error && error.message ? error.message : 'Unknown error';
            const responseDetail = error && typeof error.detail === 'string' ? error.detail : '';
            const missingPane = Boolean(
                (error && error.status === 404) ||
                    (responseDetail && /not found/i.test(responseDetail)) ||
                    /not found/i.test(detail)
            );

            if (missingPane) {
                state.selectedPane = null;
                syncAutoRefreshButtonState();
                try {
                    await loadTmuxTree();
                } catch (refreshError) {
                    dom.tmuxContent.textContent = `Error: ${refreshError.message}`;
                }
                return;
            }

            dom.tmuxContent.textContent = `Error: ${detail}`;
            syncAutoRefreshButtonState();
        }
    }

    function refreshTmux() {
        return refreshTmuxWithOptions({ background: getTmuxUpdateHoldReason() === 'selection' });
    }

    function refreshTmuxWithOptions({ background = false } = {}) {
        if (viewState.currentView !== 'tmux') {
            return;
        }

        if (state.selectedPane) {
            loadTmuxContent({ deferWhenDetached: background });
        } else {
            loadTmuxTree();
        }
    }

    function stopAutoRefreshTimers() {
        refreshController.stopTimers();
    }

    function syncAutoRefreshButtonState() {
        refreshController.syncButtonState();
    }

    function disableAutoRefresh(message) {
        refreshController.disable(message);
    }

    function markInteraction() {
        refreshController.markInteraction();
    }

    function syncAutoRefreshState() {
        refreshController.syncState();
    }

    function checkPendingTmuxSnapshotAfterSelectionChange() {
        requestAnimationFrame(() => {
            applyPendingTmuxSnapshotWhenIdle();
            syncAutoRefreshButtonState();
        });
    }

    function setupListeners() {
        dom.pageUpTmux.addEventListener('click', () => {
            pageScroll(dom.tmuxContent, -1);
            state.shouldAutoScroll = isNearBottom(dom.tmuxContent);
            if (state.shouldAutoScroll) {
                applyPendingTmuxSnapshotWhenIdle();
            }
            syncAutoRefreshButtonState();
        });

        dom.pageDownTmux.addEventListener('click', () => {
            pageScroll(dom.tmuxContent, 1);
            state.shouldAutoScroll = isNearBottom(dom.tmuxContent);
            if (state.shouldAutoScroll) {
                applyPendingTmuxSnapshotWhenIdle();
            }
            syncAutoRefreshButtonState();
        });

        dom.tmuxContent.addEventListener('scroll', () => {
            state.shouldAutoScroll = isNearBottom(dom.tmuxContent);
            if (state.shouldAutoScroll) {
                applyPendingTmuxSnapshotWhenIdle();
            }
            syncAutoRefreshButtonState();
        });

        dom.autoRefreshBtn.addEventListener('click', () => {
            refreshController.toggle();
        });

        if (dom.tmuxTreeRefreshBtn) {
            dom.tmuxTreeRefreshBtn.addEventListener('click', () => {
                markInteraction();
                loadTmuxTree();
            });
        }

        if (dom.paneRefreshBtn) {
            dom.paneRefreshBtn.addEventListener('click', () => {
                refreshTmux();
                markInteraction();
            });
        }

        document.addEventListener('selectionchange', checkPendingTmuxSnapshotAfterSelectionChange);
        dom.tmuxContent.addEventListener('pointerup', checkPendingTmuxSnapshotAfterSelectionChange);
        document.addEventListener('keyup', checkPendingTmuxSnapshotAfterSelectionChange);
    }

    function applyConfig(config) {
        refreshController.applyConfig(config);
    }

    treeRenderer = createTmuxTreeRenderer({
        dom,
        onSelectPane: selectPane
    });

    refreshController = createTmuxRefreshController({
        dom,
        state,
        getCurrentView: () => viewState.currentView,
        getHoldReason: getTmuxUpdateHoldReason,
        refreshTmuxWithOptions,
        callbacks
    });

    return {
        applyConfig,
        applyPendingTmuxSnapshotWhenIdle,
        clearPendingTmuxSnapshot,
        disableAutoRefresh,
        getTmuxUpdateHoldReason,
        loadTmuxContent,
        loadTmuxTree,
        markInteraction,
        refreshTmux,
        refreshTmuxWithOptions,
        setupListeners,
        stopAutoRefreshTimers,
        syncAutoRefreshButtonState,
        syncAutoRefreshState
    };
}
