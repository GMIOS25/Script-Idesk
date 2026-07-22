import { ensureBasePath } from '../utils/helpers.js';
import { handleListResponse, handleViewResponse, handleUnitsResponse } from './api.js';

export const interceptXHR = () => {
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

export const interceptFetch = () => {
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
