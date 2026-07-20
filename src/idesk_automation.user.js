// ==UserScript==
// @name         iDesk RPA Auto-Fill v2.1
// @namespace    http://inet.vn/
// @version      2.1.1
// @description  iDesk Automation: Bấm "Quét & Gửi AI" để quét danh sách VB đến và tự động gửi AI ngay → Tự động điền "Xử lý chính", "Phối hợp xử lý", "Hạn xử lý" → Đồng ý
// @author       Senior Developer
// @match        https://vpdt.gialai.gov.vn/cumphumy/smartcloud/idesk6/page/paperwork/index.cpx*
// @match        https://vpdt.gialai.gov.vn/cumphumy/smartcloud/idesk6/page/paperwork/*
// @match        https://vpdt.gialai.gov.vn/cumphumy/smartcloud/*
// @icon         https://vpdt.gialai.gov.vn/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/GMIOS25/Script-Idesk/main/src/idesk_automation.user.js
// @updateURL    https://raw.githubusercontent.com/GMIOS25/Script-Idesk/main/src/idesk_automation.user.js
// ==/UserScript==

// CHANGELOG v2.1
// - CHANGE: Bỏ cơ chế tự động quét (MutationObserver quan sát danh sách + auto
//   scan lúc init). Giờ script CHỈ quét khi người dùng bấm nút "Quét & Gửi AI".
// - CHANGE: Gộp 2 bước "Quét" và "Gửi AI tất cả" thành 1 hành động duy nhất
//   (scanAndSendAll). Bỏ nút "Gửi AI tất cả" và hàm runAIOnAll. Sau khi quét,
//   mọi văn bản đang ở trạng thái "idle" (chưa từng gửi AI) sẽ được tự động
//   gửi ngay, không cần chọn checkbox hay bấm thêm nút nào.
//
// CHANGELOG v2.0
// - FIX CRITICAL: Typo "qrreceiving" → "qsreceiving" (AJAX interceptor không hoạt động)
// - FIX: Bổ sung Fetch API interceptor (iDesk dùng fetch cho 1 số API)
// - FIX: CSS injection dùng GM_addStyle thay vì innerHTML (best practice)
// - FIX: Cải tiến tree popup selector - click chuẩn hơn, retry nếu popup chưa kịp render
// - FIX: Download PDF dùng GM_xmlhttpRequest (blob) thay fetch (CORS issue)
// - FIX: autoFillAndSubmit - chờ các transition DOM kỹ hơn, dùng MutationObserver khi cần
// - NEW: Floating progress bar + log console panel
// - NEW: Config persistence dùng GM_setValue/GM_getValue
// - NEW: Bỏ qua "Số đến" - chỉ fill "Sổ văn bản đến" rồi Lưu và chuyển
// - NEW: Xử lý lỗi chi tiết hơn, retry khi timeout

