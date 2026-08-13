import { CONFIG } from '../config.js';
import { docCache, state } from '../state.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { sleep, applyDeadlineDays } from '../utils/helpers.js';
import { ensureDocDetails } from '../services/api.js';
import { callAIBackend, lookupDocument, patchDocument } from '../services/ai.js';
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

    state.isProcessing = true;
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
            // Mồi thành công (chuyển false -> true) thì emit thêm 'docs-changed' để
            // vẽ lại các card ĐÃ hiện trước đó ngay trong batch này (nếu có) — nhờ đó
            // gợi ý đơn vị (suggestUnitLabel(), dựa trên unitCache) xuất hiện ngay cả
            // với văn bản đầu tiên, không cần đợi văn bản kế tiếp mới trigger vẽ lại.
            if (!state.unitsPrimed) {
                const justPrimed = await primeUnitTreeDirect();
                if (justPrimed) emit('docs-changed');
            }

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

        // Backend gioi han rate theo cua so truot (mock_backend.py: 30 request/60s
        // cho tung endpoint). Khong co delay o day thi lo >30 van ban (vi du khi
        // nguoi dung chuyen trang thu cong nhieu lan truoc khi bam Quet & Gui AI,
        // khien nhieu trang cung "visible" va scanList() gom chung mot luc) se ban
        // request lien tuc va dinh 429 tu van ban thu 31 tro di.
        if (i < pendingIds.length - 1) await sleep(CONFIG.DELAY_MS.BETWEEN_AI_CALLS);
    }

    state.isProcessing = false;
    setStatus(`Hoan tat AI: ${success} thanh cong, ${errors} loi`);
    updateProgress(total, total);
};

export const runFillOnAll = async () => {
    if (state.isProcessing) return alert('Dang xu ly, vui long cho!');

    const checkboxes = document.querySelectorAll('.rpa-row-check:checked');
    if (checkboxes.length === 0) return alert('Hay chon it nhat 1 van ban!');

    state.isProcessing = true;
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

    state.isProcessing = false;
    setStatus(`Ket thuc tu dong dien: ${success}/${total} thanh cong`);
    updateProgress(total, total);
};

export const updateProgress = (current, total) => {
    emit('progress', { current, total });
};

// Đồng bộ chỉnh sửa tay của người dùng (đơn vị xử lý/phối hợp, hạn thực hiện...)
// lên backend qua PATCH /documents/{stt} (patchDocument() trong services/ai.js),
// ngay sau khi đã cập nhật doc.aiData trong RAM. Nếu không làm bước này, lần
// tra cứu lại văn bản sau đó (lookupDocument hoặc nhánh cache của
// /documents/process) sẽ trả về dữ liệu AI gốc, chưa sửa.
// Chạy "best-effort" và không await ở nơi gọi: PATCH lỗi (mất mạng, 429, ...)
// chỉ ghi log cảnh báo chứ không revert lại doc.aiData hay chặn UI, để người
// dùng không mất thao tác chỉnh sửa đang hiển thị trên màn hình review.
const persistAiDataPatch = async (doc, fields) => {
    if (!doc || !doc.aiData || !doc.aiData.stt) return;
    try {
        await patchDocument(doc.aiData.stt, fields);
    } catch (err) {
        appendLog(`${doc.signNumber || doc.aiData.stt}: luu chinh sua len backend that bai (${err.message}) - thay doi van duoc giu tam trong phien lam viec, thu lai sau`);
    }
};

// Người dùng bấm "×" trên 1 chip đơn vị xử lý chính/phối hợp/lãnh đạo theo dõi để
// xoá khỏi kết quả AI đang review. Cập nhật doc.aiData trong bộ nhớ để UI phản hồi
// ngay, đồng thời PATCH lên backend để lần tra cứu sau còn nhớ chỉnh sửa này.
on('unit-remove-requested', ({ id, kind, value }) => {
    const doc = docCache.get(id);
    if (!doc || !doc.aiData) return;

    if (kind === 'main') {
        doc.aiData.processing_unit = null;
        emit('docs-changed');
        persistAiDataPatch(doc, { processing_unit: null });
    } else if (kind === 'leader') {
        doc.aiData.monitoring_leader = null;
        emit('docs-changed');
        persistAiDataPatch(doc, { monitoring_leader: null });
    } else {
        // Nếu coordinating_units không phải mảng (vi phạm docflow.md mục 4), coi thao
        // tác xoá như "reset về rỗng" thay vì cố lọc theo giá trị.
        const arr = Array.isArray(doc.aiData.coordinating_units) ? doc.aiData.coordinating_units : [];
        doc.aiData.coordinating_units = arr.filter(u => u !== value);
        emit('docs-changed');
        persistAiDataPatch(doc, { coordinating_units: doc.aiData.coordinating_units });
    }
});

