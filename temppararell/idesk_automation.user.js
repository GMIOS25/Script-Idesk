// ==UserScript==
// @name         iDesk RPA Auto-Fill v3.0 (Role: Chủ tịch - Minimalist Pure Text)
// @namespace    http://inet.vn/
// @version      3.0.0
// @description  iDesk RPA cho role Chủ tịch/Lãnh đạo xử lý chính: crawl metadata (Số hiệu, Loại VB, CQ ban hành, Ngày VB, Người ký, Trích yếu) + auto match file đính kèm theo số hiệu, gửi AI, tự động điền "Xử lý chính/Phối hợp/Hạn xử lý" và bấm "Chuyển xử lý". Không còn bước chọn "Sổ văn bản đến" (văn bản đã được Văn thư vào sổ trước đó).
// @author       Senior Developer
// @match        https://vpdt.gialai.gov.vn/*/smartcloud/idesk6/page/paperwork/index.cpx*
// @match        https://vpdt.gialai.gov.vn/*/smartcloud/idesk6/page/paperwork/*
// @match        https://vpdt.gialai.gov.vn/*/smartcloud/*
// @icon         https://vpdt.gialai.gov.vn/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-end
// @downloadURL  https://raw.githubusercontent.com/GMIOS25/Script-Idesk/features/chairperson/src/idesk_automation.user.js
// @updateURL    https://raw.githubusercontent.com/GMIOS25/Script-Idesk/features/chairperson/src/idesk_automation.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================
    // 1. CONFIGURATION
    // ============================================================
    // Ghi chu: Backend AI hien tai (mock_backend.py, POST /api/process-doc) van dung hop dong
    // cu (v1.0). Tai lieu docs/en/API_CONTRACT.md ban 2.2 mo ta hop dong moi (lookup/process,
    // port 8000) nhung CHUA duoc trien khai o backend that/mock kem theo repo nay - vi vay
    // callAIBackend() ben duoi CHUA doi theo hop dong moi, giu nguyen de tuong thich voi
    // mock_backend.py hien co. Neu backend duoc nang cap len v2.2, can sua lai rieng.
    const CONFIG = {
        BACKEND_URL: 'http://localhost:5000/documents/process',
        AUTH_URL: 'http://localhost:5000/auth/token',
        DELAY_MS: {
            SELECT_DOC: 1000,
            CLICK_SAVE_TRANSFER: 1200,
            OPEN_TREE: 800,
            TREE_SEARCH: 500,
            CLOSE_TREE: 350,
            AFTER_SUBMIT: 1800,
            BETWEEN_DOCS: 800
        }
    };

    // Cac selector duoi day khop voi resource/"Chủ tịch role" (qsprocess.cpx, view.cpx,
    // left_panel.html, right_panel.html, right_panel_after_save_and_transfer.html) - DA doi
    // chieu truc tiep va CHINH XAC 100%: panel "Chuyen xu ly" dung chung 1 component
    // (id "ed-transfer-*") cho ca role Van thu lan Chu tich, chi khac o cach mo panel (Van thu
    // phai chon "So van ban den" truoc, Chu tich bam thang "Chuyen xu ly").
    const S = {
        LEFT_LIST: '#listview-process-list-list-content div.messageListItem',
        LEFT_LIST_FALLBACK: 'div.messageListItem[data-id]',
        // "Chuyen xu ly" trong man hinh chi tiet VB (resource/Chủ tịch role/right_panel.html, dong 33)
        SAVE_TRANSFER_BTN: '#ed-view-btn-transfer',
        // Panel hien ra sau khi bam "Chuyen xu ly" (resource/Chủ tịch role/right_panel_after_save_and_transfer.html)
        TRANSFER_CONTAINER: '#ed-transfer-document-container',
        RESPONSIBLE_LINK: '#ed-transfer-select-user-responsible a.user-box-link',
        RESPONSIBLE_WRAP: '#ed-transfer-select-user-responsible',
        PARTICIPANTS_LINK: '#ed-transfer-select-user-participants a.user-box-link',
        PARTICIPANTS_WRAP: '#ed-transfer-select-user-participants',
        DEADLINE_INPUT: '#ed-transfer-txt-deadline',
        DEADLINE_NUMBER: '#ed-transfer-txt-deadline-number',
        // "Doc thu" bo sung (chua tu dong dien, xem ghi chu trong autoFillAndSubmit)
        PRIORITY_SELECT: '#ed-transfer-select-priority',
        CONTENT_TEXTAREA: '#ed-transfer-txt-content',
        AGREE_BTN: '#ed-transfer-btn-transfer',
        CANCEL_BTN: '#ed-transfer-btn-cancel'
    };

    // ============================================================
    // 2. STATE & CACHE
    // ============================================================
    const docCache = new Map();     // Map<id, DocObject>
    const unitCache = new Map();    // Map<id, UnitObject> (từ fbyvsphere.cpx)
    let isProcessing = false;
    let logPanel = null;
    let basePath = '';   // vd: "/cumvinhthanh/smartcloud" - tu dong phat hien theo don vi dang dang nhap
    let execAcode = '';  // receiverAcode cua nguoi dang dang nhap (Chu tich/Lanh dao) - dung cho exeacode khi goi lai view.cpx thu cong

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

    const getVisibleItems = () => {
        let items = Array.from(document.querySelectorAll(S.LEFT_LIST));
        if (items.length === 0) items = Array.from(document.querySelectorAll(S.LEFT_LIST_FALLBACK));
        return items.filter(el => el.offsetParent !== null);
    };

    // Tu dong phat hien duong dan goc cua he thong (vd "/cumvinhthanh/smartcloud") tu URL
    // request that trinh duyet da goi - de khong phai hardcode ten don vi (moi don vi/tinh
    // co the co ma khac nhau, vd "cumphumy" cho Van thu Phu My vs "cumvinhthanh" cho Chu tich
    // Vinh Thanh trong bo resource duoc cung cap).
    const deriveBasePath = (url) => {
        const m = (url || '').match(/(\/[^\/?]+\/smartcloud)(?=\/)/);
        return m ? m[1] : null;
    };

    const ensureBasePath = (url) => {
        if (basePath) return;
        const derived = deriveBasePath(url);
        if (derived) {
            basePath = derived;
            appendLog(`Da xac dinh duong dan goc he thong: ${basePath}`);
        }
    };

    // Fallback khi chua kip bat duoc basePath tu network (edge-case truoc khi co request nao)
    const getFallbackBasePath = () => {
        const seg = window.location.pathname.split('/').filter(Boolean)[0];
        return seg ? `/${seg}/smartcloud` : '/smartcloud';
    };

    // Tim phan tu theo noi dung text hien thi (dung khi id chinh xac chua duoc xac nhan tren
    // giao dien that, vd khu vuc "Chuyen xu ly" cua role Chu tich)
    const findByVisibleText = (root, selector, texts) => {
        const scope = root || document;
        const nodes = scope.querySelectorAll(selector);
        for (const el of nodes) {
            const t = (el.textContent || el.value || '').trim();
            if (texts.includes(t) && el.offsetParent !== null) return el;
        }
        return null;
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
                    if (url.includes('qsprocess.cpx') || url.includes('view.cpx') || url.includes('fbyvsphere.cpx')) {
                        ensureBasePath(url);
                    }
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
                    ensureBasePath(url);
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
            // "responsibility" (main/coordinate) va "book" (da vao so tu Van thu) chi co o
            // role Chu tich/xu ly - dung de goi lai view.cpx dung tham so va hien thi thong tin
            doc.responsibility = item.responsibility || doc.responsibility || 'main';
            doc.book = item.book || doc.book || null;
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
        doc.book = data.book || doc.book || null;

        docCache.set(id, doc);
        updateExecAcodeFromView(data);
        updateDashboard();
    };

    const handleUnitsResponse = (data) => {
        if (!data || !data.elements) return;
        data.elements.forEach(unit => unitCache.set(unit.id, unit));
        appendLog(`API fbyvsphere: Cap nhat ${data.elements.length} don vi/ca nhan xu ly`);
    };

    // Xac dinh "receiverAcode" cua nguoi dang dang nhap (Chu tich/Lanh dao xu ly chinh) tu
    // response view.cpx (mang "senders"/"proInfos"), dung lam exeacode khi tu goi lai view.cpx.
    // Voi role Van thu, doc.creatorAcode (da co san trong edSearchDto) chinh la ma dinh danh
    // cua ho nen khong can co che nay; voi role Chu tich thi creatorAcode lai la ma cua Van thu
    // (nguoi tao/vao so), khong phai cua Chu tich, nen phai lay tu "responsibility": "main".
    const updateExecAcodeFromView = (data) => {
        if (execAcode) return;
        const pool = [];
        if (Array.isArray(data.senders)) pool.push(...data.senders);
        if (Array.isArray(data.proInfos)) pool.push(...data.proInfos);
        const mainEntry = pool.find(e => e && e.responsibility === 'main' && e.receiverAcode);
        if (mainEntry) {
            execAcode = mainEntry.receiverAcode;
            appendLog(`Da xac dinh ma dinh danh xu ly (exeacode): ${execAcode}`);
        }
    };

    // ============================================================
    // 7. DOWNLOAD PDF & CALL AI
    // ============================================================
    const downloadPDF = (contentUid, fileName) => {
        return new Promise((resolve, reject) => {
            const bp = basePath || getFallbackBasePath();
            const url = `${bp}/docx/download.cpx?docID=${contentUid}&view=pdf&t=${Date.now()}`;
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

        // Uu tien: click chon VB trong danh sach de trang tu goi view.cpx (voi exeacode dung
        // ma he thong tu dien, khong phan biet role) - cach nay khong doi ma van hoat dong dung
        // cho ca Van thu lan Chu tich vi day la request cua chinh trang, khong phai script tu tao.
        if (!doc.attachments || doc.attachments.length === 0) {
            const itemEl = document.querySelector(`.messageListItem[data-id="${id}"]`);
            if (itemEl && !itemEl.classList.contains('selected')) {
                itemEl.click();
                await sleep(CONFIG.DELAY_MS.SELECT_DOC);
                doc = docCache.get(id.toString()) || doc;
            }
        }

        // Fallback: tu goi view.cpx thu cong neu click chua kip tra ve attachments. Voi role
        // Chu tich, exeacode phai la receiverAcode cua chinh minh (execAcode) + responsibility
        // (thuong la "main"), KHONG phai doc.creatorAcode (do la ma cua Van thu da vao so VB).
        if ((!doc.attachments || doc.attachments.length === 0) && execAcode) {
            try {
                const bp = basePath || getFallbackBasePath();
                const resp = await fetch(`${bp}/document/edocs/view.cpx?exeacode=${execAcode}&id=${id}&responsibility=${doc.responsibility || 'main'}`);
                if (resp.ok) {
                    handleViewResponse(await resp.json());
                    doc = docCache.get(id.toString()) || doc;
                }
            } catch (e) {
                appendLog(`Fetch view.cpx cho ${id} loi: ${e.message}`);
            }
        } else if ((!doc.attachments || doc.attachments.length === 0) && !execAcode) {
            appendLog(`Chua xac dinh duoc exeacode xu ly - bo qua fetch thu cong cho VB ${id} (can mo it nhat 1 VB truoc de he thong tra ve receiverAcode).`);
        }

        return doc;
    };

    let cachedAuthToken = '';

    const getAuthToken = () => {
        return new Promise((resolve) => {
            if (cachedAuthToken) return resolve(cachedAuthToken);
            GM_xmlhttpRequest({
                method: 'POST',
                url: CONFIG.AUTH_URL,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ username: 'fe-server-prod', password: 'secret_password' }),
                onload: (resp) => {
                    if (resp.status === 200) {
                        try {
                            const res = JSON.parse(resp.responseText);
                            cachedAuthToken = res.access_token || '';
                            appendLog('Da lay Auth Token tu Backend');
                        } catch (e) {}
                    }
                    resolve(cachedAuthToken);
                },
                onerror: () => resolve(''),
                ontimeout: () => resolve('')
            });
        });
    };

    const callAIBackend = async (doc) => {
        const targetAttach = selectAttachment(doc);
        if (!targetAttach) {
            throw new Error(`Khong tim thay file dinh kem phu hop cho VB "${doc.signNumber}"`);
        }

        const bp = basePath || getFallbackBasePath();
        const fileUrl = window.location.origin + `${bp}/docx/download.cpx?docID=${targetAttach.contentUid}&view=pdf`;
        const token = await getAuthToken();

        const payload = {
            metadata: {
                document_number: doc.signNumber || '',
                document_type: doc.category || '',
                issuing_agency: doc.author || '',
                document_date: doc.docDateStr || '',
                signer: doc.signer || '',
                subject: doc.subject || ''
            },
            file_url: fileUrl
        };

        return new Promise((resolve, reject) => {
            setStatus(`Gui "${doc.signNumber}" den AI (DocFlow API)...`);

            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            GM_xmlhttpRequest({
                method: 'POST',
                url: CONFIG.BACKEND_URL,
                headers: headers,
                data: JSON.stringify(payload),
                onload: (resp) => {
                    if (resp.status === 200) {
                        try {
                            const result = JSON.parse(resp.responseText);
                            const responseData = result.data || result;
                            appendLog(`AI phan hoi cho "${doc.signNumber}": ${JSON.stringify(responseData)}`);
                            resolve(responseData);
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
    // 8. IDESK FORM AUTOMATION (CHUYỂN XỬ LÝ - ROLE CHỦ TỊCH)
    // ============================================================
    // Ghi chu: Khac voi role Van thu (phai chon "So van ban den" truoc khi "Luu va chuyen"),
    // van ban toi tay Chu tich da duoc Van thu vao so tu truoc (xem doc.book) nen khong con
    // buoc chon so - chi can bam thang nut "Chuyen xu ly" (#ed-view-btn-transfer) roi dien
    // "Xu ly chinh" / "Phoi hop xu ly" / "Han xu ly" nhu cu.

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

        // Role Chu tich: van ban da duoc Van thu vao so truoc do (doc.book), khong can chon
        // "So van ban den" - bam thang nut "Chuyen xu ly"
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
            // Fallback: id chinh xac cua panel "Chuyen xu ly" cho role Chu tich chua duoc xac
            // nhan qua resource (file mau duoc cung cap rong) - thu tim theo nut "Dong y" dang
            // hien thi de xac dinh vung form.
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

        // Tự động điền 1: Độ khẩn (#ed-transfer-select-priority)
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

        // Tự động điền 2: Nội dung (#ed-transfer-txt-content)
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
            /* ===== iDesk RPA Document Card List v3.1 ===== */
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
                flex-shrink: 0 !important;
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

            /* ===== Document Card List ===== */
            .rpa-card-list {
                flex: 1 !important;
                overflow-y: auto !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 12px !important;
                padding: 4px 0 !important;
            }
            .rpa-card-list::-webkit-scrollbar { width: 6px !important; }
            .rpa-card-list::-webkit-scrollbar-thumb { background: #262626 !important; border-radius: 3px !important; }

            /* Empty state */
            .rpa-card-empty {
                text-align: center !important;
                color: #666666 !important;
                padding: 48px 24px !important;
                font-size: 13px !important;
            }

            /* Document Card */
            .rpa-card {
                background: #18181B !important;
                border: 1px solid #262626 !important;
                border-radius: 8px !important;
                padding: 16px 20px !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 0 !important;
                transition: border-color 0.15s !important;
            }
            .rpa-card:hover {
                border-color: #333333 !important;
            }
            .rpa-card.rpa-card-selected {
                border-color: #555555 !important;
            }

            /* Card Divider */
            .rpa-card-divider {
                height: 1px !important;
                background: #262626 !important;
                margin: 12px 0 !important;
                flex-shrink: 0 !important;
            }

            /* ===== 1. Card Header ===== */
            .rpa-card-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: flex-start !important;
                gap: 12px !important;
            }
            .rpa-card-header-left {
                flex: 1 !important;
                min-width: 0 !important;
            }
            .rpa-card-sign-number {
                font-family: 'Geist Mono', 'SF Mono', monospace !important;
                font-weight: 600 !important;
                font-size: 14px !important;
                color: #FFFFFF !important;
                margin-bottom: 4px !important;
            }
            .rpa-card-subject {
                font-size: 13px !important;
                color: #D4D4D8 !important;
                line-height: 1.5 !important;
                word-break: break-word !important;
            }
            .rpa-card-header-right {
                flex-shrink: 0 !important;
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
            }

            /* ===== 2. Card Metadata ===== */
            .rpa-card-meta {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                gap: 6px 24px !important;
            }
            .rpa-card-meta-row {
                display: flex !important;
                gap: 8px !important;
                align-items: baseline !important;
            }
            .rpa-card-meta-label {
                font-size: 11px !important;
                color: #71717A !important;
                font-weight: 500 !important;
                text-transform: uppercase !important;
                letter-spacing: 0.03em !important;
                white-space: nowrap !important;
                min-width: 105px !important;
            }
            .rpa-card-meta-value {
                font-size: 13px !important;
                color: #E4E4E7 !important;
                word-break: break-word !important;
            }

            /* ===== 3. AI Summary ===== */
            .rpa-card-ai-title {
                font-size: 10px !important;
                font-weight: 600 !important;
                text-transform: uppercase !important;
                letter-spacing: 0.08em !important;
                color: #71717A !important;
                margin-bottom: 6px !important;
            }
            .rpa-card-ai-content {
                font-size: 13px !important;
                color: #E4E4E7 !important;
                line-height: 1.7 !important;
                word-break: break-word !important;
                max-height: 120px !important;
                overflow: hidden !important;
                transition: max-height 0.25s ease !important;
                position: relative !important;
            }
            .rpa-card-ai-content.expanded {
                max-height: none !important;
            }
            .rpa-card-ai-toggle {
                background: none !important;
                border: none !important;
                color: #60A5FA !important;
                font-size: 12px !important;
                cursor: pointer !important;
                padding: 2px 0 !important;
                font-family: inherit !important;
            }
            .rpa-card-ai-toggle:hover {
                color: #93C5FD !important;
                text-decoration: underline !important;
            }

            /* ===== 4. Card Detail ===== */
            .rpa-card-detail {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                gap: 6px 24px !important;
            }
            .rpa-card-detail-row {
                display: flex !important;
                gap: 8px !important;
                align-items: baseline !important;
            }
            .rpa-card-detail-label {
                font-size: 11px !important;
                color: #71717A !important;
                font-weight: 500 !important;
                text-transform: uppercase !important;
                letter-spacing: 0.03em !important;
                white-space: nowrap !important;
                min-width: 120px !important;
            }
            .rpa-card-detail-value {
                font-size: 13px !important;
                color: #E4E4E7 !important;
                word-break: break-word !important;
            }

            /* ===== 5. Card Actions ===== */
            .rpa-card-actions {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                gap: 12px !important;
            }
            .rpa-card-actions-left {
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
            }
            .rpa-card-actions-left label {
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
                font-size: 12px !important;
                color: #A1A1AA !important;
                cursor: pointer !important;
            }
            .rpa-card-actions-left input[type="checkbox"] {
                accent-color: #FFFFFF !important;
                cursor: pointer !important;
            }
            .rpa-card-actions-right {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
            }
            .rpa-card-action-btn {
                background: transparent !important;
                border: 1px solid #333333 !important;
                color: #A1A1AA !important;
                border-radius: 4px !important;
                padding: 4px 12px !important;
                font-size: 11px !important;
                cursor: pointer !important;
                font-family: inherit !important;
                transition: all 0.15s !important;
            }
            .rpa-card-action-btn:hover {
                background: #262626 !important;
                color: #FFFFFF !important;
                border-color: #444444 !important;
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
                white-space: nowrap !important;
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
                    <button class="rpa-btn rpa-btn-primary" id="rpa-btn-scan">Quét & Gửi AI</button>
                    <button class="rpa-btn rpa-btn-purple" id="rpa-btn-fill-all">Tự động điền</button>
                    <button class="rpa-btn rpa-btn-outline" id="rpa-btn-select-all">Chọn / Bỏ chọn</button>
                </div>
                <div class="rpa-card-list" id="rpa-card-list">
                    <div class="rpa-card-empty">Nhấn "Quét & Gửi AI" để bắt đầu...</div>
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
        document.getElementById('rpa-btn-select-all').addEventListener('click', () => {
            const allChecked = document.querySelectorAll('.rpa-card-check:not(:checked)').length === 0;
            document.querySelectorAll('.rpa-card-check').forEach(cb => cb.checked = !allChecked);
        });

        appendLog('Khoi tao iDesk RPA Document Card List v3.1');
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
        const list = document.getElementById('rpa-card-list');
        if (!list) return;

        const countEl = document.getElementById('rpa-doc-count');
        if (countEl) countEl.textContent = docCache.size.toString();

        if (docCache.size === 0) {
            list.innerHTML = `<div class="rpa-card-empty">Nhấn "Quét & Gửi AI" để bắt đầu...</div>`;
            return;
        }

        // Track expanded AI summary states
        if (!window._rpaAiExpanded) window._rpaAiExpanded = {};

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
            const isChecked = doc.status !== 'fill_done';
            const isSelected = doc.status !== 'fill_done';

            const ai = doc.aiData || {};
            const summary = ai.tom_tat || ai.summary || '---';
            const isSummaryLong = summary.length > 200;
            const isAiExpanded = window._rpaAiExpanded[id] || false;

            // --- 1. HEADER ---
            const signNumber = doc.signNumber || '---';
            const subject = doc.subject || '---';

            // --- 2. METADATA (khong lap lai o Detail) ---
            const author = doc.author || '---';
            const signer = doc.signer || '---';
            const category = doc.category || '---';
            const deadlineStr = (ai.thoi_han_thuc_hien || ai.implementation_deadline) ? `${ai.thoi_han_thuc_hien || ai.implementation_deadline} ngay` : '--';

            // --- 3. AI SUMMARY ---
            // --- 4. DETAIL (khong chua Co quan ban hanh, Nguoi ky, Loai VB) ---
            const bookInfo = doc.book
                ? `So ${doc.book.serialNumber || '---'}${doc.book.dateStr ? ' (' + formatDate(new Date(doc.book.dateStr)) + ')' : ''}`
                : '---';
            const mainUnit = ai.don_vi_xu_ly || ai.processing_unit || '---';
            const leader = ai.lanh_dao_theo_doi || ai.monitoring_leader || '---';
            const coUnits = ai.don_vi_phoi_hop || ai.coordinating_units;
            const coUnitsStr = (Array.isArray(coUnits) && coUnits.length > 0) ? coUnits.join(', ') : '---';
            const notes = ai.ghi_chu || ai.notes || '---';

            const pRaw = (ai.priority !== undefined && ai.priority !== null) ? ai.priority : ai.do_khan;
            let priorityStr = 'Binh thuong';
            if (pRaw === 1 || pRaw === '1' || pRaw === 'Khẩn' || pRaw === 'khan') priorityStr = 'Khan';
            else if (pRaw === 2 || pRaw === '2' || pRaw === 'Thuong khan' || pRaw === 'thuong_khan' || pRaw === 'Hoa toc') priorityStr = 'Thuong khan';

            // Escape quotes for safe HTML
            const safeSubject = subject.replace(/"/g, '"');
            const safeSummary = summary.replace(/"/g, '"');
            const safeNotes = notes.replace(/"/g, '"');

            html += `
                <div class="rpa-card ${isSelected ? 'rpa-card-selected' : ''}" data-id="${id}">
                    <!-- 1. HEADER -->
                    <div class="rpa-card-header">
                        <div class="rpa-card-header-left">
                            <div class="rpa-card-sign-number">${signNumber}</div>
                            <div class="rpa-card-subject">${safeSubject}</div>
                        </div>
                        <div class="rpa-card-header-right">
                            <span class="rpa-badge ${s[0]}">${s[1]}</span>
                        </div>
                    </div>

                    <div class="rpa-card-divider"></div>

                    <!-- 2. METADATA -->
                    <div class="rpa-card-meta">
                        <div class="rpa-card-meta-row">
                            <span class="rpa-card-meta-label">CQ ban hanh</span>
                            <span class="rpa-card-meta-value">${author}</span>
                        </div>
                        <div class="rpa-card-meta-row">
                            <span class="rpa-card-meta-label">Loai VB</span>
                            <span class="rpa-card-meta-value">${category}</span>
                        </div>
                        <div class="rpa-card-meta-row">
                            <span class="rpa-card-meta-label">Nguoi ky</span>
                            <span class="rpa-card-meta-value">${signer}</span>
                        </div>
                        <div class="rpa-card-meta-row">
                            <span class="rpa-card-meta-label">Han xu ly</span>
                            <span class="rpa-card-meta-value">${deadlineStr}</span>
                        </div>
                    </div>

                    <div class="rpa-card-divider"></div>

                    <!-- 3. AI SUMMARY -->
                    <div>
                        <div class="rpa-card-ai-title">TOM TAT AI</div>
                        <div class="rpa-card-ai-content ${isAiExpanded ? 'expanded' : ''}" id="rpa-ai-${id}">
                            ${safeSummary}
                        </div>
                        ${isSummaryLong ? `<button class="rpa-card-ai-toggle" data-ai-id="${id}" data-expanded="${isAiExpanded ? '1' : '0'}">${isAiExpanded ? 'Thu gon' : 'Xem them'}</button>` : ''}
                    </div>

                    <div class="rpa-card-divider"></div>

                    <!-- 4. DETAIL INFORMATION -->
                    <div class="rpa-card-detail">
                        <div class="rpa-card-detail-row">
                            <span class="rpa-card-detail-label">Da vao so</span>
                            <span class="rpa-card-detail-value">${bookInfo}</span>
                        </div>
                        <div class="rpa-card-detail-row">
                            <span class="rpa-card-detail-label">Do khan</span>
                            <span class="rpa-card-detail-value">${priorityStr}</span>
                        </div>
                        <div class="rpa-card-detail-row">
                            <span class="rpa-card-detail-label">DV xu ly chinh</span>
                            <span class="rpa-card-detail-value">${mainUnit}</span>
                        </div>
                        <div class="rpa-card-detail-row">
                            <span class="rpa-card-detail-label">DV phoi hop</span>
                            <span class="rpa-card-detail-value">${coUnitsStr}</span>
                        </div>
                        <div class="rpa-card-detail-row">
                            <span class="rpa-card-detail-label">Lanh dao theo doi</span>
                            <span class="rpa-card-detail-value">${leader}</span>
                        </div>
                        <div class="rpa-card-detail-row">
                            <span class="rpa-card-detail-label">Ghi chu</span>
                            <span class="rpa-card-detail-value">${safeNotes}</span>
                        </div>
                    </div>

                    <div class="rpa-card-divider"></div>

                    <!-- 5. ACTION AREA -->
                    <div class="rpa-card-actions">
                        <div class="rpa-card-actions-left">
                            <label>
                                <input type="checkbox" class="rpa-card-check" data-id="${id}" ${isChecked ? 'checked' : ''}>
                                Chon
                            </label>
                        </div>
                        <div class="rpa-card-actions-right">
                            <button class="rpa-card-action-btn" data-action="send-ai" data-id="${id}">Gui AI</button>
                            <button class="rpa-card-action-btn" data-action="fill" data-id="${id}">Dien & Chuyen</button>
                        </div>
                    </div>
                </div>
            `;
        });

        list.innerHTML = html;

        // Event delegation for AI summary toggle
        list.querySelectorAll('.rpa-card-ai-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-ai-id');
                const expanded = btn.getAttribute('data-expanded') === '1';
                const newExpanded = !expanded;
                window._rpaAiExpanded[id] = newExpanded;
                const content = document.getElementById(`rpa-ai-${id}`);
                if (content) content.classList.toggle('expanded', newExpanded);
                btn.setAttribute('data-expanded', newExpanded ? '1' : '0');
                btn.textContent = newExpanded ? 'Thu gon' : 'Xem them';
            });
        });
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

        const checkboxes = document.querySelectorAll('.rpa-card-check:checked');
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