import { docCache } from '../state.js';
import { CSS_STYLES } from './styles.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { formatDate, getVisibleItems, sleep } from '../utils/helpers.js';
import { scanAndSendAll, runFillOnAll } from '../controllers/mainController.js';

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
    document.getElementById('rpa-btn-scan').addEventListener('click', scanAndSendAll);
    document.getElementById('rpa-btn-fill-all').addEventListener('click', runFillOnAll);
    document.getElementById('rpa-check-all').addEventListener('change', (e) => {
        document.querySelectorAll('.rpa-row-check').forEach(cb => cb.checked = e.target.checked);
    });
    document.getElementById('rpa-btn-select-all').addEventListener('click', () => {
        const allCb = document.getElementById('rpa-check-all');
        allCb.checked = !allCb.checked;
        allCb.dispatchEvent(new Event('change'));
    });

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

export const updateDashboard = () => {
    const cardFeed = document.getElementById('rpa-card-feed');
    if (!cardFeed) return;

    const countEl = document.getElementById('rpa-doc-count');
    if (countEl) countEl.textContent = docCache.size.toString();

    if (docCache.size === 0) {
        cardFeed.innerHTML = `<div class="rpa-empty-state">Nhấn "Quét &amp; Gửi AI" để bắt đầu...</div>`;
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
        const summary = ai.tom_tat || ai.summary || 'Chưa có tóm tắt AI...';
        const bookInfo = doc.book
            ? `Số ${doc.book.serialNumber || '---'}${doc.book.dateStr ? ' (' + formatDate(new Date(doc.book.dateStr)) + ')' : ''}`
            : '---';
        const mainUnit = ai.don_vi_xu_ly || ai.processing_unit || '---';
        const leader = ai.lanh_dao_theo_doi || ai.monitoring_leader || '---';
        const days = ai.thoi_han_thuc_hien || ai.implementation_deadline;
        const daysStr = days ? `${days} ngày` : '---';
        const coUnits = ai.don_vi_phoi_hop || ai.coordinating_units;
        const notes = ai.ghi_chu || ai.notes || '---';
        const docType = doc.category || ai.document_type || ai.loai_van_ban || '';

        let coUnitsPills = '<span class="rpa-meta-value">---</span>';
        if (Array.isArray(coUnits) && coUnits.length > 0) {
            coUnitsPills = coUnits.map(u => `<span class="rpa-unit-pill">${u}</span>`).join(' ');
        } else if (typeof coUnits === 'string' && coUnits.trim() && coUnits !== '---') {
            coUnitsPills = `<span class="rpa-unit-pill">${coUnits.trim()}</span>`;
        }

        const pRaw = (ai.priority !== undefined && ai.priority !== null) ? ai.priority : ai.do_khan;
        let priorityStr = 'Bình thường';
        if (pRaw === 1 || pRaw === '1' || pRaw === 'Khẩn' || pRaw === 'khan') priorityStr = 'Khẩn';
        else if (pRaw === 2 || pRaw === '2' || pRaw === 'Thượng khẩn' || pRaw === 'thuong_khan' || pRaw === 'Hỏa tốc') priorityStr = 'Thượng khẩn';

        html += `
            <div data-id="${id}" class="rpa-doc-card">
                <div class="rpa-card-header">
                    <div class="rpa-card-header-left">
                        <input type="checkbox" class="rpa-row-check" data-id="${id}" ${doc.status === 'fill_done' ? '' : 'checked'}>
                        <span class="rpa-doc-code" title="Số hiệu">${doc.signNumber || ai.document_number || '---'}</span>
                        ${docType ? `<span class="rpa-tag rpa-tag-type">${docType}</span>` : ''}
                        ${priorityStr !== 'Bình thường' ? `<span class="rpa-tag rpa-tag-priority">${priorityStr}</span>` : ''}
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

                    <div class="rpa-card-meta-grid">
                        <div class="rpa-meta-item highlight-unit">
                            <span class="rpa-meta-label">Đơn vị xử lý chính</span>
                            <span class="rpa-meta-value main-unit">${mainUnit}</span>
                        </div>

                        <div class="rpa-meta-item">
                            <span class="rpa-meta-label">Đơn vị phối hợp</span>
                            <div class="rpa-unit-tags">
                                ${coUnitsPills}
                            </div>
                        </div>

                        <div class="rpa-meta-item highlight-deadline">
                            <span class="rpa-meta-label">Hạn thực hiện / Ngày VB</span>
                            <span class="rpa-meta-value deadline">${daysStr}${doc.docDateStr ? ' • Ngày ' + doc.docDateStr : ''}</span>
                        </div>
                    </div>

                    <div class="rpa-card-footer-meta">
                        <span><strong>Cơ quan ban hành:</strong> ${doc.author || ai.issuing_agency || '---'}</span>
                        <span><strong>Người ký:</strong> ${doc.signer || ai.signer || '---'}</span>
                        <span><strong>Lãnh đạo theo dõi:</strong> ${leader}</span>
                        <span><strong>Đã vào sổ:</strong> ${bookInfo}</span>
                        ${(notes && notes !== '---') ? `<span><strong>Ghi chú:</strong> ${notes}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    cardFeed.innerHTML = html;
};

export const scanList = async (retries = 3) => {
    setStatus('Đang quét danh sách văn bản...');
    let items = getVisibleItems();
    let attempt = 0;
    while (items.length === 0 && attempt < retries) {
        attempt++;
        await sleep(800);
        items = getVisibleItems();
    }

    if (items.length === 0) {
        setStatus('Không tìm thấy văn bản.');
        return 0;
    }

    let newCount = 0;
    items.forEach(el => {
        const id = el.getAttribute('data-id');
        if (id && !docCache.has(id)) {
            docCache.set(id, {
                id,
                signNumber: el.querySelector('.sender')?.textContent?.trim() || '',
                subject: el.querySelector('.subject')?.textContent?.trim() || '',
                status: 'idle',
                aiData: null,
                attachments: [],
                creatorAcode: ''
            });
            newCount++;
        }
    });

    updateDashboard();
    setStatus(`Đã quét: ${docCache.size} VB (${newCount} mới)`);
    return items.length;
};
