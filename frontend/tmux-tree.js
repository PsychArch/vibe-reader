export function getSelectedPaneKey(selectedPane) {
    if (!selectedPane) {
        return null;
    }

    return [
        String(selectedPane.session),
        String(selectedPane.window),
        String(selectedPane.pane)
    ].join('\u0000');
}

export function findFirstSelectablePane(tree) {
    for (const session of tree) {
        const firstWindow = session.windows.find(win => win.panes.length > 0);
        if (!firstWindow) {
            continue;
        }

        return {
            session: session.name,
            window: firstWindow.index,
            pane: firstWindow.panes[0].index
        };
    }

    return null;
}

export function createTmuxTreeRenderer({ dom, onSelectPane }) {
    function clearSelectionHighlights() {
        if (!dom.tmuxTree) {
            return;
        }

        dom.tmuxTree
            .querySelectorAll(
                '.tree-session-name.active, .tree-window-name.active, .tree-pane.active'
            )
            .forEach((element) => element.classList.remove('active'));
    }

    function applySelectionHighlight(selectedPane) {
        if (!dom.tmuxTree || !selectedPane) {
            return false;
        }

        const sessionName = String(selectedPane.session);
        const windowIndex = String(selectedPane.window);
        const paneValue = selectedPane.pane;
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

        clearSelectionHighlights();
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

    function createStatusRow(message, { error = false } = {}) {
        const row = document.createElement('div');
        row.className = error ? 'tree-status tree-status--error' : 'tree-status';
        row.textContent = message;
        return row;
    }

    function renderEmpty() {
        dom.tmuxTree.replaceChildren(createStatusRow('No tmux sessions found'));
    }

    function renderError(message) {
        dom.tmuxTree.replaceChildren(createStatusRow(`Error: ${message}`, { error: true }));
    }

    function renderTree(tree) {
        const fragment = document.createDocumentFragment();

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
                    windowName.addEventListener('click', () => {
                        onSelectPane(session.name, window.index, window.panes[0].index);
                    });
                } else {
                    window.panes.forEach(pane => {
                        const paneDiv = document.createElement('div');
                        paneDiv.className = 'tree-pane';
                        paneDiv.textContent = `Pane ${pane.index}${pane.active ? ' *' : ''}`;
                        paneDiv.dataset.sessionName = session.name;
                        paneDiv.dataset.windowIndex = window.index;
                        paneDiv.dataset.paneIndex = pane.index;

                        paneDiv.addEventListener('click', () => {
                            onSelectPane(session.name, window.index, pane.index);
                        });

                        windowDiv.appendChild(paneDiv);
                    });
                }

                sessionDiv.appendChild(windowDiv);
            });

            fragment.appendChild(sessionDiv);
        });

        dom.tmuxTree.replaceChildren(fragment);
    }

    return {
        applySelectionHighlight,
        clearSelectionHighlights,
        renderEmpty,
        renderError,
        renderTree
    };
}
