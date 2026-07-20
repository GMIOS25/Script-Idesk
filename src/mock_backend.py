"""
Mock Backend cho iDesk RPA Automation v2.0
Mô phỏng AI xử lý văn bản đến và trả về các trường:
- Trường màu xanh (gửi lên): Số hiệu VB, Loại VB, CQ BH, Ngày VB, Người ký, Trích yếu + file PDF
- Trường AI trả về (không màu + hồng): Xử lý chính, Phối hợp (array), Hạn xử lý

Chạy: python mock_backend.py
"""

import os
import json
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ============================================================
# DỮ LIỆU MẪU - mô phỏng Excel truongdulieu_v2.xlsx
# ============================================================
SAMPLE_RESPONSES = [
    {
        "sign_number_match": "1024/TB-SXD",
        "response": {
            "tom_tat": "Sở xây dựng thông báo kế hoạch kiểm tra về cấp phép xây dựng",
            "don_vi_xu_ly": "Phòng KT-HT",
            "lanh_dao_theo_doi": "Phó chủ tịch phụ trách kinh tế",
            "thoi_han_thuc_hien": 5,
            # Các đơn vị phối hợp (giá trị 1 trong Excel = có phối hợp)
            "don_vi_phoi_hop": [
                "Phòng VH XH",
                "Trung tâm HCC",
                "Đoàn TNCS"
            ]
        }
    },
    {
        "sign_number_match": "18/NQ-HĐND",
        "response": {
            "tom_tat": "Nghị quyết về phát triển kinh tế xã hội xã Phù Mỹ Tây",
            "don_vi_xu_ly": "Văn phòng HĐND xã",
            "lanh_dao_theo_doi": "Chủ tịch HĐND xã",
            "thoi_han_thuc_hien": 7,
            "don_vi_phoi_hop": [
                "Công an xã",
                "Cơ quan quân sự xã",
                "Văn phòng xã",
                "Phòng Kinh tế",
                "Phòng VH XH",
                "Đoàn TNCS"
            ]
        }
    },
    {
        "sign_number_match": "593/CV-TTYT",
        "response": {
            "tom_tat": "Cung cấp số liệu khảo sát chi phí quản lý theo Công văn số 5139/SYT-KHTC",
            "don_vi_xu_ly": "Trung tâm Y tế Phù Mỹ",
            "lanh_dao_theo_doi": "Giám đốc Trung tâm Y tế",
            "thoi_han_thuc_hien": 10,
            "don_vi_phoi_hop": [
                "Trạm y tế",
                "Phòng VH XH"
            ]
        }
    },
    {
        "sign_number_match": "31/BC-VHXH",
        "response": {
            "tom_tat": "Báo cáo kết quả rà soát hồ sơ phục vụ công tác thu nhận mẫu sinh phẩm AND xác định danh tính hài cốt liệt sĩ",
            "don_vi_xu_ly": "Văn phòng xã",
            "lanh_dao_theo_doi": "Chủ tịch UBND xã",
            "thoi_han_thuc_hien": 15,
            "don_vi_phoi_hop": [
                "Công an xã",
                "Cơ quan quân sự xã",
                "Văn phòng xã",
                "Đoàn TNCS",
                "Hội CCB"
            ]
        }
    }
]

# Response mặc định khi không có match
DEFAULT_RESPONSE = {
    "tom_tat": "",
    "don_vi_xu_ly": "Phòng KT-HT",
    "lanh_dao_theo_doi": "",
    "thoi_han_thuc_hien": 5,
    "don_vi_phoi_hop": []
}


@app.route('/api/process-doc', methods=['POST'])
def process_doc():
    print("=" * 60)
    print("📥 RECEIVED REQUEST FROM IDESK AUTOMATION")
    print("=" * 60)

    # 1. Read metadata
    metadata_str = request.form.get('metadata', '{}')
    try:
        metadata = json.loads(metadata_str)
        print("\n📋 Scraped Metadata:")
        print(json.dumps(metadata, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"⚠️ Error parsing metadata: {e}")
        metadata = {}

    # 2. Save PDF file locally for inspection
    pdf_file = request.files.get('pdf')
    if pdf_file:
        # Tạo thư mục received_pdfs nếu chưa có
        pdf_dir = os.path.join(os.getcwd(), 'received_pdfs')
        os.makedirs(pdf_dir, exist_ok=True)
        
        filename = pdf_file.filename
        save_path = os.path.join(pdf_dir, filename)
        pdf_file.save(save_path)
        print(f"\n📄 Saved PDF to: {save_path}")
        print(f"   Size: {os.path.getsize(save_path)} bytes")
    else:
        print("\n⚠️ No PDF file received.")

    # 3. Match với dữ liệu mẫu
    sign_number = metadata.get('so_hieu', '')
    subject = metadata.get('trich_yeu', '')
    
    response_data = None
    for sample in SAMPLE_RESPONSES:
        if sample["sign_number_match"] in sign_number or sample["sign_number_match"] in subject:
            response_data = sample["response"].copy()
            print(f"\n✅ Matched with: {sample['sign_number_match']}")
            break
    
    if not response_data:
        # Fallback: tạo response thông minh dựa vào subject
        response_data = DEFAULT_RESPONSE.copy()
        response_data["tom_tat"] = subject[:100] if subject else "Chờ xử lý"
        print("\n🆕 No exact match, using default response")
    
    # Thêm thông tin về thời gian xử lý
    response_data["processed_at"] = datetime.now().isoformat()
    response_data["thoi_han_thuc_hien"] = int(response_data["thoi_han_thuc_hien"])
    
    print("\n🤖 AI Response Payload:")
    print(json.dumps(response_data, indent=2, ensure_ascii=False))
    print("=" * 60)
    
    return jsonify(response_data)


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "service": "iDesk AI Mock Backend",
        "version": "2.0"
    })


if __name__ == '__main__':
    print("""
╔══════════════════════════════════════════════════╗
║     iDesk AI Mock Backend v2.0                  ║
║     Running on http://localhost:5000             ║
║                                                  ║
║     Endpoints:                                   ║
║     POST /api/process-doc - Xử lý văn bản       ║
║     GET  /api/health      - Health check         ║
╚══════════════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=5000, debug=True)
