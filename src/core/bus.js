// ==============================================================================
// EVENT BUS - Điểm giao tiếp DUY NHẤT giữa UI (src/ui/*) và Logic (controllers/services/automation).
//
// Quy ước: KHÔNG import trực tiếp file trong src/ui/* từ trong controllers/services/automation,
// và ngược lại KHÔNG import controllers/services/automation từ trong src/ui/*.
// Muốn giao tiếp 2 chiều thì dùng on()/emit() ở đây.
//
// Các event đang dùng trong dự án (cập nhật danh sách này khi thêm event mới):
//   - 'scan-requested'   : UI báo người dùng bấm nút "Quét & Gửi AI"
//   - 'fill-requested'   : UI báo người dùng bấm nút "Tự động điền"
//   - 'docs-changed'     : Logic báo docCache vừa thay đổi, UI cần render lại danh sách
//   - 'progress'         : Logic báo tiến độ xử lý { current, total }, UI cập nhật progress bar
// ==============================================================================

const listeners = {};

export const on = (event, callback) => {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
};

export const off = (event, callback) => {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(cb => cb !== callback);
};

export const emit = (event, payload) => {
    (listeners[event] || []).forEach(cb => cb(payload));
};
