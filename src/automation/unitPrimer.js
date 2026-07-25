import { state, unitCache, setUnitsPrimed } from '../state.js';
import { handleUnitsResponse } from '../services/api.js';
import { appendLog } from '../utils/logger.js';
import { getFallbackBasePath } from '../utils/helpers.js';

/**
 * Mồi cây đơn vị/cá nhân (fbyvsphere.cpx) MỘT LẦN cho cả phiên làm việc, bằng
 * cách gọi thẳng API (không giả lập click "Chuyển xử lý" trên UI thật).
 *
 * Dựa theo curl bắt được thực tế:
 *   POST {basePath}/comm/nodes/fbyvsphere.cpx
 *   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
 *   body: exeacode=<receiverAcode>&type=transfer&responsibility=main
 *
 * `exeacode` KHÔNG hard code — lấy từ state.execAcode (đã được api.js suy ra
 * từ field "receiverAcode" trong response view.cpx), nên tự động đúng theo
 * từng tài khoản/xã đang đăng nhập. `type`/`responsibility` là hằng số giao
 * thức của chính endpoint này, không phải dữ liệu tổ chức, nên set cứng là an toàn.
 *
 * Điều kiện: cần state.execAcode đã có giá trị, tức đã có ít nhất 1 văn bản
 * được mở/xem trong phiên hiện tại (việc này xảy ra tự nhiên trong vòng lặp
 * xử lý AI qua ensureDocDetails()). Nếu chưa có, hàm trả về false và có thể
 * gọi lại ở bước xử lý văn bản kế tiếp — không có tác dụng phụ khi gọi lặp lại.
 *
 * Đây là request same-origin nên KHÔNG tự set header Cookie/Origin/Referer/
 * User-Agent — trình duyệt tự đính kèm cookie phiên hiện tại, còn các header
 * kể trên là "forbidden header", JS không được phép ghi đè (và cũng không
 * cần thiết vì request xuất phát từ chính tab đang mở).
 */
export const primeUnitTreeDirect = async () => {
    if (state.unitsPrimed || unitCache.size > 0) return true;
    if (!state.execAcode) {
        appendLog('Mồi cây đơn vị: chưa có exeacode (cần mở ít nhất 1 văn bản trước), sẽ thử lại sau.');
        return false;
    }

    const bp = state.basePath || getFallbackBasePath();
    const body = new URLSearchParams({
        exeacode: state.execAcode,
        type: 'transfer',
        responsibility: 'main'
    });

    try {
        const resp = await fetch(`${bp}/comm/nodes/fbyvsphere.cpx`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: body.toString()
        });

        if (!resp.ok) {
            appendLog(`Mồi cây đơn vị: fbyvsphere.cpx trả về HTTP ${resp.status}`);
            return false;
        }

        // Gọi thẳng handleUnitsResponse (giống cách ensureDocDetails() đang xử lý
        // view.cpx) thay vì trông chờ interceptor bắt lại request này — chắc chắn
        // hơn, không phụ thuộc việc fetch() trong scope này có đi qua đúng
        // unsafeWindow.fetch đã bị patch hay không.
        handleUnitsResponse(await resp.json());

        if (unitCache.size > 0) {
            setUnitsPrimed(true);
            appendLog(`Mồi cây đơn vị thành công: ${unitCache.size} đơn vị/cá nhân sẵn sàng.`);
            return true;
        }
        appendLog('Mồi cây đơn vị: API trả về nhưng không có phần tử nào.');
    } catch (e) {
        appendLog(`Mồi cây đơn vị thất bại: ${e.message}`);
    }
    return false;
};
