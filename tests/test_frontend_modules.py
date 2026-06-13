import shutil
import subprocess
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_frontend_state_and_tmux_tree_helpers():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not available")

    script = r"""
        import assert from 'node:assert/strict';
        import {
            createConfigState,
            createFilesState,
            createMermaidState,
            createTmuxState,
            createViewState
        } from './frontend/state.js';
        import {
            findFirstSelectablePane,
            getSelectedPaneKey
        } from './frontend/tmux-tree.js';

        assert.deepEqual(createViewState(), {
            currentView: 'tmux',
            sidebarCollapsed: false
        });
        assert.equal(createTmuxState().autoRefreshEnabled, false);
        assert.equal(createFilesState().diffSource, 'unstaged');
        assert.equal(createConfigState().initialized, false);
        assert.equal(createMermaidState().diagramId, 0);

        assert.equal(getSelectedPaneKey(null), null);
        assert.equal(
            getSelectedPaneKey({ session: 'work', window: 1, pane: 2 }),
            'work\u00001\u00002'
        );
        assert.deepEqual(
            findFirstSelectablePane([
                { name: 'empty', windows: [] },
                {
                    name: 'dev',
                    windows: [
                        { index: '0', panes: [] },
                        { index: '1', panes: [{ index: '3' }] }
                    ]
                }
            ]),
            { session: 'dev', window: '1', pane: '3' }
        );
        assert.equal(findFirstSelectablePane([{ name: 'empty', windows: [] }]), null);
    """

    subprocess.run(
        [node, "--input-type=module", "-e", script],
        cwd=PROJECT_ROOT,
        check=True,
        text=True,
    )
