import { CONFIG } from '../config.js';
import { docCache, unitCache, state, setExecAcode } from '../state.js';
import { appendLog } from '../utils/logger.js';
import { sleep, ensureBasePath, getFallbackBasePath } from '../utils/helpers.js';
import { emit } from '../core/bus.js';

export const handleListResponse = (data) => {
    if (!data || !data.items) return;
    appendLog(`API qsprocess: ${data.items.length} van ban`);
    data.items.forEach(item => {
        const id = item.id.toString();
        const ed = item.edSearchDto || {};
        const doc = docCache.get(id) || { id };

        doc.signNumber = ed.signNumber || doc.signNumber || '';
        doc.subject = ed.subject || doc.subject || '';
        doc.category = ed.category || doc.category || '';
        doc.author = ed.author || doc.author || '';
        doc.signer = ed.signer || doc.signer || '';
        doc.docDateStr = ed.docDateStr || doc.docDateStr || '';
        doc.creatorAcode = ed.creatorAcode || doc.creatorAcode || '';
        doc.responsibility = item.responsibility || doc.responsibility || 'main';
        doc.book = item.book || doc.book || null;
        doc.status = doc.status || 'idle';
        doc.aiData = doc.aiData || null;

        docCache.set(id, doc);
    });
    emit('docs-changed');
};

export const handleViewResponse = (data) => {
    if (!data || !data.ed) return;
    const id = data.ed.id.toString();
    const doc = docCache.get(id) || { id };
    const ed = data.ed;

    doc.subject = ed.subject || doc.subject || '';
    doc.signNumber = ed.signNumber || doc.signNumber || '';
    doc.category = ed.category || doc.category || '';
    doc.author = ed.author || doc.author || '';
    doc.signer = ed.signer || doc.signer || '';
    doc.docDateStr = ed.docDateStr || doc.docDateStr || '';
    doc.creatorAcode = ed.creatorAcode || doc.creatorAcode || '';
    doc.attachments = data.attachments || doc.attachments || [];
    doc.book = data.book || doc.book || null;

    docCache.set(id, doc);
    updateExecAcodeFromView(data, doc.responsibility);
    emit('docs-changed');
};

export const handleUnitsResponse = (data) => {
    if (!data || !data.elements) return;
    data.elements.forEach(unit => unitCache.set(unit.id, unit));
    appendLog(`API fbyvsphere: Cap nhat ${data.elements.length} don vi/ca nhan xu ly`);
};

// Cách bắt exeacode ĐƠN GIẢN VÀ CHẮC CHẮN HƠN updateExecAcodeFromView() bên dưới:
// giá trị exeacode do CHÍNH TRANG WEB gắn vào query string của MỌI request
// view.cpx (vd "view.cpx?exeacode=b3c5c53e-...&id=..."), lặp lại y hệt nhau ở
// nhiều văn bản khác nhau — tức đây là mã định danh CỦA NGƯỜI ĐANG ĐĂNG NHẬP,
// không phụ thuộc văn bản đó là "chính" hay "phối hợp" như cách suy ra từ
// senders/proInfos. Được gọi ngay khi intercept thấy URL view.cpx (interceptor.js),
// không cần đợi/parse response.
export const captureExecAcodeFromUrl = (url) => {
    if (state.execAcode || !url) return;
    const match = url.match(/[?&]exeacode=([^&]+)/);
    if (match && match[1]) {
        setExecAcode(decodeURIComponent(match[1]));
        appendLog(`Da xac dinh ma dinh danh xu ly (exeacode) tu URL view.cpx: ${state.execAcode}`);
    }
};

export const updateExecAcodeFromView = (data, viewerResponsibility) => {
    if (state.execAcode) return;

    // QUAN TRONG: senders/proInfos la LICH SU LUAN CHUYEN cua van ban (nhieu buoc,
    // nhieu nguoi), entry co responsibility === 'main' trong do CHUA CHAC la chinh
    // nguoi dang dang nhap — no co the la nguoi khac (vd van ban nay minh chi la
    // "phoi hop"/coordinate, con "main" thuc su la mot dong nghiep khac). Lay nham
    // receiverAcode cua nguoi khac se lam fbyvsphere.cpx tra loi
    // "alias_do_not_match_for_login_user". Chi tin cay ket qua khi CHINH van ban
    // nay, o cap do qsprocess.cpx (doc.responsibility), da xac nhan nguoi dang xem
    // la "main" — luc do entry main trong senders/proInfos moi chac chan la chinh minh.
    if (viewerResponsibility !== 'main') return;

    const pool = [];
    if (Array.isArray(data.senders)) pool.push(...data.senders);
    if (Array.isArray(data.proInfos)) pool.push(...data.proInfos);
    const mainEntry = pool.find(e => e && e.responsibility === 'main' && e.receiverAcode);
    if (mainEntry) {
        setExecAcode(mainEntry.receiverAcode);
        appendLog(`Da xac dinh ma dinh danh xu ly (exeacode): ${state.execAcode}`);
    }
};

export const ensureDocDetails = async (id) => {
    let doc = docCache.get(id.toString()) || { id: id.toString(), status: 'idle' };
    docCache.set(id.toString(), doc);

    if (!doc.attachments || doc.attachments.length === 0) {
        const itemEl = document.querySelector(`.messageListItem[data-id="${id}"]`);
        if (itemEl && !itemEl.classList.contains('selected')) {
            itemEl.click();
            await sleep(CONFIG.DELAY_MS.SELECT_DOC);
            doc = docCache.get(id.toString()) || doc;
        }
    }

    if ((!doc.attachments || doc.attachments.length === 0) && state.execAcode) {
        try {
            const bp = state.basePath || getFallbackBasePath();
            const resp = await fetch(`${bp}/document/edocs/view.cpx?exeacode=${state.execAcode}&id=${id}&responsibility=${doc.responsibility || 'main'}`);
            if (resp.ok) {
                handleViewResponse(await resp.json());
                doc = docCache.get(id.toString()) || doc;
            }
        } catch (e) {
            appendLog(`Fetch view.cpx cho ${id} loi: ${e.message}`);
        }
    } else if ((!doc.attachments || doc.attachments.length === 0) && !state.execAcode) {
        appendLog(`Chua xac dinh duoc exeacode xu ly - bo qua fetch thu cong cho VB ${id} (can mo it nhat 1 VB truoc de he thong tra ve receiverAcode).`);
    }

    return doc;
};
