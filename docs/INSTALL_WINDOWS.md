# Cài đặt PNS Engine trên Windows 11

Cấu hình mục tiêu: CPU 4 nhân/8 luồng, RAM 16 GB, Intel UHD (không cần NVIDIA), ổ trống ≥ 5 GB.

## 1. Cài lần đầu
1. Cài **Python 3.11** 64-bit từ python.org; tick *Add python.exe to PATH*. (3.12 cũng được.)
2. Giải nén mã nguồn PNS vào thư mục không dấu, ví dụ `D:\PNS`.
3. Nháy đúp `START_PNS.bat`. Lần đầu cần Internet: tạo `.venv`, cài thư viện đã khóa phiên bản (`engine\requirements.txt`), kể cả FFmpeg qua gói `imageio-ffmpeg`.
4. Trình duyệt tự mở `http://127.0.0.1:7860`. Giữ cửa sổ đen mở trong khi làm việc; đóng nó để tắt Engine.

Thiếu Python → batch báo rõ và dừng. Không cần tắt Windows Defender hay tường lửa: Engine chỉ nghe `127.0.0.1`.

## 2. Giọng AI cá nhân (tùy chọn)
1. Chạy `INSTALL_VOICE_AI.bat` (cài `vieneu==3.8.5`, Apache-2.0, ONNX trên CPU).
2. Mở lại `START_PNS.bat` → **Voice Studio** → thêm mẫu giọng 3–15 giây, xác nhận quyền sử dụng.
3. Bấm **Sinh câu thử**. Lần đầu tải trọng số model từ Hugging Face (cần Internet). Giao diện hiển thị thời gian xử lý, RTF và RAM — ghi lại các số này vào báo cáo kiểm thử.
4. Chậm hoặc thiếu RAM: **Cài đặt → Giọng AI** chọn `v3 Nano`; `int8` chỉ dùng nếu CPU hỗ trợ VNNI.

Nếu giọng AI lỗi, PNS báo lỗi cụ thể; giọng thu âm thật vẫn dùng bình thường.

## 3. PPTX (tùy chọn)
Cài LibreOffice để nhập PPTX trực tiếp. Không cài thì xuất PDF từ PowerPoint (*File → Save As → PDF*) rồi nhập PDF.

## 4. Dữ liệu, sao lưu, gỡ bỏ
- Dữ liệu: `%LOCALAPPDATA%\PhucNguyenStudio` (SQLite, media, mẫu giọng, cache, video, log). Đổi vị trí bằng biến môi trường `PNS_DATA`.
- Sao lưu một dự án: **Dự án → Sao lưu** (`.pnsproj`, không chứa mẫu giọng). Khôi phục: **Dự án → Khôi phục từ .pnsproj**.
- Sao lưu toàn bộ: tắt Engine, chép nguyên thư mục dữ liệu.
- Cập nhật: thay mã nguồn mới, chạy lại `START_PNS.bat` (tự cài lại thư viện khi `requirements.txt` đổi).
- Gỡ bỏ: xóa thư mục PNS (kể cả `.venv`); xóa `%LOCALAPPDATA%\PhucNguyenStudio` nếu muốn bỏ cả dữ liệu.
- Đổi cổng: `START_PNS.bat --port 7870`.
