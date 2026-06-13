import { escapeHtml } from './ui.js';

const MERMAID_MODULE_PATH = '/static/vendor/mermaid.esm.min.mjs';

export function createMermaidRenderer({ dom, state }) {
    async function loadMermaidModule() {
        if (!state.mermaidModulePromise) {
            state.mermaidModulePromise = import(MERMAID_MODULE_PATH)
                .then((module) => {
                    const mermaid = module.default || module;
                    mermaid.initialize({
                        startOnLoad: false,
                        securityLevel: 'strict',
                        theme: 'neutral',
                        look: 'classic',
                        suppressErrorRendering: true,
                        htmlLabels: false,
                        themeCSS: `
                            svg {
                                background: #fff !important;
                            }

                            .labelBkg,
                            .background,
                            .edgeLabel rect,
                            .cluster-label rect,
                            .note,
                            .note rect,
                            .labelBox,
                            .loopText rect {
                                fill: #fff !important;
                            }

                            .edgePath path,
                            .flowchart-link,
                            .messageLine0,
                            .messageLine1,
                            .actor-line,
                            .signal-line {
                                stroke: #000 !important;
                                fill: none !important;
                            }

                            marker path,
                            .arrowMarkerPath {
                                fill: #000 !important;
                                stroke: #000 !important;
                            }
                        `
                    });
                    return mermaid;
                })
                .catch((error) => {
                    state.mermaidModulePromise = null;
                    throw error;
                });
        }

        return state.mermaidModulePromise;
    }

    function getMermaidSource(block) {
        const sourceElement = block.querySelector('.mermaid-source');
        return sourceElement ? sourceElement.textContent || '' : '';
    }

    function formatMermaidError(error) {
        const message = error instanceof Error ? error.message : String(error || 'Unknown error');
        return message.replace(/\s+/g, ' ').trim() || 'Unknown error';
    }

    function showMermaidFallback(block, source, errorMessage) {
        const diagramElement = block.querySelector('.mermaid-diagram');
        const errorElement = block.querySelector('.mermaid-error');

        if (diagramElement) {
            diagramElement.innerHTML = `<pre class="mermaid-source">${escapeHtml(source)}</pre>`;
        }

        if (errorElement) {
            errorElement.textContent = `Mermaid render failed: ${errorMessage}`;
            errorElement.classList.remove('hidden');
        }

        block.classList.remove('mermaid-block--rendered');
        block.classList.add('mermaid-block--error');
    }

    function normalizeMermaidSvg(diagramElement) {
        const svg = diagramElement?.querySelector('svg');
        if (!svg) {
            return;
        }

        const viewBoxWidth = svg.viewBox?.baseVal?.width;
        const containerWidth = diagramElement.clientWidth;
        let targetWidth = null;

        if (Number.isFinite(viewBoxWidth) && viewBoxWidth > 0) {
            const intrinsicWidth = Math.ceil(viewBoxWidth);
            const shrinkRatio =
                Number.isFinite(containerWidth) && containerWidth > 0
                    ? containerWidth / intrinsicWidth
                    : 0;

            if (shrinkRatio >= 1) {
                targetWidth = intrinsicWidth;
            } else if (shrinkRatio >= 0.75) {
                targetWidth = Math.floor(containerWidth);
            } else {
                targetWidth = intrinsicWidth;
            }
        }

        svg.style.width = targetWidth ? `${targetWidth}px` : '100%';
        svg.style.maxWidth = 'none';
        svg.style.height = 'auto';
        svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

        if (Number.isFinite(containerWidth) && containerWidth > 0 && targetWidth && targetWidth < containerWidth) {
            svg.style.marginLeft = 'auto';
            svg.style.marginRight = 'auto';
        } else {
            svg.style.marginLeft = '0';
            svg.style.marginRight = '0';
        }
    }

    function refreshVisibleMermaidDiagrams() {
        if (!dom.fileContent) {
            return;
        }

        dom.fileContent.querySelectorAll('.mermaid-diagram').forEach((diagramElement) => {
            normalizeMermaidSvg(diagramElement);
        });
    }

    async function renderMermaidBlock(block, mermaid, renderToken) {
        const source = getMermaidSource(block);
        if (!source.trim()) {
            return;
        }

        const diagramElement = block.querySelector('.mermaid-diagram');
        const errorElement = block.querySelector('.mermaid-error');
        if (!diagramElement) {
            return;
        }

        if (errorElement) {
            errorElement.textContent = '';
            errorElement.classList.add('hidden');
        }
        block.classList.remove('mermaid-block--error');

        try {
            await mermaid.parse(source);
            const { svg, bindFunctions } = await mermaid.render(
                `mermaid-diagram-${renderToken}-${++state.mermaidDiagramId}`,
                source
            );

            if (renderToken !== state.currentFileRenderToken || !dom.fileContent.contains(block)) {
                return;
            }

            diagramElement.innerHTML = svg;
            normalizeMermaidSvg(diagramElement);
            bindFunctions?.(diagramElement);
            block.classList.add('mermaid-block--rendered');
        } catch (error) {
            if (renderToken !== state.currentFileRenderToken || !dom.fileContent.contains(block)) {
                return;
            }

            showMermaidFallback(block, source, formatMermaidError(error));
        }
    }

    async function renderMermaidDiagrams(renderToken) {
        if (!dom.fileContent) {
            return;
        }

        const blocks = Array.from(dom.fileContent.querySelectorAll('.mermaid-block'));
        if (blocks.length === 0) {
            return;
        }

        let mermaid;
        try {
            mermaid = await loadMermaidModule();
        } catch (error) {
            if (renderToken !== state.currentFileRenderToken) {
                return;
            }

            const message = formatMermaidError(error);
            blocks.forEach((block) => {
                if (dom.fileContent.contains(block)) {
                    showMermaidFallback(block, getMermaidSource(block), message);
                }
            });
            return;
        }

        if (renderToken !== state.currentFileRenderToken) {
            return;
        }

        for (const block of blocks) {
            if (renderToken !== state.currentFileRenderToken || !dom.fileContent.contains(block)) {
                return;
            }

            await renderMermaidBlock(block, mermaid, renderToken);
        }
    }

    return {
        refreshVisibleMermaidDiagrams,
        renderMermaidDiagrams
    };
}
