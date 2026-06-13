export const SCROLL_LOCK_EPSILON = 4;

export function isNearBottom(element) {
    if (!element) {
        return true;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom <= SCROLL_LOCK_EPSILON;
}

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function createToastController() {
    let toastTimeoutId = null;

    function showToast(message) {
        if (!message) {
            return;
        }

        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('visible');

        if (toastTimeoutId) {
            clearTimeout(toastTimeoutId);
        }

        toastTimeoutId = setTimeout(() => {
            toast.classList.remove('visible');
        }, 4000);
    }

    return { showToast };
}

export function updateViewControlsVisibility(dom, currentView) {
    if (dom.tmuxNavControls) {
        dom.tmuxNavControls.classList.toggle('hidden', currentView !== 'tmux');
    }
    if (dom.filesNavControls) {
        dom.filesNavControls.classList.toggle('hidden', currentView !== 'files');
    }
}

export function pageScroll(element, direction) {
    if (!element) {
        return;
    }

    if (direction < 0) {
        element.scrollTop = Math.max(element.scrollTop - element.clientHeight * 0.9, 0);
        return;
    }

    const maxScrollTop = Math.max(element.scrollHeight - element.clientHeight, 0);
    element.scrollTop = Math.min(element.scrollTop + element.clientHeight * 0.9, maxScrollTop);
}
