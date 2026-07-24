"""
Mock Backend cho iDesk RPA Automation (DocFlow API v3.1)
Mo phong AI xu ly van ban den theo tai lieu docs/en/docflow.md va
docs/en/METADATA_SCHEMA.md (NGUON SU THAT DUY NHAT ve schema).

Endpoints ho tro:
- POST /auth/token              : Lay access token
- POST /documents/process       : Tra cache hoac xu ly van ban (Endpoint chinh)
- POST /api/v1/documents/process: Alias cho /documents/process
- POST /api/process-doc         : Legacy endpoint (backward compatibility)
- POST /documents/lookup        : Tra metadata van ban khong can file URL
- PATCH /documents/<stt>        : Cap nhat 6 truong thong tin AI
- GET  /health                  : Check Liveness
- GET  /health/ready            : Check Readiness

Hanh vi loi (docs/en/docflow.md muc 9-10):
- Moi response deu co header `X-Request-Id` (giu lai gia tri FE gui neu hop le,
  nguoc lai tu sinh).
- Payload thieu/sai schema -> loi chuan `{"error": {"code","message","detail"}}`.
- Vuot rate limit -> 429 `RATE_LIMITED`; qua so job OCR/AI dong thoi -> 503
  `SERVER_BUSY`.
- Co the ep loi thu cong de FE/QA test cac nhanh nay bang header:
    X-Mock-Force-Error: RATE_LIMITED | SERVER_BUSY | VALIDATION
"""

import os
import re
import json
import time
import uuid
import threading
from collections import defaultdict, deque

from flask import Flask, request, jsonify, g
from flask_cors import CORS

app = Flask(__name__)
CORS(app, expose_headers=['X-Request-Id'])

# ----------------------------------------------------
# 0. Ha tang chung: X-Request-Id, rate limit, error payload chuan (docs muc 9-10)
# ----------------------------------------------------
REQUEST_ID_RE = re.compile(r'^[A-Za-z0-9._-]{8,128}$')

RATE_LIMIT_MAX = int(os.environ.get('MOCK_RATE_LIMIT_MAX', '30'))
RATE_LIMIT_WINDOW_SEC = int(os.environ.get('MOCK_RATE_LIMIT_WINDOW_SEC', '60'))
MAX_CONCURRENT_JOBS = int(os.environ.get('MOCK_MAX_CONCURRENT_JOBS', '3'))

_rate_limit_lock = threading.Lock()
_rate_limit_hits = defaultdict(deque)  # key -> deque[timestamp, ...]

_active_jobs_lock = threading.Lock()
_active_jobs = 0


def _check_rate_limit(key):
    """Sliding-window dan gian, luu trong bo nho. Du cho mock/dev, khong dung
    cho production that (can Redis/rate-limit store dung dan)."""
    now = time.monotonic()
    with _rate_limit_lock:
        hits = _rate_limit_hits[key]
        while hits and now - hits[0] > RATE_LIMIT_WINDOW_SEC:
            hits.popleft()
        if len(hits) >= RATE_LIMIT_MAX:
            return False
        hits.append(now)
        return True


def _client_key(suffix=''):
    base = request.headers.get('Authorization') or request.remote_addr or 'anonymous'
    return f"{base}:{suffix}" if suffix else base


def _error_response(code, message, status, detail=None):
    return jsonify({"error": {"code": code, "message": message, "detail": detail}}), status


def _forced_error():
    """Cho phep FE/QA ep tinh huong loi de test 429/503/422 (docs muc 9-10) ma
    khong phu thuoc vao rate-limit/concurrency thuc te (kho tai hien on dinh)."""
    forced = (request.headers.get('X-Mock-Force-Error') or '').strip().upper()
    if forced == 'RATE_LIMITED':
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep (ep buoc de test)', 429)
    if forced == 'SERVER_BUSY':
        return _error_response('SERVER_BUSY', 'He thong dang qua tai OCR/AI (ep buoc de test)', 503)
    if forced == 'VALIDATION':
        return _error_response('INVALID_PROCESS_PAYLOAD', 'Du lieu gui len sai schema (ep buoc de test)', 422)
    return None


