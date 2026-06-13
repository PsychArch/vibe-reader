import { readConfig } from './config.js';
import { isNearBottom, pageScroll } from './ui.js';

export function createTmuxViewController({ dom, state, api, callbacks }) {
    function getSelectedPaneKey() {
        if (!state.selectedPane) {
            return null;
        }

        return [
            String(state.selectedPane.session),
            String(state.selectedPane.window),
            String(state.selectedPane.pane)
        ].join('\u0000');
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
        if (state.currentView !== 'tmux' || !state.selectedPane) {
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
                state.currentView === 'tmux' &&
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

    function clearTmuxSelectionHighlights() {
        if (!dom.tmuxTree) {
            return;
        }

        dom.tmuxTree
            .querySelectorAll(
                '.tree-session-name.active, .tree-window-name.active, .tree-pane.active'
            )
            .forEach((element) => element.classList.remove('active'));
    }

    function applyTmuxSelectionHighlight() {
        if (!dom.tmuxTree || !state.selectedPane) {
            return false;
        }

        const sessionName = String(state.selectedPane.session);
        const windowIndex = String(state.selectedPane.window);
        const paneValue = state.selectedPane.pane;
        const paneIndex =
            paneValue === undefined || paneValue === null ? null : String(paneValue);

        const sessionEl = Array.from(dom.tmuxTree.querySelectorAll('.tree-session-name')).find(
            (element) => element.dataset.sessionName === sessionName
        );
        const windowEl = Array.from(dom.tmuxTree.querySelectorAll('.tree-window-name')).find(
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
            const paneEl = Array.from(dom.tmuxTree.querySelectorAll('.tree-pane')).find(
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
        applyTmuxSelectionHighlight();
        syncAutoRefreshButtonState();
    }

    async function loadTmuxTree() {
        try {
            const tree = await api.loadTmuxTree();
            dom.tmuxTree.innerHTML = '';

            if (tree.length === 0) {
                state.selectedPane = null;
                dom.tmuxTree.innerHTML = '<div style="padding: 20px;">No tmux sessions found</div>';
                dom.tmuxContent.textContent = '';
                syncAutoRefreshButtonState();
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

                    if (window.panes.length === 1) {
                        windowDiv.classList.add('single-pane');
                    }

                    const windowName = document.createElement('div');
                    windowName.className = 'tree-window-name';
                    windowName.textContent = `${window.index}: ${window.name}`;
                    windowName.dataset.sessionName = session.name;
                    windowName.dataset.windowIndex = window.index;
                    windowDiv.appendChild(windowName);

                    if (window.panes.length === 1) {
                        windowName.onclick = () => {
                            selectPane(session.name, window.index, window.panes[0].index);
                        };
                    } else {
                        window.panes.forEach(pane => {
                            const paneDiv = document.createElement('div');
                            paneDiv.className = 'tree-pane';
                            paneDiv.textContent = `Pane ${pane.index}${pane.active ? ' *' : ''}`;
                            paneDiv.dataset.sessionName = session.name;
                            paneDiv.dataset.windowIndex = window.index;
                            paneDiv.dataset.paneIndex = pane.index;

                            paneDiv.onclick = () => {
                                selectPane(session.name, window.index, pane.index);
                            };

                            windowDiv.appendChild(paneDiv);
                        });
                    }

                    sessionDiv.appendChild(windowDiv);
                });

                dom.tmuxTree.appendChild(sessionDiv);
            });

            let selectionHighlighted = false;

            if (state.selectedPane) {
                selectionHighlighted = applyTmuxSelectionHighlight();
                if (!selectionHighlighted) {
                    state.selectedPane = null;
                }
            }

            if (!selectionHighlighted) {
                for (const session of tree) {
                    const firstWindow = session.windows.find(win => win.panes.length > 0);
                    if (!firstWindow) {
                        continue;
                    }

                    const firstPane = firstWindow.panes[0];
                    state.selectedPane = {
                        session: session.name,
                        window: firstWindow.index,
                        pane: firstPane.index
                    };
                    state.shouldAutoScroll = true;
                    clearPendingTmuxSnapshot();
                    loadTmuxContent();
                    applyTmuxSelectionHighlight();
                    syncAutoRefreshButtonState();
                    selectionHighlighted = true;
                    break;
                }
            }

            if (!selectionHighlighted) {
                clearTmuxSelectionHighlights();
                dom.tmuxContent.textContent = '';
                syncAutoRefreshButtonState();
            }
        } catch (error) {
            dom.tmuxTree.innerHTML = `<div style="padding: 20px; color: red;">Error: ${error.message}</div>`;
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
        if (state.currentView !== 'tmux') {
            return;
        }

        if (state.selectedPane) {
            loadTmuxContent({ deferWhenDetached: background });
        } else {
            loadTmuxTree();
        }
    }

    function stopAutoRefreshTimers() {
        if (state.refreshIntervalId) {
            clearInterval(state.refreshIntervalId);
            state.refreshIntervalId = null;
        }

        if (state.idleTimeoutId) {
            clearTimeout(state.idleTimeoutId);
            state.idleTimeoutId = null;
        }
    }

    function syncAutoRefreshButtonState() {
        if (!dom.autoRefreshBtn) {
            return;
        }

        const holdReason = state.autoRefreshEnabled ? getTmuxUpdateHoldReason() : null;
        const mode = !state.autoRefreshEnabled ? 'off' : holdReason ? 'paused' : 'on';
        const labels = {
            off: {
                text: 'Auto⟳',
                pressed: 'false',
                description: 'Auto refresh is off. Click to enable auto refresh.'
            },
            on: {
                text: 'Auto⟳',
                pressed: 'true',
                description: 'Auto refresh is on. Click to disable auto refresh.'
            },
            paused: {
                text: 'Auto⟳',
                pressed: 'mixed',
                description: holdReason === 'selection'
                    ? 'Auto refresh is paused while tmux text is selected. Click to disable auto refresh.'
                    : 'Auto refresh is paused while the tmux pane is scrolled up. Click to disable auto refresh.'
            }
        };
        const buttonState = labels[mode];

        dom.autoRefreshBtn.textContent = buttonState.text;
        dom.autoRefreshBtn.classList.toggle('active', mode === 'on');
        dom.autoRefreshBtn.classList.toggle('paused', mode === 'paused');
        dom.autoRefreshBtn.setAttribute('aria-pressed', buttonState.pressed);
        dom.autoRefreshBtn.setAttribute('aria-label', buttonState.description);
        dom.autoRefreshBtn.title = buttonState.description;
    }

    function disableAutoRefresh(message) {
        state.autoRefreshEnabled = false;
        stopAutoRefreshTimers();
        syncAutoRefreshButtonState();

        if (message) {
            callbacks.showToast(message);
        }
    }

    function enableAutoRefresh() {
        if (state.currentRefreshInterval <= 0) {
            callbacks.showToast('Set a refresh interval above 0 seconds to enable auto refresh.');
            return;
        }

        state.autoRefreshEnabled = true;
        markInteraction();
        syncAutoRefreshState();
    }

    function scheduleIdleTimeout() {
        if (state.idleTimeoutId) {
            clearTimeout(state.idleTimeoutId);
            state.idleTimeoutId = null;
        }

        if (!state.autoRefreshEnabled || state.currentIdleTimeoutMinutes <= 0 || state.currentView !== 'tmux') {
            return;
        }

        state.idleTimeoutId = setTimeout(() => {
            disableAutoRefresh(`Auto refresh disabled after ${state.currentIdleTimeoutMinutes} minutes of inactivity.`);
        }, state.currentIdleTimeoutMinutes * 60 * 1000);
    }

    function markInteraction() {
        scheduleIdleTimeout();
    }

    function syncAutoRefreshState() {
        stopAutoRefreshTimers();
        syncAutoRefreshButtonState();

        if (!state.autoRefreshEnabled || state.currentRefreshInterval <= 0 || state.currentView !== 'tmux') {
            return;
        }

        if (document.visibilityState === 'hidden') {
            return;
        }

        state.refreshIntervalId = setInterval(() => {
            if (document.visibilityState === 'hidden') {
                return;
            }
            refreshTmuxWithOptions({ background: true });
        }, state.currentRefreshInterval * 1000);

        scheduleIdleTimeout();
        syncAutoRefreshButtonState();
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
            if (state.autoRefreshEnabled) {
                disableAutoRefresh();
            } else {
                enableAutoRefresh();
            }
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

    return {
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
