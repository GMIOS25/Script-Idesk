# Tài liệu kết nối API cho FE

<aside>
💡

Tài khoản mật khẩu đăng nhập auth token:

- Tài khoản: Docflow
- Mật khẩu: 2aRfs7AzFS43m6mxCAfcNsBa-Q42P8DT
</aside>

- Endpoint: https://api.truyenthanh755.xyz

```markdown
### Request 1 — Lấy token
```

POST https://api.truyenthanh755.xyz/api/v1/auth/token

````
Body:
```json
{ "username": "qa-test", "password": "<mật khẩu qa-test>" }
````

✅ Kỳ vọng `200` + có `access_token`. **Copy `access_token` này** để gắn Bearer cho request 4–7.

````

```markdown
### Request 2 — Health ready (không cần token)
````

GET https://api.truyenthanh755.xyz/api/v1/health/ready

```
Không body. ✅ Kỳ vọng `200`, `status=ready`, 4 check đều `ok`.

```

```markdown
### Request 3 — Lookup THIẾU token (kiểm auth được ép)
```

POST https://api.truyenthanh755.xyz/api/v1/documents/lookup

````
Không đặt Authorization. Body:
```json
{
  "document_number": "SMOKE/QD",
  "document_type": "Quyết định",
  "issuing_agency": "Kiểm thử",
  "document_date": "2026-07-24",
  "signer": "Smoke Test",
  "subject": "Kiểm thử thiếu token"
}
````

✅ Kỳ vọng `401`, `error.code = UNAUTHORIZED`.

````

```markdown
### Request 4 — Lookup CÓ token
````

POST https://api.truyenthanh755.xyz/api/v1/documents/lookup

````
Authorization: **Bearer `<access_token>`**. Body:
```json
{
  "document_number": "SMOKE/QD",
  "document_type": "Quyết định",
  "issuing_agency": "Kiểm thử",
  "document_date": "2026-07-24",
  "signer": "Smoke Test",
  "subject": "Kiểm thử tra cứu"
}
````

✅ Kỳ vọng `200`, `state = not_found` (văn bản test chưa xử lý bao giờ).

````

```markdown
POST https://api.truyenthanh755.xyz/api/v1/documents/process
````

Authorization: **Bearer `<access_token>`**. Body:

```json
{
  "metadata": {
    "document_number": "SSRF/TEST",
    "document_type": "Quyết định",
    "issuing_agency": "Kiểm thử",
    "document_date": "2026-07-24",
    "signer": "Smoke Test",
    "subject": "Kiểm thử SSRF"
  },
  "file_url": "http://127.0.0.1/secret.pdf"
}
```

✅ Kỳ vọng `422`, `error.code = INVALID_FILE_URL`.

````

```markdown
### Request 6 — Process file THẬT (chứng minh OCR + AI end-to-end)
````

POST https://api.truyenthanh755.xyz/api/v1/documents/process

````
Authorization: **Bearer `<access_token>`**. Body (đổi `file_url` thành URL PDF công khai thật):
```json
{
  "metadata": {
    "document_number": "SMOKE-AI/QD",
    "document_type": "Quyết định",
    "issuing_agency": "Kiểm thử bàn giao",
    "document_date": "2026-07-24",
    "signer": "Smoke Test",
    "subject": "Kiểm thử xử lý AI end-to-end"
  },
  "file_url": "https://<đường-dẫn-pdf-công-khai>.pdf"
}
````

✅ Kỳ vọng `200`, `source = processed`, có `data.stt` + 13 cột; `data.summary`/

````

```markdown
### Request 7 — PATCH sửa tay 6 trường AI (tùy chọn)
Lấy `stt` từ `data.stt` của request 6, rồi:
````

PATCH https://api.truyenthanh755.xyz/api/v1/documents/<stt>

````
Authorization: **Bearer `<access_token>`**. Body (subset 6 trường AI, ít nhất một):
```json
{ "summary": "Tóm tắt đã hiệu chỉnh", "processing_unit": "Phòng Tổng hợp" }
````

✅ Kỳ vọng `200`, `data` trả về đã cập nhật đúng trường vừa sửa.

```

```
