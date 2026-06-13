const BADGE_LABELS = {
    staged: { text: 'S', title: 'Staged change' },
    unstaged: { text: 'M', title: 'Unstaged modification' },
    untracked: { text: 'U', title: 'Untracked path' },
    deleted: { text: 'D', title: 'Deleted path' }
};

export function normalizeDirectoryKey(path) {
    if (!path || path === '.' || path === '/') {
        return '.';
    }
    return path.replace(/\/+$/, '');
}

export function getParentDirectory(path) {
    if (!path || path === '.') {
        return '.';
    }
    const segments = path.split('/');
    segments.pop();
    return segments.length === 0 ? '.' : segments.join('/');
}

export function getDisplayNameForDirectory(path, directoryKey) {
    const normalizedDir = normalizeDirectoryKey(directoryKey);
    if (normalizedDir === '.' || !path.startsWith(`${normalizedDir}/`)) {
        return path;
    }
    return path.slice(normalizedDir.length + 1);
}

export function buildGitStatusHelper(summary) {
    if (!summary) {
        return null;
    }
    return {
        staged: new Set(summary.staged.map(entry => entry.path)),
        unstaged: new Set(summary.unstaged.map(entry => entry.path)),
        untracked: new Set(summary.untracked),
        deleted: new Set(summary.deleted)
    };
}

export function deriveStatusFlags(path, isDir, helper) {
    if (!helper) {
        return [];
    }
    const normalizedPath = normalizeDirectoryKey(path);
    const prefix = normalizedPath === '.' ? '' : `${normalizedPath}/`;
    const results = new Set();

    const evaluate = (set, flag) => {
        if (!set || set.size === 0) {
            return;
        }
        if (normalizedPath !== '.' && set.has(normalizedPath)) {
            results.add(flag);
            return;
        }
        if (!isDir) {
            return;
        }
        if (normalizedPath === '.' && set.size > 0) {
            results.add(flag);
            return;
        }
        if (prefix) {
            for (const value of set) {
                if (value.startsWith(prefix)) {
                    results.add(flag);
                    break;
                }
            }
        }
    };

    evaluate(helper.staged, 'staged');
    evaluate(helper.unstaged, 'unstaged');
    evaluate(helper.untracked, 'untracked');
    evaluate(helper.deleted, 'deleted');

    return Array.from(results);
}

export function createBadgeElement(flag) {
    const definition = BADGE_LABELS[flag];
    if (!definition) {
        return null;
    }
    const badge = document.createElement('span');
    badge.className = `file-item-badge file-item-badge--${flag}`;
    badge.textContent = definition.text;
    badge.title = definition.title;
    return badge;
}

export function applyGitStatusBadges(fileDiv, flags) {
    const badges = document.createElement('span');
    badges.className = 'file-badges';

    flags.forEach(flag => {
        fileDiv.classList.add(`file-item--${flag}`);
        const badge = createBadgeElement(flag);
        if (badge) {
            badges.appendChild(badge);
        }
    });

    if (!badges.childElementCount) {
        badges.classList.add('hidden');
    }

    fileDiv.appendChild(badges);
}

export function createFileRow({ kind, path, name, statusFlags = [], active = false, onClick }) {
    const fileDiv = document.createElement('div');

    if (kind === 'parent') {
        fileDiv.className = 'file-item dir';
        fileDiv.textContent = '.. (parent)';
    } else {
        const isDir = kind === 'directory';
        const isDeleted = kind === 'deleted';
        fileDiv.className = isDir ? 'file-item dir' : 'file-item';
        fileDiv.dataset.path = path;
        fileDiv.dataset.type = isDir ? 'dir' : isDeleted ? 'deleted' : 'file';

        if (isDeleted) {
            fileDiv.classList.add('file-item--deleted');
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = isDir ? `📁 ${name}` : name;
        fileDiv.appendChild(nameSpan);

        applyGitStatusBadges(fileDiv, statusFlags);

        if (active) {
            fileDiv.classList.add('active');
        }
    }

    fileDiv.addEventListener('click', onClick);
    return fileDiv;
}

export function gatherDeletedEntries(summary, directoryKey) {
    if (!summary || !summary.deleted || summary.deleted.length === 0) {
        return [];
    }
    const normalizedDir = normalizeDirectoryKey(directoryKey);
    return summary.deleted.filter(item => getParentDirectory(item) === normalizedDir);
}

export function createGitStatusStore({ loadGitStatus }) {
    const gitStatusCache = new Map();

    async function getSummary(path, { force = false } = {}) {
        const key = normalizeDirectoryKey(path);
        if (force) {
            gitStatusCache.delete(key);
        }
        if (gitStatusCache.has(key)) {
            return gitStatusCache.get(key);
        }

        const summary = await loadGitStatus(key);
        gitStatusCache.set(key, summary);
        return summary;
    }

    function invalidate(path) {
        if (!path) {
            gitStatusCache.clear();
            return;
        }
        gitStatusCache.delete(normalizeDirectoryKey(path));
    }

    return {
        getSummary,
        invalidate
    };
}
