export const docCache = new Map();     // Map<id, DocObject>
export const unitCache = new Map();    // Map<id, UnitObject> (từ fbyvsphere.cpx)
export const expandedRows = new Set(); // Set<id> các bản ghi đang mở chi tiết

export const state = {
    isProcessing: false,
    basePath: '',      // vd: "/cumvinhthanh/smartcloud"
    execAcode: '',     // receiverAcode của người đăng nhập
    cachedAuthToken: ''
};

export const setProcessing = (val) => { state.isProcessing = val; };
export const setBasePath = (path) => { state.basePath = path; };
export const setExecAcode = (code) => { state.execAcode = code; };
export const setCachedAuthToken = (token) => { state.cachedAuthToken = token; };
