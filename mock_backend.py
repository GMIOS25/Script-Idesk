import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import json

app = Flask(__name__)
# Enable CORS so the userscript running on government domain can call our local port
CORS(app)

@app.route('/api/process-doc', methods=['POST'])
def process_doc():
    print("=== RECEIVED REQUEST FROM IDESK AUTOMATION ===")
    
    # 1. Read metadata
    metadata_str = request.form.get('metadata', '{}')
    try:
        metadata = json.loads(metadata_str)
        print("Scraped Metadata:", json.dumps(metadata, indent=2, ensure_ascii=False))
    except Exception as e:
        print("Error parsing metadata:", e)
        metadata = {}

    # 2. Save PDF file locally for inspection
    pdf_file = request.files.get('pdf')
    if pdf_file:
        filename = pdf_file.filename
        save_path = os.path.join(os.getcwd(), filename)
        pdf_file.save(save_path)
        print(f"Saved PDF to: {save_path} (Size: {os.path.getsize(save_path)} bytes)")
    else:
        print("No PDF file received.")

    # 3. Simulate AI processing and return Excel row data
    # We match against the scraped data to return corresponding values
    subject = metadata.get('trich_yeu', '')
    sign_number = metadata.get('so_hieu', '')
    
    # Default response matching Row 4 of excel sheet:
    response_data = {
        "tom_tat": "Sở xây dựng thông báo kế hoạch kiểm tra về cấp phép xây dựng",
        "don_vi_xu_ly": "Phòng KT-HT",
        "lanh_dao_theo_doi": "Phó chủ tịch phụ trách kinh tế",
        "thoi_han_thuc_hien": 5,
        "don_vi_phoi_hop": ["Công an xã", "Phòng VH XH", "Trung tâm HCC", "Đoàn TNCS"]
    }
    
    # Custom match for sample document 18/NQ-HĐND if needed
    if "18/NQ-HĐND" in sign_number or "18_NQ-HĐND" in subject or "Báo cáo" in subject:
        response_data = {
            "tom_tat": "Báo cáo kết quả rà soát hồ sơ phục vụ công tác thu nhận mẫu sinh phẩm ADN xác định danh tính hài cốt liệt sĩ tại xã Phù Mỹ Tây",
            "don_vi_xu_ly": "Văn phòng xã",
            "lanh_dao_theo_doi": "Chủ tịch HĐND xã",
            "thoi_han_thuc_hien": 7,
            "don_vi_phoi_hop": ["Công an xã", "Cơ quan quân sự xã", "Văn phòng xã"]
        }
        
    print("AI Response Payload:", json.dumps(response_data, indent=2, ensure_ascii=False))
    return jsonify(response_data)

if __name__ == '__main__':
    # Run server on port 5000
    app.run(host='0.0.0.0', port=5000, debug=True)
