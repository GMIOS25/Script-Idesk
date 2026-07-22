"""
Mock Backend cho iDesk RPA Automation (DocFlow API v3.1)
Mô phỏng AI xử lý văn bản đến theo tài liệu docs/en/docflow.md

Endpoints hỗ trợ:
- POST /auth/token              : Lấy access token
- POST /documents/process       : Tra cache hoặc xử lý văn bản (Endpoint chính)
- POST /api/v1/documents/process: Alias cho /documents/process
- POST /api/process-doc         : Legacy endpoint (backward compatibility)
- POST /documents/lookup        : Tra metadata văn bản
- PATCH /documents/<stt>        : Cập nhật 6 trường thông tin AI
- GET  /health                  : Check Liveness
- GET  /health/ready            : Check Readiness
"""

import os
import json
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# DỮ LIỆU MẪU - Đáp ứng đúng schema trong docflow.md
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
            "implementation_deadline": 7,
            "coordinating_units": ["Phòng VH XH", "Văn phòng xã"],
            "notes": "Văn bản ưu đãi ngành Y tế - Ưu tiên xử lý",
            "priority": 1  # 0: Bình thường, 1: Khẩn, 2: Thượng khẩn
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
            "implementation_deadline": 5,
            "coordinating_units": ["Phòng VH XH", "Trung tâm HCC"],
            "notes": "Yêu cầu số liệu trước ngày 25",
            "priority": 0
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
            "implementation_deadline": 15,
            "coordinating_units": ["Công an xã", "Phòng KT-HT"],
            "notes": "Niêm yết 15 ngày tại trụ sở",
            "priority": 0
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
            "implementation_deadline": 10,
            "coordinating_units": ["Công an xã"],
            "notes": "Hồ sơ đất đai cá nhân",
            "priority": 0
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
            "implementation_deadline": 7,
            "coordinating_units": ["Phòng VH XH", "Đoàn TNCS"],
            "notes": "Gửi văn bản góp ý về Sở Nội vụ",
            "priority": 0
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
            "implementation_deadline": 5,
            "coordinating_units": ["Công an xã"],
            "notes": "Cập nhật danh sách tư vấn viên",
            "priority": 0
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
            "implementation_deadline": 10,
            "coordinating_units": ["Phòng VH XH"],
            "notes": "Tuyên truyền BHYT toàn dân",
            "priority": 0
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
            "implementation_deadline": 3,
            "coordinating_units": ["Văn phòng xã"],
            "notes": "Văn bản khẩn điện tử",
            "priority": 2  # Thượng khẩn
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
    "implementation_deadline": 5,
    "coordinating_units": ["Văn phòng xã"],
    "notes": "Phân tích mặc định từ AI Mock Backend",
    "priority": 0
}

# ----------------------------------------------------
# 1. POST /auth/token
# ----------------------------------------------------
@app.route('/auth/token', methods=['POST'])
def auth_token():
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
# 2. POST /documents/process (và các Route Aliases)
# ----------------------------------------------------
@app.route('/documents/process', methods=['POST'])
@app.route('/api/v1/documents/process', methods=['POST'])
@app.route('/api/process-doc', methods=['POST'])
def process_document():
    print("=" * 60)
    print("RECEIVED PROCESS REQUEST FOR DOCFLOW API (v3.1)")
    print("=" * 60)

    request_data = request.get_json(silent=True)
    metadata = {}
    file_url = ""

    if request_data and isinstance(request_data, dict):
        metadata = request_data.get('metadata', {})
        file_url = request_data.get('file_url', '')
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
    print(json.dumps(metadata, indent=2, ensure_ascii=False))

    doc_number = metadata.get('document_number') or metadata.get('so_hieu') or ''
    subject = metadata.get('subject') or metadata.get('trich_yeu') or ''

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

    # Update dynamic fields
    matched_data["document_number"] = doc_number or matched_data["document_number"]
    matched_data["document_type"] = metadata.get('document_type') or metadata.get('loai_vb') or matched_data["document_type"]
    matched_data["issuing_agency"] = metadata.get('issuing_agency') or metadata.get('cq_bh') or matched_data["issuing_agency"]
    matched_data["document_date"] = metadata.get('document_date') or metadata.get('ngay_vb') or matched_data["document_date"]
    matched_data["signer"] = metadata.get('signer') or metadata.get('nguoi_ky') or matched_data["signer"]
    matched_data["subject"] = subject or matched_data["subject"]

    response_payload = {
        "source": "processed",
        "data": matched_data
    }

    print("\nResponse Payload:")
    print(json.dumps(response_payload, indent=2, ensure_ascii=False))
    print("=" * 60)

    return jsonify(response_payload), 200

# ----------------------------------------------------
# 3. POST /documents/lookup
# ----------------------------------------------------
@app.route('/documents/lookup', methods=['POST'])
def lookup_document():
    req_body = request.get_json(silent=True) or {}
    doc_number = req_body.get('document_number', '')

    for sample in SAMPLE_RESPONSES:
        if sample["sign_number_match"] in doc_number:
            return jsonify({
                "found": True,
                "state": "completed",
                "data": sample["data"]
            }), 200

    return jsonify({
        "found": False,
        "state": "not_found",
        "data": None
    }), 200

# ----------------------------------------------------
# 4. PATCH /documents/<stt>
# ----------------------------------------------------
@app.route('/documents/<int:stt>', methods=['PATCH'])
def patch_document(stt):
    patch_body = request.get_json(silent=True) or {}
    matched = DEFAULT_DOC_DATA.copy()
    matched["stt"] = stt

    for key, val in patch_body.items():
        if key in matched:
            matched[key] = val

    return jsonify({"data": matched}), 200

# ----------------------------------------------------
# 5. GET /health & GET /health/ready
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
╔══════════════════════════════════════════════════════╗
║     DocFlow AI Mock Backend v3.1 (Flask)            ║
║     Running on http://localhost:5000                 ║
║     Endpoint: POST /documents/process                ║
╚══════════════════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=5000, debug=True)
