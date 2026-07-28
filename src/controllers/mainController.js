import { CONFIG } from '../config.js';
import { docCache, state, setProcessing } from '../state.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { sleep, applyDeadlineDays } from '../utils/helpers.js';
import { ensureDocDetails } from '../services/api.js';
import { callAIBackend, lookupDocument } from '../services/ai.js';
import { autoFillAndSubmit } from '../automation/formFiller.js';
import { primeUnitTreeDirect } from '../automation/unitPrimer.js';
import { scanList } from '../services/scanner.js';
import { on, emit } from '../core/bus.js';

export const scanAndSendAll = async () => {
    if (state.isProcessing) return alert('Dang xu ly, vui long cho!');

    const found = await scanList(4);
    if (!found) return;

    const pendingIds = [];
    docCache.forEach((doc, id) => { if (doc.status === 'idle') pendingIds.push(id); });

    if (pendingIds.length === 0) {
        setStatus(`Khong co van ban moi can gui AI.`);
        return;
    }

    setProcessing(true);
    let success = 0, errors = 0;
    const total = pendingIds.length;
    updateProgress(0, total);

    for (let i = 0; i < pendingIds.length; i++) {
        const id = pendingIds[i];
        const doc = docCache.get(id);
        if (!doc) continue;

        doc.status = 'pending';
        emit('docs-changed');
        updateProgress(i, total);

        try {
            const fullDoc = await ensureDocDetails(id);

            // Chỉ cần chạy 1 lần cho cả phiên: khi văn bản đầu tiên được mở, hệ thống
            // đã tự có exeacode (qua view.cpx) để lấy cây đơn vị của đúng xã đang
            // đăng nhập, phục vụ phần chỉnh sửa "Đơn vị xử lý"/"Đơn vị phối hợp".
            if (!state.unitsPrimed) await primeUnitTreeDirect();

            if (!fullDoc.attachments || fullDoc.attachments.length === 0) {
                throw new Error('Van ban khong co file dinh kem');
            }

            // Tra cache truoc qua /documents/lookup (docs/en/docflow.md muc 5) de
            // tranh goi lai OCR/AI cho van ban da xu ly xong tu truoc. Chi dung ket
            // qua khi state = "completed"; moi truong hop khac (not_found,
            // processing, failed_retryable, hoac loi lookup) deu roi ve /documents/process
            // nhu luong cu, khong thay doi hanh vi hien tai.
            let aiData = null;
            try {
                const lookupResult = await lookupDocument(fullDoc);
                if (lookupResult && lookupResult.found && lookupResult.state === 'completed' && lookupResult.data) {
                    aiData = lookupResult.data;
                    appendLog(`${doc.signNumber}: da co san tu /documents/lookup, bo qua goi AI`);
                }
            } catch (lookupErr) {
                appendLog(`${doc.signNumber}: lookup that bai (${lookupErr.message}), tiep tuc qua /documents/process`);
            }

            doc.aiData = aiData || await callAIBackend(fullDoc);
            doc.status = 'ai_done';
            success++;
        } catch (err) {
            doc.status = 'ai_error';
            errors++;
            appendLog(`${doc.signNumber}: ${err.message}`);
        }
        emit('docs-changed');
        updateProgress(i + 1, total);
    }

    setProcessing(false);
    setStatus(`Hoan tat AI: ${success} thanh cong, ${errors} loi`);
    updateProgress(total, total);
};

export const runFillOnAll = async () => {
    if (state.isProcessing) return alert('Dang xu ly, vui long cho!');

    const checkboxes = document.querySelectorAll('.rpa-row-check:checked');
    if (checkboxes.length === 0) return alert('Hay chon it nhat 1 van ban!');

    setProcessing(true);
    let success = 0, errors = 0;
    const total = checkboxes.length;
    updateProgress(0, total);

    for (let i = 0; i < checkboxes.length; i++) {
        const chk = checkboxes[i];
        const id = chk.getAttribute('data-id');
        const doc = docCache.get(id);
        if (!doc || !doc.aiData) {
            errors++;
            updateProgress(i + 1, total);
            continue;
        }

        setStatus(`Dang dien: ${doc.signNumber || id} (${i + 1}/${total})`);
        updateProgress(i, total);

        try {
            await autoFillAndSubmit(id, doc.aiData);
            doc.status = 'fill_done';
            success++;
            chk.checked = false;
        } catch (err) {
            doc.status = 'fill_error';
            errors++;
            appendLog(`Loi ${doc.signNumber}: ${err.message}`);
        }
        emit('docs-changed');
        updateProgress(i + 1, total);
        await sleep(CONFIG.DELAY_MS.BETWEEN_DOCS);
    }

    setProcessing(false);
    setStatus(`Ket thuc tu dong dien: ${success}/${total} thanh cong`);
    updateProgress(total, total);
};

export const updateProgress = (current, total) => {
    emit('progress', { current, total });
};

// Người dùng bấm "×" trên 1 chip đơn vị xử lý chính/phối hợp để xoá khỏi kết quả
// AI đang review (chỉ sửa dữ liệu trong bộ nhớ, không đụng gì tới hệ thống thật).
on('unit-remove-requested', ({ id, kind, value }) => {
    const doc = docCache.get(id);
    if (!doc || !doc.aiData) return;

    if (kind === 'main') {
        doc.aiData.processing_unit = null;
    } else {
        // Nếu coordinating_units không phải mảng (vi phạm docflow.md mục 4), coi thao
        // tác xoá như "reset về rỗng" thay vì cố lọc theo giá trị.
        const arr = Array.isArray(doc.aiData.coordinating_units) ? doc.aiData.coordinating_units : [];
        doc.aiData.coordinating_units = arr.filter(u => u !== value);
    }
    emit('docs-changed');
});

// Người dùng chọn xong 1 đơn vị/người trong dropdown (unitPicker) — ghi nhận vào
// aiData của văn bản tương ứng. Đơn vị xử lý chính chỉ 1 giá trị (thay thế), đơn
// vị phối hợp cho phép nhiều giá trị (thêm vào, không trùng lặp).
on('unit-add-confirmed', ({ id, kind, label }) => {
    const doc = docCache.get(id);
    if (!doc) return;
    doc.aiData = doc.aiData || {};

    if (kind === 'main') {
        doc.aiData.processing_unit = label;
    } else {
        doc.aiData.coordinating_units = Array.isArray(doc.aiData.coordinating_units) ? doc.aiData.coordinating_units : [];
        if (!doc.aiData.coordinating_units.includes(label)) doc.aiData.coordinating_units.push(label);
    }
    emit('docs-changed');
});

// Người dùng chỉnh số ngày hạn thực hiện qua popover (deadlineEditor) — chỉ số ngày
// (01-100) được thay đổi, phần văn phong còn lại của AI (nếu có) được giữ nguyên
// nhờ applyDeadlineDays().
on('deadline-update-confirmed', ({ id, days }) => {
    const doc = docCache.get(id);
    if (!doc) return;
    doc.aiData = doc.aiData || {};
    doc.aiData.implementation_deadline = applyDeadlineDays(doc.aiData.implementation_deadline, days);
    emit('docs-changed');
});

// Logic tự đăng ký lắng nghe thao tác của người dùng trên UI, thay vì UI import thẳng
// hàm của controller. Nhờ đó ui/dashboard.js và controllers/mainController.js không
// còn import lẫn nhau (không còn circular dependency).
on('scan-requested', scanAndSendAll);
on('fill-requested', runFillOnAll);