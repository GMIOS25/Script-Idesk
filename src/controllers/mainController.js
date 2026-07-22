import { CONFIG } from '../config.js';
import { docCache, state, setProcessing } from '../state.js';
import { setStatus, appendLog } from '../utils/logger.js';
import { sleep } from '../utils/helpers.js';
import { ensureDocDetails } from '../services/api.js';
import { callAIBackend } from '../services/ai.js';
import { autoFillAndSubmit } from '../automation/formFiller.js';
import { updateDashboard, scanList } from '../ui/dashboard.js';

export const scanAndSendAll = async () => {
    if (state.isProcessing) return alert('Dang xu ly, vui long cho!');

    const found = await scanList(4);
    if (!found) return;

    const pendingIds = [];
    docCache.forEach((doc, id) => { if (doc.status === 'idle') pendingIds.push(id); });

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

        doc.status = 'pending';
        updateDashboard();
        updateProgress(i, total);

        try {
            const fullDoc = await ensureDocDetails(id);
            if (fullDoc.attachments && fullDoc.attachments.length > 0) {
                doc.aiData = await callAIBackend(fullDoc);
                doc.status = 'ai_done';
                success++;
            } else {
                throw new Error('Van ban khong co file dinh kem');
            }
        } catch (err) {
            doc.status = 'ai_error';
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

export const runFillOnAll = async () => {
    if (state.isProcessing) return alert('Dang xu ly, vui long cho!');

    const checkboxes = document.querySelectorAll('.rpa-row-check:checked');
    if (checkboxes.length === 0) return alert('Hay chon it nhat 1 van ban!');

    setProcessing(true);
    let success = 0, errors = 0;
    const total = checkboxes.length;
    updateProgress(0, total);

    for (let i = 0; i < checkboxes.length; i++) {
        const chk = checkboxes[i];
        const id = chk.getAttribute('data-id');
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
            doc.status = 'fill_done';
            success++;
            chk.checked = false;
        } catch (err) {
            doc.status = 'fill_error';
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

export const updateProgress = (current, total) => {
    const fill = document.getElementById('rpa-progress-fill');
    const text = document.getElementById('rpa-progress-text');
    if (fill && text) {
        fill.style.width = (total > 0 ? Math.round((current / total) * 100) : 0) + '%';
        text.textContent = `${current}/${total}`;
    }
};
