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

    // Bam "Mo rong tat ca" TRUOC khi tim/quet — mac dinh khi popover vua mo,
    // nhieu nhanh cua cay CHUA duoc mo rong (co nut rieng bien cho viec nay,
    // xem <button id="${wrapSelector}-expand-all" title="Mo rong tat ca">
    // trong resource/"Chu tich role"/right_panel_after_save_and_transfer.html).
    // Neu bo qua buoc nay, node muc tieu co the dang nam trong 1 nhanh dang
    // thu gon (offsetParent === null) va se bi dieu kien loc offsetParent ben
    // duoi loai bo, dan den "Khong chon duoc" du textContent da khop dinh
    // dang "Vai tro (Ho ten)" dung nhu tren giao dien.
    const expandAllBtn = document.querySelector(`${wrapSelector}-expand-all`);
    if (expandAllBtn) {
        expandAllBtn.click();
        await sleep(CONFIG.DELAY_MS.EXPAND_TREE);
    }

    const searchInput = popup.querySelector('input[type="text"]');
    if (searchInput) {
        searchInput.value = targetName;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('keyup', { bubbles: true }));
        await sleep(CONFIG.DELAY_MS.TREE_SEARCH);
    }

    // Chi query dung the <a class="user-box-group-item"> — day la phan tu
    // THAT SU co the click de chon 1 don vi/nguoi trong cay (xem cau truc that
    // trong resource/"Chu tich role"/right_panel_after_save_and_transfer.html).
    // KHONG duoc query them 'li'/'div'/'span'/'label' nhu truoc: <li> cha luon
    // dung TRUOC <a> con cua no trong document order, va vi textContent cua
    // <li> bao gom ca text cua <a> ben trong (voi node la) nen se bi khop
    // (includes) va click NHAM vao <li> truoc khi kip toi <a> — click vao <li>
    // khong kich hoat duoc handler chon (chi gan tren chinh <a>), khien code
    // tuong da "chon" thanh cong (khong loi) nhung thuc te khong co gi duoc
    // chon tren form that.
    const candidates = Array.from(popup.querySelectorAll('a.user-box-group-item'))
        // Loai node dac biet "Chon tat ca" (co class phu
        // "user-box-group-item-all" tren div ten ben trong) de tranh khop
        // nham neu targetName qua ngan/chung chung.
        .filter(el => !el.querySelector('.user-box-group-item-all'))
        .filter(el => el.offsetParent !== null);

    let clicked = false;

    const tryClick = (el) => {
        const cb = el.querySelector('input[type="checkbox"], input[type="radio"]');
        if (cb) { cb.click(); return true; }
        el.click();
        return true;
    };

    // Uu tien khop CHINH XAC truoc (vd "Hieu truong (Dinh Van Ngo)"), chi
    // fallback sang includes() neu khong co khop chinh xac nao — tranh truong
    // hop 1 chuoi ngan hon vo tinh la substring cua muc tieu (hoac nguoc lai)
    // duoc chon truoc mot khop day du va chinh xac hon dung o vi tri khac.
    let match = candidates.find(el => el.textContent.trim() === targetName);
    if (!match) {
        match = candidates.find(el => el.textContent.trim().includes(targetName));
    }
    if (match) {
        tryClick(match);
        clicked = true;
    }

    if (clicked) appendLog(`Da chon "${targetName}"`);
    else appendLog(`Khong chon duoc "${targetName}" trong popup`);

    const closeBtn = popup.querySelector('button.close, .close, [data-dismiss="modal"]');
    if (closeBtn) closeBtn.click();
    else document.body.click();
    await sleep(CONFIG.DELAY_MS.CLOSE_TREE);

    return clicked;
};
