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
// @downloadURL  https://raw.githubusercontent.com/GMIOS25/Script-Idesk/features/chairperson/dist/idesk_automation.user.js
// @updateURL    https://raw.githubusercontent.com/GMIOS25/Script-Idesk/features/chairperson/dist/idesk_automation.user.js
// ==/UserScript==

// ==============================================================================
// ⚠️ FILE TỰ ĐỘNG SINH RA (AUTO-GENERATED BUNDLE). KHÔNG SỬA TRỰC TIẾP FILE NÀY!
// 💡 Vui lòng sửa code tại các file module trong thư mục src/ (vd: src/config.js,
//    src/services/ai.js, src/ui/dashboard.js...), sau đó gõ "pnpm run build".
// ==============================================================================

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
    /* ===== iDesk RPA Minimalist UI v3.0 (Bento Card Feed - Direct Scroll) ===== */
    #idesk-rpa-hub {
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        width: min(1200px, 95vw) !important;
        height: min(780px, 88vh) !important;
        background: #121212 !important;
        border: 1px solid #282828 !important;
        border-radius: 8px !important;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4) !important;
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
        gap: 12px !important;
        align-items: center !important;
        background: #161618 !important;
        padding: 8px 12px !important;
        border-radius: 6px !important;
        border: 1px solid #242427 !important;
    }

    .rpa-select-all-label {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 12px !important;
        color: #A1A1AA !important;
        cursor: pointer !important;
        user-select: none !important;
        margin-left: auto !important;
    }
    .rpa-select-all-label input { cursor: pointer !important; }

    .rpa-btn {
        background: #1A1A1A !important;
        border: 1px solid #333333 !important;
        color: #EAEAEA !important;
        border-radius: 4px !important;
        padding: 7px 16px !important;
        font-weight: 500 !important;
        font-size: 12px !important;
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

    /* ===== CARD FEED WRAPPER ===== */
    .rpa-feed-wrap {
        flex: 1 !important;
        overflow-y: auto !important;
        padding-right: 4px !important;
    }
    .rpa-feed-wrap::-webkit-scrollbar { width: 6px !important; }
    .rpa-feed-wrap::-webkit-scrollbar-thumb { background: #282828 !important; border-radius: 3px !important; }

    .rpa-card-feed {
        display: flex !important;
        flex-direction: column !important;
        gap: 14px !important;
    }

    .rpa-empty-state {
        text-align: center !important;
        color: #71717A !important;
        padding: 48px 20px !important;
        background: #161618 !important;
        border: 1px solid #262626 !important;
        border-radius: 8px !important;
        font-size: 13px !important;
    }

    /* ===== DOCUMENT BENTO CARD ===== */
    .rpa-doc-card {
        background: #161618 !important;
        border: 1px solid #28282B !important;
        border-radius: 8px !important;
        padding: 16px 18px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        transition: border-color 0.15s, background 0.15s !important;
    }
    .rpa-doc-card:hover {
        border-color: #3F3F46 !important;
        background: #18181B !important;
    }

    /* Card Header */
    .rpa-card-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        gap: 10px !important;
        padding-bottom: 10px !important;
        border-bottom: 1px solid #242427 !important;
    }
    .rpa-card-header-left {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        flex-wrap: wrap !important;
    }
    .rpa-card-header-right {
        display: flex !important;
        align-items: center !important;
    }

    .rpa-doc-code {
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-weight: 700 !important;
        color: #FFFFFF !important;
        font-size: 14px !important;
        background: #242427 !important;
        padding: 2px 8px !important;
        border-radius: 4px !important;
        border: 1px solid #333338 !important;
    }

    /* Tags */
    .rpa-tag {
        font-size: 11px !important;
        padding: 2px 8px !important;
        border-radius: 4px !important;
        font-weight: 500 !important;
        letter-spacing: 0.02em !important;
    }
    .rpa-tag-type {
        background: #27272A !important;
        color: #A1A1AA !important;
        border: 1px solid #3F3F46 !important;
    }
    .rpa-tag-priority {
        background: #FBF3DB !important;
        color: #956400 !important;
        border: 1px solid #F7E4A9 !important;
        font-weight: 600 !important;
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
    .rpa-badge-pending { background: #E1F3FE !important; color: #1F6C9F !important; }
    .rpa-badge-success { background: #EDF3EC !important; color: #346538 !important; }
    .rpa-badge-error { background: #FDEBEC !important; color: #9F2F2D !important; }
    .rpa-badge-sent { background: #E1F3FE !important; color: #1F6C9F !important; }

    /* Card Body */
    .rpa-card-body {
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
    }

    .rpa-card-subject {
        font-size: 14px !important;
        font-weight: 600 !important;
        color: #F4F4F5 !important;
        line-height: 1.5 !important;
    }
    .rpa-subject-label {
        color: #71717A !important;
        font-weight: 500 !important;
        font-size: 12px !important;
        text-transform: uppercase !important;
        margin-right: 4px !important;
    }

    /* AI Summary Callout */
    .rpa-card-summary {
        background: #111113 !important;
        border: 1px solid #242427 !important;
        border-left: 3px solid #EAEAEA !important;
        border-radius: 6px !important;
        padding: 12px 14px !important;
    }
    .rpa-summary-title {
        font-size: 10px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.08em !important;
        color: #A1A1AA !important;
        font-weight: 600 !important;
        margin-bottom: 4px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
    }
    .rpa-summary-text {
        font-size: 13px !important;
        color: #E4E4E7 !important;
        line-height: 1.6 !important;
        white-space: pre-wrap !important;
    }

    /* Meta Grid */
    .rpa-card-meta-grid {
        display: grid !important;
        grid-template-columns: repeat(3, 1fr) !important;
        gap: 12px !important;
        background: #131315 !important;
        border: 1px solid #222225 !important;
        padding: 12px 14px !important;
        border-radius: 6px !important;
    }

    .rpa-meta-item {
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
    }
    .rpa-meta-label {
        font-size: 10px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        color: #71717A !important;
        font-weight: 600 !important;
    }
    .rpa-meta-value {
        font-size: 13px !important;
        color: #D4D4D8 !important;
    }
    .rpa-meta-value.main-unit {
        color: #FFFFFF !important;
        font-weight: 600 !important;
    }
    .rpa-meta-value.deadline {
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        color: #FFFFFF !important;
        font-weight: 500 !important;
    }

    .rpa-unit-tags {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 4px !important;
    }
    .rpa-unit-pill {
        background: #242427 !important;
        border: 1px solid #333338 !important;
        color: #D4D4D8 !important;
        padding: 1px 8px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
    }

    /* Card Footer Meta */
    .rpa-card-footer-meta {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 16px !important;
        font-size: 11px !important;
        color: #888888 !important;
        padding-top: 4px !important;
    }
    .rpa-card-footer-meta strong {
        color: #A1A1AA !important;
    }

    /* ===== LOG PANEL ===== */
    .rpa-log-panel {
        display: none !important;
        height: 120px !important;
        background: #0A0A0A !important;
        border: 1px solid #222222 !important;
        border-radius: 4px !important;
        padding: 8px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-size: 11px !important;
        overflow-y: auto !important;
        color: #00FF66 !important;
    }
    .rpa-log-panel.open { display: block !important; }

    /* ===== FOOTER ===== */
    .rpa-footer {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 8px 16px !important;
        background: #181818 !important;
        border-top: 1px solid #262626 !important;
        font-size: 11px !important;
        color: #888888 !important;
    }

    .rpa-progress-wrap {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
    }
    .rpa-progress-bar {
        width: 100px !important;
        height: 6px !important;
        background: #262626 !important;
        border-radius: 3px !important;
        overflow: hidden !important;
    }
    .rpa-progress-fill {
        width: 0% !important;
        height: 100% !important;
        background: #FFFFFF !important;
        transition: width 0.2s ease !important;
    }
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
                <label class="rpa-select-all-label">
                    <input type="checkbox" id="rpa-check-all" checked>
                    <span>Ch\u1ECDn t\u1EA5t c\u1EA3</span>
                </label>
                <button class="rpa-btn rpa-btn-outline" id="rpa-btn-select-all">\u0110\u1EA3o ch\u1ECDn</button>
            </div>
            <div class="rpa-feed-wrap">
                <div class="rpa-card-feed" id="rpa-card-feed">
                    <div class="rpa-empty-state">Nh\u1EA5n "Qu\xE9t &amp; G\u1EEDi AI" \u0111\u1EC3 b\u1EAFt \u0111\u1EA7u...</div>
                </div>
            </div>
            <div class="rpa-log-panel" id="rpa-log-panel"><div id="rpa-log-body"></div></div>
        </div>
        <div class="rpa-footer">
            <span class="rpa-status-text" id="rpa-footer-status">S\u1EB5n s\xE0ng. Nh\u1EA5n "Qu\xE9t &amp; G\u1EEDi AI" \u0111\u1EC3 b\u1EAFt \u0111\u1EA7u.</span>
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
    appendLog("Kh\u1EDFi t\u1EA1o iDesk RPA Card Feed UI v3.0");
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
    const cardFeed = document.getElementById("rpa-card-feed");
    if (!cardFeed) return;
    const countEl = document.getElementById("rpa-doc-count");
    if (countEl) countEl.textContent = docCache.size.toString();
    if (docCache.size === 0) {
      cardFeed.innerHTML = `<div class="rpa-empty-state">Nh\u1EA5n "Qu\xE9t &amp; G\u1EEDi AI" \u0111\u1EC3 b\u1EAFt \u0111\u1EA7u...</div>`;
      return;
    }
    let html = "";
    docCache.forEach((doc, id) => {
      const statusMap = {
        "idle": ["rpa-badge-idle", "Ch\u01B0a g\u1EEDi"],
        "pending": ["rpa-badge-pending", "\u0110ang g\u1EEDi"],
        "ai_done": ["rpa-badge-success", "\u0110\xE3 ph\xE2n t\xEDch"],
        "ai_error": ["rpa-badge-error", "L\u1ED7i AI"],
        "fill_done": ["rpa-badge-sent", "\u0110\xE3 \u0111i\u1EC1n"],
        "fill_error": ["rpa-badge-error", "L\u1ED7i \u0111i\u1EC1n"]
      };
      const s = statusMap[doc.status] || statusMap.idle;
      const ai = doc.aiData || {};
      const summary = ai.tom_tat || ai.summary || "Ch\u01B0a c\xF3 t\xF3m t\u1EAFt AI...";
      const bookInfo = doc.book ? `S\u1ED1 ${doc.book.serialNumber || "---"}${doc.book.dateStr ? " (" + formatDate(new Date(doc.book.dateStr)) + ")" : ""}` : "---";
      const mainUnit = ai.don_vi_xu_ly || ai.processing_unit || "---";
      const leader = ai.lanh_dao_theo_doi || ai.monitoring_leader || "---";
      const days = ai.thoi_han_thuc_hien || ai.implementation_deadline;
      const daysStr = days ? `${days} ng\xE0y` : "---";
      const coUnits = ai.don_vi_phoi_hop || ai.coordinating_units;
      const notes = ai.ghi_chu || ai.notes || "---";
      const docType = doc.category || ai.document_type || ai.loai_van_ban || "";
      let coUnitsPills = '<span class="rpa-meta-value">---</span>';
      if (Array.isArray(coUnits) && coUnits.length > 0) {
        coUnitsPills = coUnits.map((u) => `<span class="rpa-unit-pill">${u}</span>`).join(" ");
      } else if (typeof coUnits === "string" && coUnits.trim() && coUnits !== "---") {
        coUnitsPills = `<span class="rpa-unit-pill">${coUnits.trim()}</span>`;
      }
      const pRaw = ai.priority !== void 0 && ai.priority !== null ? ai.priority : ai.do_khan;
      let priorityStr = "B\xECnh th\u01B0\u1EDDng";
      if (pRaw === 1 || pRaw === "1" || pRaw === "Kh\u1EA9n" || pRaw === "khan") priorityStr = "Kh\u1EA9n";
      else if (pRaw === 2 || pRaw === "2" || pRaw === "Th\u01B0\u1EE3ng kh\u1EA9n" || pRaw === "thuong_khan" || pRaw === "H\u1ECFa t\u1ED1c") priorityStr = "Th\u01B0\u1EE3ng kh\u1EA9n";
      html += `
            <div data-id="${id}" class="rpa-doc-card">
                <div class="rpa-card-header">
                    <div class="rpa-card-header-left">
                        <input type="checkbox" class="rpa-row-check" data-id="${id}" ${doc.status === "fill_done" ? "" : "checked"}>
                        <span class="rpa-doc-code" title="S\u1ED1 hi\u1EC7u">${doc.signNumber || ai.document_number || "---"}</span>
                        ${docType ? `<span class="rpa-tag rpa-tag-type">${docType}</span>` : ""}
                        ${priorityStr !== "B\xECnh th\u01B0\u1EDDng" ? `<span class="rpa-tag rpa-tag-priority">${priorityStr}</span>` : ""}
                    </div>
                    <div class="rpa-card-header-right">
                        <span class="rpa-badge ${s[0]}">${s[1]}</span>
                    </div>
                </div>

                <div class="rpa-card-body">
                    <div class="rpa-card-subject">
                        <span class="rpa-subject-label">Tr\xEDch y\u1EBFu:</span> ${doc.subject || ai.subject || "---"}
                    </div>

                    <div class="rpa-card-summary">
                        <div class="rpa-summary-title">T\xD3M T\u1EAET AI</div>
                        <div class="rpa-summary-text">${summary}</div>
                    </div>

                    <div class="rpa-card-meta-grid">
                        <div class="rpa-meta-item highlight-unit">
                            <span class="rpa-meta-label">\u0110\u01A1n v\u1ECB x\u1EED l\xFD ch\xEDnh</span>
                            <span class="rpa-meta-value main-unit">${mainUnit}</span>
                        </div>

                        <div class="rpa-meta-item">
                            <span class="rpa-meta-label">\u0110\u01A1n v\u1ECB ph\u1ED1i h\u1EE3p</span>
                            <div class="rpa-unit-tags">
                                ${coUnitsPills}
                            </div>
                        </div>

                        <div class="rpa-meta-item highlight-deadline">
                            <span class="rpa-meta-label">H\u1EA1n th\u1EF1c hi\u1EC7n / Ng\xE0y VB</span>
                            <span class="rpa-meta-value deadline">${daysStr}${doc.docDateStr ? " \u2022 Ng\xE0y " + doc.docDateStr : ""}</span>
                        </div>
                    </div>

                    <div class="rpa-card-footer-meta">
                        <span><strong>C\u01A1 quan ban h\xE0nh:</strong> ${doc.author || ai.issuing_agency || "---"}</span>
                        <span><strong>Ng\u01B0\u1EDDi k\xFD:</strong> ${doc.signer || ai.signer || "---"}</span>
                        <span><strong>L\xE3nh \u0111\u1EA1o theo d\xF5i:</strong> ${leader}</span>
                        <span><strong>\u0110\xE3 v\xE0o s\u1ED5:</strong> ${bookInfo}</span>
                        ${notes && notes !== "---" ? `<span><strong>Ghi ch\xFA:</strong> ${notes}</span>` : ""}
                    </div>
                </div>
            </div>
        `;
    });
    cardFeed.innerHTML = html;
  };
  var scanList = async (retries = 3) => {
    setStatus("\u0110ang qu\xE9t danh s\xE1ch v\u0103n b\u1EA3n...");
    let items = getVisibleItems();
    let attempt = 0;
    while (items.length === 0 && attempt < retries) {
      attempt++;
      await sleep(800);
      items = getVisibleItems();
    }
    if (items.length === 0) {
      setStatus("Kh\xF4ng t\xECm th\u1EA5y v\u0103n b\u1EA3n.");
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
    setStatus(`\u0110\xE3 qu\xE9t: ${docCache.size} VB (${newCount} m\u1EDBi)`);
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
