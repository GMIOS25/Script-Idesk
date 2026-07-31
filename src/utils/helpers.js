import { S } from '../config.js';
import { state } from '../state.js';
import { appendLog } from './logger.js';

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const formatDate = (date) => {
    const d = date || new Date();
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const calcDeadline = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + parseInt(days, 10));
    return formatDate(date);
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_DAYS_RE = /(\d+)\s*ng[aà]y/i;

export const resolveDeadlineDate = (value) => {
    const result = { dateStr: null, daysNum: null, displayText: '---', raw: value, unparsed: false };
    if (!value && value !== 0) return result;

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

        result.unparsed = true;
        result.displayText = trimmed;
    }

    return result;
};

export const applyDeadlineDays = (rawValue, newDays) => {
    const n = Math.round(Number(newDays));
    const clamped = Math.min(100, Math.max(1, Number.isFinite(n) ? n : 1));
    const standardTemplate = () => `trong ${String(clamped).padStart(2, '0')} ngày làm việc`;

    if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        const relMatch = trimmed.match(RELATIVE_DAYS_RE);
        if (relMatch) {
            const digits = relMatch[1];
            const padded = (digits.length > 1 && digits.startsWith('0')) ? String(clamped).padStart(digits.length, '0') : String(clamped);
            return trimmed.slice(0, relMatch.index) + relMatch[0].replace(digits, padded) + trimmed.slice(relMatch.index + relMatch[0].length);
        }
    }
    return standardTemplate();
};

export const getVisibleItems = () => {
    let items = Array.from(document.querySelectorAll(S.LEFT_LIST));
    if (items.length === 0) items = Array.from(document.querySelectorAll(S.LEFT_LIST_FALLBACK));
    return items.filter(el => el.offsetParent !== null);
};

export const ensureBasePath = (url) => {
    if (state.basePath) return;
    const m = (url || '').match(/(\/[^\/?]+\/smartcloud)(?=\/)/);
    if (m && m[1]) {
        state.basePath = m[1];
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