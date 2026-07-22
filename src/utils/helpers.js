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
    date.setDate(date.getDate() + parseInt(days));
    return formatDate(date);
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
