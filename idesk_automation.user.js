// ==UserScript==
// @name         iDesk Auto-Fill Helper
// @namespace    http://inet.vn/
// @version      1.1
// @description  Hệ thống tự động hóa xử lý văn bản đến trên iDesk sử dụng AI
// @author       Senior Developer
// @match        https://vpdt.gialai.gov.vn/cumphumy/smartcloud/idesk6/page/paperwork/index.cpx*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

// CHANGELOG v1.1 (đối chiếu với resource/*.html thật do người dùng cung cấp):
// - Fix: chọn "Sổ văn bản đến" luôn throw lỗi vì ID container do Select2 tự sinh
//   có ký tự "\" thật chèn trước dấu "-" (bug của bản Select2 đang chạy trên trang này).
//   -> Chuyển sang lấy container qua input gốc ổn định #edocs-txt-book (previousElementSibling).
// - Fix: scanList() ra 0 kết quả do race-condition (SPA load AJAX chưa xong) -> thêm retry
//   + lọc theo visibility (offsetParent) để không lẫn dữ liệu từ widget khác đang ẩn.
// - Thêm: MutationObserver tự quét lại danh sách khi DOM đổi, khỏi cần bấm tay.
// - Fix: kéo popup bị giật/đứng khi rê qua iframe (khung xem PDF đính kèm) do dùng
//   mousemove trên document -> chuyển sang Pointer Events + setPointerCapture.
// - Fix: bug tiềm ẩn khi bind thẳng hàm nhận tham số vào addEventListener('click', ...).
// - Cải thiện: "Hạn xử lý" set số ngày trước rồi ép lại đúng ngày theo công thức
//   hiện tại + N ngày, tránh lệch nếu iDesk tự tính theo quy tắc khác.

