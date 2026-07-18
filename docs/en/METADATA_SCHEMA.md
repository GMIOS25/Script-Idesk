# METADATA_SCHEMA.md — Schema metadata văn bản (v2.0)

> NGUỒN SỰ THẬT DUY NHẤT về cấu trúc metadata. Quyết định phạm vi V2: `docs/V2_SCOPE.md`.
> Cột `Nguồn`: `FE` = frontend cung cấp và có thẩm quyền (AI không được ghi đè); `HT` = backend/hệ thống tự sinh; `AI` = backend + AI trích từ nội dung file.
> Pydantic model tương ứng: `app/models/document_v2.py` (`DocumentMetadataV2`, `DocumentIdentity`, `AIExtractedFields`) — phải khớp 100% file này.

## 1. Metadata công khai — đúng 13 cột, đúng thứ tự

| #   | Field                     | Kiểu                  | Bắt buộc        | Nguồn | Mô tả                                                                                                                                                                                 |
| --- | ------------------------- | --------------------- | --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `stt`                     | int ≥ 1               | ✔               | HT    | STT — SQLite tự cấp theo thứ tự bản ghi; KHÔNG nhận từ FE, KHÔNG giao AI                                                                                                              |
| 2   | `document_number`         | str                   | ✔               | FE    | Số hiệu văn bản (vd: `123/QĐ-ABC`)                                                                                                                                                    |
| 3   | `document_type`           | str                   | ✔               | FE    | Loại văn bản (vd: `Quyết định`)                                                                                                                                                       |
| 4   | `issuing_agency`          | str                   | ✔               | FE    | Cơ quan ban hành                                                                                                                                                                      |
| 5   | `document_date`           | date ISO `YYYY-MM-DD` | ✔               | FE    | Ngày văn bản                                                                                                                                                                          |
| 6   | `signer`                  | str                   | ✔               | FE    | Người ký                                                                                                                                                                              |
| 7   | `subject`                 | str                   | ✔               | FE    | Trích yếu văn bản                                                                                                                                                                     |
| 8   | `summary`                 | str \| null           |                 | AI    | Tóm tắt nội dung                                                                                                                                                                      |
| 9   | `processing_unit`         | str \| null           |                 | AI    | Đơn vị xử lý — chỉ khi có bằng chứng trong văn bản                                                                                                                                    |
| 10  | `monitoring_leader`       | str \| null           |                 | AI    | Lãnh đạo theo dõi — chỉ khi có bằng chứng trong văn bản                                                                                                                               |
| 11  | `implementation_deadline` | str \| null           |                 | AI    | Thời hạn thực hiện: ưu tiên ISO `YYYY-MM-DD` nếu văn bản có ngày tuyệt đối; nếu chỉ có thời hạn tương đối (vd "trong 05 ngày làm việc") giữ câu ngắn đã chuẩn hóa — KHÔNG tự bịa ngày |
| 12  | `coordinating_units`      | list[str]             | ✔ (có thể `[]`) | AI    | Danh sách đơn vị phối hợp; không tìm thấy → `[]`                                                                                                                                      |
| 13  | `notes`                   | str \| null           |                 | AI    | Ghi chú thông tin quan trọng/không chắc chắn rút ra từ văn bản; KHÔNG chứa log kỹ thuật hoặc chain-of-thought                                                                         |

## 2. Cột kỹ thuật nội bộ (chỉ trong database, KHÔNG trả cho FE)

| Field               | Kiểu                                         | Mô tả                                                                      |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `document_key_hash` | str, unique, not null                        | Hash deterministic từ 6 field FE đã normalize — identity chính của văn bản |
| `processing_state`  | enum `processing` \| `completed` \| `failed` | Trạng thái xử lý nội bộ                                                    |
| `failure_code`      | str \| null                                  | Mã lỗi lần xử lý gần nhất — KHÔNG chứa full text/secret                    |
| `created_at`        | datetime                                     | Thời điểm tạo bản ghi                                                      |
| `updated_at`        | datetime                                     | Cập nhật gần nhất                                                          |
| `ai_model`          | str \| null                                  | (tùy chọn vận hành) model đã dùng — không expose mặc định                  |
| `prompt_version`    | str \| null                                  | (tùy chọn vận hành) version prompt tĩnh — không expose mặc định            |

KHÔNG có: file path/storage URI, extracted/OCR full text, bảng file, snapshot, feedback, prompt governance.

## 3. Quy tắc nguồn dữ liệu

- **FE authoritative (field 2–7):** FE gửi trước trong lookup/process; AI không được ghi đè; backend merge theo nguyên tắc FE thắng.
- **`stt` (field 1):** backend/SQLite tự cấp. Model request từ FE (`DocumentIdentity`) dùng `extra="forbid"` — FE gửi `stt` bị reject.
- **AI-derived (field 8–13):** trích từ nội dung file. Không tìm thấy → `null` (field đơn) / `[]` (`coordinating_units`). Không suy đoán đơn vị/lãnh đạo không có bằng chứng — chưa có danh mục cán bộ/phòng ban nên không tự định tuyến. Schema AI output (`AIExtractedFields`) dùng `extra="forbid"` — AI trả field FE bị reject.

## 4. Normalization cho identity (áp dụng trước khi tính `document_key_hash` — triển khai ở V2-B)

- Trim khoảng trắng đầu/cuối; collapse khoảng trắng liên tiếp (đã áp dụng ngay tại `DocumentIdentity`).
- Unicode normalize ổn định (NFC).
- Case-insensitive tại identity hash khi hợp lý; KHÔNG bỏ dấu tiếng Việt khỏi dữ liệu hiển thị.
- `document_date` chuẩn ISO `YYYY-MM-DD` trước khi hash.
- KHÔNG dùng tên file hoặc binary hash làm identity chính (request lookup không có file).

## Changelog

| Version | Ngày       | Thay đổi                                                                                                                                          |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-07-16 | Chốt phiên bản đầu tiên (37 field, 6 nhóm) — ĐÃ THAY THẾ, xem git history (model legacy `app/models/document.py` đã xóa trong cleanup 2026-07-18) |
| 2.0     | 2026-07-17 | V2 theo `docs/V2_SCOPE.md`: đúng 13 cột nghiệp vụ, 3 nguồn FE/HT/AI, tách cột kỹ thuật nội bộ, bỏ file storage/feedback/prompt-learning fields    |
