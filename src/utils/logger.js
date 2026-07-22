export const setStatus = (msg) => {
    const el = document.getElementById('rpa-footer-status');
    if (el) el.textContent = msg;
    appendLog(msg);
};

export const appendLog = (msg) => {
    const logBody = document.getElementById('rpa-log-body');
    if (logBody) {
        const time = new Date().toLocaleTimeString('vi-VN');
        const row = document.createElement('div');
        row.className = 'rpa-log-entry';
        row.innerHTML = `<span class="rpa-log-time">[${time}]</span> ${msg}`;
        logBody.appendChild(row);
        logBody.scrollTop = logBody.scrollHeight;
    }
};
