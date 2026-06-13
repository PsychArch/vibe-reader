export const DEFAULT_REFRESH_INTERVAL = 5;
export const CONFIG_STORAGE_KEY = 'vibeReaderConfig';

export const DEFAULT_CONFIG = {
    scrollbackLines: 400,
    fontSize: 14,
    refreshInterval: DEFAULT_REFRESH_INTERVAL,
    refreshIdleMinutes: 10,
    markdownFontFamily: 'serif',
    enableSyntaxHighlighting: true,
    diffSourcePreference: 'unstaged'
};

export function normalizeMarkdownFontFamily(value) {
    return value === 'sans' ? 'sans' : 'serif';
}

function normalizeDiffSource(value) {
    return value === 'staged' ? 'staged' : 'unstaged';
}

function normalizeInteger(value, fallback, { positive = false } = {}) {
    if (Number.isInteger(value) && (!positive || value > 0)) {
        return value;
    }
    return fallback;
}

export function normalizeConfig(config = {}) {
    return {
        scrollbackLines: normalizeInteger(config.scrollbackLines, DEFAULT_CONFIG.scrollbackLines),
        fontSize: normalizeInteger(config.fontSize, DEFAULT_CONFIG.fontSize),
        refreshInterval: normalizeInteger(
            config.refreshInterval,
            DEFAULT_CONFIG.refreshInterval,
            { positive: true }
        ),
        refreshIdleMinutes: normalizeInteger(
            config.refreshIdleMinutes,
            DEFAULT_CONFIG.refreshIdleMinutes
        ),
        markdownFontFamily: normalizeMarkdownFontFamily(config.markdownFontFamily),
        enableSyntaxHighlighting: config.enableSyntaxHighlighting !== false,
        diffSourcePreference: normalizeDiffSource(config.diffSourcePreference)
    };
}

