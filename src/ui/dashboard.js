import { docCache, expandedRows } from '../state.js';
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
                <button class="rpa-btn rpa-btn-outline" id="rpa-btn-select-all">Chọn / Bỏ chọn</button>
            </div>
            <div class="rpa-table-wrap">
                <table class="rpa-table" id="rpa-doc-table">
                    <thead>
                        <tr>
                            <th style="width:30px;"><input type="checkbox" id="rpa-check-all" checked></th>
                            <th style="width:30px;"></th>
                            <th style="width:130px;">So hieu VB</th>
                            <th>Trich yeu VB</th>
                            <th style="width:180px;">DV xu ly chinh</th>
                            <th style="width:90px;">Han TH</th>
                            <th style="width:100px;">Trang thai</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="7" style="text-align:center;color:#666;padding:35px;">Nhan "Quet & Gui AI" de bat dau...</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="rpa-log-panel" id="rpa-log-panel"><div id="rpa-log-body"></div></div>
        </div>
        <div class="rpa-footer">
            <span class="rpa-status-text" id="rpa-footer-status">San sang. Nhan "Quét & Gửi AI" de bat dau.</span>
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

    document.querySelector('#rpa-doc-table tbody').addEventListener('click', (e) => {
        if (e.target.closest('input[type="checkbox"]')) return;
        const mainRow = e.target.closest('.rpa-row-main');
        if (mainRow) {
            const id = mainRow.getAttribute('data-id');
            if (expandedRows.has(id)) expandedRows.delete(id);
            else expandedRows.add(id);
            updateDashboard();
        }
    });

    appendLog('Khoi tao iDesk RPA Minimalist UI v2.3');
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
    const tbody = document.querySelector('#rpa-doc-table tbody');
    if (!tbody) return;

    const countEl = document.getElementById('rpa-doc-count');
    if (countEl) countEl.textContent = docCache.size.toString();

    if (docCache.size === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#666;padding:35px;">Nhan "Quet & Gui AI" de bat dau...</td></tr>`;
        return;
    }

    let html = '';
    docCache.forEach((doc, id) => {
        const statusMap = {
            'idle': ['rpa-badge-idle', 'Chua gui'],
            'pending': ['rpa-badge-pending', 'Dang gui'],
            'ai_done': ['rpa-badge-success', 'Da phan tich'],
            'ai_error': ['rpa-badge-error', 'Loi AI'],
            'fill_done': ['rpa-badge-sent', 'Da dien'],
            'fill_error': ['rpa-badge-error', 'Loi dien'],
        };
        const s = statusMap[doc.status] || statusMap.idle;
        const isExpanded = expandedRows.has(id);

        const ai = doc.aiData || {};
        const summary = ai.tom_tat || ai.summary || '---';
        const bookInfo = doc.book
            ? `So ${doc.book.serialNumber || '---'}${doc.book.dateStr ? ' (' + formatDate(new Date(doc.book.dateStr)) + ')' : ''}`
            : '---';
        const mainUnit = ai.don_vi_xu_ly || ai.processing_unit || '---';
        const leader = ai.lanh_dao_theo_doi || ai.monitoring_leader || '---';
        const days = ai.thoi_han_thuc_hien || ai.implementation_deadline;
        const daysStr = days ? `${days} ngay` : '---';
        const coUnits = ai.don_vi_phoi_hop || ai.coordinating_units;
        const coUnitsStr = (Array.isArray(coUnits) && coUnits.length > 0) ? coUnits.join(', ') : '---';
        const notes = ai.ghi_chu || ai.notes || '---';

        const pRaw = (ai.priority !== undefined && ai.priority !== null) ? ai.priority : ai.do_khan;
        let priorityStr = 'Bình thường';
        if (pRaw === 1 || pRaw === '1' || pRaw === 'Khẩn' || pRaw === 'khan') priorityStr = 'Khẩn';
        else if (pRaw === 2 || pRaw === '2' || pRaw === 'Thượng khẩn' || pRaw === 'thuong_khan' || pRaw === 'Hỏa tốc') priorityStr = 'Thượng khẩn';

        html += `
            <tr data-id="${id}" class="rpa-row-main ${isExpanded ? 'expanded' : ''}">
                <td><input type="checkbox" class="rpa-row-check" data-id="${id}" ${doc.status === 'fill_done' ? '' : 'checked'}></td>
                <td><span class="rpa-toggle-text">${isExpanded ? '[-]' : '[+]'}</span></td>
                <td><div class="rpa-doc-code" title="${doc.signNumber}">${doc.signNumber || '---'}</div></td>
                <td><div class="rpa-doc-text" title="${doc.subject}">${doc.subject || '---'}</div></td>
                <td><div class="rpa-doc-text" title="${mainUnit}">${mainUnit}</div></td>
                <td><div class="rpa-doc-code" title="${daysStr}">${daysStr}</div></td>
                <td><span class="rpa-badge ${s[0]}">${s[1]}</span></td>
            </tr>
        `;

        if (isExpanded) {
            html += `
                <tr data-id="${id}" class="rpa-row-detail">
                    <td colspan="7">
                        <div class="rpa-detail-grid">
                            <div class="rpa-detail-field span-full">
                                <span class="rpa-detail-label">Tom tat AI</span>
                                <span class="rpa-detail-value highlight">${summary}</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Da vao so (Van thu)</span>
                                <span class="rpa-detail-value highlight">${bookInfo}</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Don vi xu ly chinh</span>
                                <span class="rpa-detail-value highlight">${mainUnit}</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Lanh dao theo doi</span>
                                <span class="rpa-detail-value">${leader}</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Co quan ban hanh</span>
                                <span class="rpa-detail-value">${doc.author || '---'}</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Nguoi ky / Ngay VB</span>
                                <span class="rpa-detail-value">${doc.signer || '---'} (${doc.docDateStr || '---'})</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Loai van ban</span>
                                <span class="rpa-detail-value">${doc.category || '---'}</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Do khan</span>
                                <span class="rpa-detail-value highlight">${priorityStr}</span>
                            </div>
                            <div class="rpa-detail-field span-2">
                                <span class="rpa-detail-label">Don vi phoi hop</span>
                                <span class="rpa-detail-value">${coUnitsStr}</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Ghi chu / Noi dung</span>
                                <span class="rpa-detail-value">${notes}</span>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }
    });

    tbody.innerHTML = html;
};

export const scanList = async (retries = 3) => {
    setStatus('Dang quet danh sach van ban...');
    let items = getVisibleItems();
    let attempt = 0;
    while (items.length === 0 && attempt < retries) {
        attempt++;
        await sleep(800);
        items = getVisibleItems();
    }

    if (items.length === 0) {
        setStatus('Khong tim thay van ban.');
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
    setStatus(`Da quet: ${docCache.size} VB (${newCount} moi)`);
    return items.length;
};
