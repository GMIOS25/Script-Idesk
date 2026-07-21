"""
Mock Backend cho iDesk RPA Automation v2.3
Mô phỏng AI xử lý văn bản đến và trả về các trường:
- Trường gửi lên: Số hiệu VB, Loại VB, CQ BH, Ngày VB, Người ký, Trích yếu + file PDF
- Trường AI trả về: Sổ văn bản đến, Xử lý chính, Phối hợp (array), Hạn xử lý, Tóm tắt, Ghi chú
"""

import os
import json
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# DỮ LIỆU MẪU - Mô phỏng dữ liệu từ resource/qsreceiving.cpx & dropdown_so_van_ban_den.html
SAMPLE_RESPONSES = [
    {
        "sign_number_match": "5637/SYT-TCCB",
        "response": {
            "so_van_ban": "Số văn bản đến UBND tỉnh",
            "tom_tat": "Trình tự, thủ tục, biểu mẫu thực hiện chính sách thu hút và ưu đãi bác sĩ, dược sĩ theo NQ 54/2026/NQ-HĐND",
            "don_vi_xu_ly": "Trạm y tế Phù Mỹ Tây",
            "lanh_dao_theo_doi": "Chủ tịch UBND xã",
            "thoi_han_thuc_hien": 7,
            "don_vi_phoi_hop": ["Phòng VH XH", "Văn phòng xã"],
            "ghi_chu": "Văn bản ưu đãi ngành Y tế - Ưu tiên xử lý"
        }
    },
    {
        "sign_number_match": "8069/SNNMT-PTNT",
        "response": {
            "so_van_ban": "Văn bản do cấp trên gửi đến",
            "tom_tat": "Phối hợp cung cấp số liệu về tỷ lệ nghèo đa chiều phục vụ xác định thôn vùng đồng bào DTTS",
            "don_vi_xu_ly": "Phòng KT-HT",
            "lanh_dao_theo_doi": "Phó chủ tịch phụ trách kinh tế",
            "thoi_han_thuc_hien": 5,
            "don_vi_phoi_hop": ["Phòng VH XH", "Trung tâm HCC"],
            "ghi_chu": "Yêu cầu số liệu trước ngày 25"
        }
    },
    {
        "sign_number_match": "445/TB-UBND",
        "response": {
            "so_van_ban": "Văn bản do địa phương gửi đến",
            "tom_tat": "Niêm yết công khai xác nhận nguồn gốc đất, thời điểm sử dụng đất và cấp GCN QSD đất lần đầu",
            "don_vi_xu_ly": "Văn phòng xã",
            "lanh_dao_theo_doi": "Chủ tịch UBND xã",
            "thoi_han_thuc_hien": 15,
            "don_vi_phoi_hop": ["Công an xã", "Phòng KT-HT"],
            "ghi_chu": "Niêm yết 15 ngày tại trụ sở"
        }
    },
    {
        "sign_number_match": "274a/TB-UBND",
        "response": {
            "so_van_ban": "Sổ văn bản đến",
            "tom_tat": "Niêm yết công khai kết quả kiểm tra hồ sơ đăng ký của ông Nguyễn Văn Cang",
            "don_vi_xu_ly": "Văn phòng xã",
            "lanh_dao_theo_doi": "Chủ tịch UBND xã",
            "thoi_han_thuc_hien": 10,
            "don_vi_phoi_hop": ["Công an xã"],
            "ghi_chu": "Hồ sơ đất đai cá nhân"
        }
    },
    {
        "sign_number_match": "5174/SNV-CCVC",
        "response": {
            "so_van_ban": "Sổ văn bản đến Hội đồng nhân dân",
            "tom_tat": "Góp ý dự thảo Thông tư hướng dẫn xây dựng, khai thác học liệu số trong bồi dưỡng cán bộ",
            "don_vi_xu_ly": "Văn phòng HĐND xã",
            "lanh_dao_theo_doi": "Chủ tịch HĐND xã",
            "thoi_han_thuc_hien": 7,
            "don_vi_phoi_hop": ["Phòng VH XH", "Đoàn TNCS"],
            "ghi_chu": "Gửi văn bản góp ý về Sở Nội vụ"
        }
    },
    {
        "sign_number_match": "3059/QĐ-UBND",
        "response": {
            "so_van_ban": "Văn bản do cấp trên gửi đến",
            "tom_tat": "Phê duyệt danh sách tổ chức, cá nhân tham gia mạng lưới tư vấn viên pháp luật tỉnh Gia Lai",
            "don_vi_xu_ly": "Văn phòng xã",
            "lanh_dao_theo_doi": "Chủ tịch UBND xã",
            "thoi_han_thuc_hien": 5,
            "don_vi_phoi_hop": ["Công an xã"],
            "ghi_chu": "Cập nhật danh sách tư vấn viên"
        }
    },
    {
        "sign_number_match": "5636/SYT-NVY",
        "response": {
            "so_van_ban": "Số văn bản đến UBND tỉnh",
            "tom_tat": "Triển khai Kế hoạch số 261/KH-UBND ngày 26/6/2026 về thực hiện BHYT toàn dân giai đoạn mới",
            "don_vi_xu_ly": "Trạm y tế Phù Mỹ Tây",
            "lanh_dao_theo_doi": "Phó chủ tịch phụ trách kinh tế",
            "thoi_han_thuc_hien": 10,
            "don_vi_phoi_hop": ["Phòng VH XH"],
            "ghi_chu": "Tuyên truyền BHYT toàn dân"
        }
    },
    {
        "sign_number_match": "8497/CAT-PV01",
        "response": {
            "so_van_ban": "Văn bản khẩn, hỏa tốc",
            "tom_tat": "Thông báo tiếp nhận văn bản hệ thống quản lý văn bản trên môi trường điện tử",
            "don_vi_xu_ly": "Công an xã",
            "lanh_dao_theo_doi": "Chủ tịch UBND xã",
            "thoi_han_thuc_hien": 3,
            "don_vi_phoi_hop": ["Văn phòng xã"],
            "ghi_chu": "Văn bản khẩn điện tử"
        }
    },
    {
        "sign_number_match": "1024/TB-SXD",
        "response": {
            "so_van_ban": "Sổ văn bản đến Trung ương",
            "tom_tat": "Sở xây dựng thông báo kế hoạch kiểm tra về cấp phép xây dựng",
            "don_vi_xu_ly": "Phòng KT-HT",
            "lanh_dao_theo_doi": "Phó chủ tịch phụ trách kinh tế",
            "thoi_han_thuc_hien": 5,
            "don_vi_phoi_hop": ["Phòng VH XH", "Trung tâm HCC"],
            "ghi_chu": "Chuẩn bị hồ sơ kiểm tra"
        }
    },
    {
        "sign_number_match": "18/NQ-HĐND",
        "response": {
            "so_van_ban": "Sổ văn bản đến Hội đồng nhân dân",
            "tom_tat": "Nghị quyết về phát triển kinh tế xã hội xã Phù Mỹ Tây",
            "don_vi_xu_ly": "Văn phòng HĐND xã",
            "lanh_dao_theo_doi": "Chủ tịch HĐND xã",
            "thoi_han_thuc_hien": 7,
            "don_vi_phoi_hop": ["Công an xã", "Phòng Kinh tế", "Phòng VH XH"],
            "ghi_chu": "Nghị quyết quan trọng"
        }
    }
]

