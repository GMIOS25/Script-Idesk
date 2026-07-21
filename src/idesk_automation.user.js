// ==UserScript==
// @name         iDesk RPA Auto-Fill v2.3 (Minimalist Pure Text)
// @namespace    http://inet.vn/
// @version      2.3.0
// @description  iDesk RPA: Giao diện Minimalist UI chuẩn (không icon/emoji), Tự động chọn Sổ văn bản đến theo backend AI, Tự động match file đính kèm theo số hiệu
// @author       Senior Developer
// @match        https://vpdt.gialai.gov.vn/*/smartcloud/idesk6/page/paperwork/index.cpx*
// @match        https://vpdt.gialai.gov.vn/*/smartcloud/idesk6/page/paperwork/*
// @match        https://vpdt.gialai.gov.vn/*/smartcloud/*
// @icon         https://vpdt.gialai.gov.vn/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/GMIOS25/Script-Idesk/main/src/idesk_automation.user.js
// @updateURL    https://raw.githubusercontent.com/GMIOS25/Script-Idesk/main/src/idesk_automation.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // 1. CONFIGURATION
    // ============================================================
    const CONFIG = {
        BACKEND_URL: 'http://localhost:5000/api/process-doc',
        DEFAULT_BOOK: 'Số văn bản đến UBND tỉnh',
        DELAY_MS: {
            SELECT_DOC: 1000,
            OPEN_SELECT2: 350,
            AFTER_BOOK_SELECT: 700,
            CLICK_SAVE_TRANSFER: 1200,
            OPEN_TREE: 800,
            TREE_SEARCH: 500,
            CLOSE_TREE: 350,
            AFTER_SUBMIT: 1800,
            BETWEEN_DOCS: 800
        }
    };

    const S = {
        LEFT_LIST: '#listview-process-list-list-content div.messageListItem',
        LEFT_LIST_FALLBACK: 'div.messageListItem[data-id]',
        SHOW_MORE: '#edocs-btn-hide-show-more-info',
        BOOK_INPUT: '#edocs-txt-book',
        SAVE_TRANSFER_BTN: '#ed-view-btn-transfer',
        TRANSFER_CONTAINER: '#ed-transfer-document-container',
        RESPONSIBLE_LINK: '#ed-transfer-select-user-responsible a.user-box-link',
        RESPONSIBLE_WRAP: '#ed-transfer-select-user-responsible',
        PARTICIPANTS_LINK: '#ed-transfer-select-user-participants a.user-box-link',
        PARTICIPANTS_WRAP: '#ed-transfer-select-user-participants',
        DEADLINE_INPUT: '#ed-transfer-txt-deadline',
        DEADLINE_NUMBER: '#ed-transfer-txt-deadline-number',
        AGREE_BTN: '#ed-transfer-btn-transfer'
    };

    // ============================================================
    // 2. STATE & CACHE
    // ============================================================
    const docCache = new Map();     // Map<id, DocObject>
    const unitCache = new Map();    // Map<id, UnitObject> (từ fbyvsphere.cpx)
    const expandedRows = new Set(); // Set<id> các bản ghi đang mở chi tiết
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

    const formatDate = (date) => {
        const d = date || new Date();
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    };

    const calcDeadline = (days) => {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(days));
        return formatDate(date);
    };

    const getSelect2Container = (originalFieldId) => {
        const hiddenEl = document.querySelector(originalFieldId);
        if (!hiddenEl) return null;
        const prev = hiddenEl.previousElementSibling;
        if (prev && prev.classList.contains('select2-container')) return prev;
        const next = hiddenEl.nextElementSibling;
        if (next && next.classList.contains('select2-container')) return next;
        const parent = hiddenEl.closest('.row-fluid, .span4, .span3, div');
        return parent ? parent.querySelector('.select2-container') : null;
    };

    const getVisibleItems = () => {
        let items = Array.from(document.querySelectorAll(S.LEFT_LIST));
        if (items.length === 0) items = Array.from(document.querySelectorAll(S.LEFT_LIST_FALLBACK));
        return items.filter(el => el.offsetParent !== null);
    };

    // ============================================================
    // 4. ATTACHMENT SELECTION LOGIC
    // ============================================================
    const selectAttachment = (doc) => {
        const attachments = doc.attachments || [];
        if (attachments.length === 0) return null;

        const signNumber = doc.signNumber || '';
        const leadingMatch = signNumber.match(/^\s*(\d+)/) || signNumber.match(/(\d+)/);
        const signDigits = leadingMatch ? leadingMatch[1] : null;

        if (signDigits) {
            const matchedByNum = attachments.find(att => {
                const name = att.name || '';
                const attDigitsMatch = name.match(/^\s*(\d+)/) || name.match(/(\d+)/);
                return attDigitsMatch && attDigitsMatch[1] === signDigits;
            });
            if (matchedByNum) {
                appendLog(`Match file dinh kem theo so dau "${signDigits}": ${matchedByNum.name}`);
                return matchedByNum;
            }
        }

        const matchedSigned = attachments.find(att => att.signed === 'Y');
        if (matchedSigned) {
            appendLog(`Fallback chon file da ky (signed="Y"): ${matchedSigned.name}`);
            return matchedSigned;
        }

        const pdfAttach = attachments.find(att => att.format === 'pdf' || (att.name || '').toLowerCase().endsWith('.pdf'));
        const fallback = pdfAttach || attachments[0];
        appendLog(`Fallback mac dinh chon file: ${fallback ? fallback.name : 'N/A'}`);
        return fallback;
    };

    // ============================================================
    // 5. NETWORK INTERCEPTOR
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
                    if (url.includes('qsprocess.cpx')) {
                        handleListResponse(JSON.parse(this.responseText));
                    } else if (url.includes('view.cpx') && url.includes('exeacode=')) {
                        handleViewResponse(JSON.parse(this.responseText));
                    } else if (url.includes('fbyvsphere.cpx')) {
                        handleUnitsResponse(JSON.parse(this.responseText));
                    }
                } catch (e) { /* silent */ }
            });
            return origSend.apply(this, arguments);
        };
    };

    const interceptFetch = () => {
        const origFetch = unsafeWindow.fetch.bind(unsafeWindow);
        unsafeWindow.fetch = function(input, init) {
            const url = typeof input === 'string' ? input : (input.url || '');
            return origFetch(input, init).then(async (response) => {
                if (url.includes('qsprocess.cpx') || url.includes('view.cpx') || url.includes('fbyvsphere.cpx')) {
                    const clone = response.clone();
                    try {
                        const data = await clone.json();
                        if (url.includes('qsprocess.cpx')) handleListResponse(data);
                        else if (url.includes('view.cpx')) handleViewResponse(data);
                        else if (url.includes('fbyvsphere.cpx')) handleUnitsResponse(data);
                    } catch (e) { /* silent */ }
                }
                return response;
            }).catch(err => { throw err; });
        };
    };

    // ============================================================
    // 6. RESPONSE HANDLERS
    // ============================================================
    const handleListResponse = (data) => {
        if (!data || !data.items) return;
        appendLog(`API qsreceiving: ${data.items.length} van ban`);
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

        docCache.set(id, doc);
        updateDashboard();
    };

    const handleUnitsResponse = (data) => {
        if (!data || !data.elements) return;
        data.elements.forEach(unit => unitCache.set(unit.id, unit));
        appendLog(`API fbyvsphere: Cap nhat ${data.elements.length} don vi/ca nhan xu ly`);
    };

    // ============================================================
    // 7. DOWNLOAD PDF & CALL AI
    // ============================================================
    const downloadPDF = (contentUid, fileName) => {
        return new Promise((resolve, reject) => {
            const url = `/cumphumy/smartcloud/docx/download.cpx?docID=${contentUid}&view=pdf&t=${Date.now()}`;
            setStatus(`Dang tai PDF: ${fileName}...`);

            GM_xmlhttpRequest({
                method: 'GET',
                url: window.location.origin + url,
                responseType: 'blob',
                onload: (resp) => {
                    if (resp.status >= 200 && resp.status < 300) {
                        const blob = resp.response;
                        resolve(new File([blob], fileName || `doc_${contentUid}.pdf`, {
                            type: blob.type || 'application/pdf'
                        }));
                    } else {
                        reject(new Error(`Download HTTP ${resp.status}`));
                    }
                },
                onerror: (err) => reject(new Error(`Loi ket noi download: ${err}`)),
                ontimeout: () => reject(new Error('Timeout download PDF'))
            });
        });
    };

    const ensureDocDetails = async (id) => {
        let doc = docCache.get(id.toString()) || { id: id.toString(), status: 'idle' };
        docCache.set(id.toString(), doc);

        if (!doc.creatorAcode || !doc.attachments || doc.attachments.length === 0) {
            const itemEl = document.querySelector(`.messageListItem[data-id="${id}"]`);
            if (itemEl && !itemEl.classList.contains('selected')) {
                itemEl.click();
                await sleep(CONFIG.DELAY_MS.SELECT_DOC);
                doc = docCache.get(id.toString()) || doc;
            }
        }

        if (doc.creatorAcode && (!doc.attachments || doc.attachments.length === 0)) {
            try {
                const resp = await fetch(`/cumphumy/smartcloud/document/edocs/view.cpx?exeacode=${doc.creatorAcode}&id=${id}`);
                if (resp.ok) {
                    handleViewResponse(await resp.json());
                    doc = docCache.get(id.toString()) || doc;
                }
            } catch (e) {
                appendLog(`Fetch view.cpx cho ${id} loi: ${e.message}`);
            }
        }

        return doc;
    };

    const callAIBackend = async (doc) => {
        const targetAttach = selectAttachment(doc);
        if (!targetAttach) {
            throw new Error(`Khong tim thay file dinh kem phu hop cho VB "${doc.signNumber}"`);
        }

        const pdfFile = await downloadPDF(targetAttach.contentUid, targetAttach.name);
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
            setStatus(`Gui "${doc.signNumber}" den AI...`);

            GM_xmlhttpRequest({
                method: 'POST',
                url: CONFIG.BACKEND_URL,
                data: formData,
                onload: (resp) => {
                    if (resp.status === 200) {
                        try {
                            const result = JSON.parse(resp.responseText);
                            appendLog(`AI phan hoi cho "${doc.signNumber}": ${JSON.stringify(result)}`);
                            resolve(result);
                        } catch (e) {
                            reject(new Error(`Parse JSON loi: ${e.message}`));
                        }
                    } else {
                        reject(new Error(`Backend HTTP ${resp.status}: ${resp.responseText}`));
                    }
                },
                onerror: () => reject(new Error(`Khong ket noi duoc AI (${CONFIG.BACKEND_URL})`)),
                ontimeout: () => reject(new Error('Timeout goi AI backend'))
            });
        });
    };

    // ============================================================
    // 8. IDESK FORM AUTOMATION (DYNAMIC SỔ VĂN BẢN ĐẾN FROM BACKEND)
    // ============================================================
    const selectBook = async (bookName) => {
        const container = getSelect2Container(S.BOOK_INPUT);
        if (!container) throw new Error('Khong thay Select2 cua So van ban den');

        const trigger = container.querySelector('.select2-choice');
        if (!trigger) throw new Error('Khong tim thay nut chon So van ban');

        const currentText = trigger.querySelector('.select2-chosen')?.textContent?.trim() || '';
        if (currentText === bookName) return;

        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await sleep(CONFIG.DELAY_MS.OPEN_SELECT2);

        const drop = document.getElementById('select2-drop');
        if (!drop) throw new Error('Khong mo duoc dropdown Select2');

        const items = drop.querySelectorAll('ul.select2-results li');
        let target = Array.from(items).find(li => li.textContent.trim() === bookName) ||
                     Array.from(items).find(li => li.textContent.trim().includes(bookName)) ||
                     items[0];

        if (target) {
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            await sleep(CONFIG.DELAY_MS.AFTER_BOOK_SELECT);
            appendLog(`Da chon so van ban den: "${target.textContent.trim()}"`);
        } else {
            document.body.click();
            throw new Error('Khong tim thay so van ban den phu hop!');
        }
    };

    const selectTreeItem = async (linkSelector, wrapSelector, targetName) => {
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

    const autoFillAndSubmit = async (docId, aiData) => {
        const itemEl = document.querySelector(`.messageListItem[data-id="${docId}"]`);
        if (!itemEl) throw new Error(`Khong tim thay VB ID ${docId}`);

        if (!itemEl.classList.contains('selected')) {
            itemEl.click();
            await sleep(CONFIG.DELAY_MS.SELECT_DOC);
        }

        const showMoreBtn = document.querySelector(S.SHOW_MORE);
        if (showMoreBtn && showMoreBtn.textContent.includes('Hien thi them')) {
            showMoreBtn.click();
            await sleep(200);
        }

        // Dynamic Sổ văn bản đến phân tích từ Backend
        const targetBook = aiData.so_van_ban || aiData.book_name || CONFIG.DEFAULT_BOOK;
        appendLog(`Chon So van ban den: ${targetBook}`);
        await selectBook(targetBook);

        const saveTransferBtn = document.querySelector(S.SAVE_TRANSFER_BTN);
        if (!saveTransferBtn) throw new Error('Khong tim thay nut "Luu va chuyen"');
        if (saveTransferBtn.disabled) {
            for (let i = 0; i < 10; i++) {
                await sleep(500);
                if (!saveTransferBtn.disabled) break;
            }
        }
        if (saveTransferBtn.disabled) throw new Error('Nut "Luu va chuyen" khong enable!');

        saveTransferBtn.click();
        appendLog('Da click "Luu va chuyen"');
        await sleep(CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER);

        if (!document.querySelector(S.TRANSFER_CONTAINER)) {
            for (let i = 0; i < 5; i++) {
                await sleep(500);
                if (document.querySelector(S.TRANSFER_CONTAINER)) break;
            }
        }
        if (!document.querySelector(S.TRANSFER_CONTAINER)) {
            throw new Error('Khong thay form Thong tin xu ly!');
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

        const agreeBtn = document.querySelector(S.AGREE_BTN);
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

    const scanList = async (retries = 3) => {
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

    // ============================================================
    // 9. MINIMALIST UI DASHBOARD SYSTEM (PURE TEXT, ZERO ICONS)
    // ============================================================
    const createDashboard = () => {
        if (document.getElementById('idesk-rpa-hub')) return;

        GM_addStyle(`
            /* ===== iDesk RPA Minimalist UI v2.3 (Pure Text) ===== */
            #idesk-rpa-hub {
                position: fixed !important;
                bottom: 20px !important;
                right: 20px !important;
                width: min(1680px, 95vw) !important;
                height: min(680px, 85vh) !important;
                background: #121212 !important;
                border: 1px solid #282828 !important;
                border-radius: 8px !important;
                box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35) !important;
                color: #EAEAEA !important;
                font-family: 'SF Pro Display', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                z-index: 999999 !important;
                display: flex !important;
                flex-direction: column !important;
                overflow: hidden !important;
                font-size: 13px !important;
                line-height: 1.5 !important;
                transition: width 0.25s ease, height 0.25s ease, border-radius 0.25s ease !important;
                user-select: none !important;
            }
            #idesk-rpa-hub.rpa-dragging { transition: none !important; }
            #idesk-rpa-hub * { box-sizing: border-box !important; }

            #idesk-rpa-hub.minimized {
                width: 340px !important;
                height: 42px !important;
                border-radius: 6px !important;
            }
            #idesk-rpa-hub.minimized .rpa-body,
            #idesk-rpa-hub.minimized .rpa-footer { display: none !important; }

            .rpa-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                padding: 10px 16px !important;
                background: #181818 !important;
                border-bottom: 1px solid #262626 !important;
                cursor: grab !important;
                min-height: 42px !important;
            }
            .rpa-header:active { cursor: grabbing !important; }

            .rpa-title {
                font-weight: 600 !important;
                font-size: 14px !important;
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                color: #FFFFFF !important;
                letter-spacing: -0.01em !important;
            }
            .rpa-title .badge-count {
                background: #262626 !important;
                color: #A1A1AA !important;
                font-size: 11px !important;
                padding: 1px 8px !important;
                border-radius: 9999px !important;
                font-family: 'Geist Mono', 'SF Mono', monospace !important;
            }

            .rpa-header-actions { display: flex !important; gap: 6px !important; }
            .rpa-header-actions button {
                background: transparent !important;
                border: 1px solid #2A2A2A !important;
                color: #A1A1AA !important;
                cursor: pointer !important;
                padding: 4px 10px !important;
                border-radius: 4px !important;
                font-size: 11px !important;
                transition: all 0.15s !important;
            }
            .rpa-header-actions button:hover {
                background: #262626 !important;
                color: #FFFFFF !important;
            }

            .rpa-body {
                flex: 1 !important;
                padding: 14px !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 12px !important;
                overflow: hidden !important;
            }

            .rpa-toolbar {
                display: flex !important;
                gap: 10px !important;
                align-items: center !important;
            }

            .rpa-btn {
                background: #1A1A1A !important;
                border: 1px solid #333333 !important;
                color: #EAEAEA !important;
                border-radius: 4px !important;
                padding: 8px 18px !important;
                font-weight: 500 !important;
                font-size: 13px !important;
                cursor: pointer !important;
                display: inline-flex !important;
                align-items: center !important;
                transition: background 0.15s, transform 0.1s !important;
            }
            .rpa-btn:hover { background: #262626 !important; color: #FFFFFF !important; }
            .rpa-btn:active { transform: scale(0.98) !important; }

            .rpa-btn-primary {
                background: #FFFFFF !important;
                color: #111111 !important;
                border: 1px solid #FFFFFF !important;
                font-weight: 600 !important;
            }
            .rpa-btn-primary:hover { background: #E5E5E5 !important; }

            .rpa-btn-purple {
                background: #EAEAEA !important;
                color: #111111 !important;
                border: 1px solid #EAEAEA !important;
                font-weight: 600 !important;
            }
            .rpa-btn-purple:hover { background: #D4D4D4 !important; }

            .rpa-btn-outline {
                background: transparent !important;
                border: 1px solid #2E2E2E !important;
                color: #A1A1AA !important;
            }
            .rpa-btn-outline:hover { border-color: #444444 !important; color: #FFFFFF !important; }

            /* Table & Accordion Rows */
            .rpa-table-wrap {
                flex: 1 !important;
                overflow-y: auto !important;
                border: 1px solid #262626 !important;
                border-radius: 6px !important;
                background: #121212 !important;
            }
            .rpa-table-wrap::-webkit-scrollbar { width: 6px !important; }
            .rpa-table-wrap::-webkit-scrollbar-thumb { background: #262626 !important; border-radius: 3px !important; }

            .rpa-table {
                width: 100% !important;
                border-collapse: collapse !important;
                font-size: 13px !important;
            }
            .rpa-table th {
                background: #181818 !important;
                color: #888888 !important;
                font-weight: 600 !important;
                padding: 10px 12px !important;
                position: sticky !important;
                top: 0 !important;
                z-index: 1 !important;
                border-bottom: 1px solid #262626 !important;
                font-size: 11px !important;
                text-transform: uppercase !important;
                letter-spacing: 0.05em !important;
                text-align: left !important;
            }

            .rpa-row-main {
                cursor: pointer !important;
                transition: background 0.15s !important;
            }
            .rpa-row-main:hover { background: #18181B !important; }
            .rpa-row-main.expanded { background: #1C1C1F !important; }

            .rpa-row-main td {
                padding: 12px 12px !important;
                border-bottom: 1px solid #222225 !important;
                vertical-align: middle !important;
                color: #E4E4E7 !important;
            }

            .rpa-doc-code {
                font-family: 'Geist Mono', 'SF Mono', monospace !important;
                font-weight: 600 !important;
                color: #FFFFFF !important;
                font-size: 13px !important;
            }
            .rpa-doc-text {
                max-width: 320px !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
                color: #D4D4D8 !important;
                line-height: 1.5 !important;
            }

            .rpa-toggle-text {
                font-family: 'Geist Mono', 'SF Mono', monospace !important;
                font-size: 11px !important;
                color: #71717A !important;
            }

            /* Detail Drawer Dropdown Panel */
            .rpa-row-detail {
                background: #161618 !important;
                border-bottom: 1px solid #262626 !important;
            }
            .rpa-row-detail td {
                padding: 16px 20px !important;
            }
            .rpa-detail-grid {
                display: grid !important;
                grid-template-columns: repeat(3, 1fr) !important;
                gap: 14px 24px !important;
                background: #111113 !important;
                padding: 16px !important;
                border-radius: 6px !important;
                border: 1px solid #242427 !important;
            }
            .rpa-detail-field {
                display: flex !important;
                flex-direction: column !important;
                gap: 4px !important;
            }
            .rpa-detail-field.span-2 { grid-column: span 2 !important; }
            .rpa-detail-field.span-full { grid-column: span 3 !important; }

            .rpa-detail-label {
                font-size: 11px !important;
                text-transform: uppercase !important;
                letter-spacing: 0.05em !important;
                color: #71717A !important;
                font-weight: 500 !important;
            }
            .rpa-detail-value {
                font-size: 13px !important;
                color: #E4E4E7 !important;
                line-height: 1.5 !important;
                word-break: break-word !important;
            }
            .rpa-detail-value.highlight {
                color: #FFFFFF !important;
                font-weight: 500 !important;
            }

            /* Status Badges */
            .rpa-badge {
                display: inline-flex !important;
                align-items: center !important;
                padding: 3px 10px !important;
                border-radius: 9999px !important;
                font-weight: 500 !important;
                font-size: 11px !important;
                letter-spacing: 0.03em !important;
                text-transform: uppercase !important;
            }
            .rpa-badge-idle { background: #27272A !important; color: #A1A1AA !important; }
            .rpa-badge-pending { background: #2E2211 !important; color: #F59E0B !important; }
            .rpa-badge-success { background: #14291B !important; color: #4ADE80 !important; }
            .rpa-badge-error { background: #2D1517 !important; color: #F87171 !important; }
            .rpa-badge-sent { background: #102030 !important; color: #60A5FA !important; }

            /* Footer & Log Panel */
            .rpa-footer {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                padding: 8px 16px !important;
                background: #181818 !important;
                border-top: 1px solid #262626 !important;
                gap: 16px !important;
            }
            .rpa-status-text {
                font-size: 12px !important;
                color: #A1A1AA !important;
                flex: 1 !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
            }
            .rpa-progress-wrap { display: flex !important; align-items: center !important; gap: 10px !important; }
            .rpa-progress-bar {
                width: 120px !important;
                height: 4px !important;
                background: #262626 !important;
                border-radius: 2px !important;
                overflow: hidden !important;
            }
            .rpa-progress-fill {
                height: 100% !important;
                background: #EAEAEA !important;
                width: 0% !important;
                transition: width 0.2s !important;
            }
            .rpa-progress-text {
                font-size: 11px !important;
                color: #A1A1AA !important;
                font-family: 'Geist Mono', 'SF Mono', monospace !important;
            }

            .rpa-log-panel {
                max-height: 0 !important;
                overflow-y: auto !important;
                transition: max-height 0.25s !important;
                background: #0D0D0D !important;
                border-radius: 4px !important;
            }
            .rpa-log-panel.open {
                max-height: 120px !important;
                padding: 8px 12px !important;
                border: 1px solid #262626 !important;
            }
            .rpa-log-entry {
                font-size: 11px !important;
                color: #888888 !important;
                font-family: 'Geist Mono', 'SF Mono', monospace !important;
                line-height: 1.6 !important;
            }
            .rpa-log-time { color: #555555 !important; margin-right: 8px !important; }
        `);

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

        // Event delegation cho click row tong the toggle drawer chi tiet
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

    const makeDraggable = (elmnt) => {
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

    const updateDashboard = () => {
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
            const bookName = ai.so_van_ban || ai.book_name || '---';
            const mainUnit = ai.don_vi_xu_ly || ai.processing_unit || '---';
            const leader = ai.lanh_dao_theo_doi || ai.monitoring_leader || '---';
            const days = ai.thoi_han_thuc_hien || ai.implementation_deadline;
            const daysStr = days ? `${days} ngay` : '---';
            const coUnits = ai.don_vi_phoi_hop || ai.coordinating_units;
            const coUnitsStr = (Array.isArray(coUnits) && coUnits.length > 0) ? coUnits.join(', ') : '---';
            const notes = ai.ghi_chu || ai.notes || '---';

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
                                    <span class="rpa-detail-label">So van ban den (AI chon)</span>
                                    <span class="rpa-detail-value highlight">${bookName}</span>
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
                                <div class="rpa-detail-field span-2">
                                    <span class="rpa-detail-label">Don vi phoi hop</span>
                                    <span class="rpa-detail-value">${coUnitsStr}</span>
                                </div>
                                <div class="rpa-detail-field">
                                    <span class="rpa-detail-label">Ghi chu</span>
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

    // ============================================================
    // 10. CONTROLLERS
    // ============================================================
    const scanAndSendAll = async () => {
        if (isProcessing) return alert('Dang xu ly, vui long cho!');

        const found = await scanList(4);
        if (!found) return;

        const pendingIds = [];
        docCache.forEach((doc, id) => { if (doc.status === 'idle') pendingIds.push(id); });

        if (pendingIds.length === 0) {
            setStatus(`Khong co van ban moi can gui AI.`);
            return;
        }

        isProcessing = true;
        let success = 0, errors = 0;
        const total = pendingIds.length;
        updateProgress(0, total);

        for (let i = 0; i < pendingIds.length; i++) {
            const id = pendingIds[i];
            const doc = docCache.get(id);
            if (!doc) continue;

            doc.status = 'pending';
            updateDashboard();
            updateProgress(i, total);

            try {
                const fullDoc = await ensureDocDetails(id);
                if (fullDoc.attachments && fullDoc.attachments.length > 0) {
                    doc.aiData = await callAIBackend(fullDoc);
                    doc.status = 'ai_done';
                    success++;
                } else {
                    throw new Error('Van ban khong co file dinh kem');
                }
            } catch (err) {
                doc.status = 'ai_error';
                errors++;
                appendLog(`${doc.signNumber}: ${err.message}`);
            }
            updateDashboard();
            updateProgress(i + 1, total);
        }

        isProcessing = false;
        setStatus(`Hoan tat AI: ${success} thanh cong, ${errors} loi`);
        updateProgress(total, total);
    };

    const runFillOnAll = async () => {
        if (isProcessing) return alert('Dang xu ly, vui long cho!');

        const checkboxes = document.querySelectorAll('.rpa-row-check:checked');
        if (checkboxes.length === 0) return alert('Hay chon it nhat 1 van ban!');

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
            updateDashboard();
            updateProgress(i + 1, total);
            await sleep(CONFIG.DELAY_MS.BETWEEN_DOCS);
        }

        isProcessing = false;
        setStatus(`Ket thuc tu dong dien: ${success}/${total} thanh cong`);
        updateProgress(total, total);
    };

    const updateProgress = (current, total) => {
        const fill = document.getElementById('rpa-progress-fill');
        const text = document.getElementById('rpa-progress-text');
        if (fill && text) {
            fill.style.width = (total > 0 ? Math.round((current / total) * 100) : 0) + '%';
            text.textContent = `${current}/${total}`;
        }
    };

    // ============================================================
    // 11. INIT
    // ============================================================
    const init = () => {
        interceptXHR();
        interceptFetch();

        const waitAndStart = () => {
            if (!document.getElementById('process-list-widget')) {
                setTimeout(waitAndStart, 400);
                return;
            }
            createDashboard();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', waitAndStart);
        } else {
            waitAndStart();
        }
    };

    init();

})();