// Người dùng chọn xong 1 đơn vị/người — hoặc là chọn thủ công qua dropdown
// (unitPicker), hoặc là bấm nút "Gợi ý" ngay trên card review (dashboard.js,
// dựa trên suggestUnitLabel() — xem ui/unitPicker.js) — ghi nhận vào aiData
// của văn bản tương ứng. Đơn vị xử lý chính và lãnh đạo theo dõi chỉ 1 giá
// trị (thay thế), đơn vị phối hợp cho phép nhiều giá trị (thêm vào, không
// trùng lặp). Sau khi cập nhật RAM, PATCH lên backend để lưu lại chỉnh sửa.
//
// `replaceValue` (chỉ có ý nghĩa với kind 'co'): khi người dùng bấm "Gợi ý"
// trên 1 chip đơn vị phối hợp ĐÃ CÓ SẴN 1 chuỗi thô từ AI (vd "Phòng kinh
// tế"), cần loại bỏ đúng chuỗi thô đó khỏi mảng trước khi thêm giá trị đã
// khớp (vd "Phòng Kinh tế - Xã Vĩnh Thạnh - Tỉnh Gia Lai") vào — nếu không sẽ
// còn lại CẢ 2 bản (thô + đã khớp) cùng lúc trong danh sách. Luồng "+ Thêm"
// thủ công (thêm 1 đơn vị phối hợp hoàn toàn mới) không set field này nên
// không bị ảnh hưởng.
on('unit-add-confirmed', ({ id, kind, label, replaceValue }) => {
    const doc = docCache.get(id);
    if (!doc) return;
    doc.aiData = doc.aiData || {};

    if (kind === 'main') {
        doc.aiData.processing_unit = label;
        emit('docs-changed');
        persistAiDataPatch(doc, { processing_unit: label });
    } else if (kind === 'leader') {
        doc.aiData.monitoring_leader = label;
        emit('docs-changed');
        persistAiDataPatch(doc, { monitoring_leader: label });
    } else {
        let arr = Array.isArray(doc.aiData.coordinating_units) ? doc.aiData.coordinating_units : [];
        if (replaceValue) arr = arr.filter((v) => v !== replaceValue);
        if (!arr.includes(label)) arr.push(label);
        doc.aiData.coordinating_units = arr;
        emit('docs-changed');
        persistAiDataPatch(doc, { coordinating_units: doc.aiData.coordinating_units });
    }
});

// Người dùng chỉnh số ngày hạn thực hiện qua popover (deadlineEditor) — chỉ số ngày
// (01-100) được thay đổi, phần văn phong còn lại của AI (nếu có) được giữ nguyên
// nhờ applyDeadlineDays(). Sau khi cập nhật RAM, PATCH lên backend để lưu lại.
on('deadline-update-confirmed', ({ id, days }) => {
    const doc = docCache.get(id);
    if (!doc) return;
    doc.aiData = doc.aiData || {};
    doc.aiData.implementation_deadline = applyDeadlineDays(doc.aiData.implementation_deadline, days);
    emit('docs-changed');
    persistAiDataPatch(doc, { implementation_deadline: doc.aiData.implementation_deadline });
});

// Logic tự đăng ký lắng nghe thao tác của người dùng trên UI, thay vì UI import thẳng
// hàm của controller. Nhờ đó ui/dashboard.js và controllers/mainController.js không
// còn import lẫn nhau (không còn circular dependency).
on('scan-requested', scanAndSendAll);
on('fill-requested', runFillOnAll);