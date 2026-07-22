import { CONFIG } from '../config.js';
import { sleep } from '../utils/helpers.js';
import { appendLog } from '../utils/logger.js';

export const selectTreeItem = async (linkSelector, wrapSelector, targetName) => {
    if (!targetName || !targetName.trim()) return false;
    const link = document.querySelector(linkSelector);
    if (!link) return false;

    link.click();
    await sleep(CONFIG.DELAY_MS.OPEN_TREE);

    const popupSelectors = [
        '.popover:not(.hide):not([style*="display: none"])',
        '.modal:not(.hide):not([style*="display: none"])',
        '.ui-dialog:not([style*="display: none"])',
        '.select2-drop:not([style*="display: none"])',
        'div[role="dialog"]:not([style*="display: none"])'
    ];

    let popup = popupSelectors.map(sel => document.querySelector(sel)).find(el => el && el.offsetParent !== null);
    if (!popup) {
        document.body.click();
        await sleep(200);
        return false;
    }

    const searchInput = popup.querySelector('input[type="text"]');
    if (searchInput) {
        searchInput.value = targetName;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('keyup', { bubbles: true }));
        await sleep(CONFIG.DELAY_MS.TREE_SEARCH);
    }

    const labels = popup.querySelectorAll('label, span, a, li, .user-box-item, div');
    let clicked = false;

    const tryClick = (el) => {
        const cb = el.querySelector('input[type="checkbox"], input[type="radio"]');
        if (cb) { cb.click(); return true; }
        el.click();
        return true;
    };

    for (const el of labels) {
        const text = el.textContent.trim();
        if ((text === targetName || text.includes(targetName)) && el.offsetParent !== null) {
            tryClick(el);
            clicked = true;
            break;
        }
    }

    if (clicked) appendLog(`Da chon "${targetName}"`);
    else appendLog(`Khong chon duoc "${targetName}" trong popup`);

    const closeBtn = popup.querySelector('button.close, .close, [data-dismiss="modal"]');
    if (closeBtn) closeBtn.click();
    else document.body.click();
    await sleep(CONFIG.DELAY_MS.CLOSE_TREE);

    return clicked;
};