@app.before_request
def _assign_request_id():
    incoming = request.headers.get('X-Request-Id', '')
    g.request_id = incoming if REQUEST_ID_RE.match(incoming or '') else uuid.uuid4().hex


@app.after_request
def _attach_request_id(response):
    response.headers['X-Request-Id'] = getattr(g, 'request_id', uuid.uuid4().hex)
    return response


# ----------------------------------------------------
# 1. Validation payload theo hop dong API (docs/en/docflow.md muc 4-6)
# ----------------------------------------------------
REQUIRED_METADATA_FIELDS = ['document_number', 'document_type', 'issuing_agency', 'document_date', 'signer', 'subject']
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
PATCHABLE_FIELDS = {'summary', 'processing_unit', 'monitoring_leader', 'implementation_deadline', 'coordinating_units', 'notes'}


def _validate_identity_metadata(metadata):
    """Dung chung cho POST /documents/process (key `metadata`) va POST
    /documents/lookup (chinh body request) — ca hai deu doi hoi dung 6 truong
    identity theo docs muc 4."""
    if not isinstance(metadata, dict):
        return "metadata phai la mot JSON object"

    missing = [f for f in REQUIRED_METADATA_FIELDS if not metadata.get(f)]
    if missing:
        return f"Thieu truong bat buoc: {', '.join(missing)}"

    for f in REQUIRED_METADATA_FIELDS:
        val = metadata.get(f)
        if not isinstance(val, str):
            return f"Truong '{f}' phai la string"
        if len(val) > 500:
            return f"Truong '{f}' vuot qua 500 ky tu"

    if not DATE_RE.match(metadata.get('document_date', '')):
        return "document_date phai theo dinh dang YYYY-MM-DD"

    return None


