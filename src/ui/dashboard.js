import { docCache } from '../state.js';
import { CSS_STYLES } from './styles.js';
import { appendLog } from '../utils/logger.js';
<<<<<<< HEAD
import { formatDate, stripAgencySuffix } from '../utils/helpers.js';
=======
import { formatDate, resolveDeadlineDate } from '../utils/helpers.js';
>>>>>>> d558f2d01e5c6e7ad1fc3792f48bca950be709ea
import { on, emit } from '../core/bus.js';

let logPanel = null;

export const createDashboard = () => {
    if (document.getElementById('idesk-rpa-hub')) return;

    GM_addStyle(CSS_STYLES);

    const hub = document.createElement('div');
    hub.id = 'idesk-rpa-hub';
    hub.innerHTML = `
        <div class="rpa-header">
            <div class="rpa-title">
                iDesk RPA <span class="badge-count" id="rpa-doc-count">0</span>
            </div>
            <div class="rpa-header-actions">
                <button id="rpa-btn-toggle-log">Console</button>
                <button id="rpa-btn-minimize">Thu nhỏ</button>
            </div>
        </div>
        <div class="rpa-body">
            <div class="rpa-toolbar">
                <button class="rpa-btn rpa-btn-primary" id="rpa-btn-scan">Quét &amp; Gửi AI</button>
                <button class="rpa-btn rpa-btn-purple" id="rpa-btn-fill-all">Tự động điền</button>
                <label class="rpa-select-all-label">
                    <input type="checkbox" id="rpa-check-all" checked>
                    <span>Chọn tất cả</span>
                </label>
                <button class="rpa-btn rpa-btn-outline" id="rpa-btn-select-all">Đảo chọn</button>
            </div>
            <div class="rpa-feed-wrap">
                <div class="rpa-card-feed" id="rpa-card-feed">
                    <div class="rpa-empty-state">Nhấn "Quét &amp; Gửi AI" để bắt đầu...</div>
                </div>
            </div>
            <div class="rpa-log-panel" id="rpa-log-panel"><div id="rpa-log-body"></div></div>
        </div>
        <div class="rpa-footer">
            <span class="rpa-status-text" id="rpa-footer-status">Sẵn sàng. Nhấn "Quét &amp; Gửi AI" để bắt đầu.</span>
            <div class="rpa-progress-wrap">
                <span class="rpa-progress-text" id="rpa-progress-text">0/0</span>
                <div class="rpa-progress-bar"><div class="rpa-progress-fill" id="rpa-progress-fill"></div></div>
            </div>
        </div>
    `;
    document.body.appendChild(hub);
    logPanel = document.getElementById('rpa-log-panel');

    makeDraggable(hub);

    document.getElementById('rpa-btn-minimize').addEventListener('click', () => hub.classList.toggle('minimized'));
    document.getElementById('rpa-btn-toggle-log').addEventListener('click', () => logPanel.classList.toggle('open'));
    document.getElementById('rpa-btn-scan').addEventListener('click', () => emit('scan-requested'));
    document.getElementById('rpa-btn-fill-all').addEventListener('click', () => emit('fill-requested'));
    document.getElementById('rpa-check-all').addEventListener('change', (e) => {
        document.querySelectorAll('.rpa-row-check').forEach(cb => cb.checked = e.target.checked);
    });
    document.getElementById('rpa-btn-select-all').addEventListener('click', () => {
        const allCb = document.getElementById('rpa-check-all');
        allCb.checked = !allCb.checked;
        allCb.dispatchEvent(new Event('change'));
    });

    on('docs-changed', updateDashboard);
    on('progress', ({ current, total }) => setProgress(current, total));

    appendLog('Khởi tạo iDesk RPA Card Feed UI v3.0');
};