(function() {
    'use strict';

    // 1. CONFIGURATION & SELECTORS
    const CONFIG = {
        BACKEND_URL: 'http://localhost:5000/api/process-doc',
        DEFAULT_BOOK: 'Văn bản do địa phương gửi đến', // Tên Sổ văn bản đến mặc định
        DELAY_MS: {
            SELECT_DOC: 1000,       // Chờ sau khi click chọn văn bản ở panel trái
            OPEN_SELECT2: 300,      // Chờ mở select2 dropdown
            CLICK_SAVE_TRANSFER: 1000, // Chờ mở form "Thông tin xử lý" sau khi click "Lưu và chuyển"
            OPEN_TREE: 500,         // Chờ mở popup Chọn người/Phòng ban
            CLOSE_TREE: 300,        // Chờ đóng popup Chọn người/Phòng ban
            AFTER_SUBMIT: 1500      // Chờ sau khi nhấn "Đồng ý" để lưu hoàn tất
        }
    };

    // DOM Selectors
    const SELECTORS = {
        // Chọn theo ID cụ thể trước (nhanh hơn), fallback sang class chung + lọc visible
        // nếu ID bị trùng lặp giữa nhiều widget (Xử lý chính, Cho ý kiến... cùng preload trong DOM).
        LEFT_PANEL_ITEMS: '#listview-list-content div.messageListItem',
        LEFT_PANEL_ITEMS_FALLBACK: 'div.messageListItem[data-id]',
        RIGHT_PANEL_CONTAINER: '#ed-new-receiver-document-widget',
        
        // Right Panel Fields
        SUBJECT: '#edocs-txt-subject',
        SIGN_NUMBER: '#edocs-txt-sign-number',
        DOC_DATE: '#edocs-txt-doc-date-str',
        AGENCY: '#edocs-txt-agency',
        SIGNER: '#edocs-txt-signer',
        SHOW_MORE_BTN: '#edocs-btn-hide-show-more-info',

        // KHÔNG dùng ID auto-gen của Select2 (dạng #s2id_edocs-txt-book) vì phiên bản Select2
        // đang chạy trên trang này chèn ký tự "\" thật vào trước mỗi dấu "-" trong id container
        // (đã kiểm chứng bằng byte thô từ right_panel.html): id thật là "s2id_edocs\-txt\-book".
        // CSS selector "#s2id_edocs-txt-book" (không có \) sẽ KHÔNG BAO GIỜ match được.
        // => Thay vào đó lấy qua input gốc ổn định, không đổi theo phiên bản Select2.
        BOOK_ORIGINAL_INPUT: '#edocs-txt-book',
        CATEGORY_ORIGINAL_INPUT: '#edocs-txt-category',
        SAVE_TRANSFER_BTN: '#ed-new-receiver-btn-save-transfer',
        
        // Transfer Screen Selectors (Right panel after save & transfer)
        TRANSFER_CONTAINER: '#ed-transfer-document-container',
        RESPONSIBLE_LINK: '#ed-transfer-select-user-responsible a.user-box-link',
        PARTICIPANTS_LINK: '#ed-transfer-select-user-participants a.user-box-link',
        DEADLINE_INPUT: '#ed-transfer-txt-deadline',
        DEADLINE_NUMBER_INPUT: '#ed-transfer-txt-deadline-number',
        AGREE_BTN: '#ed-transfer-btn-transfer',
        CANCEL_BTN: '#ed-transfer-btn-cancel'
    };

    // Document Cache & State
    const docCache = new Map();
    let isProcessingQueue = false;

    // Helper sleep function
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Lấy container Select2 (.select2-container) dựa trên ID của input/select GỐC (ổn định),
    // thay vì dựa vào ID "s2id_..." mà Select2 tự sinh (đã xác nhận bị lỗi escape \- trên trang này).
    // Select2 3.x luôn chèn .select2-container làm anh/em (sibling) ngay sát input gốc,
    // nhưng thứ tự trước/sau có thể khác nhau tùy field nên ta thử cả 2 hướng cho chắc.
    const getSelect2ContainerByFieldId = (originalFieldId) => {
        const hiddenEl = document.querySelector(originalFieldId);
        if (!hiddenEl) return null;

        const prev = hiddenEl.previousElementSibling;
        if (prev && prev.classList.contains('select2-container')) return prev;

        const next = hiddenEl.nextElementSibling;
        if (next && next.classList.contains('select2-container')) return next;

        // Fallback cuối: leo lên parent gần nhất rồi tìm .select2-container bên trong
        const parent = hiddenEl.closest('.row-fluid, .span4, .span3, div');
        return parent ? parent.querySelector('.select2-container') : null;
    };

    // 2. NETWORK INTERCEPTOR (AJAX)
    // Intercept iDesk AJAX calls to capture document metadata & IDs automatically
    const interceptAjax = () => {
        const XHR = XMLHttpRequest.prototype;
        const open = XHR.open;
        const send = XHR.send;

        XHR.open = function(method, url) {
            this._url = url;
            return open.apply(this, arguments);
        };

        XHR.send = function() {
            this.addEventListener('load', function() {
                try {
                    if (this._url.includes('qrreceiving.cpx')) {
                        const response = JSON.parse(this.responseText);
                        handleListResponse(response);
                    } else if (this._url.includes('view.cpx')) {
                        const response = JSON.parse(this.responseText);
                        handleViewResponse(response);
                    }
                } catch (e) {}
            });
            return send.apply(this, arguments);
        };
    };

    const handleListResponse = (data) => {
        if (data && data.items) {
            data.items.forEach(item => {
                const id = item.id.toString();
                const ed = item.edSearchDto || {};
                
                // Get existing or create new entry
                const doc = docCache.get(id) || { id };
                doc.subject = ed.subject || doc.subject;
                doc.signNumber = ed.signNumber || doc.signNumber;
                doc.category = ed.category || doc.category;
                doc.docDateStr = ed.docDateStr || doc.docDateStr;
                doc.author = ed.author || doc.author;
                doc.signer = ed.signer || doc.signer;
                doc.creatorAcode = ed.creatorAcode || doc.creatorAcode;
                
                docCache.set(id, doc);
            });
            updateDashboardTable();
        }
    };

    const handleViewResponse = (data) => {
        if (data && data.ed) {
            const id = data.ed.id.toString();
            const doc = docCache.get(id) || { id };
            
            doc.subject = data.ed.subject || doc.subject;
            doc.signNumber = data.ed.signNumber || doc.signNumber;
            doc.category = data.ed.category || doc.category;
            doc.docDateStr = data.ed.docDateStr || doc.docDateStr;
            doc.author = data.ed.author || doc.author;
            doc.signer = data.ed.signer || doc.signer;
            doc.creatorAcode = data.ed.creatorAcode || doc.creatorAcode;
            doc.attachments = data.attachments || [];
            
            docCache.set(id, doc);
            updateDashboardTable();
        }
    };

    // Get document by ID. If not fully loaded, fetch it programmatically
    const getOrFetchDocDetails = async (id) => {
        let doc = docCache.get(id.toString());
        if (!doc) {
            doc = { id: id.toString() };
        }
        
        // If we don't have creatorAcode, we look at the DOM or wait
        if (!doc.creatorAcode) {
            // Try to find if currently clicked or in list
            const itemEl = document.querySelector(`.messageListItem[data-id="${id}"]`);
            if (itemEl) {
                // If not loaded, we click it to load
                itemEl.click();
                await sleep(CONFIG.DELAY_MS.SELECT_DOC);
                doc = docCache.get(id.toString()) || doc;
            }
        }
        
        // Programmatically fetch view details if missing attachment info
        if (doc.creatorAcode && (!doc.attachments || doc.attachments.length === 0)) {
            try {
                const res = await fetch(`/cumphumy/smartcloud/document/edocs/view.cpx?exeacode=${doc.creatorAcode}&id=${id}`);
                const data = await res.json();
                handleViewResponse(data);
                doc = docCache.get(id.toString());
            } catch (err) {
                console.error("Error fetching view details programmatically:", err);
            }
        }
        return doc;
    };

    // 3. CORE AUTOMATION FUNCTIONS (RPA)

    // Download attachment PDF from iDesk
    const downloadPDF = async (contentUid, fileName) => {
        const url = `/cumphumy/smartcloud/docx/download.cpx?docID=${contentUid}&view=pdf`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not fetch PDF: ${res.statusText}`);
        const blob = await res.blob();
        return new File([blob], fileName, { type: 'application/pdf' });
    };

    // Call local/remote AI Backend
    const callAIBackend = async (doc) => {
        // Find PDF attachment
        const pdfAttach = (doc.attachments || []).find(att => att.format === 'pdf' || att.name.toLowerCase().endsWith('.pdf'));
        if (!pdfAttach) {
            throw new Error("Không tìm thấy file đính kèm PDF nào!");
        }

        const pdfFile = await downloadPDF(pdfAttach.contentUid, pdfAttach.name);
        
        // Clean metadata for AI
        const metadata = {
            id: doc.id,
            so_hieu: doc.signNumber,
            loai_vb: doc.category,
            cq_bh: doc.author,
            ngay_vb: doc.docDateStr,
            nguoi_ky: doc.signer,
            trich_yeu: doc.subject
        };

        const formData = new FormData();
        formData.append('pdf', pdfFile);
        formData.append('metadata', JSON.stringify(metadata));

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: CONFIG.BACKEND_URL,
                data: formData,
                onload: function(response) {
                    if (response.status === 200) {
                        try {
                            const result = JSON.parse(response.responseText);
                            resolve(result);
                        } catch (e) {
                            reject(new Error("Lỗi parse JSON kết quả AI: " + e.message));
                        }
                    } else {
                        reject(new Error("AI Server trả về code: " + response.status));
                    }
                },
                onerror: function(err) {
                    reject(new Error("Không kết nối được tới AI Server (" + CONFIG.BACKEND_URL + ")"));
                }
            });
        });
    };

    // Select register in Select2
    const selectBookDropdown = async (bookName) => {
        const select2Container = getSelect2ContainerByFieldId(SELECTORS.BOOK_ORIGINAL_INPUT);
        if (!select2Container) throw new Error("Không tìm thấy Sổ văn bản đến! (container Select2 không xác định được qua #edocs-txt-book, kiểm tra lại DOM)");
        
        const trigger = select2Container.querySelector('.select2-choice');
        if (!trigger) throw new Error("Không tìm thấy nút bấm chọn Sổ văn bản!");
        
        // Open select2
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await sleep(CONFIG.DELAY_MS.OPEN_SELECT2);
        
        // Find dropdown options - ưu tiên khớp chính xác trước, tránh chọn nhầm khi
        // nhiều tên sổ chứa chung tiền tố (VD "Sổ văn bản đến" vs "Sổ văn bản đến Trung ương")
        const results = document.querySelectorAll('#select2-drop ul.select2-results li');
        let target = null;
        for (const li of results) {
            if (li.textContent.trim() === bookName) { target = li; break; }
        }
        if (!target) {
            for (const li of results) {
                if (li.textContent.trim().includes(bookName)) { target = li; break; }
            }
        }

        if (target) {
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        } else {
            // Close dropdown if option not found
            document.body.click();
            throw new Error(`Không tìm thấy sổ '${bookName}' trong dropdown!`);
        }
    };

    // Check tree popup nodes and click match
    const selectNodeInTreePopup = async (linkSelector, targetName) => {
        const link = document.querySelector(linkSelector);
        if (!link) throw new Error(`Không tìm thấy link mở danh sách chọn: ${linkSelector}`);
        
        link.click();
        await sleep(CONFIG.DELAY_MS.OPEN_TREE);
        
        const popups = document.querySelectorAll('.popover, .dropdown-menu, .tree, [role="listbox"], .modal, .select2-drop');
        let clicked = false;
        
        for (const popup of popups) {
            if (popup.offsetWidth > 0 && popup.offsetHeight > 0) { // check visibility
                const labels = popup.querySelectorAll('span, div, a, li, label');
                // Exact text match first
                for (const label of labels) {
                    if (label.childNodes.length > 0 && label.textContent.trim() === targetName) {
                        const checkbox = label.querySelector('input[type="checkbox"], .lbl, .ace');
                        if (checkbox) checkbox.click();
                        else label.click();
                        clicked = true;
                        break;
                    }
                }
                if (clicked) break;
                
                // Partial match if exact not found
                for (const label of labels) {
                    if (label.textContent.trim().includes(targetName)) {
                        const checkbox = label.querySelector('input[type="checkbox"], .lbl, .ace');
                        if (checkbox) checkbox.click();
                        else label.click();
                        clicked = true;
                        break;
                    }
                }
                if (clicked) break;
            }
        }
        
        // Close popup
        document.body.click();
        await sleep(CONFIG.DELAY_MS.CLOSE_TREE);
        
        if (!clicked) {
            console.warn(`Cảnh báo: Không click được phòng ban/nhân sự: "${targetName}" trong popup.`);
        }
    };

    // Calculate deadline date: Current Date + Days
    const calculateDeadlineDate = (days) => {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(days));
        
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        
        return `${dd}/${mm}/${yyyy}`;
    };

    // Process single document auto-filling
    const autoFillAndSubmit = async (docId, aiData) => {
        // 1. Select the document in left panel
        const itemEl = document.querySelector(`.messageListItem[data-id="${docId}"]`);
        if (!itemEl) throw new Error("Không tìm thấy mục văn bản trong danh sách panel trái!");
        
        itemEl.click();
        await sleep(CONFIG.DELAY_MS.SELECT_DOC);
        
        // Expand hidden details (like signer) if not visible
        const showMoreBtn = document.querySelector(SELECTORS.SHOW_MORE_BTN);
        if (showMoreBtn && showMoreBtn.textContent.includes("Hiển thị thêm")) {
            showMoreBtn.click();
            await sleep(300);
        }

        // 2. Select register (Sổ văn bản đến)
        await selectBookDropdown(CONFIG.DEFAULT_BOOK);
        await sleep(500); // Wait for iDesk calculations & serial number retrieval

        // 3. Click "Lưu và chuyển"
        const saveTransferBtn = document.querySelector(SELECTORS.SAVE_TRANSFER_BTN);
        if (!saveTransferBtn) throw new Error("Không tìm thấy nút 'Lưu và chuyển'!");
        saveTransferBtn.click();
        await sleep(CONFIG.DELAY_MS.CLICK_SAVE_TRANSFER);

        // 4. Fill Xử lý chính
        if (aiData.don_vi_xu_ly) {
            await selectNodeInTreePopup(SELECTORS.RESPONSIBLE_LINK, aiData.don_vi_xu_ly);
        }

        // 5. Fill Phối hợp xử lý
        if (aiData.don_vi_phoi_hop && Array.isArray(aiData.don_vi_phoi_hop)) {
            for (const unit of aiData.don_vi_phoi_hop) {
                await selectNodeInTreePopup(SELECTORS.PARTICIPANTS_LINK, unit);
            }
        }

        // 6. Fill Hạn xử lý = ngày hiện tại + số ngày (thời hạn thực hiện)
        if (aiData.thoi_han_thuc_hien) {
            const deadlineDays = parseInt(aiData.thoi_han_thuc_hien);
            const deadlineDate = calculateDeadlineDate(deadlineDays);

            // Set số ngày TRƯỚC để kích hoạt logic tính toán/validate gốc của iDesk (nếu có)
            const deadlineNumInput = document.querySelector(SELECTORS.DEADLINE_NUMBER_INPUT);
            if (deadlineNumInput) {
                deadlineNumInput.value = deadlineDays;
                deadlineNumInput.dispatchEvent(new Event('input', { bubbles: true }));
                deadlineNumInput.dispatchEvent(new Event('change', { bubbles: true }));
                deadlineNumInput.dispatchEvent(new Event('blur', { bubbles: true }));
                await sleep(300); // chờ iDesk tự tính (nếu có binding riêng)
            }

            // Sau đó ÉP LẠI ngày hiển thị đúng công thức "hiện tại + N ngày" mà bạn yêu cầu,
            // để không phụ thuộc vào việc iDesk có tự tính đúng quy tắc này hay không
            // (VD: iDesk có thể loại trừ thứ 7/CN, tính theo ngày văn bản thay vì hôm nay, v.v.)
            const deadlineInput = document.querySelector(SELECTORS.DEADLINE_INPUT);
            if (deadlineInput) {
                deadlineInput.value = deadlineDate;
                deadlineInput.dispatchEvent(new Event('input', { bubbles: true }));
                deadlineInput.dispatchEvent(new Event('change', { bubbles: true }));
                deadlineInput.dispatchEvent(new Event('blur', { bubbles: true }));

                if (deadlineInput.value !== deadlineDate) {
                    console.warn(`[iDesk RPA] Hạn xử lý không set được đúng giá trị mong muốn. Muốn: ${deadlineDate}, thực tế: ${deadlineInput.value}`);
                }
            }
        }

        // 7. Click Đồng ý
        const agreeBtn = document.querySelector(SELECTORS.AGREE_BTN);
        if (!agreeBtn) throw new Error("Không tìm thấy nút 'Đồng ý'!");
        agreeBtn.click();
        
        await sleep(CONFIG.DELAY_MS.AFTER_SUBMIT);
    };

    // 4. FLOATING USER INTERFACE (DASHBOARD)
    const createDashboardUI = () => {
        // Avoid duplicate rendering
        if (document.getElementById('idesk-rpa-hub')) return;

        // Inject UI HTML structure
        const container = document.createElement('div');
        container.id = 'idesk-rpa-hub';
        container.innerHTML = `
            <div class="rpa-header">
                <div class="rpa-title">
                    <span class="rpa-logo">⚡</span> iDesk AI RPA Automation Panel
                </div>
                <div class="rpa-header-actions">
                    <button id="rpa-btn-minimize" title="Thu nhỏ/Mở rộng">➖</button>
                </div>
            </div>
            <div class="rpa-body">
                <div class="rpa-controls-row">
                    <button class="rpa-btn rpa-btn-blue" id="rpa-btn-scan">🔄 Quét danh sách</button>
                    <button class="rpa-btn rpa-btn-green" id="rpa-btn-ai-all">🤖 Gửi toàn bộ AI</button>
                    <button class="rpa-btn rpa-btn-purple" id="rpa-btn-fill-all">⚡ Tự động điền</button>
                </div>
                
                <div class="rpa-collapsible-config">
                    <div class="rpa-config-header">⚙️ Cấu hình hệ thống</div>
                    <div class="rpa-config-body">
                        <div class="rpa-form-group">
                            <label>AI API Endpoint:</label>
                            <input type="text" id="rpa-config-api-url" value="${CONFIG.BACKEND_URL}">
                        </div>
                        <div class="rpa-form-group">
                            <label>Sổ văn bản mặc định:</label>
                            <input type="text" id="rpa-config-default-book" value="${CONFIG.DEFAULT_BOOK}">
                        </div>
                    </div>
                </div>
                
                <div class="rpa-table-container">
                    <table class="rpa-table" id="rpa-doc-table">
                        <thead>
                            <tr>
                                <th style="width: 30px;"><input type="checkbox" id="rpa-th-check-all" checked></th>
                                <th style="width: 140px;">Văn bản gốc</th>
                                <th style="width: 100px;">Trạng thái</th>
                                <th>Thông tin xử lý đề xuất (AI)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td colspan="4" style="text-align: center; color: #8892b0; padding: 20px;">
                                    Chưa có dữ liệu. Nhấn "Quét danh sách" để tải văn bản.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="rpa-footer">
                <div class="rpa-status-text" id="rpa-footer-status">Hệ thống sẵn sàng.</div>
                <div class="rpa-version">v1.0</div>
            </div>
        `;

        document.body.appendChild(container);

        // Inject Premium Glassmorphism Stylesheet
        const style = document.createElement('style');
        style.innerHTML = `
            #idesk-rpa-hub {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 780px;
                height: 480px;
                background: rgba(10, 16, 30, 0.85);
                backdrop-filter: blur(15px);
                -webkit-backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.5);
                color: #e2e8f0;
                font-family: 'Outfit', 'Inter', system-ui, sans-serif;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
            }
            #idesk-rpa-hub.minimized {
                height: 45px;
                width: 280px;
            }
            .rpa-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 16px;
                background: rgba(255, 255, 255, 0.03);
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                cursor: grab;
            }
            .rpa-title {
                font-weight: 600;
                font-size: 13px;
                letter-spacing: 0.5px;
                display: flex;
                align-items: center;
                gap: 6px;
                color: #38bdf8;
            }
            .rpa-logo {
                font-size: 14px;
                animation: pulse 2s infinite;
            }
            .rpa-header-actions button {
                background: none;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                padding: 2px 6px;
                font-size: 11px;
                transition: color 0.2s;
            }
            .rpa-header-actions button:hover {
                color: #f1f5f9;
            }
            .rpa-body {
                flex: 1;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                overflow: hidden;
            }
            #idesk-rpa-hub.minimized .rpa-body {
                display: none;
            }
            .rpa-controls-row {
                display: flex;
                gap: 8px;
            }
            .rpa-btn {
                flex: 1;
                border: none;
                border-radius: 8px;
                padding: 8px 12px;
                font-weight: 500;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            .rpa-btn-blue {
                background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
                color: white;
                box-shadow: 0 2px 8px rgba(2, 132, 199, 0.3);
            }
            .rpa-btn-blue:hover {
                background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
                box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
            }
            .rpa-btn-green {
                background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
                color: white;
                box-shadow: 0 2px 8px rgba(22, 163, 74, 0.3);
            }
            .rpa-btn-green:hover {
                background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                box-shadow: 0 4px 12px rgba(22, 163, 74, 0.4);
            }
            .rpa-btn-purple {
                background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
                color: white;
                box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
            }
            .rpa-btn-purple:hover {
                background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
                box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4);
            }
            .rpa-collapsible-config {
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.02);
            }
            .rpa-config-header {
                padding: 6px 12px;
                font-size: 11px;
                font-weight: 500;
                color: #94a3b8;
                cursor: pointer;
            }
            .rpa-config-body {
                padding: 8px 12px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                border-top: 1px solid rgba(255, 255, 255, 0.03);
            }
            .rpa-form-group {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .rpa-form-group label {
                font-size: 11px;
                width: 140px;
                color: #94a3b8;
            }
            .rpa-form-group input {
                flex: 1;
                background: rgba(0, 0, 0, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 4px;
                padding: 3px 6px;
                color: #e2e8f0;
                font-size: 11px;
            }
            .rpa-table-container {
                flex: 1;
                overflow-y: auto;
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                background: rgba(0, 0, 0, 0.15);
            }
            .rpa-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
                text-align: left;
            }
            .rpa-table th, .rpa-table td {
                padding: 6px 10px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            }
            .rpa-table th {
                background: rgba(255, 255, 255, 0.02);
                color: #94a3b8;
                font-weight: 600;
                position: sticky;
                top: 0;
            }
            .rpa-doc-info {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .rpa-doc-num {
                font-weight: 600;
                color: #f1f5f9;
            }
            .rpa-doc-subject {
                color: #94a3b8;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 180px;
            }
            .rpa-status-badge {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 4px;
                font-weight: 600;
                font-size: 10px;
            }
            .rpa-status-idle { background: rgba(148, 163, 184, 0.1); color: #94a3b8; }
            .rpa-status-pending { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
            .rpa-status-success { background: rgba(16, 185, 129, 0.1); color: #10b981; }
            .rpa-status-error { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
            
            .rpa-ai-fields {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .rpa-ai-row {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .rpa-ai-row label {
                width: 70px;
                color: #64748b;
                font-size: 10px;
            }
            .rpa-ai-row input {
                flex: 1;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 4px;
                padding: 2px 4px;
                color: #f1f5f9;
                font-size: 10px;
            }
            .rpa-ai-row input:focus {
                border-color: #38bdf8;
                outline: none;
            }
            
            .rpa-footer {
                padding: 6px 12px;
                background: rgba(255, 255, 255, 0.02);
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 10px;
                color: #64748b;
            }
            #idesk-rpa-hub.minimized .rpa-footer {
                display: none;
            }
            
            @keyframes pulse {
                0% { opacity: 0.6; }
                50% { opacity: 1; }
                100% { opacity: 0.6; }
            }
        `;
        document.head.appendChild(style);

        // Make floating panel draggable
        dragElement(container);

        // Bind UI Events
        document.getElementById('rpa-btn-minimize').addEventListener('click', () => {
            container.classList.toggle('minimized');
            document.getElementById('rpa-btn-minimize').textContent = container.classList.contains('minimized') ? '🗖' : '➖';
        });

        document.getElementById('rpa-btn-scan').addEventListener('click', () => scanList());
        document.getElementById('rpa-btn-ai-all').addEventListener('click', runAIOnAllSelected);
        document.getElementById('rpa-btn-fill-all').addEventListener('click', runFillOnAllSelected);
        document.getElementById('rpa-th-check-all').addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.rpa-td-check').forEach(chk => chk.checked = checked);
        });

        // Config event listeners
        document.getElementById('rpa-config-api-url').addEventListener('change', (e) => {
            CONFIG.BACKEND_URL = e.target.value;
        });
        document.getElementById('rpa-config-default-book').addEventListener('change', (e) => {
            CONFIG.DEFAULT_BOOK = e.target.value;
        });
    };

    // Update footer status text
    const setStatus = (msg) => {
        const el = document.getElementById('rpa-footer-status');
        if (el) el.textContent = msg;
    };

    // Lấy danh sách item đang thực sự hiển thị trên màn hình (loại bỏ item từ các
    // widget khác đang bị ẩn display:none nhưng vẫn còn trong DOM do iDesk cache lại).
    // offsetParent === null nghĩa là phần tử (hoặc cha của nó) đang display:none.
    const queryVisibleListItems = () => {
        // Ưu tiên selector cụ thể trước (đúng ngữ cảnh hơn), fallback sang class chung toàn trang
        let items = Array.from(document.querySelectorAll(SELECTORS.LEFT_PANEL_ITEMS));
        if (items.length === 0) {
            items = Array.from(document.querySelectorAll(SELECTORS.LEFT_PANEL_ITEMS_FALLBACK));
        }
        return items.filter(el => el.offsetParent !== null);
    };

    // Scrape documents from left list panel DOM.
    // Có retry vì list được nạp bằng AJAX (qrreceiving.cpx) - nếu gọi quá sớm lúc SPA
    // chưa kịp render xong (chuyển tab, mới load trang...) sẽ ra 0 kết quả.
    const scanList = async (retries = 3) => {
        setStatus("Đang quét danh sách văn bản...");
        let items = queryVisibleListItems();

        let attempt = 0;
        while (items.length === 0 && attempt < retries) {
            attempt++;
            setStatus(`Chưa thấy văn bản, thử lại lần ${attempt}/${retries}...`);
            await sleep(800);
            items = queryVisibleListItems();
        }

        if (items.length === 0) {
            setStatus("Không tìm thấy văn bản nào ở panel trái. Hãy chắc chắn đang ở màn hình 'Tiếp nhận văn bản' rồi thử lại!");
            return 0;
        }

        items.forEach(el => {
            const id = el.getAttribute('data-id');
            if (id) {
                // If not in cache, initialize placeholder
                if (!docCache.has(id)) {
                    const sender = el.querySelector('.sender')?.textContent.trim() || '';
                    const subject = el.querySelector('.subject')?.textContent.trim() || '';
                    docCache.set(id, {
                        id: id,
                        signNumber: sender,
                        subject: subject,
                        status: 'idle',
                        aiData: null
                    });
                }
            }
        });

        updateDashboardTable();
        setStatus(`Đã quét xong. Tìm thấy ${docCache.size} văn bản.`);
        return items.length;
    };

    // Tự động quét lại mỗi khi nội dung panel trái thay đổi (đổi tab Tất cả/Nhận trong
    // ngày/Chưa vào sổ, phân trang, nạp thêm dữ liệu...) thay vì phải bấm tay liên tục.
    let scanDebounceTimer = null;
    const observeListChanges = () => {
        const debouncedScan = () => {
            clearTimeout(scanDebounceTimer);
            scanDebounceTimer = setTimeout(() => scanList(1), 600);
        };

        const observer = new MutationObserver(debouncedScan);
        observer.observe(document.body, { childList: true, subtree: true });
        return observer;
    };

    // Repopulate UI Table with cached documents
    const updateDashboardTable = () => {
        const tbody = document.querySelector('#rpa-doc-table tbody');
        if (!tbody) return;

        if (docCache.size === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: #8892b0; padding: 20px;">
                        Chưa có dữ liệu. Nhấn "Quét danh sách" để tải văn bản.
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        docCache.forEach((doc, id) => {
            const statusClass = doc.status === 'idle' ? 'rpa-status-idle' :
                                doc.status === 'pending' ? 'rpa-status-pending' :
                                doc.status === 'success' ? 'rpa-status-success' : 'rpa-status-error';
            
            const statusText = doc.status === 'idle' ? 'Chưa gửi' :
                               doc.status === 'pending' ? 'Đang xử lý...' :
                               doc.status === 'success' ? 'Đã phân tích' : 'Lỗi: ' + (doc.errorMsg || 'Thất bại');

            // Set up editable AI values or default strings
            const ai = doc.aiData || {
                tom_tat: doc.subject || '',
                don_vi_xu_ly: '',
                don_vi_phoi_hop: [],
                thoi_han_thuc_hien: ''
            };

            const phoiHopStr = Array.isArray(ai.don_vi_phoi_hop) ? ai.don_vi_phoi_hop.join(', ') : (ai.don_vi_phoi_hop || '');

            html += `
                <tr data-id="${id}">
                    <td><input type="checkbox" class="rpa-td-check" checked data-id="${id}"></td>
                    <td>
                        <div class="rpa-doc-info">
                            <span class="rpa-doc-num" title="${doc.signNumber || 'Không số'}">${doc.signNumber || 'Chưa vào số'}</span>
                            <span class="rpa-doc-subject" title="${doc.subject}">${doc.subject}</span>
                        </div>
                    </td>
                    <td><span class="rpa-status-badge ${statusClass}">${statusText}</span></td>
                    <td>
                        <div class="rpa-ai-fields">
                            <div class="rpa-ai-row">
                                <label>Tóm tắt:</label>
                                <input type="text" class="rpa-ai-tom-tat" value="${ai.tom_tat}" data-id="${id}">
                            </div>
                            <div class="rpa-ai-row">
                                <label>Xử lý chính:</label>
                                <input type="text" class="rpa-ai-xu-ly" value="${ai.don_vi_xu_ly}" data-id="${id}">
                            </div>
                            <div class="rpa-ai-row">
                                <label>Phối hợp:</label>
                                <input type="text" class="rpa-ai-phoi-hop" value="${phoiHopStr}" data-id="${id}">
                            </div>
                            <div class="rpa-ai-row">
                                <label>Hạn xử lý (ngày):</label>
                                <input type="number" class="rpa-ai-deadline" value="${ai.thoi_han_thuc_hien}" data-id="${id}" style="max-width: 80px;">
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        
        // Add event listeners to input changes to save user corrections back to cache
        tbody.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', (e) => {
                const id = e.target.getAttribute('data-id');
                const doc = docCache.get(id);
                if (!doc) return;
                
                if (!doc.aiData) doc.aiData = {};

                if (e.target.classList.contains('rpa-ai-tom-tat')) {
                    doc.aiData.tom_tat = e.target.value;
                } else if (e.target.classList.contains('rpa-ai-xu-ly')) {
                    doc.aiData.don_vi_xu_ly = e.target.value;
                } else if (e.target.classList.contains('rpa-ai-phoi-hop')) {
                    doc.aiData.don_vi_phoi_hop = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                } else if (e.target.classList.contains('rpa-ai-deadline')) {
                    doc.aiData.thoi_han_thuc_hien = e.target.value;
                }
            });
        });
    };

    // Send selected docs to local AI Backend in parallel/sequence
    const runAIOnAllSelected = async () => {
        const checkboxes = document.querySelectorAll('.rpa-td-check:checked');
        if (checkboxes.length === 0) {
            alert("Hãy chọn ít nhất 1 văn bản!");
            return;
        }

        setStatus("Bắt đầu xử lý AI...");
        
        for (const chk of checkboxes) {
            const id = chk.getAttribute('data-id');
            const doc = docCache.get(id);
            if (!doc) continue;

            doc.status = 'pending';
            updateDashboardTable();
            setStatus(`Đang phân tích: ${doc.signNumber || id}...`);

            try {
                // Fetch full details (AJAX view) if not loaded
                const fullDoc = await getOrFetchDocDetails(id);
                
                // Call AI server
                const aiResult = await callAIBackend(fullDoc);
                
                doc.status = 'success';
                doc.aiData = aiResult;
            } catch (err) {
                console.error(err);
                doc.status = 'error';
                doc.errorMsg = err.message;
            }
            updateDashboardTable();
        }
        setStatus("Đã hoàn tất phân tích AI cho các văn bản chọn.");
    };

    // Auto fill and submit selected documents sequentially
    const runFillOnAllSelected = async () => {
        const checkboxes = document.querySelectorAll('.rpa-td-check:checked');
        if (checkboxes.length === 0) {
            alert("Hãy chọn ít nhất 1 văn bản!");
            return;
        }

        if (isProcessingQueue) {
            alert("Hệ thống đang chạy tiến trình tự động điền!");
            return;
        }

        const confirmStart = confirm(`Bạn có chắc chắn muốn TỰ ĐỘNG ĐIỀN và gửi ${checkboxes.length} văn bản đã chọn?`);
        if (!confirmStart) return;

        isProcessingQueue = true;
        setStatus("Bắt đầu chu trình tự động điền...");

        for (const chk of checkboxes) {
            const id = chk.getAttribute('data-id');
            const doc = docCache.get(id);
            if (!doc || !doc.aiData) {
                console.warn(`Bỏ qua văn bản ${id} vì chưa có dữ liệu AI.`);
                continue;
            }

            setStatus(`Đang tự động điền: ${doc.signNumber || id}...`);
            chk.closest('tr').style.backgroundColor = 'rgba(124, 58, 237, 0.15)'; // highlight running row

            try {
                await autoFillAndSubmit(id, doc.aiData);
                
                // Mark success
                doc.status = 'success';
                doc.processed = true;
                chk.closest('tr').style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
                chk.checked = false; // Uncheck processed item
            } catch (err) {
                console.error("Auto-fill error for doc:", id, err);
                doc.status = 'error';
                doc.errorMsg = "Lỗi điền: " + err.message;
                chk.closest('tr').style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
            }
            updateDashboardTable();
        }
        
        isProcessingQueue = false;
        setStatus("Chu trình điền tự động kết thúc.");
    };

    // Drag helper for floating dashboard panel.
    // Dùng Pointer Events + setPointerCapture thay vì mousedown/mousemove trên document:
    // trang iDesk có nhúng iframe (khung xem PDF file đính kèm, các dropdown/select2...),
    // nếu chỉ nghe mousemove trên document thì khi con trỏ rê ngang qua iframe, sự kiện
    // sẽ bị "nuốt" bởi document riêng của iframe đó, làm việc kéo bị đứng/giật rất khó chịu.
    // setPointerCapture đảm bảo MỌI sự kiện con trỏ tiếp theo được gửi thẳng về header
    // bất kể đang đè lên phần tử/iframe nào, tới khi pointerup.
    const dragElement = (elmnt) => {
        const header = elmnt.querySelector('.rpa-header') || elmnt;
        let startX = 0, startY = 0, startTop = 0, startLeft = 0, dragging = false;

        header.style.touchAction = 'none'; // tránh cuộn trang trên trackpad/touch khi đang kéo

        header.addEventListener('pointerdown', (e) => {
            // Chỉ kéo bằng chuột trái, và không kéo khi bấm đúng vào nút bên trong header
            if (e.button !== 0 || e.target.closest('button')) return;

            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = elmnt.getBoundingClientRect();
            startTop = rect.top;
            startLeft = rect.left;

            // Chốt vị trí hiện tại bằng top/left rồi bỏ neo bottom/right,
            // để tính toán khi kéo không bị lệch do đổi hệ quy chiếu giữa chừng.
            elmnt.style.top = startTop + 'px';
            elmnt.style.left = startLeft + 'px';
            elmnt.style.bottom = 'auto';
            elmnt.style.right = 'auto';

            header.setPointerCapture(e.pointerId);
            header.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none'; // tránh bôi đen chữ khi rê nhanh
            e.preventDefault();
        });

        header.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Giới hạn không cho kéo panel ra hẳn ngoài màn hình
            const maxLeft = window.innerWidth - 60;
            const maxTop = window.innerHeight - 40;
            const newLeft = Math.min(Math.max(startLeft + dx, -elmnt.offsetWidth + 60), maxLeft);
            const newTop = Math.min(Math.max(startTop + dy, 0), maxTop);

            elmnt.style.left = newLeft + 'px';
            elmnt.style.top = newTop + 'px';
        });

        const stopDrag = (e) => {
            if (!dragging) return;
            dragging = false;
            header.style.cursor = 'grab';
            document.body.style.userSelect = '';
            try { header.releasePointerCapture(e.pointerId); } catch (err) {}
        };

        header.addEventListener('pointerup', stopDrag);
        header.addEventListener('pointercancel', stopDrag);
    };

    // 5. INITIALIZATION
    const init = () => {
        console.log("=== iDesk Auto-Fill Helper initialized ===");
        // Enable XHR & Fetch intercepting
        interceptAjax();
        
        // Wait for body to render then inject UI
        setTimeout(() => {
            createDashboardUI();
            // Automatically scan list on initial load (có retry sẵn bên trong)
            scanList();
            // Từ giờ tự quét lại mỗi khi danh sách đổi, khỏi cần bấm tay
            observeListChanges();
        }, 1500);
    };

    // Run helper
    init();

})();