# ----------------------------------------------------
# 2. Du lieu mau — dung 13 cot theo METADATA_SCHEMA.md v2.0
#    Luu y `implementation_deadline` la string|null (khong phai so nguyen), va
#    KHONG co truong `priority` (khong nam trong 13 cot cong khai — schema AI
#    output dung extra="forbid" nen BE that se reject/khong bao gio tra field nay).
# ----------------------------------------------------
SAMPLE_RESPONSES = [
    {
        "sign_number_match": "5637/SYT-TCCB",
        "data": {
            "stt": 1,
            "document_number": "5637/SYT-TCCB",
            "document_type": "Thông báo",
            "issuing_agency": "Sở Y tế",
            "document_date": "2026-07-20",
            "signer": "Nguyễn Văn A",
            "subject": "Trình tự, thủ tục, biểu mẫu thực hiện chính sách thu hút và ưu đãi bác sĩ, dược sĩ theo NQ 54/2026/NQ-HĐND",
            "summary": "Trình tự, thủ tục, biểu mẫu thực hiện chính sách thu hút và ưu đãi bác sĩ, dược sĩ theo NQ 54/2026/NQ-HĐND",
            "processing_unit": "Trạm y tế Phù Mỹ Tây",
            "monitoring_leader": "Chủ tịch UBND xã",
            "implementation_deadline": "trong 07 ngày làm việc",
            "coordinating_units": ["Phòng VH XH", "Văn phòng xã"],
            "notes": "Văn bản ưu đãi ngành Y tế - Ưu tiên xử lý"
        }
    },
    {
        "sign_number_match": "8069/SNNMT-PTNT",
        "data": {
            "stt": 2,
            "document_number": "8069/SNNMT-PTNT",
            "document_type": "Công văn",
            "issuing_agency": "Sở Nông nghiệp và PTNT",
            "document_date": "2026-07-19",
            "signer": "Trần Văn B",
            "subject": "Phối hợp cung cấp số liệu về tỷ lệ nghèo đa chiều phục vụ xác định thôn vùng đồng bào DTTS",
            "summary": "Phối hợp cung cấp số liệu về tỷ lệ nghèo đa chiều phục vụ xác định thôn vùng đồng bào DTTS",
            "processing_unit": "Phòng KT-HT",
            "monitoring_leader": "Phó chủ tịch phụ trách kinh tế",
            "implementation_deadline": "trong 05 ngày làm việc",
            "coordinating_units": ["Phòng VH XH", "Trung tâm HCC"],
            "notes": "Yêu cầu số liệu trước ngày 25"
        }
    },
    {
        "sign_number_match": "445/TB-UBND",
        "data": {
            "stt": 3,
            "document_number": "445/TB-UBND",
            "document_type": "Thông báo",
            "issuing_agency": "UBND Huyện Phù Mỹ",
            "document_date": "2026-07-18",
            "signer": "Lê Văn C",
            "subject": "Niêm yết công khai xác nhận nguồn gốc đất, thời điểm sử dụng đất và cấp GCN QSD đất lần đầu",
            "summary": "Niêm yết công khai xác nhận nguồn gốc đất, thời điểm sử dụng đất và cấp GCN QSD đất lần đầu",
            "processing_unit": "Văn phòng xã",
            "monitoring_leader": "Chủ tịch UBND xã",
            "implementation_deadline": "trong 15 ngày",
            "coordinating_units": ["Công an xã", "Phòng KT-HT"],
            "notes": "Niêm yết 15 ngày tại trụ sở"
        }
    },
    {
        "sign_number_match": "274a/TB-UBND",
        "data": {
            "stt": 4,
            "document_number": "274a/TB-UBND",
            "document_type": "Thông báo",
            "issuing_agency": "UBND xã",
            "document_date": "2026-07-17",
            "signer": "Phạm Văn D",
            "subject": "Niêm yết công khai kết quả kiểm tra hồ sơ đăng ký của ông Nguyễn Văn Cang",
            "summary": "Niêm yết công khai kết quả kiểm tra hồ sơ đăng ký của ông Nguyễn Văn Cang",
            "processing_unit": "Văn phòng xã",
            "monitoring_leader": "Chủ tịch UBND xã",
            "implementation_deadline": "trong 10 ngày làm việc",
            "coordinating_units": ["Công an xã"],
            "notes": "Hồ sơ đất đai cá nhân"
        }
    },
    {
        "sign_number_match": "5174/SNV-CCVC",
        "data": {
            "stt": 5,
            "document_number": "5174/SNV-CCVC",
            "document_type": "Công văn",
            "issuing_agency": "Sở Nội vụ",
            "document_date": "2026-07-16",
            "signer": "Hoàng Văn E",
            "subject": "Góp ý dự thảo Thông tư hướng dẫn xây dựng, khai thác học liệu số trong bồi dưỡng cán bộ",
            "summary": "Góp ý dự thảo Thông tư hướng dẫn xây dựng, khai thác học liệu số trong bồi dưỡng cán bộ",
            "processing_unit": "Văn phòng HĐND xã",
            "monitoring_leader": "Chủ tịch HĐND xã",
            "implementation_deadline": "trong 07 ngày làm việc",
            "coordinating_units": ["Phòng VH XH", "Đoàn TNCS"],
            "notes": "Gửi văn bản góp ý về Sở Nội vụ"
        }
    },
    {
        "sign_number_match": "3059/QĐ-UBND",
        "data": {
            "stt": 6,
            "document_number": "3059/QĐ-UBND",
            "document_type": "Quyết định",
            "issuing_agency": "UBND Tỉnh",
            "document_date": "2026-07-15",
            "signer": "Vũ Văn F",
            "subject": "Phê duyệt danh sách tổ chức, cá nhân tham gia mạng lưới tư vấn viên pháp luật tỉnh Gia Lai",
            "summary": "Phê duyệt danh sách tổ chức, cá nhân tham gia mạng lưới tư vấn viên pháp luật tỉnh Gia Lai",
            "processing_unit": "Văn phòng xã",
            "monitoring_leader": "Chủ tịch UBND xã",
            "implementation_deadline": "trong 05 ngày làm việc",
            "coordinating_units": ["Công an xã"],
            "notes": "Cập nhật danh sách tư vấn viên"
        }
    },
    {
        "sign_number_match": "5636/SYT-NVY",
        "data": {
            "stt": 7,
            "document_number": "5636/SYT-NVY",
            "document_type": "Kế hoạch",
            "issuing_agency": "Sở Y tế",
            "document_date": "2026-07-14",
            "signer": "Đặng Văn G",
            "subject": "Triển khai Kế hoạch số 261/KH-UBND ngày 26/6/2026 về thực hiện BHYT toàn dân giai đoạn mới",
            "summary": "Triển khai Kế hoạch số 261/KH-UBND ngày 26/6/2026 về thực hiện BHYT toàn dân giai đoạn mới",
            "processing_unit": "Trạm y tế Phù Mỹ Tây",
            "monitoring_leader": "Phó chủ tịch phụ phụ trách kinh tế",
            "implementation_deadline": "trong 10 ngày làm việc",
            "coordinating_units": ["Phòng VH XH"],
            "notes": "Tuyên truyền BHYT toàn dân"
        }
    },
    {
        "sign_number_match": "8497/CAT-PV01",
        "data": {
            "stt": 8,
            "document_number": "8497/CAT-PV01",
            "document_type": "Công văn",
            "issuing_agency": "Công an tỉnh",
            "document_date": "2026-07-13",
            "signer": "Bùi Văn H",
            "subject": "Thông báo tiếp nhận văn bản hệ thống quản lý văn bản trên môi trường điện tử",
            "summary": "Thông báo tiếp nhận văn bản hệ thống quản lý văn bản trên môi trường điện tử",
            "processing_unit": "Công an xã",
            "monitoring_leader": "Chủ tịch UBND xã",
            "implementation_deadline": "trong 03 ngày làm việc",
            "coordinating_units": ["Văn phòng xã"],
            "notes": "Văn bản khẩn điện tử"
        }
    }
]

