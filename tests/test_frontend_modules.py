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
        import { createFilesViewController } from './frontend/files-view.js';
        import {
            findFirstSelectablePane,
            getSelectedPaneKey
        } from './frontend/tmux-tree.js';

        function createDeferred() {
            let resolve;
            let reject;
            const promise = new Promise((promiseResolve, promiseReject) => {
                resolve = promiseResolve;
                reject = promiseReject;
            });
            return { promise, resolve, reject };
        }

        function createFileControllerHarness(apiOverrides = {}) {
            const fileState = createFilesState();
            const calls = {
                inlineMessages: [],
                renderedPayloads: [],
                toasts: []
            };
            const dom = {
                fileContentContainer: { scrollTop: 45 },
                fileList: { querySelectorAll: () => [] },
                pageUpFiles: { addEventListener: () => {} },
                pageDownFiles: { addEventListener: () => {} },
                loadFiles: { addEventListener: () => {} },
                diffModeToggle: { addEventListener: () => {} },
                currentPathDisplay: null
            };
            const contentRenderer = {
                renderInlineMessage: (message) => calls.inlineMessages.push(message),
                renderFileContent: (payload) => calls.renderedPayloads.push(payload),
                renderDiffPrompt: (message) => calls.inlineMessages.push(message || 'diff prompt'),
                resetFilePreview: () => calls.inlineMessages.push('reset')
            };
            const controller = createFilesViewController({
                dom,
                state: fileState,
                viewState: createViewState(),
                api: {
                    loadFileContent: () => Promise.resolve({ render_mode: 'plain', html: '', metadata: {} }),
                    loadFiles: () => Promise.resolve([]),
                    loadGitDiff: () => Promise.resolve({ text: '' }),
                    ...apiOverrides
                },
                contentRenderer,
                gitStatus: {
                    getSummary: () => Promise.resolve(null),
                    invalidate: () => {}
                },
                callbacks: {
                    markInteraction: () => {},
                    showToast: (message) => calls.toasts.push(message)
                }
            });
            return { calls, controller, dom, fileState };
        }

        assert.deepEqual(createViewState(), {
            currentView: 'tmux',
            sidebarCollapsed: false
        });
        assert.equal(createTmuxState().autoRefreshEnabled, false);
        assert.equal(createFilesState().diffSource, 'unstaged');
        assert.equal(createFilesState().currentFileRequestId, 0);
        assert.equal(createFilesState().currentFileAbortController, null);
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

        {
            const request = createDeferred();
            let capturedSignal = null;
            const { calls, controller, dom } = createFileControllerHarness({
                loadFileContent: (_path, options) => {
                    capturedSignal = options.signal;
                    return request.promise;
                }
            });

            const pending = controller.loadFileContent('slow.py');
            assert.equal(calls.inlineMessages.at(-1), 'Loading slow.py...');
            assert.equal(capturedSignal instanceof AbortSignal, true);

            request.resolve({
                render_mode: 'plain',
                html: '<div>ok</div>',
                metadata: { render_note: 'Large file rendered without syntax highlighting.' }
            });
            await pending;

            assert.equal(calls.renderedPayloads.length, 1);
            assert.equal(dom.fileContentContainer.scrollTop, 0);
            assert.deepEqual(calls.toasts, ['Large file rendered without syntax highlighting.']);
        }

        {
            const requests = [];
            const { calls, controller } = createFileControllerHarness({
                loadFileContent: (_path, options) => {
                    const request = createDeferred();
                    request.signal = options.signal;
                    requests.push(request);
                    return request.promise;
                }
            });

            const first = controller.loadFileContent('first.py');
            const second = controller.loadFileContent('second.py');
            assert.equal(requests[0].signal.aborted, true);

            requests[0].resolve({ render_mode: 'plain', html: 'first', metadata: {} });
            await first;
            assert.equal(calls.renderedPayloads.length, 0);

            requests[1].resolve({ render_mode: 'plain', html: 'second', metadata: {} });
            await second;
            assert.equal(calls.renderedPayloads.length, 1);
            assert.equal(calls.renderedPayloads[0].html, 'second');
        }

        {
            const { calls, controller } = createFileControllerHarness({
                loadFileContent: () => Promise.reject(new DOMException('Aborted', 'AbortError'))
            });

            await controller.loadFileContent('aborted.py');

            assert.deepEqual(calls.inlineMessages, ['Loading aborted.py...']);
            assert.equal(calls.renderedPayloads.length, 0);
        }
    """

    subprocess.run(
        [node, "--input-type=module", "-e", script],
        cwd=PROJECT_ROOT,
        check=True,
        text=True,
    )