export const makeDraggable = (elmnt) => {
    const header = elmnt.querySelector('.rpa-header');
    let startX, startY, startTop, startLeft, dragging = false;

    header.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = elmnt.getBoundingClientRect();
        startTop = rect.top;
        startLeft = rect.left;
        elmnt.style.top = startTop + 'px';
        elmnt.style.left = startLeft + 'px';
        elmnt.style.bottom = 'auto';
        elmnt.style.right = 'auto';
        elmnt.classList.add('rpa-dragging');
        header.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        elmnt.style.left = Math.min(Math.max(startLeft + dx, -elmnt.offsetWidth + 80), window.innerWidth - 60) + 'px';
        elmnt.style.top = Math.min(Math.max(startTop + dy, 0), window.innerHeight - 50) + 'px';
    });

    const stop = (e) => {
        if (!dragging) return;
        dragging = false;
        elmnt.classList.remove('rpa-dragging');
        try { header.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    header.addEventListener('pointerup', stop);
    header.addEventListener('pointercancel', stop);
};

/**
 * Escape HTML entities for safe rendering inside title/attributes.
 */
const escHtml = (str) => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&' + 'amp;')
        .replace(/"/g, '&' + 'quot;')
        .replace(/'/g, '&' + '#39;')
        .replace(/</g, '&' + 'lt;')
        .replace(/>/g, '&' + 'gt;');
};

const escAttr = (str) => escHtml(str);

export const updateDashboard = () => {
    const cardFeed = document.getElementById('rpa-card-feed');
    if (!cardFeed) return;

    const countEl = document.getElementById('rpa-doc-count');
    if (countEl) countEl.textContent = docCache.size.toString();

    if (docCache.size === 0) {
        cardFeed.innerHTML = `<div class="rpa-empty-state">Nhấn "Quét & Gửi AI" để bắt đầu...</div>`;
        return;
    }

    let html = '';
    docCache.forEach((doc, id) => {
        const statusMap = {
            'idle': ['rpa-badge-idle', 'Chưa gửi'],
            'pending': ['rpa-badge-pending', 'Đang gửi'],
            'ai_done': ['rpa-badge-success', 'Đã phân tích'],
            'ai_error': ['rpa-badge-error', 'Lỗi AI'],
            'fill_done': ['rpa-badge-sent', 'Đã điền'],
            'fill_error': ['rpa-badge-error', 'Lỗi điền'],
        };
        const s = statusMap[doc.status] || statusMap.idle;

        const ai = doc.aiData || {};
<<<<<<< HEAD
        const summary = ai.tom_tat || ai.summary || 'Chưa có tóm tắt AI...';

        // --- Metadata values ---
        const signNumber = doc.signNumber || ai.document_number || '---';
        const docType = doc.category || ai.document_type || ai.loai_van_ban || '';
        const agency = stripAgencySuffix(doc.author || ai.issuing_agency || '---');
        const signer = doc.signer || ai.signer || '---';
        const bookSerial = doc.book ? doc.book.serialNumber || '---' : '---';
        const docDate = doc.docDateStr || '';

        // --- Assignment ---
        const mainUnit = ai.don_vi_xu_ly || ai.processing_unit || '---';
        const leader = ai.lanh_dao_theo_doi || ai.monitoring_leader || '---';
        const days = ai.thoi_han_thuc_hien || ai.implementation_deadline;
        const daysStr = days ? `${days} ngày` : '---';
        const coUnits = ai.don_vi_phoi_hop || ai.coordinating_units;

        let coUnitsPills = '<span class="rpa-assign-value">---</span>';
        if (Array.isArray(coUnits) && coUnits.length > 0) {
            coUnitsPills = coUnits.map(u => `<span class="rpa-unit-pill">${escAttr(u)}</span>`).join(' ');
        } else if (typeof coUnits === 'string' && coUnits.trim() && coUnits !== '---') {
            coUnitsPills = `<span class="rpa-unit-pill">${escAttr(coUnits.trim())}</span>`;
        }

        // --- Priority ---
        const pRaw = (ai.priority !== undefined && ai.priority !== null) ? ai.priority : ai.do_khan;
        let priorityStr = '';
        if (pRaw === 1 || pRaw === '1' || pRaw === 'Khẩn' || pRaw === 'khan') priorityStr = 'Khẩn';
        else if (pRaw === 2 || pRaw === '2' || pRaw === 'Thượng khẩn' || pRaw === 'thuong_khan' || pRaw === 'Hỏa tốc') priorityStr = 'Thượng khẩn';
=======
        const summary = ai.summary || 'Chưa có tóm tắt AI...';
        const bookInfo = doc.book
            ? `Số ${doc.book.serialNumber || '---'}${doc.book.dateStr ? ' (' + formatDate(new Date(doc.book.dateStr)) + ')' : ''}`
            : '---';
        const mainUnit = ai.processing_unit || '---';
        const leader = ai.monitoring_leader || '---';
        // `implementation_deadline` la string|null theo METADATA_SCHEMA.md (#11), khong
        // phai luon la so ngay — resolveDeadlineDate() xu ly moi dang hop le.
        const daysStr = resolveDeadlineDate(ai.implementation_deadline).displayText;
        const coUnits = ai.coordinating_units;
        const notes = ai.notes || '---';
        const docType = doc.category || ai.document_type || '';

        let coUnitsPills = '<span class="rpa-meta-value">---</span>';
        if (Array.isArray(coUnits)) {
            if (coUnits.length > 0) {
                coUnitsPills = coUnits.map(u => `<span class="rpa-unit-pill">${u}</span>`).join(' ');
            }
        } else if (coUnits) {
            // docs/en/docflow.md muc 4 cam ket coordinating_units luon la mang (ke ca
            // []), khong bao gio la string/null. Neu roi vao day tuc BE dang vi pham
            // hop dong API — bao cho biet thay vi am tham "sua" du lieu nhu binh thuong.
            if (!doc._coUnitsContractWarned) {
                appendLog(`⚠ coordinating_units cua VB "${doc.signNumber || id}" khong phai mang (vi pham docflow.md muc 4, nhan duoc kieu ${typeof coUnits}): ${JSON.stringify(coUnits)}`);
                doc._coUnitsContractWarned = true;
            }
            coUnitsPills = `<span class="rpa-unit-pill">⚠ ${String(coUnits).trim()}</span>`;
        }

        // `priority` KHONG nam trong 13 truong hop dong API (METADATA_SCHEMA.md muc
        // 1). BE that se khong bao gio tra field nay nen tag nay se mac dinh "Binh
        // thuong" tru khi dang goi mock/BE thu nghiem cu con tra `priority`.
        const pRaw = ai.priority;
        let priorityStr = 'Bình thường';
        if (pRaw === 1 || pRaw === '1') priorityStr = 'Khẩn';
        else if (pRaw === 2 || pRaw === '2') priorityStr = 'Thượng khẩn';
>>>>>>> d558f2d01e5c6e7ad1fc3792f48bca950be709ea

        // --- Build header badge chips ---
        const escSign = escAttr(signNumber);
        const escType = escAttr(docType);
        const escAgency = escAttr(agency);
        const escSigner = escAttr(signer);
        const escBook = escAttr(bookSerial);

        const chipSign = `<span class="rpa-badge-chip is-signnumber" title="${escSign}">${escSign}</span>`;
        const chipType = docType ? `<span class="rpa-badge-chip" title="${escType}">${escType}</span>` : '';
        const chipAgency = agency !== '---' ? `<span class="rpa-badge-chip" title="${escAgency}">CQ: ${escAgency}</span>` : '';
        const chipSigner = signer !== '---' ? `<span class="rpa-badge-chip" title="${escSigner}">Ký: ${escSigner}</span>` : '';
        const chipBook = bookSerial !== '---' ? `<span class="rpa-badge-chip" title="Số: ${escBook}">Sổ: ${escBook}</span>` : '';
        const chipDate = docDate ? `<span class="rpa-badge-chip" title="${docDate}">${docDate}</span>` : '';
        const chipPriority = priorityStr ? `<span class="rpa-badge-chip is-priority" title="${priorityStr}">${priorityStr}</span>` : '';

        html += `
            <div data-id="${id}" class="rpa-doc-card">
                <div class="rpa-card-header">
                    <div class="rpa-card-header-left">
                        <input type="checkbox" class="rpa-row-check" data-id="${id}" ${doc.status === 'fill_done' ? '' : 'checked'}>
                        ${chipSign}
                        ${chipType}
                        ${chipPriority}
                        ${chipAgency}
                        ${chipSigner}
                        ${chipBook}
                        ${chipDate}
                    </div>
                    <div class="rpa-card-header-right">
                        <span class="rpa-badge ${s[0]}">${s[1]}</span>
                    </div>
                </div>

                <div class="rpa-card-body">
                    <div class="rpa-card-subject">
                        <span class="rpa-subject-label">Trích yếu:</span> ${doc.subject || ai.subject || '---'}
                    </div>

                    <div class="rpa-card-summary">
                        <div class="rpa-summary-title">TÓM TẮT AI</div>
                        <div class="rpa-summary-text">${summary}</div>
                    </div>

                    <div class="rpa-assignment-grid">
                        <div class="rpa-assign-item">
                            <span class="rpa-assign-label">Đơn vị xử lý chính</span>
                            <span class="rpa-assign-value is-main-unit" title="${escAttr(mainUnit)}">${mainUnit}</span>
                        </div>
                        <div class="rpa-assign-item">
                            <span class="rpa-assign-label">Đơn vị phối hợp</span>
                            <div class="rpa-unit-tags">${coUnitsPills}</div>
                        </div>
                        <div class="rpa-assign-item">
                            <span class="rpa-assign-label">Lãnh đạo theo dõi</span>
                            <span class="rpa-assign-value" title="${escAttr(leader)}">${leader}</span>
                        </div>
                        <div class="rpa-assign-item">
                            <span class="rpa-assign-label">Hạn thực hiện</span>
                            <span class="rpa-assign-value is-deadline">${daysStr}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    cardFeed.innerHTML = html;
};

// UI sở hữu trọn vẹn progress bar. Logic chỉ emit('progress', {current, total}), không tự query DOM nữa.
export const setProgress = (current, total) => {
    const fill = document.getElementById('rpa-progress-fill');
    const text = document.getElementById('rpa-progress-text');
    if (fill && text) {
        fill.style.width = (total > 0 ? Math.round((current / total) * 100) : 0) + '%';
        text.textContent = `${current}/${total}`;
    }
};