DEFAULT_DOC_DATA = {
    "stt": 99,
    "document_number": "999/VB-KXD",
    "document_type": "Công văn",
    "issuing_agency": "Cơ quan ban hành",
    "document_date": "2026-07-21",
    "signer": "Người ký",
    "subject": "Tự động phân tích văn bản đến",
    "summary": "Tự động phân tích văn bản đến từ hệ thống iDesk",
    "processing_unit": "Phòng KT-HT",
    "monitoring_leader": "Chủ tịch UBND xã",
    "implementation_deadline": "trong 05 ngày làm việc",
    "coordinating_units": ["Văn phòng xã"],
    "notes": "Phân tích mặc định từ AI Mock Backend"
}

# "Database" gia lap trong bo nho: luu lai ban ghi da tra ve theo `stt`, de
# PATCH /documents/<stt> co the cap nhat dung ban ghi hien co thay vi khoi tao
# lai tu DEFAULT_DOC_DATA (bug cu lam "mat" du lieu goc).
PROCESSED_DOCS = {}


def _find_sample_by_stt(stt):
    for sample in SAMPLE_RESPONSES:
        if sample['data']['stt'] == stt:
            return sample['data'].copy()
    return None


# ----------------------------------------------------
# 3. POST /auth/token
# ----------------------------------------------------
@app.route('/auth/token', methods=['POST'])
def auth_token():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('auth')):
        return _error_response('RATE_LIMITED', 'Qua tan suat lay token, vui long thu lai sau', 429)

    payload = request.get_json(silent=True) or {}
    username = payload.get('username', '')
    password = payload.get('password', '')

    print(f"[AUTH] Request token for user: '{username}'")

    token = f"mock_bearer_token_{uuid.uuid4().hex[:16]}"
    return jsonify({
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 86400
    }), 200