DEFAULT_RESPONSE = {
    "so_van_ban": "Số văn bản đến UBND tỉnh",
    "tom_tat": "Tự động phân tích văn bản đến",
    "don_vi_xu_ly": "Phòng KT-HT",
    "lanh_dao_theo_doi": "Chủ tịch UBND xã",
    "thoi_han_thuc_hien": 5,
    "don_vi_phoi_hop": ["Văn phòng xã"],
    "ghi_chu": "Phân tích mặc định"
}

@app.route('/api/process-doc', methods=['POST'])
def process_doc():
    print("=" * 60)
    print("RECEIVED REQUEST FROM IDESK AUTOMATION")
    print("=" * 60)

    # 1. Read metadata
    metadata_str = request.form.get('metadata', '{}')
    try:
        metadata = json.loads(metadata_str)
        print("\nScraped Metadata:")
        print(json.dumps(metadata, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Error parsing metadata: {e}")
        metadata = {}

    # 2. Save PDF file locally for inspection
    pdf_file = request.files.get('pdf')
    if pdf_file:
        pdf_dir = os.path.join(os.getcwd(), 'received_pdfs')
        os.makedirs(pdf_dir, exist_ok=True)
        filename = pdf_file.filename
        save_path = os.path.join(pdf_dir, filename)
        pdf_file.save(save_path)
        print(f"\nSaved PDF to: {save_path} ({os.path.getsize(save_path)} bytes)")
    else:
        print("\nNo PDF file received.")

    # 3. Match với dữ liệu mẫu
    sign_number = metadata.get('so_hieu', '')
    subject = metadata.get('trich_yeu', '')

    response_data = None
    for sample in SAMPLE_RESPONSES:
        if sample["sign_number_match"] in sign_number or sample["sign_number_match"] in subject:
            response_data = sample["response"].copy()
            print(f"\nMatched with sample: {sample['sign_number_match']}")
            break

    if not response_data:
        response_data = DEFAULT_RESPONSE.copy()
        response_data["tom_tat"] = subject[:100] if subject else "Cho xu ly"
        print("\nNo exact match, using fallback default response")

    response_data["processed_at"] = datetime.now().isoformat()
    response_data["thoi_han_thuc_hien"] = int(response_data["thoi_han_thuc_hien"])

    print("\nAI Response Payload:")
    print(json.dumps(response_data, indent=2, ensure_ascii=False))
    print("=" * 60)

    return jsonify(response_data)

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "service": "iDesk AI Mock Backend",
        "version": "2.3"
    })

if __name__ == '__main__':
    print("""
╔══════════════════════════════════════════════════╗
║     iDesk AI Mock Backend v2.3                  ║
║     Running on http://localhost:5000             ║
╚══════════════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=5000, debug=True)
