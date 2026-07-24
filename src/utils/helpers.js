import { S } from '../config.js';
import { state, setBasePath } from '../state.js';
import { appendLog } from './logger.js';

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const formatDate = (date) => {
    const d = date || new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
};

export const calcDeadline = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + parseInt(days, 10));
    return formatDate(date);
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_DAYS_RE = /(\d+)\s*ng[aà]y/i;

// `implementation_deadline` theo docs/en/METADATA_SCHEMA.md (#11) la string | null:
// uu tien ngay ISO "YYYY-MM-DD" neu van ban co ngay tuyet doi, hoac cau tuong doi
// da chuan hoa (vd "trong 05 ngay lam viec") neu khong co ngay cu the — KHONG duoc
// tu bia ngay. Ham nay quy doi ca 2 dang tren ve mot ngay hien thi cu the, dong thoi
// van chap nhan gia tri la so nguyen (so ngay) de tuong thich nguoc voi mock/BE cu
// chua tra dung kieu du lieu theo schema.
export const resolveDeadlineDate = (value) => {
    const result = { dateStr: null, daysNum: null, displayText: '---', raw: value, unparsed: false };

    if (value === null || value === undefined || value === '') {
        return result;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        result.daysNum = value;
        result.dateStr = calcDeadline(value);
        result.displayText = `${result.dateStr} (+${value} ngày)`;
        return result;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return result;

        const isoMatch = trimmed.match(ISO_DATE_RE);
        if (isoMatch) {
            const d = new Date(`${trimmed}T00:00:00`);
            if (!isNaN(d.getTime())) {
                result.dateStr = formatDate(d);
                result.displayText = result.dateStr;
                return result;
            }
        }

        const relMatch = trimmed.match(RELATIVE_DAYS_RE);
        if (relMatch) {
            result.daysNum = parseInt(relMatch[1], 10);
            result.dateStr = calcDeadline(result.daysNum);
            result.displayText = `${trimmed} (~ ${result.dateStr})`;
            return result;
        }

        // Cau mo ta khong the tu quy doi ra ngay cu the (vd "sau khi co huong dan moi")
        result.unparsed = true;
        result.displayText = trimmed;
        return result;
    }

    return result;
};

export const getVisibleItems = () => {
    let items = Array.from(document.querySelectorAll(S.LEFT_LIST));
    if (items.length === 0) items = Array.from(document.querySelectorAll(S.LEFT_LIST_FALLBACK));
    return items.filter(el => el.offsetParent !== null);
};

export const deriveBasePath = (url) => {
    const m = (url || '').match(/(\/[^\/?]+\/smartcloud)(?=\/)/);
    return m ? m[1] : null;
};

export const ensureBasePath = (url) => {
    if (state.basePath) return;
    const derived = deriveBasePath(url);
    if (derived) {
        setBasePath(derived);
        appendLog(`Da xac dinh duong dan goc he thong: ${state.basePath}`);
    }
};

export const getFallbackBasePath = () => {
    const seg = window.location.pathname.split('/').filter(Boolean)[0];
    return seg ? `/${seg}/smartcloud` : '/smartcloud';
};

export const findByVisibleText = (root, selector, texts) => {
    const scope = root || document;
    const nodes = scope.querySelectorAll(selector);
    for (const el of nodes) {
        const t = (el.textContent || el.value || '').trim();
        if (texts.includes(t) && el.offsetParent !== null) return el;
    }
    return null;
};

/**
 * Loại bỏ hậu tố " - Tỉnh Gia Lai" khỏi tên cơ quan ban hành khi hiển thị.
 * Không thay đổi dữ liệu gốc.
 * @param {string} name - Tên cơ quan ban hành
 * @returns {string} Tên đã được rút gọn
 */
export const stripAgencySuffix = (name) => {
    if (!name || name === '---') return name;
    return name.replace(/\s*-\s*Tỉnh\s+Gia\s+Lai\s*$/i, '').trim();
};

export const toISODateOnly = (value) => {
    if (!value) return '';
    const s = String(value).trim();
    const isoPrefix = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoPrefix) return isoPrefix[1];
    const d = new Date(s);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
