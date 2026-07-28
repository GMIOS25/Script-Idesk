# Đề xuất bổ sung endpoint Presigned URL — giải quyết lỗi `file_url` không tải được ngoài phiên đăng nhập

**Trạng thái:** Đề xuất, chờ backend xác nhận
**Liên quan:** `docs/en/docflow.md` mục 4 — `POST /documents/process`
**Không đổi:** contract hiện tại của `/documents/process` (vẫn nhận `file_url` dạng URL, không nhận base64/multipart)

## 1. Vấn đề hiện tại

`file_url` mà FE (userscript) đang gửi được dựng từ chính domain iDesk:

```
https://vpdt.gialai.gov.vn/.../docx/download.cpx?docID=<contentUid>&view=pdf
```

Endpoint `download.cpx` được bảo vệ bằng **session cookie** của người dùng đang đăng nhập trên trình duyệt. Khi backend AI tự `GET` vào URL này để tải file (theo đúng flow đang triển khai: nhận link → tải → phân tích), request không mang theo cookie đó nên **luôn thất bại** — y hệt như dán link vào một trình duyệt/profile chưa đăng nhập.

Nói cách khác: `file_url` hiện tại chưa bao giờ là link công khai đúng nghĩa như tài liệu docflow.md yêu cầu (_"link tải trực tiếp"_), mà là link nội bộ chỉ tải được trong đúng phiên trình duyệt sinh ra nó.

## 2. Hướng giải quyết

Giữ nguyên toàn bộ logic hiện tại của `POST /documents/process` (vẫn nhận URL, vẫn tự fetch, không đổi sang multipart/base64). Chỉ bổ sung **1 endpoint mới** để FE "public hoá" file trước khi gửi:

**Flow mới:**

1. FE tải file PDF thật bằng session cookie hợp lệ của người dùng (đã có sẵn cơ chế này ở phía FE).
2. FE gọi endpoint mới `POST /files/presign` để xin 1 cặp URL: một URL để upload, một URL công khai tạm thời để tải về.
3. FE `PUT` file thẳng lên URL upload (đi thẳng lên storage, không qua backend).
4. FE gửi URL công khai đó làm `file_url` trong `POST /documents/process` như bình thường.
5. Backend AI fetch `file_url` này y như đang làm — **không cần sửa logic xử lý hiện tại.**

**Nguyên tắc bắt buộc:** secret key/access key của storage (S3, GCS, MinIO...) **chỉ được giữ ở backend**, không bao giờ xuất hiện trong userscript — vì userscript chạy client-side, ai cài script đều đọc được toàn bộ source. Vì vậy bắt buộc dùng presigned URL sinh từ server, không phải static key nhúng sẵn ở FE.

## 3. Endpoint đề xuất: `POST /files/presign`

| Mục        | Giá trị                                        |
| ---------- | ---------------------------------------------- |
| Auth       | Bearer token (dùng lại token từ `/auth/token`) |
| Rate limit | Đề xuất áp cùng nhóm với `/documents/process`  |

### Request

```json
{
  "filename": "123-QD-ABC.pdf",
  "content_type": "application/pdf"
}
```

| Field          | Kiểu   | Bắt buộc | Ghi chú                                                                                        |
| -------------- | ------ | -------- | ---------------------------------------------------------------------------------------------- |
| `filename`     | string | Có       | Dùng để đặt tên object trên storage (backend nên tự thêm UUID/prefix để tránh trùng/đoán được) |
| `content_type` | string | Có       | Hiện chỉ cần hỗ trợ `application/pdf`                                                          |

### Response `200`

```json
{
  "upload_url": "https://<bucket>.s3.amazonaws.com/tmp/<uuid>.pdf?X-Amz-Signature=...",
  "public_url": "https://<bucket>.s3.amazonaws.com/tmp/<uuid>.pdf?X-Amz-Signature=...",
  "upload_method": "PUT",
  "upload_headers": {
    "Content-Type": "application/pdf"
  },
  "expires_in": 600
}
```

| Field            | Kiểu   | Ghi chú                                                                                                                                                                      |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload_url`     | string | FE `PUT` file lên đúng URL này                                                                                                                                               |
| `public_url`     | string | FE dùng làm `file_url` khi gọi `/documents/process`. Nên có TTL riêng, không cần trùng TTL với `upload_url`                                                                  |
| `upload_method`  | string | Method FE phải dùng khi upload (thường là `PUT`)                                                                                                                             |
| `upload_headers` | object | Header bắt buộc khi upload — **quan trọng nhất là `Content-Type` phải khớp chính xác với giá trị mà backend đã ký vào `upload_url`**, nếu lệch sẽ bị `SignatureDoesNotMatch` |
| `expires_in`     | number | Số giây `upload_url` còn hiệu lực                                                                                                                                            |

### Yêu cầu bảo mật cho `public_url`

- **TTL ngắn:** đề xuất 5–15 phút, đủ để backend AI kịp fetch, không cần tồn tại lâu hơn.
- **Không đoán được:** tên object có UUID/random token, không dùng số hiệu văn bản làm tên file trực tiếp trên storage.
- **Tự dọn dẹp:** object nên tự xoá sau khi hết hạn (S3 lifecycle rule / cron dọn thư mục tạm), tránh tích tụ văn bản nội bộ trên storage public dài hạn.
- **Không list được thư mục:** bucket/prefix chứa file tạm không cho phép `ListBucket` công khai — chỉ ai có đúng URL (kèm signature) mới truy cập được từng object.

### Response lỗi

Theo đúng format lỗi chung đã dùng ở các endpoint khác (`docs/en/docflow.md` mục 9):

```json
{
  "error": {
    "code": "PRESIGN_FAILED",
    "message": "Khong the sinh presigned URL",
    "detail": null
  }
}
```

## 4. Việc mỗi bên cần làm

**Backend:**

- Thêm endpoint `POST /files/presign` như mô tả ở mục 3.
- Cấu hình bucket/storage: prefix riêng cho file tạm, lifecycle rule tự xoá, chặn `ListBucket` công khai.
- Không đổi bất kỳ logic nào trong `/documents/process` — endpoint này tiếp tục nhận `file_url` và tự fetch như hiện tại.

**Frontend/automation:**

- Gọi `/files/presign` trước khi gọi `/documents/process`.
- Tải file thật bằng session cookie, `PUT` lên `upload_url` với đúng header trong `upload_headers`.
- Dùng `public_url` trả về làm `file_url`.
- Khai báo thêm domain storage vào `@connect` trong metadata userscript.

## 5. Vì sao không đổi `/documents/process` sang nhận multipart/form-data

Đây là phương án thay thế đã cân nhắc nhưng không chọn ở thời điểm này, vì cần sửa logic fetch-and-process hiện tại của backend (đổi từ "tự tải theo URL" sang "nhận file đính kèm trực tiếp") và cập nhật lại contract ở mục 4 của `docflow.md`. Phương án presigned URL trong tài liệu này **không đụng vào endpoint `/documents/process`**, chỉ thêm 1 endpoint độc lập ở phía trước, nên chi phí sửa đổi cho backend thấp hơn đáng kể.

## Link bài viết chứng minh lập luận: https://200lab.io/blog/upload-file-tu-front-end-den-back-end-dung-cach
