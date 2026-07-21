# DocFlow API — Tài liệu kết nối Frontend (v3.1)

## 1. Thông tin chung

| Môi trường | Base URL                                     |
| ---------- | -------------------------------------------- |
| Local      | ``                                           |
| Staging    | `<BỔ_SUNG_SAU_KHI_DEPLOY_STAGING>/api/v1`    |
| Production | `<BỔ_SUNG_SAU_KHI_DEPLOY_PRODUCTION>/api/v1` |

Header cho request JSON:

```http
Content-Type: application/json
Accept: application/json
```

Các endpoint `/documents/*` yêu cầu thêm:

```http
Authorization: Bearer <access_token>
```

## 2. Danh sách endpoint

| Method | Endpoint             | Auth         | Mục đích                        |
| ------ | -------------------- | ------------ | ------------------------------- |
| POST   | `/auth/token`        | Không        | Lấy access token                |
| POST   | `/documents/process` | Bearer token | Tra cache hoặc xử lý văn bản    |
| POST   | `/documents/lookup`  | Bearer token | Tra metadata không cần file URL |
| PATCH  | `/documents/{stt}`   | Bearer token | Cập nhật 6 trường AI            |
| GET    | `/health`            | Không        | Liveness                        |
| GET    | `/health/ready`      | Không        | Readiness                       |

## 3. POST `/auth/token`

Request:

```json
{
  "username": "fe-server-prod",
  "password": "<mật khẩu được cấp riêng>"
}
```

Response `200`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 86400
}
```

## 4. POST `/documents/process`

Đây là endpoint chính. FE gửi cùng một payload cho văn bản mới hoặc đã xử lý.

Request:

```json
{
  "metadata": {
    "document_number": "123/QĐ-ABC",
    "document_type": "Quyết định",
    "issuing_agency": "Cơ quan ABC",
    "document_date": "2026-07-17",
    "signer": "Nguyễn Văn A",
    "subject": "Về việc ban hành kế hoạch quý 3"
  },
  "file_url": "https://ten-mien-van-ban.vn/duong-dan/van-ban.pdf"
}
```

Ràng buộc payload:

- `metadata` bắt buộc đúng 6 field trên, không nhận field lạ hoặc `stt`.
- Mỗi field chuỗi trong `metadata` dài tối đa 500 ký tự.
- `document_date` theo `YYYY-MM-DD`.
- `file_url` dài tối đa 2048 ký tự, là link tải trực tiếp PDF/DOCX/TXT.
- File tối đa 25 MB; không gửi base64 hoặc multipart/form-data.

Response `200` khi backend nhận đủ dữ liệu và xử lý thành công (trả đủ 13 trường):

```json
{
  "source": "processed",
  "data": {
    "stt": 1,
    "document_number": "123/QĐ-ABC",
    "document_type": "Quyết định",
    "issuing_agency": "Cơ quan ABC",
    "document_date": "2026-07-17",
    "signer": "Nguyễn Văn A",
    "subject": "Về việc ban hành kế hoạch quý 3",
    "summary": "Cơ quan ABC ban hành kế hoạch triển khai nhiệm vụ quý 3.",
    "processing_unit": "Phòng Tổng hợp",
    "monitoring_leader": null,
    "implementation_deadline": "2026-08-01",
    "coordinating_units": ["Đơn vị B", "Đơn vị C"],
    "notes": null
  }
}
```

Kiểu dữ liệu các trường đơn vị trong response:

- `processing_unit`: `string | null` — một đơn vị chủ trì xử lý.
- `coordinating_units`: `List<string>` — danh sách các đơn vị phối hợp thực hiện.

Quy tắc áp dụng cho `coordinating_units` trong mọi response của backend:

- Có nhiều đơn vị: `["Đơn vị B", "Đơn vị C"]`.
- Chỉ có một đơn vị: `["Đơn vị B"]`.
- Không có đơn vị phối hợp: `[]`.
- Backend không trả trường này dưới dạng chuỗi đơn hoặc `null`.

Nếu văn bản đã có, response có cùng `data` và `source` bằng `cache`:

```json
{
  "source": "cache",
  "data": {
    "stt": 1,
    "document_number": "123/QĐ-ABC",
    "document_type": "Quyết định",
    "issuing_agency": "Cơ quan ABC",
    "document_date": "2026-07-17",
    "signer": "Nguyễn Văn A",
    "subject": "Về việc ban hành kế hoạch quý 3",
    "summary": "Cơ quan ABC ban hành kế hoạch triển khai nhiệm vụ quý 3.",
    "processing_unit": "Phòng Tổng hợp",
    "monitoring_leader": null,
    "implementation_deadline": "2026-08-01",
    "coordinating_units": ["Đơn vị B", "Đơn vị C"],
    "notes": null
  }
}
```

## 5. POST `/documents/lookup`

Request:

```json
{
  "document_number": "123/QĐ-ABC",
  "document_type": "Quyết định",
  "issuing_agency": "Cơ quan ABC",
  "document_date": "2026-07-17",
  "signer": "Nguyễn Văn A",
  "subject": "Về việc ban hành kế hoạch quý 3"
}
```

Response `200` khi chưa có:

```json
{
  "found": false,
  "state": "not_found",
  "data": null
}
```

Response `200` khi đang xử lý:

```json
{
  "found": false,
  "state": "processing",
  "data": null
}
```

Response `200` khi lần trước xử lý lỗi và có thể retry:

```json
{
  "found": false,
  "state": "failed_retryable",
  "data": null
}
```

Response `200` khi đã hoàn thành:

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
    "subject": "Về việc ban hành kế hoạch quý 3",
    "summary": "Cơ quan ABC ban hành kế hoạch triển khai nhiệm vụ quý 3.",
    "processing_unit": "Phòng Tổng hợp",
    "monitoring_leader": null,
    "implementation_deadline": "2026-08-01",
    "coordinating_units": ["Đơn vị B", "Đơn vị C"],
    "notes": null
  }
}
```

