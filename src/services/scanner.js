import { docCache } from '../state.js';
import { setStatus } from '../utils/logger.js';
import { getVisibleItems, sleep } from '../utils/helpers.js';
import { emit } from '../core/bus.js';

// Quét danh sách văn bản đang hiển thị trên trang và đổ vào docCache.
// (Trước đây hàm này nằm trong src/ui/dashboard.js, gây lẫn lộn UI/logic.)
export const scanList = async (retries = 3) => {
    setStatus('Đang quét danh sách văn bản...');
    let items = getVisibleItems();
    let attempt = 0;
    while (items.length === 0 && attempt < retries) {
        attempt++;
        await sleep(800);
        items = getVisibleItems();
    }

    if (items.length === 0) {
        setStatus('Không tìm thấy văn bản.');
        return 0;
    }

    let newCount = 0;
    items.forEach(el => {
        const id = el.getAttribute('data-id');
        if (id && !docCache.has(id)) {
            docCache.set(id, {
                id,
                signNumber: el.querySelector('.sender')?.textContent?.trim() || '',
                subject: el.querySelector('.subject')?.textContent?.trim() || '',
                status: 'idle',
                aiData: null,
                attachments: [],
                creatorAcode: ''
            });
            newCount++;
        }
    });

    emit('docs-changed');
    setStatus(`Đã quét: ${docCache.size} VB (${newCount} mới)`);
    return items.length;
};
