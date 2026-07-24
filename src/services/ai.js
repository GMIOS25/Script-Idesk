import { CONFIG } from '../config.js';
import { state, setCachedAuthToken } from '../state.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { getFallbackBasePath, sleep, toISODateOnly } from '../utils/helpers.js';
import { selectAttachment } from '../utils/attachment.js';

// Doc header tra ve tu GM_xmlhttpRequest la 1 chuoi tho "Key: Value\r\n..."
const parseResponseHeaders = (rawHeaders) => {
    const headers = {};
    (rawHeaders || '').split('\r\n').forEach((line) => {
        const idx = line.indexOf(':');
        if (idx > -1) {
            const key = line.slice(0, idx).trim().toLowerCase();
            const val = line.slice(idx + 1).trim();
            if (key) headers[key] = val;
        }
    });
    return headers;
};

// Doc payload loi chuan theo docs/en/docflow.md muc 9: { error: { code, message, detail } }
const parseErrorPayload = (resp) => {
    try {
        const body = JSON.parse(resp.responseText);
        if (body && body.error) return body.error;
    } catch (e) {
        // response khong phai JSON hop le, roi qua fallback ben duoi
    }
    return { code: null, message: resp.responseText || `HTTP ${resp.status}`, detail: null };
};

const RETRYABLE_STATUS = new Set([429, 503]);

export const downloadPDF = (contentUid, fileName) => {
    return new Promise((resolve, reject) => {
        const bp = state.basePath || getFallbackBasePath();
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

export const getAuthToken = () => {
    return new Promise((resolve) => {
        if (state.cachedAuthToken) return resolve(state.cachedAuthToken);
        GM_xmlhttpRequest({
            method: 'POST',
            url: CONFIG.AUTH_URL,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ username: 'fe-server-prod', password: 'secret_password' }),
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        const res = JSON.parse(resp.responseText);
                        const token = res.access_token || '';
                        setCachedAuthToken(token);
                        appendLog('Da lay Auth Token tu Backend');
                    } catch (e) {}
                }
                resolve(state.cachedAuthToken);
            },
            onerror: () => resolve(''),
            ontimeout: () => resolve('')
        });
    });
};

const callAIBackendOnce = (doc, payload, token) => {
    return new Promise((resolve) => {
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
                const respHeaders = parseResponseHeaders(resp.responseHeaders);
                const requestId = respHeaders['x-request-id'] || null;

                if (resp.status === 200) {
                    try {
                        const result = JSON.parse(resp.responseText);
                        const responseData = result.data || result;
                        appendLog(`AI phan hoi cho "${doc.signNumber}": ${JSON.stringify(responseData)}`);
                        resolve({ ok: true, data: responseData });
                    } catch (e) {
                        resolve({ ok: false, retryable: false, error: new Error(`Parse JSON loi: ${e.message}`) });
                    }
                    return;
                }

                const errPayload = parseErrorPayload(resp);
                const reqIdSuffix = requestId ? ` [X-Request-Id: ${requestId}]` : '';
                const err = new Error(`Backend HTTP ${resp.status} (${errPayload.code || '?'}): ${errPayload.message}${reqIdSuffix}`);
                resolve({ ok: false, retryable: RETRYABLE_STATUS.has(resp.status), status: resp.status, error: err });
            },
            onerror: () => resolve({ ok: false, retryable: true, error: new Error(`Khong ket noi duoc AI (${CONFIG.BACKEND_URL})`) }),
            ontimeout: () => resolve({ ok: false, retryable: true, error: new Error('Timeout goi AI backend') })
        });
    });
};

