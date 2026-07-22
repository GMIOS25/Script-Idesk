import { CONFIG } from '../config.js';
import { state, setCachedAuthToken } from '../state.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { getFallbackBasePath } from '../utils/helpers.js';
import { selectAttachment } from '../utils/attachment.js';

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
