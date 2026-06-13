export function createTmuxRefreshController({
    dom,
    state,
    getCurrentView,
    getHoldReason,
    refreshTmuxWithOptions,
    callbacks
}) {
    function stopTimers() {
        if (state.refreshIntervalId) {
            clearInterval(state.refreshIntervalId);
            state.refreshIntervalId = null;
        }

        if (state.idleTimeoutId) {
            clearTimeout(state.idleTimeoutId);
            state.idleTimeoutId = null;
        }
    }

    function syncButtonState() {
        if (!dom.autoRefreshBtn) {
            return;
        }

        const holdReason = state.autoRefreshEnabled ? getHoldReason() : null;
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

    function disable(message) {
        state.autoRefreshEnabled = false;
        stopTimers();
        syncButtonState();

        if (message) {
            callbacks.showToast(message);
        }
    }

    function scheduleIdleTimeout() {
        if (state.idleTimeoutId) {
            clearTimeout(state.idleTimeoutId);
            state.idleTimeoutId = null;
        }

        if (!state.autoRefreshEnabled || state.currentIdleTimeoutMinutes <= 0 || getCurrentView() !== 'tmux') {
            return;
        }

        state.idleTimeoutId = setTimeout(() => {
            disable(`Auto refresh disabled after ${state.currentIdleTimeoutMinutes} minutes of inactivity.`);
        }, state.currentIdleTimeoutMinutes * 60 * 1000);
    }

    function markInteraction() {
        scheduleIdleTimeout();
    }

    function syncState() {
        stopTimers();
        syncButtonState();

        if (!state.autoRefreshEnabled || state.currentRefreshInterval <= 0 || getCurrentView() !== 'tmux') {
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
        syncButtonState();
    }

    function enable() {
        if (state.currentRefreshInterval <= 0) {
            callbacks.showToast('Set a refresh interval above 0 seconds to enable auto refresh.');
            return;
        }

        state.autoRefreshEnabled = true;
        markInteraction();
        syncState();
    }

    function toggle() {
        if (state.autoRefreshEnabled) {
            disable();
        } else {
            enable();
        }
    }

    function applyConfig(config) {
        state.currentRefreshInterval = config.refreshInterval;
        state.currentIdleTimeoutMinutes = config.refreshIdleMinutes;
    }

    return {
        applyConfig,
        disable,
        markInteraction,
        stopTimers,
        syncButtonState,
        syncState,
        toggle
    };
}