// docs/en/docflow.md muc 10: 429 RATE_LIMITED / 503 SERVER_BUSY -> FE nen doi (backoff)
// roi thu lai, khong duoc coi la loi cuoi cung ngay lan dau.
export const callAIBackend = async (doc) => {
    const targetAttach = selectAttachment(doc);
    if (!targetAttach) {
        throw new Error(`Khong tim thay file dinh kem phu hop cho VB "${doc.signNumber}"`);
    }

    const bp = state.basePath || getFallbackBasePath();
    const fileUrl = window.location.origin + `${bp}/docx/download.cpx?docID=${targetAttach.contentUid}&view=pdf`;
    const token = await getAuthToken();

    const payload = {
        metadata: {
            document_number: doc.signNumber || '',
            document_type: doc.category || '',
            issuing_agency: doc.author || '',
            document_date: toISODateOnly(doc.docDateStr),
            signer: doc.signer || '',
            subject: doc.subject || ''
        },
        file_url: fileUrl
    };

    const maxAttempts = CONFIG.RETRY.MAX_ATTEMPTS;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        setStatus(`Gui "${doc.signNumber}" den AI (DocFlow API)${attempt > 1 ? ` - lan thu ${attempt}` : ''}...`);
        const result = await callAIBackendOnce(doc, payload, token);

        if (result.ok) return result.data;

        lastError = result.error;
        if (!result.retryable || attempt === maxAttempts) {
            throw lastError;
        }

        const delay = CONFIG.RETRY.BASE_DELAY_MS * Math.pow(2, attempt - 1);
        appendLog(`${doc.signNumber}: ${lastError.message} — cho ${delay}ms roi thu lai (${attempt}/${maxAttempts})`);
        await sleep(delay);
    }

    throw lastError;
};

// POST /documents/lookup (docs/en/docflow.md muc 5) — tra metadata da xu ly ma
// khong can goi lai OCR/AI. Duoc dung boi controllers/mainController.js truoc khi
// goi callAIBackend() de tranh xu ly trung mot van ban da "completed".
export const lookupDocument = async (doc) => {
    const token = await getAuthToken();
    const payload = {
        document_number: doc.signNumber || '',
        document_type: doc.category || '',
        issuing_agency: doc.author || '',
        document_date: toISODateOnly(doc.docDateStr),
        signer: doc.signer || '',
        subject: doc.subject || ''
    };

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'POST',
            url: CONFIG.LOOKUP_URL,
            headers,
            data: JSON.stringify(payload),
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        resolve(JSON.parse(resp.responseText));
                    } catch (e) {
                        reject(new Error(`Parse JSON loi (lookup): ${e.message}`));
                    }
                } else {
                    const errPayload = parseErrorPayload(resp);
                    reject(new Error(`Lookup HTTP ${resp.status} (${errPayload.code || '?'}): ${errPayload.message}`));
                }
            },
            onerror: () => reject(new Error('Khong ket noi duoc /documents/lookup')),
            ontimeout: () => reject(new Error('Timeout goi /documents/lookup'))
        });
    });
};

// 6 truong duy nhat PATCH /documents/{stt} chap nhan (docs/en/docflow.md muc 6).
const PATCHABLE_FIELDS = ['summary', 'processing_unit', 'monitoring_leader', 'implementation_deadline', 'coordinating_units', 'notes'];

// PATCH /documents/{stt} — hien chua co UI nao goi ham nay (xem ghi chu trong
// controllers/mainController.js); chuan bi san de tinh nang "hieu chinh AI" sau
// nay dung lai, thay vi tiep tuc de endpoint da dac ta nhung khong ai dung toi.
export const patchDocument = async (stt, fields) => {
    const body = {};
    for (const key of PATCHABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) body[key] = fields[key];
    }
    if (Object.keys(body).length === 0) {
        throw new Error(`patchDocument: can it 1 truong hop le trong [${PATCHABLE_FIELDS.join(', ')}]`);
    }

    const token = await getAuthToken();
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'PATCH',
            url: `${CONFIG.PATCH_URL_BASE}/${stt}`,
            headers,
            data: JSON.stringify(body),
            onload: (resp) => {
                if (resp.status === 200) {
                    try {
                        const result = JSON.parse(resp.responseText);
                        resolve(result.data || result);
                    } catch (e) {
                        reject(new Error(`Parse JSON loi (patch): ${e.message}`));
                    }
                } else {
                    const errPayload = parseErrorPayload(resp);
                    reject(new Error(`Patch HTTP ${resp.status} (${errPayload.code || '?'}): ${errPayload.message}`));
                }
            },
            onerror: () => reject(new Error(`Khong ket noi duoc PATCH /documents/${stt}`)),
            ontimeout: () => reject(new Error(`Timeout goi PATCH /documents/${stt}`))
        });
    });
};
