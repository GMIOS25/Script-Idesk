## 1. Thông tin chung

| Môi trường  | Base URL                                |
| ----------- | --------------------------------------- |
| Production  | `https://api.truyenthanh755.xyz/api/v1` |
| Local (dev) | `http://localhost:8000/api/v1`          |

- TLS Let's Encrypt (auto-renew), ép HTTPS (HTTP 80 → 301 → 443).
- Token sống **24 giờ**; hết hạn thì gọi lại `POST /auth/token`.
- Mật khẩu tài khoản dịch vụ được giao riêng qua kênh an toàn, không ghi trong tài liệu.

Header cho mọi request JSON:

```http
Content-Type: application/json
Accept: application/json
```

Mọi endpoint trừ `/auth/token`, `/health`, `/health/ready` yêu cầu thêm:

```http
Authorization: Bearer <access_token>
```

**Request ID.** Mọi response đều có header `X-Request-Id`. FE gửi kèm header này (8–128 ký tự
`[A-Za-z0-9._-]`) thì backend dùng lại giá trị đó, không gửi thì tự sinh. Khi báo lỗi, gửi giá
trị này để đối chiếu log.

---

## 2. Thứ tự gọi API

```
BƯỚC 1 — Lấy token (1 lần, dùng lại trong 24 giờ)
  POST /auth/token  →  access_token

BƯỚC 2 — Chuẩn bị file_url  (chọn MỘT trong hai)
  (a) File có URL tải trực tiếp, không cần đăng nhập
        → dùng URL đó luôn, sang bước 3
  (b) File nằm sau session cookie (vd link iDesk download.cpx?docID=…)
        → POST /files/presign        →  {upload_url, public_url}
        → PUT  <upload_url>          →  204 (body = bytes thô của file)
        → dùng <public_url> làm file_url

BƯỚC 3 — Xử lý văn bản (endpoint chính, gọi CÙNG payload cho mọi văn bản)
  POST /documents/process  →  13 cột metadata
        source = "cache"      → đã xử lý trước đó, trả ngay, không gọi AI
        source = "processed"  → vừa trích text + AI, mất vài giây

BƯỚC 4 — (tùy chọn) Người dùng sửa tay 6 trường AI
  PATCH /documents/{stt}  →  13 cột sau khi sửa
```

**`POST /documents/lookup` là bước tùy chọn**, dùng khi FE _chưa có_ file hoặc muốn biết
trạng thái chi tiết trước khi gọi `process`:

| `state` trả về     | FE nên làm                                                                     |
| ------------------ | ------------------------------------------------------------------------------ |
| `completed`        | dùng luôn 13 cột trong `data`                                                  |
| `not_found`        | gọi `process` khi đã có `file_url`                                             |
| `processing`       | văn bản đang được xử lý — **chờ rồi lookup lại**, đừng gọi `process` song song |
| `failed_retryable` | gọi lại `process` để thử lại                                                   |

Bốn endpoint `/wards`, `/wards/compare`, `/wards/{ward_code}/organizations`,
`/organizations/{id}/entries` **độc lập với luồng trên** — chỉ đọc danh mục cơ cấu tổ chức,
gọi lúc nào cũng được (xem mục 12).

---

## 3. Danh sách endpoint