(function() {
    'use strict';

    // ============================================================
    // 1. CONFIGURATION
    // ============================================================
    const CONFIG = {
        BACKEND_URL: 'http://localhost:5000/api/process-doc',
        DEFAULT_BOOK: 'Sổ văn bản đến UBND tỉnh',
        DELAY_MS: {
            SELECT_DOC: 1200,
            OPEN_SELECT2: 400,
            AFTER_BOOK_SELECT: 800,
            CLICK_SAVE_TRANSFER: 1500,
            OPEN_TREE: 1000,
            TREE_SEARCH: 600,
            CLOSE_TREE: 400,
            AFTER_SUBMIT: 2000,
            BETWEEN_DOCS: 1000
        }
    };

    // Selectors - ánh xạ từ resource/*.html
    const S = {
        // Left panel
        LEFT_LIST: '#listview-list-content div.messageListItem',
        LEFT_LIST_FALLBACK: 'div.messageListItem[data-id]',

        // Right panel - form fields
        SUBJECT: '#edocs-txt-subject',
        SIGN_NUMBER: '#edocs-txt-sign-number',
        DOC_DATE: '#edocs-txt-doc-date-str',
        CATEGORY_INPUT: '#edocs-txt-category',
        AGENCY: '#edocs-txt-agency',
        SIGNER: '#edocs-txt-signer',
        PUBLISHER_UNIT: '#edocs-txt-publisher-unit',
        SHOW_MORE: '#edocs-btn-hide-show-more-info',

        // Sổ văn bản đến section
        BOOK_INPUT: '#edocs-txt-book',
        SERIAL_NUMBER: '#edocs-txt-serial-number',

        // Buttons
        SAVE_TRANSFER_BTN: '#ed-new-receiver-btn-save-transfer',
        SAVE_BTN: '#ed-new-receiver-btn-save',

        // Transfer screen (after Lưu và chuyển)
        TRANSFER_CONTAINER: '#ed-transfer-document-container',
        TRANSFER_CONTENT: '#ed-transfer-document-content',
        SUBJECT_DISPLAY: '#ed-transfer-doc-text-subject',
        RESPONSIBLE_LINK: '#ed-transfer-select-user-responsible a.user-box-link',
        RESPONSIBLE_WRAP: '#ed-transfer-select-user-responsible',
        PARTICIPANTS_LINK: '#ed-transfer-select-user-participants a.user-box-link',
        PARTICIPANTS_WRAP: '#ed-transfer-select-user-participants',
        DEADLINE_INPUT: '#ed-transfer-txt-deadline',
        DEADLINE_NUMBER: '#ed-transfer-txt-deadline-number',
        AGREE_BTN: '#ed-transfer-btn-transfer',
        CANCEL_BTN: '#ed-transfer-btn-cancel',
        PRIORITY_SELECT: '#ed-transfer-select-priority',
        CONTENT_TEXTAREA: '#ed-transfer-txt-content',

        // File attachment table
        FILE_TABLE: '#ed-file-origin-table tbody',
        FILE_ROW: '#ed-file-origin-table tbody tr',
        FILE_DOWNLOAD_LINK: 'a.link-file[data-file-action="download"]',
        FILE_VIEW_LINK: 'a[data-file-action="view"]',
    };

    // ============================================================
    // 2. STATE & CACHE
    // ============================================================
    const docCache = new Map(); // Map<id, DocObject>
    let isProcessing = false;
    let logPanel = null;

    // ============================================================
    // 3. HELPERS
    // ============================================================
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const setStatus = (msg) => {
        const el = document.getElementById('rpa-footer-status');
        if (el) el.textContent = msg;
        appendLog(msg);
        console.log(`[iDesk RPA] ${msg}`);
    };

    const appendLog = (msg) => {
        const logBody = document.getElementById('rpa-log-body');
        if (logBody) {
            const time = new Date().toLocaleTimeString('vi-VN');
            const row = document.createElement('div');
            row.className = 'rpa-log-entry';
            row.innerHTML = `<span class="rpa-log-time">[${time}]</span> ${msg}`;
            logBody.appendChild(row);
            logBody.scrollTop = logBody.scrollHeight;
        }
    };

    // Format date DD/MM/YYYY
    const formatDate = (date) => {
        const d = date || new Date();
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    };

    // Parse DD/MM/YYYY to Date
    const parseDate = (str) => {
        if (!str) return null;
        const parts = str.split('/');
        if (parts.length === 3) {
            return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        }
        return null;
    };

    // Calculate deadline: today + N days
    const calcDeadline = (days) => {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(days));
        return formatDate(date);
    };

    // Get Select2 container reliably (xem right_panel.html)
    const getSelect2Container = (originalFieldId) => {
        const hiddenEl = document.querySelector(originalFieldId);
        if (!hiddenEl) return null;

        // Select2 3.x chèn container ngay trước hoặc sau input gốc
        const prev = hiddenEl.previousElementSibling;
        if (prev && prev.classList.contains('select2-container')) return prev;

        const next = hiddenEl.nextElementSibling;
        if (next && next.classList.contains('select2-container')) return next;

        // Fallback: tìm trong parent
        const parent = hiddenEl.closest('.row-fluid, .span4, .span3, div');
        return parent ? parent.querySelector('.select2-container') : null;
    };

    // Query visible (not display:none) left panel items
    const getVisibleItems = () => {
        let items = Array.from(document.querySelectorAll(S.LEFT_LIST));
        if (items.length === 0) {
            items = Array.from(document.querySelectorAll(S.LEFT_LIST_FALLBACK));
        }
        return items.filter(el => el.offsetParent !== null);
    };

    // ============================================================
    // 4. NETWORK INTERCEPTOR (XHR + Fetch)
    // ============================================================
    const interceptXHR = () => {
        const XHR = XMLHttpRequest.prototype;
        const origOpen = XHR.open;
        const origSend = XHR.send;

        XHR.open = function(method, url) {
            this._url = url;
            return origOpen.apply(this, arguments);
        };

        XHR.send = function(body) {
            this.addEventListener('load', function() {
                try {
                    const url = this._url || '';
                    if (url.includes('qsreceiving.cpx')) {
                        const data = JSON.parse(this.responseText);
                        handleListResponse(data);
                    } else if (url.includes('view.cpx') && url.includes('exeacode=')) {
                        const data = JSON.parse(this.responseText);
                        handleViewResponse(data);
                    }
                } catch (e) {
                    // silent
                }
            });
            return origSend.apply(this, arguments);
        };
    };

    const interceptFetch = () => {
        const origFetch = unsafeWindow.fetch.bind(unsafeWindow);
        unsafeWindow.fetch = function(input, init) {
            const url = typeof input === 'string' ? input : (input.url || '');
            return origFetch(input, init).then(async (response) => {
                // Clone response để đọc body mà không ảnh hưởng original consumer
                if (url.includes('qsreceiving.cpx') || url.includes('view.cpx')) {
                    const clone = response.clone();
                    try {
                        const data = await clone.json();
                        if (url.includes('qsreceiving.cpx')) {
                            handleListResponse(data);
                        } else if (url.includes('view.cpx')) {
                            handleViewResponse(data);
                        }
                    } catch (e) { /* silent */ }
                }
                return response;
            }).catch(err => {
                throw err;
            });
        };
    };

    // ============================================================
    // 5. RESPONSE HANDLERS
    // ============================================================
    const handleListResponse = (data) => {
        if (!data || !data.items) return;
        const count = data.items.length;
        appendLog(`📥 API qsreceiving: ${count} văn bản`);

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
            doc.status = doc.status || 'idle';
            doc.aiData = doc.aiData || null;

            docCache.set(id, doc);
        });
        updateDashboard();
    };

    const handleViewResponse = (data) => {
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
        doc.docType = ed.docType || doc.docType || 'normal';
        doc.form = ed.form || doc.form || 'original';
        doc.priority = ed.priority !== undefined ? ed.priority : doc.priority;
        doc.security = ed.security !== undefined ? ed.security : doc.security;

        docCache.set(id, doc);
        updateDashboard();
    };

    // ============================================================
    // 6. PDF DOWNLOAD (dùng GM_xmlhttpRequest để tránh CORS)
    // ============================================================
    const downloadPDF = (contentUid, fileName) => {
        return new Promise((resolve, reject) => {
            const url = `/cumphumy/smartcloud/docx/download.cpx?docID=${contentUid}&view=pdf&t=${Date.now()}`;
            setStatus(`Đang tải PDF: ${fileName}...`);

            GM_xmlhttpRequest({
                method: 'GET',
                url: window.location.origin + url,
                responseType: 'blob',
                onload: (resp) => {
                    if (resp.status >= 200 && resp.status < 300) {
                        const blob = resp.response;
                        const file = new File([blob], fileName || `document_${contentUid}.pdf`, {
                            type: blob.type || 'application/pdf'
                        });
                        resolve(file);
                    } else {
                        reject(new Error(`Download PDF thất bại: HTTP ${resp.status}`));
                    }
                },
                onerror: (err) => {
                    reject(new Error(`Không thể download PDF: ${err}`));
                },
                ontimeout: () => {
                    reject(new Error('Timeout khi download PDF'));
                }
            });
        });
    };

    // ============================================================
    // 7. GET FULL DOC DETAILS (click + fetch nếu thiếu)
    // ============================================================
    const ensureDocDetails = async (id) => {
        let doc = docCache.get(id.toString());
        if (!doc) {
            doc = { id: id.toString(), status: 'idle' };
            docCache.set(id.toString(), doc);
        }

        // Nếu chưa có đầy đủ, thử click vào item để load
        if (!doc.creatorAcode || !doc.attachments || doc.attachments.length === 0) {
            const itemEl = document.querySelector(`.messageListItem[data-id="${id}"]`);
            if (itemEl) {
                // Check xem có đang được chọn chưa
                if (!itemEl.classList.contains('selected')) {
                    itemEl.click();
                    await sleep(CONFIG.DELAY_MS.SELECT_DOC);
                }
                doc = docCache.get(id.toString()) || doc;
            }
        }

        // Fetch trực tiếp nếu vẫn thiếu
        if (doc.creatorAcode && (!doc.attachments || doc.attachments.length === 0)) {
            try {
                const viewUrl = `/cumphumy/smartcloud/document/edocs/view.cpx?exeacode=${doc.creatorAcode}&id=${id}`;
                const resp = await fetch(viewUrl);
                if (resp.ok) {
                    const data = await resp.json();
                    handleViewResponse(data);
                    doc = docCache.get(id.toString()) || doc;
                }
            } catch (e) {
                appendLog(`⚠️ Fetch view.cpx cho ${id} thất bại: ${e.message}`);
            }
        }

        return doc;
    };

    // ============================================================
    // 8. CALL AI BACKEND (gửi metadata + PDF)
    // ============================================================
    const callAIBackend = async (doc) => {
        // Tìm file PDF đầu tiên trong attachments
        const pdfAttach = (doc.attachments || []).find(a =>
            a.format === 'pdf' || (a.name || '').toLowerCase().endsWith('.pdf')
        );

        if (!pdfAttach) {
            throw new Error(`Không tìm thấy file PDF đính kèm cho VB "${doc.signNumber}"`);
        }

        const pdfFile = await downloadPDF(pdfAttach.contentUid, pdfAttach.name);

        // Metadata cẩn thận loại bỏ undefined/null
        const metadata = {
            id: doc.id,
            so_hieu: doc.signNumber || '',
            loai_vb: doc.category || '',
            cq_bh: doc.author || '',
            ngay_vb: doc.docDateStr || '',
            nguoi_ky: doc.signer || '',
            trich_yeu: doc.subject || ''
        };

        const formData = new FormData();
        formData.append('pdf', pdfFile);
        formData.append('metadata', JSON.stringify(metadata));

        return new Promise((resolve, reject) => {
            setStatus(`📤 Gửi "${doc.signNumber}" đến AI...`);

            GM_xmlhttpRequest({
                method: 'POST',
                url: CONFIG.BACKEND_URL,
                data: formData,
                onload: (resp) => {
                    if (resp.status === 200) {
                        try {
                            const result = JSON.parse(resp.responseText);
                            appendLog(`✅ AI phản hồi cho "${doc.signNumber}": ${JSON.stringify(result)}`);
                            resolve(result);
                        } catch (e) {
                            reject(new Error(`Parse JSON lỗi: ${e.message}`));
                        }
                    } else {
                        reject(new Error(`Backend HTTP ${resp.status}: ${resp.responseText}`));
                    }
                },
                onerror: () => {
                    reject(new Error(`Không kết nối được tới AI (${CONFIG.BACKEND_URL})`));
                },
                ontimeout: () => {
                    reject(new Error('Timeout gọi AI backend'));
                }
            });
        });
    };

    // ============================================================
    // 9. SELECT2: CHỌN "SỔ VĂN BẢN ĐẾN"
    // ============================================================
    const selectBook = async (bookName) => {
        const container = getSelect2Container(S.BOOK_INPUT);
        if (!container) throw new Error('Không tìm thấy container Select2 của "Sổ văn bản đến"');

        const trigger = container.querySelector('.select2-choice');
        if (!trigger) throw new Error('Không tìm thấy nút chọn Sổ văn bản');

        // Check xem đã chọn đúng chưa
        const currentText = trigger.querySelector('.select2-chosen')?.textContent?.trim() || '';
        if (currentText === bookName) {
            appendLog(`✅ Đã chọn sẵn: "${bookName}"`);
            return;
        }

        // Mở dropdown
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await sleep(CONFIG.DELAY_MS.OPEN_SELECT2);

        // Tìm option trong dropdown
        const drop = document.getElementById('select2-drop');
        if (!drop) throw new Error('Không thấy dropdown Select2 mở ra');

        const items = drop.querySelectorAll('ul.select2-results li');
        let target = null;

        // Ưu tiên match chính xác
        for (const li of items) {
            const text = li.textContent.trim();
            if (text === bookName) { target = li; break; }
        }
        if (!target) {
            for (const li of items) {
                const text = li.textContent.trim();
                if (text.includes(bookName)) { target = li; break; }
            }
        }
        if (!target) {
            // Fallback: chọn cái đầu tiên
            target = items[0];
            if (target) {
                appendLog(`⚠️ Không tìm thấy "${bookName}", chọn "${target.textContent.trim()}" làm mặc định`);
            }
        }

        if (target) {
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            await sleep(CONFIG.DELAY_MS.AFTER_BOOK_SELECT);
            appendLog(`✅ Đã chọn sổ: "${target.textContent.trim()}"`);
        } else {
            document.body.click(); // đóng dropdown
            throw new Error('Không tìm thấy sổ nào trong dropdown!');
        }
    };

    // ============================================================
    // 10. TREE POPUP: CHỌN NGƯỜI / PHÒNG BAN (Xử lý chính, Phối hợp)
    // ============================================================
    const selectTreeItem = async (linkSelector, wrapSelector, targetName) => {
        if (!targetName || targetName.trim() === '') {
            appendLog(`⚠️ Bỏ qua trống: ${linkSelector}`);
            return false;
        }

        // Click vào link "+ Chọn người, phòng ban..."
        const link = document.querySelector(linkSelector);
        if (!link) {
            appendLog(`⚠️ Không tìm thấy link: ${linkSelector}`);
            return false;
        }

        link.click();
        await sleep(CONFIG.DELAY_MS.OPEN_TREE);

        // Tìm popup đang mở - thử nhiều selector
        let popup = null;
        const popupSelectors = [
            '.popover:not(.hide):not([style*="display: none"])',
            '.modal:not(.hide):not([style*="display: none"])',
            '.ui-dialog:not([style*="display: none"])',
            '.select2-drop:not([style*="display: none"])',
            'div[role="dialog"]:not([style*="display: none"])',
            '.dropdown-menu:not(.hide):not([style*="display: none"])'
        ];

        for (const sel of popupSelectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
                popup = el;
                break;
            }
        }

        if (!popup) {
            appendLog(`⚠️ Không tìm thấy popup, thử tìm theo visibility...`);
            // Fallback: tìm tất cả popup visible
            const all = document.querySelectorAll('.popover, .modal, .ui-dialog, .dropdown-menu');
            for (const el of all) {
                if (el.offsetParent !== null) {
                    popup = el;
                    break;
                }
            }
        }

        if (!popup) {
            appendLog(`⚠️ Không mở được popup - bỏ qua "${targetName}"`);
            document.body.click();
            await sleep(200);
            return false;
        }

        // Thử tìm kiếm
        const searchInput = popup.querySelector('input[type="text"]');
        if (searchInput) {
            searchInput.value = targetName;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('keyup', { bubbles: true }));
            await sleep(CONFIG.DELAY_MS.TREE_SEARCH);
        }

        // Tìm label chứa text match
        const labels = popup.querySelectorAll('label, span, a, li, .user-box-item, .text, div');
        let clicked = false;

        // Hàm thử click vào phần tử
        const tryClick = (el) => {
            // Ưu tiên click vào checkbox/radio
            const cb = el.querySelector('input[type="checkbox"], input[type="radio"]');
            if (cb) {
                cb.click();
                return true;
            }
            // Hoặc click vào label
            el.click();
            return true;
        };

        // Match chính xác
        for (const el of labels) {
            const text = el.textContent.trim();
            if (text === targetName && el.offsetParent !== null) {
                tryClick(el);
                clicked = true;
                break;
            }
        }

        // Match includes
        if (!clicked) {
            for (const el of labels) {
                const text = el.textContent.trim();
                if (text.includes(targetName) && el.offsetParent !== null) {
                    tryClick(el);
                    clicked = true;
                    break;
                }
            }
        }

        if (clicked) {
            appendLog(`✅ Đã chọn "${targetName}"`);
        } else {
            appendLog(`⚠️ Không click được "${targetName}" trong popup`);
        }

        // Đóng popup
        const closeBtn = popup.querySelector('button.close, .close, [data-dismiss="modal"], .ui-dialog-titlebar-close');
        if (closeBtn) {
            closeBtn.click();
        } else {
            document.body.click();
        }
        await sleep(CONFIG.DELAY_MS.CLOSE_TREE);

        return clicked;
    };

    // ============================================================
    // 11. AUTO FILL & SUBMIT CHO 1 VĂN BẢN
    // ============================================================
    const autoFillAndSubmit = async (docId, aiData) => {
        // B1: Click vào văn bản ở panel trái
        const itemEl = document.querySelector(`.messageListItem[data-id="${docId}"]`);
        if (!itemEl) throw new Error(`Không tìm thấy văn bản ID ${docId} ở panel trái`);

        if (!itemEl.classList.contains('selected')) {
            itemEl.click();
            appendLog(`📄 Đã chọn VB ID ${docId}`);
            await sleep(CONFIG.DELAY_MS.SELECT_DOC);
        } else {
            appendLog(`📄 VB ID ${docId} đã được chọn`);
        }

        // B2: Show more fields nếu cần (người ký nằm trong info-more-hidden)
        const showMoreBtn = document.querySelector(S.SHOW_MORE);
        if (showMoreBtn && showMoreBtn.textContent.includes('Hiển thị thêm')) {
            showMoreBtn.click();
            appendLog('🔽 Đã mở rộng trường ẩn');
            await sleep(300);
        }

        // B3: Chọn "Sổ văn bản đến" (KHÔNG fill số đến)
        await selectBook(CONFIG.DEFAULT_BOOK);

        // B4: Đợi nút "Lưu và chuyển" enable
        const saveTransferBtn = document.querySelector(S.SAVE_TRANSFER_BTN);
        if (!saveTransferBtn) throw new Error('Không tìm thấy nút "Lưu và chuyển"');
        if (saveTransferBtn.disabled) {
            appendLog('⏳ Đợi nút "Lưu và chuyển" enable...');
            // Đợi tối đa 5s
            for (let i = 0; i < 10; i++) {
                await sleep(500);
                if (!saveTransferBtn.disabled) break;
            }
        }
        if (saveTransferBtn.disabled) {
            throw new Error('Nút "Lưu và chuyển" không enable sau khi chọn sổ!');
        }

        // B5: Click "Lưu và chuyển"
        saveTransferBtn.click();
        appendLog('💾 Đã click "Lưu và chuyển"');
        await sleep(CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER);

        // B6: Đợi transfer container xuất hiện
        const transferContainer = document.querySelector(S.TRANSFER_CONTAINER);
        if (!transferContainer) {
            // Retry
            for (let i = 0; i < 5; i++) {
                await sleep(500);
                if (document.querySelector(S.TRANSFER_CONTAINER)) break;
            }
        }
        if (!document.querySelector(S.TRANSFER_CONTAINER)) {
            throw new Error('Không thấy form "Thông tin xử lý" sau khi click Lưu và chuyển!');
        }
        appendLog('📋 Đã mở form Thông tin xử lý');

        // B7: Điền "Xử lý chính"
        if (aiData.don_vi_xu_ly) {
            appendLog(`👤 Xử lý chính: ${aiData.don_vi_xu_ly}`);
            await selectTreeItem(S.RESPONSIBLE_LINK, S.RESPONSIBLE_WRAP, aiData.don_vi_xu_ly);
        }

        // B8: Điền "Phối hợp xử lý" (array)
        if (aiData.don_vi_phoi_hop && Array.isArray(aiData.don_vi_phoi_hop)) {
            for (const unit of aiData.don_vi_phoi_hop) {
                if (unit && unit.trim()) {
                    await selectTreeItem(S.PARTICIPANTS_LINK, S.PARTICIPANTS_WRAP, unit.trim());
                    await sleep(300); // chờ giữa các lần chọn
                }
            }
        }

        // B9: Điền "Hạn xử lý" = hiện tại + số ngày
        if (aiData.thoi_han_thuc_hien) {
            const days = parseInt(aiData.thoi_han_thuc_hien);
            const deadlineDate = calcDeadline(days);

            // Set số ngày trước
            const numInput = document.querySelector(S.DEADLINE_NUMBER);
            if (numInput) {
                numInput.value = days;
                numInput.dispatchEvent(new Event('input', { bubbles: true }));
                numInput.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(200);
            }

            // Set ngày
            const dateInput = document.querySelector(S.DEADLINE_INPUT);
            if (dateInput) {
                dateInput.value = deadlineDate;
                dateInput.dispatchEvent(new Event('input', { bubbles: true }));
                dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
                appendLog(`📅 Hạn xử lý: ${deadlineDate} (hiện tại + ${days} ngày)`);
            }
        }

        // B10: Click "Đồng ý"
        const agreeBtn = document.querySelector(S.AGREE_BTN);
        if (!agreeBtn) throw new Error('Không tìm thấy nút "Đồng ý"!');
        if (agreeBtn.disabled) {
            appendLog('⏳ Đợi nút "Đồng ý" enable...');
            for (let i = 0; i < 5; i++) {
                await sleep(500);
                if (!agreeBtn.disabled) break;
            }
        }
        agreeBtn.click();
        appendLog('✅ Đã click "Đồng ý"');
        await sleep(CONFIG.DELAY_MS.AFTER_SUBMIT);

        return true;
    };

    // ============================================================
    // 12. SCAN DANH SÁCH VĂN BẢN TỪ DOM
    // ============================================================
    const scanList = async (retries = 3) => {
        setStatus('🔍 Đang quét danh sách văn bản...');

        let items = getVisibleItems();
        let attempt = 0;
        while (items.length === 0 && attempt < retries) {
            attempt++;
            setStatus(`⏳ Chờ danh sách (lần ${attempt}/${retries})...`);
            await sleep(1000);
            items = getVisibleItems();
        }

        if (items.length === 0) {
            setStatus('⚠️ Không tìm thấy văn bản. Đã ở màn hình "Tiếp nhận văn bản"?');
            return 0;
        }

        let newCount = 0;
        items.forEach(el => {
            const id = el.getAttribute('data-id');
            if (id && !docCache.has(id)) {
                const sender = el.querySelector('.sender')?.textContent?.trim() || '';
                const subject = el.querySelector('.subject')?.textContent?.trim() || '';
                docCache.set(id, {
                    id,
                    signNumber: sender,
                    subject,
                    status: 'idle',
                    aiData: null,
                    attachments: [],
                    creatorAcode: ''
                });
                newCount++;
            }
        });

        updateDashboard();
        setStatus(`📋 Đã quét: ${docCache.size} VB (${newCount} mới)`);
        appendLog(`📋 Quét xong: ${docCache.size} văn bản trong danh sách`);
        return items.length;
    };

    // ============================================================
    // 14. UI DASHBOARD
    // ============================================================
    const createDashboard = () => {
        if (document.getElementById('idesk-rpa-hub')) return;

        // CSS dùng GM_addStyle
        GM_addStyle(`
            /* ===== iDesk RPA Dashboard v2.0 ===== */
            #idesk-rpa-hub {
                position: fixed !important;
                bottom: 20px !important;
                right: 20px !important;
                width: 1600px !important;
                height: 520px !important;
                background: rgba(15, 23, 42, 0.92) !important;
                backdrop-filter: blur(20px) !important;
                -webkit-backdrop-filter: blur(20px) !important;
                border: 1px solid rgba(148, 163, 184, 0.15) !important;
                border-radius: 16px !important;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.03) !important;
                color: #e2e8f0 !important;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
                z-index: 999999 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                font-size: 13px !important;
                line-height: 1.4 !important;
                transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), height 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                user-select: none !important;
            }
            #idesk-rpa-hub.rpa-dragging {
                transition: none !important;
                will-change: top, left !important;
            }
            #idesk-rpa-hub * {
                box-sizing: border-box !important;
            }
            #idesk-rpa-hub.minimized {
                width: 380px !important;
                height: 44px !important;
                border-radius: 22px !important;
                cursor: pointer !important;
            }
            #idesk-rpa-hub.minimized .rpa-body,
            #idesk-rpa-hub.minimized .rpa-footer {
                display: none !important;
            }
            .rpa-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                padding: 10px 16px !important;
                background: rgba(255,255,255,0.03) !important;
                border-bottom: 1px solid rgba(255,255,255,0.06) !important;
                cursor: grab !important;
                flex-shrink: 0 !important;
                min-height: 44px !important;
            }
            .rpa-header:active { cursor: grabbing !important; }
            .rpa-title {
                font-weight: 700 !important;
                font-size: 14px !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                color: #38bdf8 !important;
                letter-spacing: 0.3px !important;
            }
            .rpa-title .badge-count {
                background: rgba(56, 189, 248, 0.15) !important;
                color: #7dd3fc !important;
                font-size: 11px !important;
                padding: 1px 8px !important;
                border-radius: 10px !important;
                font-weight: 600 !important;
            }
            .rpa-header-actions {
                display: flex !important;
                gap: 6px !important;
            }
            .rpa-header-actions button {
                background: rgba(255,255,255,0.05) !important;
                border: none !important;
                color: #94a3b8 !important;
                cursor: pointer !important;
                padding: 4px 8px !important;
                border-radius: 6px !important;
                font-size: 12px !important;
                transition: all 0.15s !important;
                line-height: 1 !important;
            }
            .rpa-header-actions button:hover {
                background: rgba(255,255,255,0.1) !important;
                color: #f1f5f9 !important;
            }
            .rpa-body {
                flex: 1 !important;
                padding: 12px !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 8px !important;
                overflow: hidden !important;
            }
            .rpa-toolbar {
                display: flex !important;
                gap: 6px !important;
                flex-shrink: 0 !important;
                flex-wrap: wrap !important;
            }
            .rpa-btn {
                border: none !important;
                border-radius: 8px !important;
                padding: 7px 14px !important;
                font-weight: 600 !important;
                font-size: 12px !important;
                cursor: pointer !important;
                display: inline-flex !important;
                align-items: center !important;
                gap: 6px !important;
                transition: all 0.15s !important;
                white-space: nowrap !important;
            }
            .rpa-btn:active { transform: scale(0.97) !important; }
            .rpa-btn-primary { background: #0284c7 !important; color: #fff !important; }
            .rpa-btn-primary:hover { background: #0ea5e9 !important; }
            .rpa-btn-success { background: #16a34a !important; color: #fff !important; }
            .rpa-btn-success:hover { background: #22c55e !important; }
            .rpa-btn-warning { background: #d97706 !important; color: #fff !important; }
            .rpa-btn-warning:hover { background: #f59e0b !important; }
            .rpa-btn-danger { background: #dc2626 !important; color: #fff !important; }
            .rpa-btn-danger:hover { background: #ef4444 !important; }
            .rpa-btn-purple { background: #7c3aed !important; color: #fff !important; }
            .rpa-btn-purple:hover { background: #8b5cf6 !important; }
            .rpa-btn-sm { padding: 4px 10px !important; font-size: 11px !important; }
            .rpa-btn-outline {
                background: transparent !important;
                border: 1px solid rgba(148,163,184,0.3) !important;
                color: #94a3b8 !important;
            }
            .rpa-btn-outline:hover { border-color: #38bdf8 !important; color: #38bdf8 !important; }
            
            .rpa-table-wrap {
                flex: 1 !important;
                overflow-y: auto !important;
                border: 1px solid rgba(255,255,255,0.06) !important;
                border-radius: 10px !important;
                background: rgba(0,0,0,0.15) !important;
                min-height: 0 !important;
            }
            .rpa-table-wrap::-webkit-scrollbar { width: 6px !important; }
            .rpa-table-wrap::-webkit-scrollbar-track { background: transparent !important; }
            .rpa-table-wrap::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.2) !important; border-radius: 3px !important; }
            
            .rpa-table {
                width: 100% !important;
                border-collapse: collapse !important;
                font-size: 13px !important;
                text-align: left !important;
            }
            .rpa-table th {
                background: rgba(255,255,255,0.02) !important;
                color: #94a3b8 !important;
                font-weight: 600 !important;
                padding: 6px 6px !important;
                position: sticky !important;
                top: 0 !important;
                z-index: 1 !important;
                border-bottom: 1px solid rgba(255,255,255,0.06) !important;
                font-size: 11px !important;
                text-transform: uppercase !important;
                letter-spacing: 0.3px !important;
                white-space: nowrap !important;
            }
            .rpa-table td {
                padding: 6px 6px !important;
                border-bottom: 1px solid rgba(255,255,255,0.03) !important;
                vertical-align: middle !important;
                font-size: 13px !important;
            }
            .rpa-table tr:hover td {
                background: rgba(255,255,255,0.02) !important;
            }
            .rpa-table tr.rpa-row-processing td {
                background: rgba(124, 58, 237, 0.08) !important;
            }
            .rpa-table tr.rpa-row-done td {
                background: rgba(16, 185, 129, 0.06) !important;
            }
            .rpa-table tr.rpa-row-error td {
                background: rgba(239, 68, 68, 0.06) !important;
            }
            
            .rpa-doc-cell {
                max-width: 260px !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
                line-height: 1.4 !important;
            }
            .rpa-doc-cell-title {
                font-weight: 600 !important;
                color: #f1f5f9 !important;
                font-size: 13px !important;
            }
            .rpa-doc-cell-sub {
                color: #94a3b8 !important;
                font-size: 12px !important;
            }
            
            .rpa-badge {
                display: inline-block !important;
                padding: 2px 6px !important;
                border-radius: 12px !important;
                font-weight: 600 !important;
                font-size: 11px !important;
                letter-spacing: 0.3px !important;
            }
            .rpa-badge-idle { background: rgba(148,163,184,0.12) !important; color: #94a3b8 !important; }
            .rpa-badge-pending { background: rgba(245,158,11,0.15) !important; color: #fbbf24 !important; }
            .rpa-badge-success { background: rgba(16,185,129,0.15) !important; color: #34d399 !important; }
            .rpa-badge-error { background: rgba(239,68,68,0.15) !important; color: #f87171 !important; }
            .rpa-badge-sent { background: rgba(99,102,241,0.15) !important; color: #818cf8 !important; }
            
            .rpa-subject-preview {
                max-width: 700px !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
                color: #cbd5e1 !important;
                font-size: 12px !important;
            }
            
            .rpa-ai-fields {
                display: flex !important;
                flex-direction: column !important;
                gap: 3px !important;
            }
            .rpa-ai-field {
                display: flex !important;
                align-items: center !important;
                gap: 4px !important;
            }
            .rpa-ai-field label {
                color: #64748b !important;
                font-size: 10px !important;
                min-width: 65px !important;
                flex-shrink: 0 !important;
            }
            .rpa-ai-field input, .rpa-ai-field textarea {
                background: rgba(255,255,255,0.04) !important;
                border: 1px solid rgba(255,255,255,0.06) !important;
                border-radius: 4px !important;
                padding: 2px 6px !important;
                color: #e2e8f0 !important;
                font-size: 11px !important;
                font-family: inherit !important;
                width: 100% !important;
                min-width: 0 !important;
            }
            .rpa-ai-field input:focus, .rpa-ai-field textarea:focus {
                border-color: #38bdf8 !important;
                outline: none !important;
                box-shadow: 0 0 0 2px rgba(56,189,248,0.1) !important;
            }
            
            .rpa-footer {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                padding: 6px 12px !important;
                background: rgba(255,255,255,0.02) !important;
                border-top: 1px solid rgba(255,255,255,0.05) !important;
                flex-shrink: 0 !important;
                gap: 8px !important;
            }
            .rpa-status-text {
                font-size: 11px !important;
                color: #94a3b8 !important;
                flex: 1 !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
            }
            .rpa-version {
                font-size: 10px !important;
                color: #475569 !important;
                flex-shrink: 0 !important;
            }
            .rpa-progress-wrap {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                flex-shrink: 0 !important;
            }
            .rpa-progress-bar {
                width: 100px !important;
                height: 4px !important;
                background: rgba(255,255,255,0.06) !important;
                border-radius: 2px !important;
                overflow: hidden !important;
            }
            .rpa-progress-fill {
                height: 100% !important;
                background: linear-gradient(90deg, #38bdf8, #818cf8) !important;
                border-radius: 2px !important;
                transition: width 0.3s !important;
                width: 0% !important;
            }
            .rpa-progress-text {
                font-size: 11px !important;
                color: #94a3b8 !important;
                min-width: 50px !important;
                text-align: right !important;
            }
            
            /* Log panel (collapsible) */
            .rpa-log-toggle {
                color: #64748b !important;
                cursor: pointer !important;
                font-size: 11px !important;
                padding: 2px 6px !important;
                border-radius: 4px !important;
            }
            .rpa-log-toggle:hover {
                background: rgba(255,255,255,0.05) !important;
                color: #94a3b8 !important;
            }
            .rpa-log-panel {
                max-height: 0 !important;
                overflow-y: auto !important;
                transition: max-height 0.3s !important;
                background: rgba(0,0,0,0.2) !important;
                border-radius: 8px !important;
                flex-shrink: 0 !important;
            }
            .rpa-log-panel.open {
                max-height: 120px !important;
                padding: 6px 8px !important;
                margin-top: 4px !important;
            }
            .rpa-log-panel::-webkit-scrollbar { width: 4px !important; }
            .rpa-log-panel::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.2) !important; border-radius: 2px !important; }
            .rpa-log-entry {
                font-size: 10px !important;
                color: #94a3b8 !important;
                padding: 1px 0 !important;
                line-height: 1.6 !important;
                border-bottom: 1px solid rgba(255,255,255,0.02) !important;
                font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
            }
            .rpa-log-entry:last-child { border-bottom: none !important; }
            .rpa-log-time { color: #475569 !important; margin-right: 4px !important; }
        `);

        // HTML
        const hub = document.createElement('div');
        hub.id = 'idesk-rpa-hub';
        hub.innerHTML = `
            <div class="rpa-header">
                <div class="rpa-title">
                    ⚡ iDesk RPA <span class="badge-count" id="rpa-doc-count">0</span>
                </div>
                <div class="rpa-header-actions">
                    <button id="rpa-btn-toggle-log" title="Log">📋</button>
                    <button id="rpa-btn-minimize" title="Thu nhỏ">➖</button>
                </div>
            </div>
            <div class="rpa-body">
                <div class="rpa-toolbar">
                    <button class="rpa-btn rpa-btn-primary" id="rpa-btn-scan">🔄 Quét &amp; Gửi AI</button>
                    <button class="rpa-btn rpa-btn-purple" id="rpa-btn-fill-all">⚡ Tự động điền</button>
                    <button class="rpa-btn rpa-btn-sm rpa-btn-outline" id="rpa-btn-select-all">☑ Chọn/Bỏ</button>
                    <div style="flex:1"></div>
                    <span style="font-size:11px;color:#64748b;" id="rpa-config-display">⚙️</span>
                </div>
                <div class="rpa-table-wrap">
                    <table class="rpa-table" id="rpa-doc-table">
                        <thead>
                            <tr>
                                <th style="width:24px;"><input type="checkbox" id="rpa-check-all" checked></th>
                                <th style="width:70px;">Số hiệu</th>
                                <th style="width:50px;">Loại VB</th>
                                <th style="width:85px;">CQ Ban hành</th>
                                <th style="width:65px;">Ngày VB</th>
                                <th style="width:60px;">Người ký</th>
                                <th>Trích yếu</th>
                                <th style="width:120px;">Tóm tắt</th>
                                <th style="width:90px;">ĐV xử lý</th>
                                <th style="width:90px;">LĐ theo dõi</th>
                                <th style="width:75px;">Hạn TH</th>
                                <th style="width:90px;">ĐV phối hợp</th>
                                <th style="width:80px;">Ghi chú</th>
                                <th style="width:75px;">Trạng thái</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td colspan="14" style="text-align:center;color:#64748b;padding:30px;">⟳ Nhấn "Quét & Gửi AI" để bắt đầu...</td></tr>
                        </tbody>
                    </table>
                </div>

                <div class="rpa-log-panel" id="rpa-log-panel">
                    <div id="rpa-log-body"></div>
                </div>
            </div>
            <div class="rpa-footer">
                <span class="rpa-status-text" id="rpa-footer-status">Sẵn sàng. Nhấn "Quét & Gửi AI" để bắt đầu.</span>
                <div class="rpa-progress-wrap">
                    <span class="rpa-progress-text" id="rpa-progress-text">0/0</span>
                    <div class="rpa-progress-bar"><div class="rpa-progress-fill" id="rpa-progress-fill"></div></div>
                </div>
                <span class="rpa-version">v2.0</span>
            </div>
        `;
        document.body.appendChild(hub);
        logPanel = document.getElementById('rpa-log-panel');

        // Drag
        makeDraggable(hub);

        // Events
        document.getElementById('rpa-btn-minimize').addEventListener('click', () => {
            hub.classList.toggle('minimized');
        });
        document.getElementById('rpa-btn-toggle-log').addEventListener('click', () => {
            logPanel.classList.toggle('open');
        });
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

        appendLog('🚀 iDesk RPA v2.0 khởi tạo thành công');
    };

    // ============================================================
    // 15. DRAG
    // ============================================================
    const makeDraggable = (elmnt) => {
        const header = elmnt.querySelector('.rpa-header');
        let startX, startY, startTop, startLeft, dragging = false;
        let animationFrameId = null;

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
            header.style.cursor = 'grabbing';
            e.preventDefault();
        });

        header.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }

            animationFrameId = requestAnimationFrame(() => {
                const newLeft = Math.min(Math.max(startLeft + dx, -elmnt.offsetWidth + 80), window.innerWidth - 60);
                const newTop = Math.min(Math.max(startTop + dy, 0), window.innerHeight - 50);
                elmnt.style.left = newLeft + 'px';
                elmnt.style.top = newTop + 'px';
            });
        });

        const stop = (e) => {
            if (!dragging) return;
            dragging = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            elmnt.classList.remove('rpa-dragging');
            header.style.cursor = 'grab';
            try { header.releasePointerCapture(e.pointerId); } catch (err) {}
        };
        header.addEventListener('pointerup', stop);
        header.addEventListener('pointercancel', stop);
    };

    // ============================================================
    // 16. UPDATE DASHBOARD TABLE
    // ============================================================
    const updateDashboard = () => {
        const tbody = document.querySelector('#rpa-doc-table tbody');
        if (!tbody) return;

        const countEl = document.getElementById('rpa-doc-count');
        if (countEl) countEl.textContent = docCache.size.toString();

        if (docCache.size === 0) {
            tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;color:#64748b;padding:30px;">⟳ Nhấn "Quét & Gửi AI" để bắt đầu...</td></tr>`;
            return;
        }

        let html = '';
        docCache.forEach((doc, id) => {
            const statusMap = {
                'idle': ['rpa-badge-idle', '🔵 Chưa gửi AI'],
                'pending': ['rpa-badge-pending', '🟡 Đang gửi AI...'],
                'ai_done': ['rpa-badge-success', '✅ Đã phân tích'],
                'ai_error': ['rpa-badge-error', '❌ Lỗi AI'],
                'fill_done': ['rpa-badge-sent', '💜 Đã điền'],
                'fill_error': ['rpa-badge-error', '❌ Lỗi điền'],
            };
            const s = statusMap[doc.status] || statusMap.idle;
            const rowClass = doc.status === 'pending' ? 'rpa-row-processing' :
                             doc.status === 'ai_done' || doc.status === 'fill_done' ? 'rpa-row-done' :
                             doc.status === 'ai_error' || doc.status === 'fill_error' ? 'rpa-row-error' : '';

            // Format các trường FE, fallback cho giá trị trống
            const signNumber = doc.signNumber || '---';
            const category = doc.category || '---';
            const author = doc.author || '---';
            const docDate = doc.docDateStr || '---';
            const signer = doc.signer || '---';
            const subject = doc.subject || '';

            // Trích xuất AI fields từ doc.aiData theo schema METADATA_SCHEMA.md
            const ai = doc.aiData || {};
            const summary = ai.summary || '---';
            const processingUnit = ai.processing_unit || '---';
            const monitoringLeader = ai.monitoring_leader || '---';
            const implementationDeadline = ai.implementation_deadline || '---';
            const coordinatingUnits = (ai.coordinating_units && Array.isArray(ai.coordinating_units) && ai.coordinating_units.length > 0)
                ? ai.coordinating_units.join(', ')
                : '---';
            const notes = ai.notes || '---';

            html += `
                <tr data-id="${id}" class="${rowClass}">
                    <td><input type="checkbox" class="rpa-row-check" data-id="${id}" ${doc.status === 'fill_done' ? '' : 'checked'}></td>
                    <td><div class="rpa-doc-cell rpa-doc-cell-title" title="${signNumber}">${signNumber}</div></td>
                    <td><div class="rpa-doc-cell" title="${category}">${category}</div></td>
                    <td><div class="rpa-doc-cell" title="${author}">${author}</div></td>
                    <td><div class="rpa-doc-cell" title="${docDate}">${docDate}</div></td>
                    <td><div class="rpa-doc-cell" title="${signer}">${signer}</div></td>
                    <td><div class="rpa-subject-preview" title="${subject}">${subject.substring(0, 80)}${subject.length > 80 ? '...' : ''}</div></td>
                    <td><div class="rpa-doc-cell-sub" title="${summary}">${summary}</div></td>
                    <td><div class="rpa-doc-cell" title="${processingUnit}">${processingUnit}</div></td>
                    <td><div class="rpa-doc-cell" title="${monitoringLeader}">${monitoringLeader}</div></td>
                    <td><div class="rpa-doc-cell rpa-doc-cell-title" title="${implementationDeadline}">${implementationDeadline}</div></td>
                    <td><div class="rpa-doc-cell" title="${coordinatingUnits}">${coordinatingUnits}</div></td>
                    <td><div class="rpa-doc-cell-sub" title="${notes}">${notes}</div></td>
                    <td><span class="rpa-badge ${s[0]}">${s[1]}</span></td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    };


    // ============================================================
    // 17. QUÉT DANH SÁCH + TỰ ĐỘNG GỬI AI CHO TẤT CẢ VĂN BẢN CHƯA GỬI
    // ============================================================
    // Gộp 2 bước cũ (Quét -> bấm "Gửi AI tất cả") thành 1 hành động duy nhất:
    // người dùng chỉ cần bấm "Quét & Gửi AI" 1 lần, script tự quét toàn bộ
    // danh sách đang hiển thị rồi tự động gửi hết các văn bản chưa gửi (status
    // 'idle') sang AI backend, không cần chọn checkbox hay bấm thêm nút nào.
    const scanAndSendAll = async () => {
        if (isProcessing) {
            alert('Hệ thống đang xử lý, vui lòng đợi!');
            return;
        }

        // Bước 1: quét danh sách hiện có trên DOM (chỉ chạy khi người dùng chủ động bấm)
        const found = await scanList(5);
        if (!found) return;

        // Bước 2: lấy toàn bộ văn bản đang ở trạng thái "idle" (chưa từng gửi AI)
        // Văn bản đã 'ai_done'/'fill_done' từ lần quét trước sẽ không bị gửi lại.
        const pendingIds = [];
        docCache.forEach((doc, id) => {
            if (doc.status === 'idle') pendingIds.push(id);
        });

        if (pendingIds.length === 0) {
            setStatus(`📋 Đã quét ${docCache.size} văn bản, không có văn bản mới cần gửi AI.`);
            return;
        }

        isProcessing = true;
        let success = 0, errors = 0;
        const total = pendingIds.length;
        updateProgress(0, total);
        setStatus(`📤 Tự động gửi ${total} văn bản đến AI backend...`);

        for (let i = 0; i < pendingIds.length; i++) {
            const id = pendingIds[i];
            const doc = docCache.get(id);
            if (!doc) continue;

            doc.status = 'pending';
            updateDashboard();
            updateProgress(i, total);

            try {
                // Đảm bảo có đủ thông tin (click + fetch)
                const fullDoc = await ensureDocDetails(id);
                if (fullDoc.attachments && fullDoc.attachments.length > 0) {
                    const aiResult = await callAIBackend(fullDoc);
                    doc.aiData = aiResult;
                    doc.status = 'ai_done';
                    success++;
                } else {
                    // Thử tải file từ DOM (view.cpx trả về đã có attachments)
                    appendLog(`⚠️ VB ${doc.signNumber} không có file đính kèm - thử tải lại...`);
                    // Retry view
                    if (doc.creatorAcode) {
                        const resp = await fetch(`/cumphumy/smartcloud/document/edocs/view.cpx?exeacode=${doc.creatorAcode}&id=${id}`);
                        const data = await resp.json();
                        handleViewResponse(data);
                        const retryDoc = docCache.get(id);
                        if (retryDoc && retryDoc.attachments && retryDoc.attachments.length > 0) {
                            const aiResult = await callAIBackend(retryDoc);
                            doc.aiData = aiResult;
                            doc.status = 'ai_done';
                            success++;
                        } else {
                            throw new Error('VB không có file PDF đính kèm sau khi retry');
                        }
                    } else {
                        throw new Error('VB không có creatorAcode và không có file đính kèm');
                    }
                }
            } catch (err) {
                doc.status = 'ai_error';
                doc.errorMsg = err.message;
                errors++;
                appendLog(`❌ ${doc.signNumber}: ${err.message}`);
            }
            updateDashboard();
            updateProgress(i + 1, total);
        }

        isProcessing = false;
        setStatus(`✅ Hoàn tất AI: ${success} thành công, ${errors} lỗi`);
        updateProgress(total, total);
    };

    // ============================================================
    // 18. TỰ ĐỘNG ĐIỀN CHO TẤT CẢ ĐÃ CHỌN
    // ============================================================
    const runFillOnAll = async () => {
        if (isProcessing) {
            alert('Hệ thống đang xử lý, vui lòng đợi!');
            return;
        }

        const checkboxes = document.querySelectorAll('.rpa-row-check:checked');
        if (checkboxes.length === 0) {
            alert('Hãy chọn ít nhất 1 văn bản!');
            return;
        }

        // Kiểm tra có doc nào chưa có aiData không
        let missingAI = 0;
        checkboxes.forEach(chk => {
            const id = chk.getAttribute('data-id');
            const doc = docCache.get(id);
            if (!doc || !doc.aiData) missingAI++;
        });

        if (missingAI > 0) {
            const proceed = confirm(`⚠️ ${missingAI}/${checkboxes.length} văn bản chưa được gửi AI (hoặc chưa có dữ liệu xử lý).\nBạn có muốn tiếp tục với dữ liệu hiện tại (có thể sửa tay trên bảng)?`);
            if (!proceed) return;
        }

        const proceed = confirm(`🚀 Bắt đầu TỰ ĐỘNG ĐIỀN cho ${checkboxes.length} văn bản?\nQuá trình này sẽ thao tác trực tiếp trên giao diện iDesk.`);
        if (!proceed) return;

        isProcessing = true;
        let success = 0, errors = 0;
        const total = checkboxes.length;
        updateProgress(0, total);

        for (let i = 0; i < checkboxes.length; i++) {
            const chk = checkboxes[i];
            const id = chk.getAttribute('data-id');
            const doc = docCache.get(id);
            if (!doc || !doc.aiData) {
                errors++;
                appendLog(`⚠️ Bỏ qua VB ${id}: chưa có dữ liệu AI`);
                updateProgress(i + 1, total);
                continue;
            }

            setStatus(`⚡ Đang tự động điền: ${doc.signNumber || id} (${i + 1}/${total})`);
            updateProgress(i, total);
            chk.closest('tr').scrollIntoView({ behavior: 'smooth', block: 'center' });

            try {
                await autoFillAndSubmit(id, doc.aiData);
                doc.status = 'fill_done';
                success++;
                chk.checked = false;
                appendLog(`✅ Hoàn tất: ${doc.signNumber}`);
            } catch (err) {
                doc.status = 'fill_error';
                doc.errorMsg = err.message;
                errors++;
                appendLog(`❌ Lỗi ${doc.signNumber}: ${err.message}`);
            }
            updateDashboard();
            updateProgress(i + 1, total);
            await sleep(CONFIG.DELAY_MS.BETWEEN_DOCS);
        }

        isProcessing = false;
        setStatus(`🏁 Kết thúc: ${success} thành công, ${errors} lỗi`);
        updateProgress(total, total);
        appendLog(`🏁 Kết thúc tự động điền: ${success}/${total} thành công`);
    };

    // ============================================================
    // 19. PROGRESS BAR
    // ============================================================
    const updateProgress = (current, total) => {
        const fill = document.getElementById('rpa-progress-fill');
        const text = document.getElementById('rpa-progress-text');
        if (fill && text) {
            const pct = total > 0 ? Math.round((current / total) * 100) : 0;
            fill.style.width = pct + '%';
            text.textContent = `${current}/${total}`;
        }
    };

    // ============================================================
    // 20. INIT
    // ============================================================
    const init = () => {
        console.log('=== iDesk RPA v2.0 starting ===');

        // Intercept AJAX
        interceptXHR();
        interceptFetch();

        // Đợi DOM sẵn sàng
        const waitAndStart = () => {
            if (!document.getElementById('received-document-widget')) {
                setTimeout(waitAndStart, 500);
                return;
            }
            createDashboard();
            appendLog('ℹ️ Chưa quét tự động. Bấm "Quét & Gửi AI" khi bạn muốn bắt đầu.');
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', waitAndStart);
        } else {
            waitAndStart();
        }
    };

    init();

})();