# ----------------------------------------------------
# 4. POST /documents/process (va cac Route Aliases)
# ----------------------------------------------------
@app.route('/documents/process', methods=['POST'])
@app.route('/api/v1/documents/process', methods=['POST'])
@app.route('/api/process-doc', methods=['POST'])
def process_document():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('process')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    print("=" * 60)
    print("RECEIVED PROCESS REQUEST FOR DOCFLOW API (v3.1)")
    print("=" * 60)

    request_data = request.get_json(silent=True)
    metadata = {}
    file_url = ""

    if request_data and isinstance(request_data, dict):
        metadata = request_data.get('metadata', {})
        file_url = request_data.get('file_url', '')
        print(f"File URL Received: {file_url}")
    else:
        # Support fallback FormData if client sends legacy format
        metadata_str = request.form.get('metadata', '{}')
        try:
            metadata = json.loads(metadata_str)
        except Exception:
            metadata = {}

        pdf_file = request.files.get('pdf')
        if pdf_file:
            pdf_dir = os.path.join(os.getcwd(), 'received_pdfs')
            os.makedirs(pdf_dir, exist_ok=True)
            save_path = os.path.join(pdf_dir, pdf_file.filename)
            pdf_file.save(save_path)
            file_url = f"file://{save_path}"

    print("\nMetadata Received:")
    print(json.dumps(metadata, indent=2))

    validation_error = _validate_identity_metadata(metadata)
    if validation_error:
        return _error_response('INVALID_PROCESS_PAYLOAD', validation_error, 422)

    if not file_url or len(file_url) > 2048:
        return _error_response('INVALID_PROCESS_PAYLOAD', 'file_url thieu hoac vuot qua 2048 ky tu', 422)

    if '127.0.0.1' in file_url or 'localhost' in file_url:
        return _error_response('INVALID_FILE_URL', 'file_url phai la URL PDF cong khai hop le', 422)

    global _active_jobs
    with _active_jobs_lock:
        if _active_jobs >= MAX_CONCURRENT_JOBS:
            return _error_response('SERVER_BUSY', 'So van ban dang OCR/AI dong thoi da dat tran', 503)
        _active_jobs += 1

    try:
        doc_number = metadata.get('document_number', '')
        subject = metadata.get('subject', '')

        matched_data = None
        for sample in SAMPLE_RESPONSES:
            pattern = sample["sign_number_match"]
            if pattern in doc_number or pattern in subject:
                matched_data = sample["data"].copy()
                print(f"\nMatched sample for pattern: {pattern}")
                break

        if not matched_data:
            matched_data = DEFAULT_DOC_DATA.copy()
            matched_data["document_number"] = doc_number or "999/VB-KXD"
            matched_data["subject"] = subject or "Văn bản chưa khớp mẫu"
            matched_data["summary"] = f"Tóm tắt tự động cho: {subject}" if subject else "Chờ xử lý"
            print("\nNo exact pattern match, using default mock response")

        # Update dynamic fields (FE authoritative — field 2-7 theo METADATA_SCHEMA.md)
        matched_data["document_number"] = doc_number or matched_data["document_number"]
        matched_data["document_type"] = metadata.get('document_type') or matched_data["document_type"]
        matched_data["issuing_agency"] = metadata.get('issuing_agency') or matched_data["issuing_agency"]
        matched_data["document_date"] = metadata.get('document_date') or matched_data["document_date"]
        matched_data["signer"] = metadata.get('signer') or matched_data["signer"]
        matched_data["subject"] = subject or matched_data["subject"]

        PROCESSED_DOCS[matched_data["stt"]] = matched_data.copy()

        response_payload = {
            "source": "processed",
            "data": matched_data
        }

        print("\nResponse Payload:")
        print(json.dumps(response_payload, indent=2))
        print("=" * 60)

        return jsonify(response_payload), 200
    finally:
        with _active_jobs_lock:
            _active_jobs -= 1