export function readConfig() {
    try {
        return normalizeConfig(JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || '{}'));
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

export function writeConfig(config) {
    const normalized = normalizeConfig(config);
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}

function ensureSelectValue(selectElement, value) {
    if (!selectElement) {
        return;
    }

    const stringValue = String(value);
    const hasOption = Array.from(selectElement.options).some(option => option.value === stringValue);

    if (!hasOption) {
        const option = document.createElement('option');
        option.value = stringValue;
        option.textContent = stringValue;
        selectElement.appendChild(option);
    }

    selectElement.value = stringValue;
}

function applyMarkdownFontPreference(dom, fontFamily) {
    if (!dom.fileContentContainer) {
        return;
    }

    const normalized = normalizeMarkdownFontFamily(fontFamily);
    dom.fileContentContainer.classList.toggle('markdown-font-serif', normalized === 'serif');
    dom.fileContentContainer.classList.toggle('markdown-font-sans', normalized === 'sans');
}

function applyContentPreferences(dom, config) {
    document.querySelectorAll('.content-box').forEach(el => {
        el.style.fontSize = `${config.fontSize}px`;
    });
    applyMarkdownFontPreference(dom, config.markdownFontFamily);
}

function syncForm(dom, config) {
    ensureSelectValue(dom.scrollbackLinesSelect, config.scrollbackLines);
    if (dom.fontSizeSelect) {
        dom.fontSizeSelect.value = String(config.fontSize);
    }
    if (dom.markdownFontFamilySelect) {
        dom.markdownFontFamilySelect.value = config.markdownFontFamily;
    }
    if (dom.refreshIntervalSelect) {
        dom.refreshIntervalSelect.value = String(config.refreshInterval);
    }
    if (dom.enableSyntaxHighlightingCheckbox) {
        dom.enableSyntaxHighlightingCheckbox.checked = config.enableSyntaxHighlighting;
    }
    if (dom.diffSourcePreferenceSelect) {
        dom.diffSourcePreferenceSelect.value = config.diffSourcePreference;
    }

    if (!dom.refreshIdleTimeoutSelect) {
        return;
    }

    if (Array.from(dom.refreshIdleTimeoutSelect.options).some(opt => parseInt(opt.value, 10) === config.refreshIdleMinutes)) {
        dom.refreshIdleTimeoutSelect.value = String(config.refreshIdleMinutes);
    } else {
        dom.refreshIdleTimeoutSelect.value = String(DEFAULT_CONFIG.refreshIdleMinutes);
    }
}

function readConfigFromForm(dom, currentIdleTimeoutMinutes) {
    const parsedScrollback = parseInt(dom.scrollbackLinesSelect?.value, 10);
    const parsedFontSize = parseInt(dom.fontSizeSelect?.value, 10);
    const parsedRefreshInterval = parseInt(dom.refreshIntervalSelect?.value, 10);
    const parsedIdleMinutes = parseInt(dom.refreshIdleTimeoutSelect?.value, 10);

    const selectedMarkdownFont = dom.markdownFontFamilySelect
        ? normalizeMarkdownFontFamily(dom.markdownFontFamilySelect.value)
        : DEFAULT_CONFIG.markdownFontFamily;

    const selectedDiffSource = dom.diffSourcePreferenceSelect && dom.diffSourcePreferenceSelect.value === 'staged'
        ? 'staged'
        : 'unstaged';

    return {
        scrollbackLines: Number.isNaN(parsedScrollback) ? DEFAULT_CONFIG.scrollbackLines : parsedScrollback,
        fontSize: Number.isNaN(parsedFontSize) ? DEFAULT_CONFIG.fontSize : parsedFontSize,
        refreshInterval: Number.isNaN(parsedRefreshInterval) || parsedRefreshInterval <= 0
            ? DEFAULT_CONFIG.refreshInterval
            : parsedRefreshInterval,
        refreshIdleMinutes: Number.isNaN(parsedIdleMinutes) ? currentIdleTimeoutMinutes : parsedIdleMinutes,
        markdownFontFamily: selectedMarkdownFont,
        enableSyntaxHighlighting: dom.enableSyntaxHighlightingCheckbox?.checked !== false,
        diffSourcePreference: selectedDiffSource
    };
}

export function createConfigController({ dom, state, callbacks }) {
    function syncConfigState(config) {
        state.currentRefreshInterval = config.refreshInterval;
        state.currentIdleTimeoutMinutes = config.refreshIdleMinutes;
        state.diffSource = config.diffSourcePreference;
    }

    function loadConfig() {
        const config = readConfig();
        syncForm(dom, config);
        const effectiveConfig = {
            ...config,
            refreshIdleMinutes: parseInt(dom.refreshIdleTimeoutSelect?.value, 10) || config.refreshIdleMinutes
        };
        applyContentPreferences(dom, effectiveConfig);
        syncConfigState(effectiveConfig);
        state.configInitialized = true;
        callbacks.onConfigLoaded?.(effectiveConfig);
        return effectiveConfig;
    }

    function applyConfig({ notify = true } = {}) {
        const config = writeConfig(readConfigFromForm(dom, state.currentIdleTimeoutMinutes));
        applyContentPreferences(dom, config);
        syncConfigState(config);
        callbacks.onConfigApplied?.(config, { notify });
        return config;
    }

    function setupListeners() {
        const controlBindings = [
            [dom.scrollbackLinesSelect, 'change'],
            [dom.fontSizeSelect, 'change'],
            [dom.markdownFontFamilySelect, 'change'],
            [dom.refreshIntervalSelect, 'change'],
            [dom.refreshIdleTimeoutSelect, 'change'],
            [dom.enableSyntaxHighlightingCheckbox, 'change'],
            [dom.diffSourcePreferenceSelect, 'change']
        ];

        controlBindings.forEach(([element, eventName]) => {
            if (!element) {
                return;
            }

            element.addEventListener(eventName, () => {
                if (!state.configInitialized) {
                    return;
                }

                applyConfig();
            });
        });
    }

    return {
        applyConfig,
        loadConfig,
        setupListeners
    };
}
