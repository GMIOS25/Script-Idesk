
# Đặc tả giao diện và luồng xử lý văn bản đến

## 1. Tổng quan

Trang web là hệ thống **Văn phòng điện tử**, trong đó chức năng **Văn bản đến → Tiếp nhận văn bản** được chia thành ba khu vực chính:

- Thanh menu chức năng bên trái.
- Danh sách văn bản ở khu vực giữa.
- Nội dung chi tiết hoặc biểu mẫu xử lý văn bản ở khu vực bên phải.

Người dùng chọn một văn bản trong danh sách để xem thông tin, cập nhật dữ liệu và chuyển văn bản sang bước xử lý tiếp theo.

---

## 2. Trạng thái 1 – Xem và tiếp nhận văn bản

Khi người dùng bấm vào một văn bản trong danh sách **Tiếp nhận văn bản**, khu vực bên phải hiển thị biểu mẫu chi tiết của văn bản.

### 2.1. Thanh thao tác

Phía trên biểu mẫu có các nút:

- Quay lại.
- **Lưu**.
- **Lưu và chuyển**.
- **Chuyển xử lý**.
- **Đính VB liên quan**.
- Menu chức năng bổ sung.

### 2.2. Thông tin văn bản

Biểu mẫu hiển thị các trường chính:

- Trích yếu.
- Số/ký hiệu.
- Ngày văn bản.
- Loại văn bản.
- Lĩnh vực.
- Cấp cơ quan ban hành.
- Cơ quan ban hành.
- Thời hạn giải quyết.
- Độ khẩn.
- Ghi chú.
- Tùy chọn có tài liệu giấy.

Một số trường bắt buộc được đánh dấu bằng dấu `(*)`.

### 2.3. Khu vực “Sổ văn bản đến”

Khu vực này dùng để nhập thông tin tiếp nhận văn bản, gồm:

- **Sổ văn bản đến**.
- **Số đến**.
- **Ngày đến**.
- Đơn vị nhận.
- Tùy chọn cho phép trùng số trong sổ văn bản.

Trong hình, trường **Sổ văn bản đến** đã được chọn là `Sổ văn bản đến UBND tỉnh`, số đến là `182` và ngày đến là `18/07/2026`.

### 2.4. Tài liệu đính kèm

Phía dưới là danh sách tài liệu đi kèm văn bản, cho phép:

- Xem tên tài liệu.
- Kiểm tra trạng thái ký số hoặc xác thực.
- Tải từng tài liệu.
- Xóa tài liệu.
- Tải tất cả tài liệu.

---

## 3. Điều kiện chuyển sang bước xử lý

Văn bản chỉ được chuyển sang bước tiếp theo sau khi người dùng:

1. Điền hoặc chọn đầy đủ các trường bắt buộc.
2. Chọn **Sổ văn bản đến**.
3. Nhập hoặc xác nhận số đến.
4. Nhập ngày đến.
5. Bấm nút **Lưu và chuyển**.

Nút **Lưu** chỉ lưu lại thông tin hiện tại nhưng không chuyển sang màn hình xử lý.

Nút **Lưu và chuyển** vừa lưu dữ liệu tiếp nhận, vừa mở biểu mẫu phân công xử lý văn bản.

---

## 4. Trạng thái 2 – Biểu mẫu chuyển xử lý

Sau khi bấm **Lưu và chuyển**, giao diện bên phải được thay thế bằng màn hình **Thông tin xử lý**.

Danh sách văn bản ở giữa có thể không còn hiển thị văn bản vừa xử lý do văn bản đã được chuyển khỏi trạng thái tiếp nhận.

### 4.1. Thanh thao tác

Phía trên màn hình có hai nút:

- **Đồng ý**: xác nhận thông tin và hoàn tất việc chuyển xử lý.
- **Bỏ qua**: hủy hoặc thoát khỏi bước phân công xử lý.

### 4.2. Thông tin nhận diện văn bản

Phần đầu màn hình hiển thị lại trường:

- **Trích yếu** của văn bản.

Trích yếu được dùng để xác định văn bản đang được xử lý.

### 4.3. Khu vực “Thông tin xử lý”

#### Xử lý chính

Cho phép chọn:

- Người xử lý chính.
- Phòng ban xử lý chính.

Thao tác được thực hiện thông qua liên kết:

> + Chọn người, phòng ban xử lý chính

#### Phối hợp xử lý

Cho phép chọn:

- Người phối hợp.
- Phòng ban phối hợp xử lý.

Thao tác được thực hiện thông qua liên kết:

> + Chọn người, phòng ban phối hợp xử lý

#### Các tùy chọn bổ sung

- Thêm người theo dõi.
- Thêm thông tin chỉ đạo.
- Lấy ý kiến dự thảo.

#### Thông tin xử lý

- Hạn xử lý.
- Độ khẩn.
- Nội dung chỉ đạo hoặc nội dung xử lý.

#### Các tùy chọn dạng checkbox

- Tiếp tục xử lý.
- Gửi thông báo đến người nhận.
- Có tài liệu giấy.

---

## 5. Luồng hoạt động tổng quát

```text
Người dùng mở mục Tiếp nhận văn bản
        ↓
Chọn một văn bản trong danh sách
        ↓
Hệ thống hiển thị biểu mẫu chi tiết
        ↓
Người dùng chọn Sổ văn bản đến và nhập thông tin tiếp nhận
        ↓
Người dùng bấm “Lưu và chuyển”
        ↓
Hệ thống lưu dữ liệu văn bản
        ↓
Hệ thống mở màn hình “Thông tin xử lý”
        ↓
Người dùng chọn người hoặc phòng ban xử lý
        ↓
Người dùng bấm “Đồng ý”
        ↓
Văn bản được chuyển sang quy trình xử lý tiếp theo
```

---

## 6. Điểm cần lưu ý khi viết Tampermonkey

Script nên nhận biết hai trạng thái giao diện khác nhau:

- **Trạng thái tiếp nhận**: có các nút `Lưu`, `Lưu và chuyển`, `Chuyển xử lý` và khu vực `Sổ văn bản đến`.
- **Trạng thái chuyển xử lý**: có các nút `Đồng ý`, `Bỏ qua` và khu vực `Thông tin xử lý`.

Do nội dung bên phải có thể được tải động mà không tải lại toàn bộ trang, script nên theo dõi thay đổi DOM bằng `MutationObserver` thay vì chỉ chạy một lần khi trang vừa mở.
