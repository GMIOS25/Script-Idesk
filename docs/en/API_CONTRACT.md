# API_CONTRACT.md — Đặc tả API cho Frontend (v2.0)

> Hợp đồng giữa Backend và Frontend. Backend thay đổi API thì PHẢI cập nhật file này trong cùng phiên. Phạm vi V2: `docs/V2_SCOPE.md`; schema: `METADATA_SCHEMA.md` v2.
> Trạng thái triển khai: Health + `POST /documents/lookup` (V2-B) + `POST /documents/process` (V2-C) ĐÃ triển khai đầy đủ (2026-07-17). Mapping HTTP status ở mục 4 đã chốt theo code.
> **Đã kiểm chứng live 2026-07-18:** toàn luồng lookup → process → lookup chạy PASS trên 12 văn bản hành chính thật (PDF signed, tiếng Việt) với Gemini `gemini-3.5-flash`; nhánh race/cache (`source: "cache"`) xác nhận không gọi AI lần hai. Thời gian process thực tế 5–18s/văn bản — FE nên hiển thị trạng thái chờ và đặt timeout client ≥ 90s cho bước upload.

**Base URL:** `http://localhost:8000/api/v1` · **Encoding:** UTF-8 · **Thời gian/ngày:** ISO 8601 · **Auth:** chưa có trong MVP (chạy mạng nội bộ; không mở internet công cộng)

Object `DocumentMetadata` (13 cột) trong mọi response: xem `METADATA_SCHEMA.md` mục 1. KHÔNG bao giờ trả: local path, storage URI, raw extracted text, raw AI response, cột kỹ thuật nội bộ, secret.

---

## 1. Health

`GET /health` → `200 {"status": "ok", "version": "..."}` (liveness)

`GET /health/ready` → readiness cho hạ tầng:

```json
{
  "status": "ready",
  "checks": {
    "database": "ok",
    "prompt": "ok",
    "ai_provider": "ok",
    "ocr_dependencies": "ok"
  }
}
```

Mục nào lỗi → `503` với `status: "degraded"` và thông báo ngắn cho mục đó (không lộ secret). FE/ops dùng để biết backend sẵn sàng nhận process.

## 2. Lookup metadata (bước 1 — FE gọi TRƯỚC, không kèm file)

`POST /documents/lookup` — body JSON đúng 6 field FE authoritative (field lạ/`stt` → 422):

```json
{
  "document_number": "123/QĐ-ABC",
  "document_type": "Quyết định",
  "issuing_agency": "Cơ quan ABC",
  "document_date": "2026-07-17",
  "signer": "Nguyễn Văn A",
  "subject": "Về việc ..."
}
```

**Response 200** (miss nghiệp vụ KHÔNG dùng 404 — luôn 200 với `found`/`state` để FE điều khiển bước upload):

