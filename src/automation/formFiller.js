import { CONFIG, S } from '../config.js';
import { sleep, calcDeadline, findByVisibleText } from '../utils/helpers.js';
import { appendLog } from '../utils/logger.js';
import { selectTreeItem } from './treeSelect.js';

export const autoFillAndSubmit = async (docId, aiData) => {
    const itemEl = document.querySelector(`.messageListItem[data-id="${docId}"]`);
    if (!itemEl) throw new Error(`Khong tim thay VB ID ${docId}`);

    if (!itemEl.classList.contains('selected')) {
        itemEl.click();
        await sleep(CONFIG.DELAY_MS.SELECT_DOC);
    }

    const transferBtn = document.querySelector(S.SAVE_TRANSFER_BTN);
    if (!transferBtn) throw new Error('Khong tim thay nut "Chuyen xu ly"');
    if (transferBtn.disabled) {
        for (let i = 0; i < 10; i++) {
            await sleep(500);
            if (!transferBtn.disabled) break;
        }
    }
    if (transferBtn.disabled) throw new Error('Nut "Chuyen xu ly" khong enable!');

    transferBtn.click();
    appendLog('Da click "Chuyen xu ly"');
    await sleep(CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER);

    let container = document.querySelector(S.TRANSFER_CONTAINER);
    if (!container) {
        for (let i = 0; i < 5; i++) {
            await sleep(500);
            container = document.querySelector(S.TRANSFER_CONTAINER);
            if (container) break;
        }
    }
    if (!container) {
        const agreeGuess = findByVisibleText(document, 'button, a', ['Đồng ý', 'Dong y']);
        container = agreeGuess ? (agreeGuess.closest('div[id], form, .modal, .popover') || document) : null;
    }
    if (!container) {
        throw new Error('Khong thay form "Thong tin xu ly" (kiem tra lai S.TRANSFER_CONTAINER cho giao dien Chu tich)');
    }

    const mainUnit = aiData.don_vi_xu_ly || aiData.processing_unit;
    if (mainUnit) {
        appendLog(`Xu ly chinh: ${mainUnit}`);
        await selectTreeItem(S.RESPONSIBLE_LINK, S.RESPONSIBLE_WRAP, mainUnit);
    }

    const subUnits = aiData.don_vi_phoi_hop || aiData.coordinating_units;
    if (subUnits && Array.isArray(subUnits)) {
        for (const unit of subUnits) {
            if (unit && unit.trim()) {
                await selectTreeItem(S.PARTICIPANTS_LINK, S.PARTICIPANTS_WRAP, unit.trim());
                await sleep(250);
            }
        }
    }

    const days = aiData.thoi_han_thuc_hien || aiData.implementation_deadline;
    if (days) {
        const daysNum = parseInt(days);
        const deadlineDate = calcDeadline(daysNum);

        const numInput = document.querySelector(S.DEADLINE_NUMBER);
        if (numInput) {
            numInput.value = daysNum;
            numInput.dispatchEvent(new Event('input', { bubbles: true }));
            numInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const dateInput = document.querySelector(S.DEADLINE_INPUT);
        if (dateInput) {
            dateInput.value = deadlineDate;
            dateInput.dispatchEvent(new Event('input', { bubbles: true }));
            dateInput.dispatchEvent(new Event('change', { bubbles: true }));
            dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
            appendLog(`Han xu ly: ${deadlineDate} (+${daysNum} ngay)`);
        }
    }

    const prioritySelect = document.querySelector(S.PRIORITY_SELECT);
    if (prioritySelect) {
        let pVal = '0';
        const pRaw = (aiData.priority !== undefined && aiData.priority !== null) ? aiData.priority : aiData.do_khan;
        if (pRaw !== undefined && pRaw !== null) {
            if (pRaw === 1 || pRaw === '1' || pRaw === 'Khẩn' || pRaw === 'khan') pVal = '1';
            else if (pRaw === 2 || pRaw === '2' || pRaw === 'Thượng khẩn' || pRaw === 'thuong_khan' || pRaw === 'Hỏa tốc') pVal = '2';
            else pVal = String(pRaw);
        }
        prioritySelect.value = pVal;
        prioritySelect.dispatchEvent(new Event('change', { bubbles: true }));
        const pText = prioritySelect.options[prioritySelect.selectedIndex]?.text || pVal;
        appendLog(`Do khan: ${pText}`);
    }

    const contentTextarea = document.querySelector(S.CONTENT_TEXTAREA);
    if (contentTextarea) {
        const contentVal = aiData.notes || aiData.ghi_chu || aiData.content || aiData.summary || aiData.tom_tat || '';
        contentTextarea.value = contentVal;
        contentTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        contentTextarea.dispatchEvent(new Event('change', { bubbles: true }));
        appendLog(`Noi dung: ${contentVal.substring(0, 45)}${contentVal.length > 45 ? '...' : ''}`);
    }

    const agreeBtn = document.querySelector(S.AGREE_BTN) || findByVisibleText(container, 'button, a', ['Đồng ý', 'Dong y']);
    if (!agreeBtn) throw new Error('Khong tim thay nut "Dong y"!');
    if (agreeBtn.disabled) {
        for (let i = 0; i < 5; i++) {
            await sleep(500);
            if (!agreeBtn.disabled) break;
        }
    }
    agreeBtn.click();
    appendLog('Da click "Dong y"');
    await sleep(CONFIG.DELAY_MS.AFTER_SUBMIT);

    return true;
};