# ----------------------------------------------------
# 5. POST /documents/lookup
# ----------------------------------------------------
@app.route('/documents/lookup', methods=['POST'])
def lookup_document():
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('lookup')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    req_body = request.get_json(silent=True)
    if not isinstance(req_body, dict):
        return _error_response('INVALID_LOOKUP_PAYLOAD', 'Body phai la mot JSON object', 422)

    validation_error = _validate_identity_metadata(req_body)
    if validation_error:
        return _error_response('INVALID_LOOKUP_PAYLOAD', validation_error, 422)

    doc_number = req_body.get('document_number', '')

    for sample in SAMPLE_RESPONSES:
        if sample["sign_number_match"] in doc_number:
            return jsonify({
                "found": True,
                "state": "completed",
                "data": sample["data"]
            }), 200

    for data in PROCESSED_DOCS.values():
        if data.get('document_number') == doc_number:
            return jsonify({
                "found": True,
                "state": "completed",
                "data": data
            }), 200

    return jsonify({
        "found": False,
        "state": "not_found",
        "data": None
    }), 200

# ----------------------------------------------------
# 6. PATCH /documents/<stt>
# ----------------------------------------------------
@app.route('/documents/<int:stt>', methods=['PATCH'])
def patch_document(stt):
    forced = _forced_error()
    if forced:
        return forced
    if not _check_rate_limit(_client_key('patch')):
        return _error_response('RATE_LIMITED', 'Qua tan suat cho phep, vui long thu lai sau', 429)

    patch_body = request.get_json(silent=True)
    if not isinstance(patch_body, dict) or not patch_body:
        return _error_response('INVALID_PATCH_PAYLOAD', 'Body phai la JSON object va co it nhat 1 truong', 422)

    unknown_fields = [k for k in patch_body.keys() if k not in PATCHABLE_FIELDS]
    if unknown_fields:
        return _error_response(
            'INVALID_PATCH_PAYLOAD',
            f"Chi nhan cac truong {sorted(PATCHABLE_FIELDS)}, nhan duoc truong khong hop le: {', '.join(unknown_fields)}",
            422
        )

    # Lay dung ban ghi hien co theo stt (tu du lieu da xu ly hoac du lieu mau),
    # KHONG khoi tao lai tu DEFAULT_DOC_DATA — day chinh la bug cu lam "mat" du
    # lieu goc cua van ban khi PATCH.
    existing = PROCESSED_DOCS.get(stt) or _find_sample_by_stt(stt)
    if existing is None:
        return _error_response('DOCUMENT_NOT_FOUND', f'Khong tim thay van ban co stt={stt}', 404)

    updated = existing.copy()
    for key, val in patch_body.items():
        if key == 'coordinating_units' and val is None:
            updated[key] = []  # theo docs muc 6: coordinating_units: null -> luu thanh []
        else:
            updated[key] = val

    PROCESSED_DOCS[stt] = updated
    return jsonify({"data": updated}), 200

# ----------------------------------------------------
# 7. GET /health & GET /health/ready
# ----------------------------------------------------
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "service": "DocFlow AI Mock Backend",
        "version": "3.1"
    }), 200

@app.route('/health/ready', methods=['GET'])
def health_ready():
    return jsonify({
        "status": "ready",
        "checks": {
            "database": "ok",
            "prompt": "ok",
            "ai_provider": "ok",
            "ocr_dependencies": "ok"
        }
    }), 200

if __name__ == '__main__':
    print("""
+------------------------------------------------------+
|     DocFlow AI Mock Backend v3.1 (Flask)             |
|     Running on http://localhost:5000                 |
|     Endpoint: POST /documents/process                |
+------------------------------------------------------+
    """)
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
