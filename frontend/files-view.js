import { readConfig } from './config.js';
import {
    buildGitStatusHelper,
    createFileRow,
    deriveStatusFlags,
    gatherDeletedEntries,
    getDisplayNameForDirectory
} from './file-status.js';
import { pageScroll } from './ui.js';

export function createFilesViewController({ dom, state, api, contentRenderer, gitStatus, callbacks }) {
    function updateCurrentPathDisplay() {
        if (!dom.currentPathDisplay) {
            return;
        }

        const displayPath = state.currentDirectory && state.currentDirectory !== '' ? state.currentDirectory : '.';
        dom.currentPathDisplay.textContent = displayPath;
        dom.currentPathDisplay.title = displayPath;
    }

    function setCurrentDirectory(path) {
        state.currentDirectory = path && path !== '' ? path : '.';
        updateCurrentPathDisplay();
        if (state.diffModeEnabled && !state.selectedFile) {
            contentRenderer.renderDiffPrompt();
        }
    }

    function highlightSelectedFile() {
        if (!dom.fileList) {
            return;
        }
        Array.from(dom.fileList.querySelectorAll('.file-item')).forEach(item => {
            const isActive = state.selectedFile && item.dataset.path === state.selectedFile;
            item.classList.toggle('active', Boolean(isActive));
        });
    }

    function describeDiffSource(source) {
        return source === 'staged' ? 'Staged' : 'Unstaged';
    }

    function openFile(path, { isDeleted = false } = {}) {
        if (!path) {
            return;
        }
        state.selectedFileIsDeleted = isDeleted;
        if (state.diffModeEnabled) {
            loadGitDiff(path, state.diffSource);
            return;
        }
        if (isDeleted) {
            callbacks.showToast('Enable diff mode to inspect deleted files.');
            contentRenderer.renderDiffPrompt();
            return;
        }
        loadFileContent(path);
    }

    async function loadGitDiff(path, source = state.diffSource) {
        if (!path) {
            contentRenderer.renderDiffPrompt();
            return;
        }

        const requestId = ++state.currentDiffRequestId;
        const sourceLabel = describeDiffSource(source);
        contentRenderer.renderInlineMessage(`Loading ${sourceLabel.toLowerCase()} diff…`);

        try {
            const payload = await api.loadGitDiff(path, source);

            if (requestId !== state.currentDiffRequestId) {
                return;
            }

            const diffText = (payload.text || '').trim();
            if (diffText.length === 0) {
                if (state.selectedFileIsDeleted) {
                    contentRenderer.renderDiffPrompt(`No ${sourceLabel.toLowerCase()} changes for deleted file.`);
                } else {
                    callbacks.showToast(`No ${sourceLabel.toLowerCase()} changes for ${path}.`);
                    loadFileContent(path);
                }
                return;
            }

            contentRenderer.renderFileContent(payload);
            dom.fileContentContainer.scrollTop = 0;
        } catch (error) {
            if (requestId !== state.currentDiffRequestId) {
                return;
            }
            contentRenderer.renderDiffPrompt(`Diff unavailable: ${error.message}`);
        }
    }

    function updateDiffModeUI() {
        if (!dom.diffModeToggle) {
            return;
        }

        dom.diffModeToggle.classList.toggle('active', state.diffModeEnabled);
        dom.diffModeToggle.textContent = state.diffModeEnabled ? 'Diff On' : 'Diff Off';
        dom.diffModeToggle.setAttribute('aria-pressed', state.diffModeEnabled ? 'true' : 'false');

        if (!state.diffModeEnabled) {
            if (state.selectedFile) {
                if (!state.selectedFileIsDeleted) {
                    loadFileContent(state.selectedFile);
                } else {
                    callbacks.showToast('Diff mode is required to view deleted files.');
                    state.selectedFile = null;
                    state.selectedFileIsDeleted = false;
                    highlightSelectedFile();
                    contentRenderer.resetFilePreview();
                }
            } else {
                contentRenderer.resetFilePreview();
            }
            return;
        }

        if (state.selectedFile) {
            loadGitDiff(state.selectedFile, state.diffSource);
        } else {
            contentRenderer.renderDiffPrompt();
        }
    }

    async function loadFileList({ forceStatusRefresh = false } = {}) {
        try {
            const path = state.currentDirectory || '.';
            updateCurrentPathDisplay();

            let statusSummary = null;
            let statusHelper = null;
            try {
                statusSummary = await gitStatus.getSummary(path, { force: forceStatusRefresh });
                statusHelper = buildGitStatusHelper(statusSummary);
            } catch (statusError) {
                if (state.diffModeEnabled) {
                    contentRenderer.renderInlineMessage(statusError.message);
                }
            }

            const files = await api.loadFiles(path);
            dom.fileList.innerHTML = '';
            let appended = false;

            if (path !== '.' && path !== '/') {
                const parentDiv = createFileRow({
                    kind: 'parent',
                    onClick: () => {
                        callbacks.markInteraction();
                        const parentPath = path.split('/').slice(0, -1).join('/') || '.';
                        setCurrentDirectory(parentPath);
                        state.selectedFile = null;
                        state.selectedFileIsDeleted = false;
                        contentRenderer.resetFilePreview();
                        loadFileList({ forceStatusRefresh: true });
                    }
                });
                dom.fileList.appendChild(parentDiv);
                appended = true;
            }

            files.forEach(file => {
                const flags = deriveStatusFlags(file.path, file.is_dir, statusHelper);
                const fileDiv = createFileRow({
                    kind: file.is_dir ? 'directory' : 'file',
                    path: file.path,
                    name: file.name,
                    statusFlags: flags,
                    active: !file.is_dir && state.selectedFile === file.path,
                    onClick: () => {
                        callbacks.markInteraction();
                        if (file.is_dir) {
                            setCurrentDirectory(file.path);
                            state.selectedFile = null;
                            state.selectedFileIsDeleted = false;
                            contentRenderer.resetFilePreview();
                            loadFileList();
                        } else {
                            state.selectedFile = file.path;
                            state.selectedFileIsDeleted = false;
                            highlightSelectedFile();
                            openFile(file.path);
                        }
                    }
                });

                dom.fileList.appendChild(fileDiv);
                appended = true;
            });

            gatherDeletedEntries(statusSummary, path).forEach(deletedPath => {
                const flags = deriveStatusFlags(deletedPath, false, statusHelper);
                const deletedDiv = createFileRow({
                    kind: 'deleted',
                    path: deletedPath,
                    name: `${getDisplayNameForDirectory(deletedPath, path)} (deleted)`,
                    statusFlags: flags,
                    onClick: () => {
                        callbacks.markInteraction();
                        state.selectedFile = deletedPath;
                        state.selectedFileIsDeleted = true;
                        highlightSelectedFile();
                        openFile(deletedPath, { isDeleted: true });
                    }
                });

                dom.fileList.appendChild(deletedDiv);
                appended = true;
            });

            if (!appended) {
                dom.fileList.innerHTML = '<div class="file-item">Empty directory</div>';
            } else {
                highlightSelectedFile();
            }

            if (state.diffModeEnabled) {
                if (state.selectedFile) {
                    loadGitDiff(state.selectedFile, state.diffSource);
                } else {
                    contentRenderer.renderDiffPrompt();
                }
            }
        } catch (error) {
            dom.fileList.innerHTML = `<div class="file-item" style="color: red;">Error: ${error.message}</div>`;
        }
    }

    async function loadFileContent(path) {
        try {
            const config = readConfig();
            const data = await api.loadFileContent(path, {
                enableHighlighting: config.enableSyntaxHighlighting
            });
            contentRenderer.renderFileContent(data);
            dom.fileContentContainer.scrollTop = 0;
        } catch (error) {
            contentRenderer.renderInlineMessage(error.message);
        }
    }

    function handleConfigChanged() {
        if (state.currentView !== 'files') {
            return;
        }

        if (state.diffModeEnabled) {
            if (state.selectedFile) {
                loadGitDiff(state.selectedFile, state.diffSource);
            } else {
                contentRenderer.renderDiffPrompt();
            }
        } else if (state.selectedFile) {
            loadFileContent(state.selectedFile);
        }
    }

    function setupListeners() {
        dom.pageUpFiles.addEventListener('click', () => {
            pageScroll(dom.fileContentContainer, -1);
        });

        dom.pageDownFiles.addEventListener('click', () => {
            pageScroll(dom.fileContentContainer, 1);
        });

        dom.loadFiles.addEventListener('click', () => {
            callbacks.markInteraction();
            gitStatus.invalidate(state.currentDirectory);
            loadFileList({ forceStatusRefresh: true });
        });

        if (dom.diffModeToggle) {
            dom.diffModeToggle.addEventListener('click', () => {
                callbacks.markInteraction();
                state.diffModeEnabled = !state.diffModeEnabled;
                updateDiffModeUI();
            });
        }
    }

    return {
        handleConfigChanged,
        loadFileContent,
        loadFileList,
        setCurrentDirectory,
        setupListeners,
        updateCurrentPathDisplay,
        updateDiffModeUI
    };
}
