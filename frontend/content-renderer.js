import { escapeHtml } from './ui.js';

export function createContentRenderer({ dom, state, mermaidRenderer, isDiffModeEnabled }) {
    function resetFilePreview() {
        if (!dom.fileContentContainer || !dom.fileContent) {
            return;
        }

        state.currentFileRenderToken += 1;
        dom.fileContent.innerHTML = '';
        dom.fileContentContainer.dataset.language = 'TEXT';
        dom.fileContentContainer.dataset.mode = 'PLAIN';
        dom.fileContentContainer.classList.remove('markdown-mode');
        dom.fileContentContainer.classList.add('code-mode');
        if (isDiffModeEnabled()) {
            renderDiffPrompt();
        }
    }

    function renderInlineMessage(message) {
        if (!dom.fileContentContainer || !dom.fileContent) {
            return;
        }
        state.currentFileRenderToken += 1;
        dom.fileContentContainer.dataset.language = 'TEXT';
        dom.fileContentContainer.dataset.mode = 'PLAIN';
        dom.fileContentContainer.classList.remove('markdown-mode');
        dom.fileContentContainer.classList.add('code-mode');
        dom.fileContent.innerHTML = `<div class="code-line"><span class="line-code">${escapeHtml(message)}</span></div>`;
    }

    function renderDiffPrompt(message) {
        renderInlineMessage(message || 'Select a file to view a diff.');
    }

    function renderFileContent({ render_mode: renderMode, html, metadata = {} }) {
        const mode = (renderMode || 'plain').toUpperCase();
        const label = (metadata.language || (mode === 'MARKDOWN' ? 'MARKDOWN' : 'TEXT')).toUpperCase();
        const renderToken = ++state.currentFileRenderToken;

        dom.fileContentContainer.dataset.language = label;
        dom.fileContentContainer.dataset.mode = mode;
        const isMarkdown = mode === 'MARKDOWN';
        dom.fileContentContainer.classList.toggle('markdown-mode', isMarkdown);
        dom.fileContentContainer.classList.toggle('code-mode', !isMarkdown);

        dom.fileContent.innerHTML = html || '';

        if (isMarkdown) {
            void mermaidRenderer.renderMermaidDiagrams(renderToken);
        }
    }

    return {
        resetFilePreview,
        renderDiffPrompt,
        renderFileContent,
        renderInlineMessage
    };
}