## 6. PATCH `/documents/{stt}`

`stt` lấy từ response process hoặc lookup. Body là subset của 6 field dưới đây, bắt buộc có ít nhất một field.

Request mẫu:

```json
{
  "summary": "Tóm tắt đã hiệu chỉnh",
  "processing_unit": "Phòng Tổng hợp",
  "monitoring_leader": null,
  "implementation_deadline": "2026-08-01",
  "coordinating_units": ["Đơn vị B", "Đơn vị C"],
  "notes": null
}
```

Ràng buộc payload:

- Chỉ nhận `summary`, `processing_unit`, `monitoring_leader`, `implementation_deadline`, `coordinating_units`, `notes`.
- Chuỗi AI tối đa 5000 ký tự.
- `coordinating_units` tối đa 50 phần tử; mỗi phần tử tối đa 500 ký tự.
- `null` hoặc chuỗi rỗng xóa giá trị; `coordinating_units: null` được lưu thành `[]`.

Response `200`:

```json
{
  "data": {
    "stt": 1,
    "document_number": "123/QĐ-ABC",
    "document_type": "Quyết định",
    "issuing_agency": "Cơ quan ABC",
    "document_date": "2026-07-17",
    "signer": "Nguyễn Văn A",
    "subject": "Về việc ban hành kế hoạch quý 3",
    "summary": "Tóm tắt đã hiệu chỉnh",
    "processing_unit": "Phòng Tổng hợp",
    "monitoring_leader": null,
    "implementation_deadline": "2026-08-01",
    "coordinating_units": ["Đơn vị B", "Đơn vị C"],
    "notes": null
  }
}
```

# Payload list đơn vị phối hợp hiện tại trả về danh sách đúng.

## 7. GET `/health`

Response `200`:

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

## 8. GET `/health/ready`

Response `200`:

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

Khi chưa sẵn sàng, endpoint trả `503` với `status` bằng `degraded`.

## 9. Error payload chung

```json
{
  "error": {
    "code": "INVALID_LOOKUP_PAYLOAD",
    "message": "Dữ liệu gửi lên sai schema",
    "detail": null
  }
}
```

## 10. Rate limit, request ID và audit (v3.1 — V3-J)

**Request ID.** Mọi response có header `X-Request-Id`. Nếu FE gửi header
`X-Request-Id` hợp lệ (8–128 ký tự `[A-Za-z0-9._-]`) thì backend dùng lại giá trị
đó, ngược lại tự sinh. Dùng giá trị này khi báo lỗi để đối chiếu với audit log.

**Rate limit.** Vượt tần suất cho phép → `429 RATE_LIMITED`. Giới hạn độc lập:

| Endpoint                                           | Giới hạn (mặc định, đổi qua .env)                   |
| -------------------------------------------------- | --------------------------------------------------- |
| `POST /auth/token`                                 | theo client IP và theo username (chống brute-force) |
| `POST /documents/process`                          | theo tài khoản dịch vụ và theo client IP            |
| `POST /documents/lookup`, `PATCH /documents/{stt}` | theo tài khoản (nới hơn process)                    |

FE nên đợi rồi thử lại (backoff); `429` không tiết lộ username có tồn tại hay không.

**Quá tải tài nguyên.** Khi số văn bản đang OCR/AI đồng thời đã đạt trần →
`503 SERVER_BUSY` (khác `429`: đây là quá tải tức thời, không phải vượt tần suất).
FE lùi một nhịp rồi gọi lại; backend KHÔNG xếp hàng vô hạn.

Bảng mã lỗi bổ sung:

| Mã             | HTTP | Ý nghĩa                        | FE nên làm                |
| -------------- | ---- | ------------------------------ | ------------------------- |
| `RATE_LIMITED` | 429  | Quá tần suất theo IP/tài khoản | Đợi (backoff) rồi thử lại |
| `SERVER_BUSY`  | 503  | Quá số job OCR/AI đồng thời    | Lùi vài giây rồi gọi lại  |
