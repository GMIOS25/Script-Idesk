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

(() => {
  // src/config.js
  var CONFIG = {
    BACKEND_URL: "http://localhost:5000/documents/process",
    AUTH_URL: "http://localhost:5000/auth/token",
    DELAY_MS: {
      SELECT_DOC: 1e3,
      CLICK_SAVE_TRANSFER: 1200,
      OPEN_TREE: 800,
      TREE_SEARCH: 500,
      CLOSE_TREE: 350,
      AFTER_SUBMIT: 1800,
      BETWEEN_DOCS: 800
    }
  };
  var S = {
    LEFT_LIST: "#listview-process-list-list-content div.messageListItem",
    LEFT_LIST_FALLBACK: "div.messageListItem[data-id]",
    SAVE_TRANSFER_BTN: "#ed-view-btn-transfer",
    TRANSFER_CONTAINER: "#ed-transfer-document-container",
    RESPONSIBLE_LINK: "#ed-transfer-select-user-responsible a.user-box-link",
    RESPONSIBLE_WRAP: "#ed-transfer-select-user-responsible",
    PARTICIPANTS_LINK: "#ed-transfer-select-user-participants a.user-box-link",
    PARTICIPANTS_WRAP: "#ed-transfer-select-user-participants",
    DEADLINE_INPUT: "#ed-transfer-txt-deadline",
    DEADLINE_NUMBER: "#ed-transfer-txt-deadline-number",
    PRIORITY_SELECT: "#ed-transfer-select-priority",
    CONTENT_TEXTAREA: "#ed-transfer-txt-content",
    AGREE_BTN: "#ed-transfer-btn-transfer",
    CANCEL_BTN: "#ed-transfer-btn-cancel"
  };

  // src/state.js
  var docCache = /* @__PURE__ */ new Map();
  var unitCache = /* @__PURE__ */ new Map();
  var expandedRows = /* @__PURE__ */ new Set();
  var state = {
    isProcessing: false,
    basePath: "",
    // vd: "/cumvinhthanh/smartcloud"
    execAcode: "",
    // receiverAcode của người đăng nhập
    cachedAuthToken: ""
  };
  var setProcessing = (val) => {
    state.isProcessing = val;
  };
  var setBasePath = (path) => {
    state.basePath = path;
  };
  var setExecAcode = (code) => {
    state.execAcode = code;
  };
  var setCachedAuthToken = (token) => {
    state.cachedAuthToken = token;
  };

  // src/utils/logger.js
  var setStatus = (msg) => {
    const el = document.getElementById("rpa-footer-status");
    if (el) el.textContent = msg;
    appendLog(msg);
  };
  var appendLog = (msg) => {
    const logBody = document.getElementById("rpa-log-body");
    if (logBody) {
      const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("vi-VN");
      const row = document.createElement("div");
      row.className = "rpa-log-entry";
      row.innerHTML = `<span class="rpa-log-time">[${time}]</span> ${msg}`;
      logBody.appendChild(row);
      logBody.scrollTop = logBody.scrollHeight;
    }
  };

  // src/utils/helpers.js
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var formatDate = (date) => {
    const d = date || /* @__PURE__ */ new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  var calcDeadline = (days) => {
    const date = /* @__PURE__ */ new Date();
    date.setDate(date.getDate() + parseInt(days));
    return formatDate(date);
  };
  var getVisibleItems = () => {
    let items = Array.from(document.querySelectorAll(S.LEFT_LIST));
    if (items.length === 0) items = Array.from(document.querySelectorAll(S.LEFT_LIST_FALLBACK));
    return items.filter((el) => el.offsetParent !== null);
  };
  var deriveBasePath = (url) => {
    const m = (url || "").match(/(\/[^\/?]+\/smartcloud)(?=\/)/);
    return m ? m[1] : null;
  };
  var ensureBasePath = (url) => {
    if (state.basePath) return;
    const derived = deriveBasePath(url);
    if (derived) {
      setBasePath(derived);
      appendLog(`Da xac dinh duong dan goc he thong: ${state.basePath}`);
    }
  };
  var getFallbackBasePath = () => {
    const seg = window.location.pathname.split("/").filter(Boolean)[0];
    return seg ? `/${seg}/smartcloud` : "/smartcloud";
  };
  var findByVisibleText = (root, selector, texts) => {
    const scope = root || document;
    const nodes = scope.querySelectorAll(selector);
    for (const el of nodes) {
      const t = (el.textContent || el.value || "").trim();
      if (texts.includes(t) && el.offsetParent !== null) return el;
    }
    return null;
  };

  // src/ui/styles.js
  var CSS_STYLES = `
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
`;

  // src/utils/attachment.js
  var selectAttachment = (doc) => {
    const attachments = doc.attachments || [];
    if (attachments.length === 0) return null;
    const signNumber = doc.signNumber || "";
    const leadingMatch = signNumber.match(/^\s*(\d+)/) || signNumber.match(/(\d+)/);
    const signDigits = leadingMatch ? leadingMatch[1] : null;
    if (signDigits) {
      const matchedByNum = attachments.find((att) => {
        const name = att.name || "";
        const attDigitsMatch = name.match(/^\s*(\d+)/) || name.match(/(\d+)/);
        return attDigitsMatch && attDigitsMatch[1] === signDigits;
      });
      if (matchedByNum) {
        appendLog(`Match file dinh kem theo so dau "${signDigits}": ${matchedByNum.name}`);
        return matchedByNum;
      }
    }
    const matchedSigned = attachments.find((att) => att.signed === "Y");
    if (matchedSigned) {
      appendLog(`Fallback chon file da ky (signed="Y"): ${matchedSigned.name}`);
      return matchedSigned;
    }
    const pdfAttach = attachments.find((att) => att.format === "pdf" || (att.name || "").toLowerCase().endsWith(".pdf"));
    const fallback = pdfAttach || attachments[0];
    appendLog(`Fallback mac dinh chon file: ${fallback ? fallback.name : "N/A"}`);
    return fallback;
  };

  // src/services/ai.js
  var getAuthToken = () => {
    return new Promise((resolve) => {
      if (state.cachedAuthToken) return resolve(state.cachedAuthToken);
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.AUTH_URL,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ username: "fe-server-prod", password: "secret_password" }),
        onload: (resp) => {
          if (resp.status === 200) {
            try {
              const res = JSON.parse(resp.responseText);
              const token = res.access_token || "";
              setCachedAuthToken(token);
              appendLog("Da lay Auth Token tu Backend");
            } catch (e) {
            }
          }
          resolve(state.cachedAuthToken);
        },
        onerror: () => resolve(""),
        ontimeout: () => resolve("")
      });
    });
  };
  var callAIBackend = async (doc) => {
    const targetAttach = selectAttachment(doc);
    if (!targetAttach) {
      throw new Error(`Khong tim thay file dinh kem phu hop cho VB "${doc.signNumber}"`);
    }
    const bp = state.basePath || getFallbackBasePath();
    const fileUrl = window.location.origin + `${bp}/docx/download.cpx?docID=${targetAttach.contentUid}&view=pdf`;
    const token = await getAuthToken();
    const payload = {
      metadata: {
        document_number: doc.signNumber || "",
        document_type: doc.category || "",
        issuing_agency: doc.author || "",
        document_date: doc.docDateStr || "",
        signer: doc.signer || "",
        subject: doc.subject || ""
      },
      file_url: fileUrl
    };
    return new Promise((resolve, reject) => {
      setStatus(`Gui "${doc.signNumber}" den AI (DocFlow API)...`);
      const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.BACKEND_URL,
        headers,
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
        ontimeout: () => reject(new Error("Timeout goi AI backend"))
      });
    });
  };

  // src/automation/treeSelect.js
  var selectTreeItem = async (linkSelector, wrapSelector, targetName) => {
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
    let popup = popupSelectors.map((sel) => document.querySelector(sel)).find((el) => el && el.offsetParent !== null);
    if (!popup) {
      document.body.click();
      await sleep(200);
      return false;
    }
    const searchInput = popup.querySelector('input[type="text"]');
    if (searchInput) {
      searchInput.value = targetName;
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(new Event("keyup", { bubbles: true }));
      await sleep(CONFIG.DELAY_MS.TREE_SEARCH);
    }
    const labels = popup.querySelectorAll("label, span, a, li, .user-box-item, div");
    let clicked = false;
    const tryClick = (el) => {
      const cb = el.querySelector('input[type="checkbox"], input[type="radio"]');
      if (cb) {
        cb.click();
        return true;
      }
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

  // src/automation/formFiller.js
  var autoFillAndSubmit = async (docId, aiData) => {
    const itemEl = document.querySelector(`.messageListItem[data-id="${docId}"]`);
    if (!itemEl) throw new Error(`Khong tim thay VB ID ${docId}`);
    if (!itemEl.classList.contains("selected")) {
      itemEl.click();
      await sleep(CONFIG.DELAY_MS.SELECT_DOC);
    }
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
      const agreeGuess = findByVisibleText(document, "button, a", ["\u0110\u1ED3ng \xFD", "Dong y"]);
      container = agreeGuess ? agreeGuess.closest("div[id], form, .modal, .popover") || document : null;
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
        numInput.dispatchEvent(new Event("input", { bubbles: true }));
        numInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const dateInput = document.querySelector(S.DEADLINE_INPUT);
      if (dateInput) {
        dateInput.value = deadlineDate;
        dateInput.dispatchEvent(new Event("input", { bubbles: true }));
        dateInput.dispatchEvent(new Event("change", { bubbles: true }));
        dateInput.dispatchEvent(new Event("blur", { bubbles: true }));
        appendLog(`Han xu ly: ${deadlineDate} (+${daysNum} ngay)`);
      }
    }
    const prioritySelect = document.querySelector(S.PRIORITY_SELECT);
    if (prioritySelect) {
      let pVal = "0";
      const pRaw = aiData.priority !== void 0 && aiData.priority !== null ? aiData.priority : aiData.do_khan;
      if (pRaw !== void 0 && pRaw !== null) {
        if (pRaw === 1 || pRaw === "1" || pRaw === "Kh\u1EA9n" || pRaw === "khan") pVal = "1";
        else if (pRaw === 2 || pRaw === "2" || pRaw === "Th\u01B0\u1EE3ng kh\u1EA9n" || pRaw === "thuong_khan" || pRaw === "H\u1ECFa t\u1ED1c") pVal = "2";
        else pVal = String(pRaw);
      }
      prioritySelect.value = pVal;
      prioritySelect.dispatchEvent(new Event("change", { bubbles: true }));
      const pText = prioritySelect.options[prioritySelect.selectedIndex]?.text || pVal;
      appendLog(`Do khan: ${pText}`);
    }
    const contentTextarea = document.querySelector(S.CONTENT_TEXTAREA);
    if (contentTextarea) {
      const contentVal = aiData.notes || aiData.ghi_chu || aiData.content || aiData.summary || aiData.tom_tat || "";
      contentTextarea.value = contentVal;
      contentTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      contentTextarea.dispatchEvent(new Event("change", { bubbles: true }));
      appendLog(`Noi dung: ${contentVal.substring(0, 45)}${contentVal.length > 45 ? "..." : ""}`);
    }
    const agreeBtn = document.querySelector(S.AGREE_BTN) || findByVisibleText(container, "button, a", ["\u0110\u1ED3ng \xFD", "Dong y"]);
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

  // src/controllers/mainController.js
  var scanAndSendAll = async () => {
    if (state.isProcessing) return alert("Dang xu ly, vui long cho!");
    const found = await scanList(4);
    if (!found) return;
    const pendingIds = [];
    docCache.forEach((doc, id) => {
      if (doc.status === "idle") pendingIds.push(id);
    });
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
      doc.status = "pending";
      updateDashboard();
      updateProgress(i, total);
      try {
        const fullDoc = await ensureDocDetails(id);
        if (fullDoc.attachments && fullDoc.attachments.length > 0) {
          doc.aiData = await callAIBackend(fullDoc);
          doc.status = "ai_done";
          success++;
        } else {
          throw new Error("Van ban khong co file dinh kem");
        }
      } catch (err) {
        doc.status = "ai_error";
        errors++;
        appendLog(`${doc.signNumber}: ${err.message}`);
      }
      updateDashboard();
      updateProgress(i + 1, total);
    }
    setProcessing(false);
    setStatus(`Hoan tat AI: ${success} thanh cong, ${errors} loi`);
    updateProgress(total, total);
  };
  var runFillOnAll = async () => {
    if (state.isProcessing) return alert("Dang xu ly, vui long cho!");
    const checkboxes = document.querySelectorAll(".rpa-row-check:checked");
    if (checkboxes.length === 0) return alert("Hay chon it nhat 1 van ban!");
    setProcessing(true);
    let success = 0, errors = 0;
    const total = checkboxes.length;
    updateProgress(0, total);
    for (let i = 0; i < checkboxes.length; i++) {
      const chk = checkboxes[i];
      const id = chk.getAttribute("data-id");
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
        doc.status = "fill_done";
        success++;
        chk.checked = false;
      } catch (err) {
        doc.status = "fill_error";
        errors++;
        appendLog(`Loi ${doc.signNumber}: ${err.message}`);
      }
      updateDashboard();
      updateProgress(i + 1, total);
      await sleep(CONFIG.DELAY_MS.BETWEEN_DOCS);
    }
    setProcessing(false);
    setStatus(`Ket thuc tu dong dien: ${success}/${total} thanh cong`);
    updateProgress(total, total);
  };
  var updateProgress = (current, total) => {
    const fill = document.getElementById("rpa-progress-fill");
    const text = document.getElementById("rpa-progress-text");
    if (fill && text) {
      fill.style.width = (total > 0 ? Math.round(current / total * 100) : 0) + "%";
      text.textContent = `${current}/${total}`;
    }
  };

  // src/ui/dashboard.js
  var logPanel = null;
  var createDashboard = () => {
    if (document.getElementById("idesk-rpa-hub")) return;
    GM_addStyle(CSS_STYLES);
    const hub = document.createElement("div");
    hub.id = "idesk-rpa-hub";
    hub.innerHTML = `
        <div class="rpa-header">
            <div class="rpa-title">
                iDesk RPA <span class="badge-count" id="rpa-doc-count">0</span>
            </div>
            <div class="rpa-header-actions">
                <button id="rpa-btn-toggle-log">Console</button>
                <button id="rpa-btn-minimize">Thu nh\u1ECF</button>
            </div>
        </div>
        <div class="rpa-body">
            <div class="rpa-toolbar">
                <button class="rpa-btn rpa-btn-primary" id="rpa-btn-scan">Qu\xE9t &amp; G\u1EEDi AI</button>
                <button class="rpa-btn rpa-btn-purple" id="rpa-btn-fill-all">T\u1EF1 \u0111\u1ED9ng \u0111i\u1EC1n</button>
                <button class="rpa-btn rpa-btn-outline" id="rpa-btn-select-all">Ch\u1ECDn / B\u1ECF ch\u1ECDn</button>
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
            <span class="rpa-status-text" id="rpa-footer-status">San sang. Nhan "Qu\xE9t & G\u1EEDi AI" de bat dau.</span>
            <div class="rpa-progress-wrap">
                <span class="rpa-progress-text" id="rpa-progress-text">0/0</span>
                <div class="rpa-progress-bar"><div class="rpa-progress-fill" id="rpa-progress-fill"></div></div>
            </div>
        </div>
    `;
    document.body.appendChild(hub);
    logPanel = document.getElementById("rpa-log-panel");
    makeDraggable(hub);
    document.getElementById("rpa-btn-minimize").addEventListener("click", () => hub.classList.toggle("minimized"));
    document.getElementById("rpa-btn-toggle-log").addEventListener("click", () => logPanel.classList.toggle("open"));
    document.getElementById("rpa-btn-scan").addEventListener("click", scanAndSendAll);
    document.getElementById("rpa-btn-fill-all").addEventListener("click", runFillOnAll);
    document.getElementById("rpa-check-all").addEventListener("change", (e) => {
      document.querySelectorAll(".rpa-row-check").forEach((cb) => cb.checked = e.target.checked);
    });
    document.getElementById("rpa-btn-select-all").addEventListener("click", () => {
      const allCb = document.getElementById("rpa-check-all");
      allCb.checked = !allCb.checked;
      allCb.dispatchEvent(new Event("change"));
    });
    document.querySelector("#rpa-doc-table tbody").addEventListener("click", (e) => {
      if (e.target.closest('input[type="checkbox"]')) return;
      const mainRow = e.target.closest(".rpa-row-main");
      if (mainRow) {
        const id = mainRow.getAttribute("data-id");
        if (expandedRows.has(id)) expandedRows.delete(id);
        else expandedRows.add(id);
        updateDashboard();
      }
    });
    appendLog("Khoi tao iDesk RPA Minimalist UI v2.3");
  };
  var makeDraggable = (elmnt) => {
    const header = elmnt.querySelector(".rpa-header");
    let startX, startY, startTop, startLeft, dragging = false;
    header.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = elmnt.getBoundingClientRect();
      startTop = rect.top;
      startLeft = rect.left;
      elmnt.style.top = startTop + "px";
      elmnt.style.left = startLeft + "px";
      elmnt.style.bottom = "auto";
      elmnt.style.right = "auto";
      elmnt.classList.add("rpa-dragging");
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    header.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      elmnt.style.left = Math.min(Math.max(startLeft + dx, -elmnt.offsetWidth + 80), window.innerWidth - 60) + "px";
      elmnt.style.top = Math.min(Math.max(startTop + dy, 0), window.innerHeight - 50) + "px";
    });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      elmnt.classList.remove("rpa-dragging");
      try {
        header.releasePointerCapture(e.pointerId);
      } catch (err) {
      }
    };
    header.addEventListener("pointerup", stop);
    header.addEventListener("pointercancel", stop);
  };
  var updateDashboard = () => {
    const tbody = document.querySelector("#rpa-doc-table tbody");
    if (!tbody) return;
    const countEl = document.getElementById("rpa-doc-count");
    if (countEl) countEl.textContent = docCache.size.toString();
    if (docCache.size === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#666;padding:35px;">Nhan "Quet & Gui AI" de bat dau...</td></tr>`;
      return;
    }
    let html = "";
    docCache.forEach((doc, id) => {
      const statusMap = {
        "idle": ["rpa-badge-idle", "Chua gui"],
        "pending": ["rpa-badge-pending", "Dang gui"],
        "ai_done": ["rpa-badge-success", "Da phan tich"],
        "ai_error": ["rpa-badge-error", "Loi AI"],
        "fill_done": ["rpa-badge-sent", "Da dien"],
        "fill_error": ["rpa-badge-error", "Loi dien"]
      };
      const s = statusMap[doc.status] || statusMap.idle;
      const isExpanded = expandedRows.has(id);
      const ai = doc.aiData || {};
      const summary = ai.tom_tat || ai.summary || "---";
      const bookInfo = doc.book ? `So ${doc.book.serialNumber || "---"}${doc.book.dateStr ? " (" + formatDate(new Date(doc.book.dateStr)) + ")" : ""}` : "---";
      const mainUnit = ai.don_vi_xu_ly || ai.processing_unit || "---";
      const leader = ai.lanh_dao_theo_doi || ai.monitoring_leader || "---";
      const days = ai.thoi_han_thuc_hien || ai.implementation_deadline;
      const daysStr = days ? `${days} ngay` : "---";
      const coUnits = ai.don_vi_phoi_hop || ai.coordinating_units;
      const coUnitsStr = Array.isArray(coUnits) && coUnits.length > 0 ? coUnits.join(", ") : "---";
      const notes = ai.ghi_chu || ai.notes || "---";
      const pRaw = ai.priority !== void 0 && ai.priority !== null ? ai.priority : ai.do_khan;
      let priorityStr = "B\xECnh th\u01B0\u1EDDng";
      if (pRaw === 1 || pRaw === "1" || pRaw === "Kh\u1EA9n" || pRaw === "khan") priorityStr = "Kh\u1EA9n";
      else if (pRaw === 2 || pRaw === "2" || pRaw === "Th\u01B0\u1EE3ng kh\u1EA9n" || pRaw === "thuong_khan" || pRaw === "H\u1ECFa t\u1ED1c") priorityStr = "Th\u01B0\u1EE3ng kh\u1EA9n";
      html += `
            <tr data-id="${id}" class="rpa-row-main ${isExpanded ? "expanded" : ""}">
                <td><input type="checkbox" class="rpa-row-check" data-id="${id}" ${doc.status === "fill_done" ? "" : "checked"}></td>
                <td><span class="rpa-toggle-text">${isExpanded ? "[-]" : "[+]"}</span></td>
                <td><div class="rpa-doc-code" title="${doc.signNumber}">${doc.signNumber || "---"}</div></td>
                <td><div class="rpa-doc-text" title="${doc.subject}">${doc.subject || "---"}</div></td>
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
                                <span class="rpa-detail-value">${doc.author || "---"}</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Nguoi ky / Ngay VB</span>
                                <span class="rpa-detail-value">${doc.signer || "---"} (${doc.docDateStr || "---"})</span>
                            </div>
                            <div class="rpa-detail-field">
                                <span class="rpa-detail-label">Loai van ban</span>
                                <span class="rpa-detail-value">${doc.category || "---"}</span>
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
  var scanList = async (retries = 3) => {
    setStatus("Dang quet danh sach van ban...");
    let items = getVisibleItems();
    let attempt = 0;
    while (items.length === 0 && attempt < retries) {
      attempt++;
      await sleep(800);
      items = getVisibleItems();
    }
    if (items.length === 0) {
      setStatus("Khong tim thay van ban.");
      return 0;
    }
    let newCount = 0;
    items.forEach((el) => {
      const id = el.getAttribute("data-id");
      if (id && !docCache.has(id)) {
        docCache.set(id, {
          id,
          signNumber: el.querySelector(".sender")?.textContent?.trim() || "",
          subject: el.querySelector(".subject")?.textContent?.trim() || "",
          status: "idle",
          aiData: null,
          attachments: [],
          creatorAcode: ""
        });
        newCount++;
      }
    });
    updateDashboard();
    setStatus(`Da quet: ${docCache.size} VB (${newCount} moi)`);
    return items.length;
  };

  // src/services/api.js
  var handleListResponse = (data) => {
    if (!data || !data.items) return;
    appendLog(`API qsprocess: ${data.items.length} van ban`);
    data.items.forEach((item) => {
      const id = item.id.toString();
      const ed = item.edSearchDto || {};
      const doc = docCache.get(id) || { id };
      doc.signNumber = ed.signNumber || doc.signNumber || "";
      doc.subject = ed.subject || doc.subject || "";
      doc.category = ed.category || doc.category || "";
      doc.author = ed.author || doc.author || "";
      doc.signer = ed.signer || doc.signer || "";
      doc.docDateStr = ed.docDateStr || doc.docDateStr || "";
      doc.creatorAcode = ed.creatorAcode || doc.creatorAcode || "";
      doc.responsibility = item.responsibility || doc.responsibility || "main";
      doc.book = item.book || doc.book || null;
      doc.status = doc.status || "idle";
      doc.aiData = doc.aiData || null;
      docCache.set(id, doc);
    });
    updateDashboard();
  };
  var handleViewResponse = (data) => {
    if (!data || !data.ed) return;
    const id = data.ed.id.toString();
    const doc = docCache.get(id) || { id };
    const ed = data.ed;
    doc.subject = ed.subject || doc.subject || "";
    doc.signNumber = ed.signNumber || doc.signNumber || "";
    doc.category = ed.category || doc.category || "";
    doc.author = ed.author || doc.author || "";
    doc.signer = ed.signer || doc.signer || "";
    doc.docDateStr = ed.docDateStr || doc.docDateStr || "";
    doc.creatorAcode = ed.creatorAcode || doc.creatorAcode || "";
    doc.attachments = data.attachments || doc.attachments || [];
    doc.book = data.book || doc.book || null;
    docCache.set(id, doc);
    updateExecAcodeFromView(data);
    updateDashboard();
  };
  var handleUnitsResponse = (data) => {
    if (!data || !data.elements) return;
    data.elements.forEach((unit) => unitCache.set(unit.id, unit));
    appendLog(`API fbyvsphere: Cap nhat ${data.elements.length} don vi/ca nhan xu ly`);
  };
  var updateExecAcodeFromView = (data) => {
    if (state.execAcode) return;
    const pool = [];
    if (Array.isArray(data.senders)) pool.push(...data.senders);
    if (Array.isArray(data.proInfos)) pool.push(...data.proInfos);
    const mainEntry = pool.find((e) => e && e.responsibility === "main" && e.receiverAcode);
    if (mainEntry) {
      setExecAcode(mainEntry.receiverAcode);
      appendLog(`Da xac dinh ma dinh danh xu ly (exeacode): ${state.execAcode}`);
    }
  };
  var ensureDocDetails = async (id) => {
    let doc = docCache.get(id.toString()) || { id: id.toString(), status: "idle" };
    docCache.set(id.toString(), doc);
    if (!doc.attachments || doc.attachments.length === 0) {
      const itemEl = document.querySelector(`.messageListItem[data-id="${id}"]`);
      if (itemEl && !itemEl.classList.contains("selected")) {
        itemEl.click();
        await sleep(CONFIG.DELAY_MS.SELECT_DOC);
        doc = docCache.get(id.toString()) || doc;
      }
    }
    if ((!doc.attachments || doc.attachments.length === 0) && state.execAcode) {
      try {
        const bp = state.basePath || getFallbackBasePath();
        const resp = await fetch(`${bp}/document/edocs/view.cpx?exeacode=${state.execAcode}&id=${id}&responsibility=${doc.responsibility || "main"}`);
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

  // src/services/interceptor.js
  var interceptXHR = () => {
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;
    XHR.open = function(method, url) {
      this._url = url;
      return origOpen.apply(this, arguments);
    };
    XHR.send = function(body) {
      this.addEventListener("load", function() {
        try {
          const url = this._url || "";
          if (url.includes("qsprocess.cpx") || url.includes("view.cpx") || url.includes("fbyvsphere.cpx")) {
            ensureBasePath(url);
          }
          if (url.includes("qsprocess.cpx")) {
            handleListResponse(JSON.parse(this.responseText));
          } else if (url.includes("view.cpx") && url.includes("exeacode=")) {
            handleViewResponse(JSON.parse(this.responseText));
          } else if (url.includes("fbyvsphere.cpx")) {
            handleUnitsResponse(JSON.parse(this.responseText));
          }
        } catch (e) {
        }
      });
      return origSend.apply(this, arguments);
    };
  };
  var interceptFetch = () => {
    const origFetch = unsafeWindow.fetch.bind(unsafeWindow);
    unsafeWindow.fetch = function(input, init2) {
      const url = typeof input === "string" ? input : input.url || "";
      return origFetch(input, init2).then(async (response) => {
        if (url.includes("qsprocess.cpx") || url.includes("view.cpx") || url.includes("fbyvsphere.cpx")) {
          ensureBasePath(url);
          const clone = response.clone();
          try {
            const data = await clone.json();
            if (url.includes("qsprocess.cpx")) handleListResponse(data);
            else if (url.includes("view.cpx")) handleViewResponse(data);
            else if (url.includes("fbyvsphere.cpx")) handleUnitsResponse(data);
          } catch (e) {
          }
        }
        return response;
      }).catch((err) => {
        throw err;
      });
    };
  };

  // src/index.js
  var init = () => {
    interceptXHR();
    interceptFetch();
    const waitAndStart = () => {
      if (!document.getElementById("process-list-widget")) {
        setTimeout(waitAndStart, 400);
        return;
      }
      createDashboard();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", waitAndStart);
    } else {
      waitAndStart();
    }
  };
  init();
})();