| #   | Method | Endpoint                                   | Auth   | Mục đích                                              | Mục                                                  |
| --- | ------ | ------------------------------------------ | ------ | ----------------------------------------------------- | ---------------------------------------------------- |
| 1   | POST   | `/auth/token`                              | Không  | Lấy access token                                      | [5](#5-post-authtoken)                               |
| 2   | POST   | `/files/presign`                           | Bearer | Xin URL tạm để đẩy file lên                           | [6](#6-post-filespresign)                            |
| 3   | PUT    | `/files/upload/{token}`                    | Bearer | Đẩy bytes file lên                                    | [7](#7-put-filesuploadtoken)                         |
| 4   | GET    | `/files/tmp/{token}`                       | Bearer | Tải lại file tạm — **FE không cần trong luồng chuẩn** | [8](#8-get-filestmptoken)                            |
| 5   | POST   | `/documents/process`                       | Bearer | **Endpoint chính** — tra cache hoặc xử lý văn bản     | [9](#9-post-documentsprocess)                        |
| 6   | POST   | `/documents/lookup`                        | Bearer | Tra metadata, không cần file                          | [10](#10-post-documentslookup)                       |
| 7   | PATCH  | `/documents/{stt}`                         | Bearer | Sửa tay 6 trường AI                                   | [11](#11-patch-documentsstt)                         |
| 8   | GET    | `/wards`                                   | Bearer | Danh sách xã trong danh mục tổ chức                   | [12.1](#121-get-wards)                               |
| 9   | GET    | `/wards/compare`                           | Bearer | So sánh các xã theo `comparison_code`                 | [12.2](#122-get-wardscompare)                        |
| 10  | GET    | `/wards/{ward_code}/organizations`         | Bearer | Đơn vị của một xã                                     | [12.3](#123-get-wardsward_codeorganizations)         |
| 11  | GET    | `/organizations/{organization_id}/entries` | Bearer | Chức danh/đầu mối của một đơn vị                      | [12.4](#124-get-organizationsorganization_identries) |
| 12  | GET    | `/health`                                  | Không  | Liveness                                              | [13](#13-get-health-và-get-healthready)              |
| 13  | GET    | `/health/ready`                            | Không  | Readiness (DB/prompt/AI/OCR)                          | [13](#13-get-health-và-get-healthready)              |

---

## 4. Thời gian phản hồi

**Cách đo.** Số dưới đây là thời gian **xử lý phía server**, đo in-process ngày 2026-07-30
(artifact `harness/tmp/latency_endpoints_2026-07-30.json`, và
`harness/tmp/run_0730_think0.log` cho đường AI). **Chưa bao gồm** độ trễ mạng, TLS và Nginx —
FE phải cộng thêm phần đường truyền của mình.

| Endpoint                                       | Trung vị    | p95     | Ghi chú                                                                        |
| ---------------------------------------------- | ----------- | ------- | ------------------------------------------------------------------------------ |
| `POST /auth/token`                             | **204 ms**  | 213 ms  | Chậm có chủ ý: bcrypt kiểm mật khẩu. Gọi 1 lần/24h, đừng gọi mỗi request.      |
| `POST /files/presign`                          | 1,9 ms      | 3,7 ms  |                                                                                |
| `PUT /files/upload/{token}`                    | 3,4 ms      | 5,3 ms  | Đo với file PDF thật 823 KB                                                    |
| `POST /documents/process` — `source=cache`     | 6,9 ms      | 9,1 ms  | Không tải file, không gọi AI                                                   |
| `POST /documents/process` — `source=processed` | **≈ 4,4 s** | —       | Trung bình 13 văn bản thật; **chậm nhất 7,6 s**. PDF có text layer, không OCR. |
| `POST /documents/lookup` — `completed`         | 4,9 ms      | 9,9 ms  |                                                                                |
| `POST /documents/lookup` — `not_found`         | 5,4 ms      | 13,0 ms |                                                                                |
| `PATCH /documents/{stt}`                       | 6,1 ms      | 15,5 ms |                                                                                |
| `GET /wards`                                   | 2,1 ms      | 3,1 ms  |                                                                                |
| `GET /wards/compare`                           | 3,1 ms      | 4,6 ms  | Đo khi so **tất cả** xã (2 xã trong danh mục)                                  |
| `GET /wards/{ward_code}/organizations`         | 3,2 ms      | 4,3 ms  |                                                                                |
| `GET /organizations/{id}/entries`              | 3,5 ms      | 4,3 ms  |                                                                                |
| `GET /health`                                  | 0,9 ms      | 1,6 ms  |                                                                                |
| `GET /health/ready`                            | 7,0 ms      | 15,7 ms | Có kiểm DB nên chậm hơn `/health`                                              |
| `GET /files/tmp/{token}`                       | _chưa đo_   |         | FE không dùng trong luồng chuẩn                                                |

**Chưa có số đo cho đường OCR.** Cả 13 văn bản trong bộ kiểm thử đều có text layer nên không
kích hoạt OCR. PDF scan phải chạy Tesseract từng trang nên **chắc chắn chậm hơn 4,4 s đáng
kể**, nhưng chưa có con số thật để ghi vào đây.

### Timeout FE nên đặt

Suy từ cấu hình server, không phải số đo:

| Endpoint                  | Timeout đề xuất | Vì sao                                                              |
| ------------------------- | --------------- | ------------------------------------------------------------------- |
| `POST /documents/process` | **120 s**       | Trần server: tải file 30 s + AI 60 s, cộng thời gian trích text/OCR |
| `POST /auth/token`        | 10 s            |                                                                     |
| Còn lại                   | 15 s            | Đều là truy vấn SQLite hoặc bộ nhớ                                  |

Đừng đặt `process` dưới 90 s: gặp văn bản scan nhiều trang sẽ timeout ở phía FE trong khi
backend vẫn đang xử lý và **sẽ lưu kết quả** — lần gọi lại sau đó trả `source=cache`.

---

## 5. POST `/auth/token`

Không cần Bearer. Lấy token dùng cho mọi endpoint khác.

**Request**

| Trường     | Kiểu   | Bắt buộc | Ghi chú                        |
| ---------- | ------ | -------- | ------------------------------ |
| `username` | string | ✔        | Tên tài khoản dịch vụ được cấp |
| `password` | string | ✔        | Mật khẩu được cấp riêng        |

```json
{
  "username": "fe-server",
  "password": "<mật khẩu được cấp riêng>"
}
```

**Response `200`**

| Trường         | Kiểu   | Ghi chú                                    |
| -------------- | ------ | ------------------------------------------ |
| `access_token` | string | Đưa vào header `Authorization: Bearer <…>` |
| `token_type`   | string | Luôn là `bearer`                           |
| `expires_in`   | int    | Số giây còn sống — `86400` (24 giờ)        |

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 86400
}
```

Sai tài khoản/mật khẩu → `401 INVALID_CREDENTIALS`. Response `401` **không** cho biết username
có tồn tại hay không.

---

## 6. POST `/files/presign`

Chỉ dùng khi file nằm sau session cookie. File có URL tải trực tiếp thì bỏ qua mục 6–8.

**Request**

| Trường         | Kiểu   | Bắt buộc | Ghi chú                                              |
| -------------- | ------ | -------- | ---------------------------------------------------- |
| `filename`     | string | ✔        | Chỉ để ghi log; **không** xuất hiện trong URL trả về |
| `content_type` | string | ✔        | Xem danh sách hỗ trợ bên dưới                        |

`content_type` hỗ trợ đúng 3 giá trị:

- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `text/plain`

Ngoài danh sách → `422 PRESIGN_FAILED`.

```json
{ "filename": "123-QD-ABC.pdf", "content_type": "application/pdf" }
```

**Response `200`**

| Trường           | Kiểu   | Ghi chú                                            |
| ---------------- | ------ | -------------------------------------------------- |
| `upload_url`     | string | PUT bytes file vào đây (bước tiếp theo)            |
| `public_url`     | string | Truyền làm `file_url` khi gọi `/documents/process` |
| `upload_method`  | string | Luôn là `PUT`                                      |
| `upload_headers` | object | Header phải gửi khi PUT — phải khớp **chính xác**  |
| `expires_in`     | int    | Số giây token còn sống, mặc định `600` (10 phút)   |

```json
{
  "upload_url": "https://api.truyenthanh755.xyz/api/v1/files/upload/9xK…43-ky-tu",
  "public_url": "https://api.truyenthanh755.xyz/api/v1/files/tmp/9xK…43-ky-tu",
  "upload_method": "PUT",
  "upload_headers": { "Content-Type": "application/pdf" },
  "expires_in": 600
}
```

`public_url` **không** phải link công khai vô danh — vẫn cần Bearer nếu truy cập trực tiếp.
Token dài 43 ký tự sinh từ 32 byte ngẫu nhiên; không có route nào liệt kê được danh sách token.

---

## 7. PUT `/files/upload/{token}`

**Request**

- Body là **bytes thô** của file — không multipart, không base64, không bọc JSON.
- Header `Content-Type` phải **khớp chính xác** giá trị trong `upload_headers` ở bước presign.
- Vẫn cần header `Authorization: Bearer <…>`.

```http
PUT /api/v1/files/upload/9xK…43-ky-tu
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/pdf

<bytes thô của file PDF>
```

**Response `204 No Content`** — không có body.

| Lỗi                            | HTTP | Khi nào                                              |
| ------------------------------ | ---- | ---------------------------------------------------- |
| `UPLOAD_CONTENT_TYPE_MISMATCH` | 400  | `Content-Type` lệch giá trị lúc presign              |
| `UPLOAD_TOKEN_INVALID`         | 404  | Token sai hoặc đã hết hạn (quá `expires_in`)         |
| `EMPTY_FILE`                   | 400  | Body rỗng                                            |
| `FILE_TOO_LARGE`               | 413  | Vượt 25 MB                                           |
| `SERVER_BUSY`                  | 503  | Kho tạm đầy (trần 200 MB) — lùi vài giây rồi thử lại |

File nằm trong **bộ nhớ** server, TTL 10 phút, và bị **xóa ngay** sau khi `/documents/process`
xử lý xong. Nên gọi `process` liền sau khi upload, đừng để quá 10 phút.

---

## 8. GET `/files/tmp/{token}`

Tải lại file vừa upload. **FE không cần endpoint này trong luồng chuẩn** — `/documents/process`
đọc bytes trực tiếp từ bộ nhớ theo token, không đi qua HTTP. Liệt kê ở đây cho đủ danh sách.

Yêu cầu Bearer. Trả về bytes file với `Content-Type` đã khai lúc presign, hoặc
`404 UPLOAD_TOKEN_INVALID` nếu token sai/hết hạn/đã bị xóa.

---

## 9. POST `/documents/process`

**Endpoint chính.** FE gửi **cùng một payload** cho văn bản mới và văn bản đã xử lý — backend
tự tra cache trước.

**Request**

| Trường                     | Kiểu           | Bắt buộc | Ràng buộc                                                                             |
| -------------------------- | -------------- | -------- | ------------------------------------------------------------------------------------- |
| `metadata`                 | object         | ✔        | Đúng 6 trường dưới đây, **không nhận trường lạ hay `stt`**                            |
| `metadata.document_number` | string         | ✔        | 1–500 ký tự                                                                           |
| `metadata.document_type`   | string         | ✔        | 1–500 ký tự                                                                           |
| `metadata.issuing_agency`  | string         | ✔        | 1–500 ký tự                                                                           |
| `metadata.document_date`   | string         | ✔        | Đúng dạng `YYYY-MM-DD`                                                                |
| `metadata.signer`          | string         | ✔        | 1–500 ký tự                                                                           |
| `metadata.subject`         | string         | ✔        | 1–500 ký tự                                                                           |
| `file_url`                 | string         | ✔        | Tối đa 2048 ký tự; link tải trực tiếp PDF/DOCX/TXT hoặc `public_url` từ mục 6         |
| `ward_code`                | string \| null | —        | Nằm **ngoài** `metadata`. Mã xã đang xử lý, để backend chuẩn hóa nhãn đơn vị (mục 14) |

- File tối đa **25 MB**. Không gửi base64, không gửi `multipart/form-data`.
- `ward_code` **không** tham gia định danh văn bản: gửi hay không cũng ra cùng một `stt`.

```json
{
  "metadata": {
    "document_number": "114/2026/QĐ-UBND",
    "document_type": "Quyết định",
    "issuing_agency": "Ủy ban nhân dân tỉnh Gia Lai",
    "document_date": "2026-07-27",
    "signer": "Nguyễn Tuấn Thanh",
    "subject": "Quy định một số mức chi đảm bảo cho việc tổ chức thực hiện bồi thường, hỗ trợ, tái định cư khi Nhà nước thu hồi đất trên địa bàn tỉnh Gia Lai"
  },
  "file_url": "https://api.truyenthanh755.xyz/api/v1/files/tmp/9xK…43-ky-tu",
  "ward_code": "VINH_THANH"
}
```

**Response `200`**

| Trường   | Kiểu   | Ghi chú                                                                       |
| -------- | ------ | ----------------------------------------------------------------------------- |
| `source` | string | `"processed"` = vừa trích text + gọi AI · `"cache"` = đã có sẵn, không gọi AI |
| `data`   | object | Đủ 13 cột metadata — xem mục 15                                               |

Ví dụ thật (văn bản `114/2026/QĐ-UBND`, `source=processed`):

```json
{
  "source": "processed",
  "data": {
    "stt": 1,
    "document_number": "114/2026/QĐ-UBND",
    "document_type": "Quyết định",
    "issuing_agency": "Ủy ban nhân dân tỉnh Gia Lai",
    "document_date": "2026-07-27",
    "signer": "Nguyễn Tuấn Thanh",
    "subject": "Quy định một số mức chi đảm bảo cho việc tổ chức thực hiện bồi thường, hỗ trợ, tái định cư khi Nhà nước thu hồi đất trên địa bàn tỉnh Gia Lai",
    "summary": "Quy định cụ thể một số mức chi bồi dưỡng cho các thành viên Hội đồng, Tổ công tác, lực lượng tham gia cưỡng chế, công tác điều tra xác nhận nguồn gốc đất, họp thẩm định và tổ chức chi trả tiền bồi thường, hỗ trợ, tái định cư khi Nhà nước thu hồi đất trên địa bàn tỉnh Gia Lai.",
    "processing_unit": "Văn phòng Ủy ban nhân dân tỉnh",
    "monitoring_leader": null,
    "implementation_deadline": null,
    "coordinating_units": [
      "Sở Tài chính",
      "Sở Nông nghiệp và Môi trường",
      "Sở Tư pháp",
      "Ủy ban nhân dân các xã, phường"
    ],
    "notes": "Quyết định có hiệu lực thi hành kể từ ngày 08 tháng 8 năm 2026."
  }
}
```

Văn bản đã xử lý trước đó — `data` giống hệt, chỉ khác `source`:

```json
{
  "source": "cache",
  "data": { "stt": 1, "…": "13 cột như trên" }
}
```

**Nhánh cache không kiểm `file_url`.** Backend tra 6 trường định danh **trước**, khớp rồi thì
trả ngay và không tải file. Nên với văn bản đã xử lý, `file_url` hết hạn hoặc sai vẫn nhận
`200`. Trường vẫn **bắt buộc** về mặt schema, nhưng FE không cần lo `public_url` đã quá TTL khi
gọi lại một văn bản cũ.

---

## 10. POST `/documents/lookup`

Tra metadata **không cần file**. Tùy chọn — xem mục 2.

**Request** — 6 trường **phẳng**, KHÔNG bọc trong `metadata` (khác `/process`):

| Trường            | Kiểu           | Bắt buộc | Ràng buộc                                                  |
| ----------------- | -------------- | -------- | ---------------------------------------------------------- |
| `document_number` | string         | ✔        | 1–500 ký tự                                                |
| `document_type`   | string         | ✔        | 1–500 ký tự                                                |
| `issuing_agency`  | string         | ✔        | 1–500 ký tự                                                |
| `document_date`   | string         | ✔        | `YYYY-MM-DD`                                               |
| `signer`          | string         | ✔        | 1–500 ký tự                                                |
| `subject`         | string         | ✔        | 1–500 ký tự                                                |
| `ward_code`       | string \| null | —        | Có giá trị → nhãn đơn vị được khớp lại theo danh mục xã đó |

```json
{
  "document_number": "114/2026/QĐ-UBND",
  "document_type": "Quyết định",
  "issuing_agency": "Ủy ban nhân dân tỉnh Gia Lai",
  "document_date": "2026-07-27",
  "signer": "Nguyễn Tuấn Thanh",
  "subject": "Quy định một số mức chi đảm bảo cho việc tổ chức thực hiện bồi thường, hỗ trợ, tái định cư khi Nhà nước thu hồi đất trên địa bàn tỉnh Gia Lai",
  "ward_code": "VINH_THANH"
}
```

**Response `200`** — bốn trạng thái. Không tìm thấy **vẫn là `200`**, không phải `404`:

| Trường  | Kiểu           | Ghi chú                                                       |
| ------- | -------------- | ------------------------------------------------------------- |
| `found` | bool           | Luôn đúng bằng `state == "completed"`                         |
| `state` | string         | `completed` / `not_found` / `processing` / `failed_retryable` |
| `data`  | object \| null | Chỉ có giá trị khi `state = "completed"`                      |

```json
{ "found": true,  "state": "completed",        "data": { "stt": 1, "…": "13 cột" } }
{ "found": false, "state": "not_found",        "data": null }
{ "found": false, "state": "processing",       "data": null }
{ "found": false, "state": "failed_retryable", "data": null }
```

---

## 11. PATCH `/documents/{stt}`

Người dùng sửa tay 6 trường AI. `stt` lấy từ response của `process` hoặc `lookup`.

**Request** — subset của 6 trường AI, **bắt buộc có ít nhất một trường**:

| Trường                    | Kiểu                    | Ràng buộc                                       |
| ------------------------- | ----------------------- | ----------------------------------------------- |
| `summary`                 | string \| null          | Tối đa 5000 ký tự                               |
| `processing_unit`         | string \| null          | Tối đa 5000 ký tự                               |
| `monitoring_leader`       | string \| null          | Tối đa 5000 ký tự                               |
| `implementation_deadline` | string \| null          | Tối đa 5000 ký tự                               |
| `coordinating_units`      | array\<string\> \| null | Tối đa 50 phần tử, mỗi phần tử tối đa 500 ký tự |
| `notes`                   | string \| null          | Tối đa 5000 ký tự                               |

- **Không nhận** 6 trường FE, `stt`, `ward_code`, hay bất kỳ trường lạ → `422 INVALID_UPDATE_PAYLOAD`.
- Trường **không gửi** = giữ nguyên giá trị cũ.
- `null` hoặc chuỗi rỗng = **xóa** giá trị. `coordinating_units: null` được lưu thành `[]`.
- Sửa tay `implementation_deadline` **không** kích hoạt chuẩn hóa lại — giá trị FE gửi được giữ
  nguyên văn (mục 13 giải thích chuẩn hóa tự động).

```json
{
  "summary": "Tóm tắt đã hiệu chỉnh bởi người dùng",
  "monitoring_leader": "Nguyễn Văn B",
  "coordinating_units": ["Phòng Văn hóa - Xã hội", "Phòng Kinh tế"]
}
```

**Response `200`** — trả `data` đủ 13 cột sau khi sửa, cùng cấu trúc mục 9.

| Lỗi                      | HTTP | Khi nào                                      |
| ------------------------ | ---- | -------------------------------------------- |
| `DOCUMENT_NOT_FOUND`     | 404  | `stt` không tồn tại                          |
| `DOCUMENT_NOT_COMPLETED` | 409  | Văn bản chưa xử lý xong — chưa sửa được      |
| `INVALID_UPDATE_PAYLOAD` | 422  | Body rỗng, có trường lạ, hoặc vượt ràng buộc |

---

## 12. Danh mục cơ cấu tổ chức cấp xã

Bốn endpoint **chỉ đọc**, dùng chung Bearer token. Dữ liệu nạp bằng CLI phía server, không ghi
qua HTTP. Chi tiết schema: `docs/ORG_SCHEMA.md`.

> **Mọi chuỗi tên trả về là NGUYÊN VĂN từ hệ nguồn iDesk** — kể cả lỗi chính tả và khoảng trắng
> thừa. FE so khớp chính xác `textContent` của node cây tổ chức, nên backend không "làm đẹp" tên.

Cây 3 tầng: `unit` (xã) → `dept` (phòng/ban) → `alias` (chức danh gắn với một người hoặc một
đầu mối chức năng).

### 12.1 GET `/wards`

Không có tham số.

```json
{
  "data": [
    {
      "id": 1,
      "code": "VINH_THANH",
      "name": "UBND Xã Vĩnh Thạnh - Tỉnh Gia Lai",
      "organization_count": 19,
      "entry_count": 98
    }
  ]
}
```

### 12.2 GET `/wards/compare`

| Query param | Kiểu                     | Ghi chú                                             |
| ----------- | ------------------------ | --------------------------------------------------- |
| `ward_code` | string, **lặp lại được** | `?ward_code=A&ward_code=B`. Bỏ trống = so tất cả xã |

Nhóm theo `comparison_code`, **không** so theo `name` — tên đơn vị giữa các xã khác cách viết
(`"Trạm y tế"` vs `"Trạm Y tế"`) nên khớp theo tên sẽ sai. Xã không có đơn vị nào trong nhóm
vẫn xuất hiện với ô `0/0`.

```json
{
  "ward_codes": ["PHU_MY_TAY", "VINH_THANH"],
  "data": [
    {
      "comparison_code": "ECONOMIC_DEPARTMENT",
      "wards": {
        "VINH_THANH": { "organization_count": 1, "entry_count": 12 },
        "PHU_MY_TAY": { "organization_count": 1, "entry_count": 12 }
      }
    }
  ]
}
```

### 12.3 GET `/wards/{ward_code}/organizations`

Sắp theo `(sort_order, source_id)` — **luôn dùng cả hai khóa**, vì `sort_order` một mình không
tất định (có xã toàn bộ `sort_order = 0`). Mã xã không tồn tại → `404 WARD_NOT_FOUND`.

```json
{
  "ward_code": "VINH_THANH",
  "data": [
    {
      "id": 3,
      "source_id": 286,
      "name": "Phòng Kinh tế - Xã Vĩnh Thạnh - Tỉnh Gia Lai",
      "comparison_code": "ECONOMIC_DEPARTMENT",
      "sort_order": 0,
      "entry_count": 12
    }
  ]
}
```

### 12.4 GET `/organizations/{organization_id}/entries`

`organization_id` là `id` nội bộ lấy từ 12.3. Không tồn tại → `404 ORGANIZATION_NOT_FOUND`.

```json
{
  "organization_id": 3,
  "data": [
    {
      "id": 20,
      "source_id": 761,
      "position_name": "Phó Trưởng phòng",
      "ref_uname": "…@phumytay.gialai.gov.vn",
      "ref_fullname": "…",
      "rank": "leader",
      "sort_order": 0
    }
  ]
}
```

Ba điểm FE cần lưu ý:

- `ref_uname` **không** phải tài khoản đăng nhập, không phải email đã xác minh — chỉ là định
  danh từ hệ nguồn, **có thể trùng** ở hai vị trí khác nhau.
- `ref_fullname` có thể là tên người **hoặc** một đầu mối chức năng (vd `"Văn thư phòng Kinh tế"`).
- `rank` là **chuỗi tự do** — xã mới có thể mang giá trị chưa từng thấy, FE không được hard-code enum.

---

## 13. GET `/health` và GET `/health/ready`

Không cần Bearer. Dùng cho giám sát.

```json
{ "status": "ok", "version": "1.0.0" }
```

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

Chưa sẵn sàng → `/health/ready` trả `503` với `status` bằng `degraded`.

---