| `state`            | `found` | `data`      | Ý nghĩa / FE làm gì                                                                                                                                                                                                             |
| ------------------ | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completed`        | `true`  | full 13 cột | Dùng ngay, không upload                                                                                                                                                                                                         |
| `not_found`        | `false` | `null`      | Chuyển bước upload `/documents/process`                                                                                                                                                                                         |
| `processing`       | `false` | `null`      | Đang xử lý cùng key — KHÔNG upload/gọi AI song song; retry lookup sau. Nếu bản ghi processing không cập nhật quá `PROCESSING_STALE_MINUTES` (mặc định 10 — request trước chết giữa chừng), backend tự chuyển `failed_retryable` |
| `failed_retryable` | `false` | `null`      | Lần xử lý trước lỗi — có thể gửi lại file để retry                                                                                                                                                                              |

Ví dụ found:

```json
{
  "found": true,
  "state": "completed",
  "data": {
    "stt": 1,
    "document_number": "123/QĐ-ABC",
    "document_type": "Quyết định",
    "issuing_agency": "Cơ quan ABC",
    "document_date": "2026-07-17",
    "signer": "Nguyễn Văn A",
    "subject": "Về việc ...",
    "summary": "...",
    "processing_unit": "...",
    "monitoring_leader": null,
    "implementation_deadline": "2026-08-01",
    "coordinating_units": ["Đơn vị B", "Đơn vị C"],
    "notes": null
  }
}
```

Miss: `{"found": false, "state": "not_found", "data": null}`

Backend normalize 6 field (trim/collapse whitespace, Unicode NFC, ngày ISO) → `document_key_hash` deterministic → tra SQLite. Lookup KHÔNG gọi AI, KHÔNG yêu cầu file.

## 3. Process upload (bước 2 — CHỈ khi lookup trả `not_found` hoặc `failed_retryable`)

`POST /documents/process` — `multipart/form-data`:

- Part `metadata`: JSON đúng 6 field như mục 2.
- Part `file`: MỘT file `pdf` | `docx` | `txt`. (KHÔNG hỗ trợ `.doc`, ảnh PNG/JPG không phải public upload format trong MVP.)

**Response 200:**

```json
{
  "source": "processed",
  "data": {
    /* full 13 cột */
  }
}
```

- `source = "processed"`: vừa parse + gọi AI.
- `source = "cache"`: recheck trong transaction phát hiện record `completed` cùng key (race giữa lookup và upload) — KHÔNG parse/gọi AI lại.

Hành vi backend: recheck key trong transaction → reserve `processing` (unique `document_key_hash` là hàng rào; hai request đồng thời cùng key → chỉ MỘT AI call, request kia nhận `409 DOCUMENT_PROCESSING`) → trích text/OCR (KHÔNG lưu file/text; temp file xóa trong `finally` mọi nhánh) → AI trả đúng 6 field AI-derived → validate + merge (FE authoritative) → SQLite cấp `stt` → lưu `completed` → trả metadata. Fail bất kỳ bước nào → KHÔNG lưu metadata giả/partial completed; ghi `failed` + `failure_code` an toàn, FE retry có kiểm soát.

## 4. Định dạng lỗi chuẩn (mọi endpoint)

```json
{
  "error": {
    "code": "UNSUPPORTED_FILE_TYPE",
    "message": "Chỉ hỗ trợ PDF, DOCX, TXT",
    "detail": null
  }
}
```

| HTTP | code                         | Khi nào                                                                   |
| ---- | ---------------------------- | ------------------------------------------------------------------------- |
| 422  | `INVALID_LOOKUP_PAYLOAD`     | Body lookup/metadata part thiếu field, field lạ, field rỗng               |
| 422  | `INVALID_DOCUMENT_DATE`      | `document_date` không phải ISO `YYYY-MM-DD` hợp lệ                        |
| 415  | `UNSUPPORTED_FILE_TYPE`      | File không phải PDF/DOCX/TXT (kiểm bằng magic bytes, không tin đuôi file) |
| 400  | `EMPTY_FILE`                 | File 0 byte                                                               |
| 413  | `FILE_TOO_LARGE`             | Vượt `MAX_FILE_SIZE_MB`                                                   |
| 409  | `DOCUMENT_PROCESSING`        | Cùng key đang xử lý — retry lookup sau                                    |
| 422  | `TEXT_EXTRACTION_FAILED`     | Parser/OCR không trích được text từ file                                  |
| 503  | `OCR_DEPENDENCY_UNAVAILABLE` | Thiếu Tesseract/Poppler khi cần OCR                                       |
| 504  | `AI_TIMEOUT`                 | AI provider quá timeout sau retry                                         |
| 502  | `AI_INVALID_OUTPUT`          | AI trả JSON sai schema sau retry                                          |
| 502  | `AI_PROVIDER_ERROR`          | Lỗi provider khác (rate limit hết retry, auth...)                         |
| 500  | `DOCUMENT_PROCESSING_FAILED` | Lỗi xử lý khác — đã ghi `failed`, retry được                              |

(Mapping HTTP status chốt cứng khi V2-C triển khai; mã `code` là hợp đồng ổn định.)

## 5. Các endpoint đã LOẠI BỎ khỏi contract (V2)

Không còn tồn tại và sẽ không triển khai: `POST /documents/upload` (multi-file), `GET /documents/{id}/file` (download — V2 không lưu file), `PATCH /documents/{id}`, `POST /documents/{id}/approve`, `POST /documents/{id}/send`, toàn bộ `POST|GET /feedback`, `POST /admin/prompt/rebuild`, `GET /admin/prompt/versions`. `GET /documents` (danh sách) chỉ thêm ở V2-D nếu FE thực sự cần, dùng đúng 13 cột hoặc subset được duyệt.

## Changelog

| Version | Ngày       | Thay đổi                                                                                                                                                                                                                                                                    |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-07-16 | Bản hợp đồng đầu tiên (upload đa file, list/detail/file, PATCH/approve/send, feedback, prompt rebuild) — ĐÃ THAY THẾ                                                                                                                                                        |
| 2.0     | 2026-07-17 | V2 theo `docs/V2_SCOPE.md`: 2 bước lookup/process, schema 13 cột, không lưu file, bỏ feedback/prompt-learning/download; public upload chỉ PDF/DOCX/TXT                                                                                                                      |
| 2.1     | 2026-07-17 | V2-D: thêm `GET /health/ready`; xử lý processing treo (stale → `failed_retryable`); chốt mapping HTTP status theo code. File này là frontend contract duy nhất — không có FRONTEND_CONTRACT.md riêng                                                                        |
| 2.2     | 2026-07-18 | KHÔNG đổi API. Kiểm chứng live toàn luồng trên 12 văn bản thật (Gemini `gemini-3.5-flash` — model đổi từ 2.5 vì Google ngừng cấp cho tài khoản mới); ghi nhận thời gian process 5–18s/văn bản cho FE; vá parser AI output chịu được rác sau JSON (không ảnh hưởng contract) |
