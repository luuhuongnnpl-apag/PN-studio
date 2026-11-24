# Chức năng chưa hoàn thành

## Cần sếp phối hợp
1. Kiểm thử Windows thật (A01), giọng AI VieNeu với mẫu giọng thật (A05): ghi thời gian, RTF, RAM; duyệt độ giống, phát âm, ngắt nghỉ.
2. Tạo repo GitHub `luuhuongnnpl-apag/phuc-nguyen-studio` (trống) hoặc cấp quyền để đẩy mã và mở PR.
3. Duyệt tạo Hosting site `phuc-nguyen-studio` trong project `phuc-nguyen-library` (A10).
4. Demo Thừa kế end-to-end bằng PDF và kịch bản thật.

## P1
- Đăng nhập Firebase Auth, metadata dự án trên Firestore (`pnStudioProjects`), xuất bản có duyệt (`pnStudioPublications`), kiểm thử rules bằng emulator; tài khoản không quyền bị từ chối; rollback theo revision.
- ~~Audio, Image, Content, Podcast Studio~~ — xong ở v0.2.0 (25/11/2026). Interactive Studio (gói HTML) cũng xong.
- Còn lại: transcript bằng Whisper CPU (căn chỉnh phụ đề theo từ, biên tập theo transcript), timeline kéo thả nâng cao, xuất gói chuẩn H5P (hiện là gói HTML độc lập), đưa cấu hình podcast/câu hỏi tương tác vào gói sao lưu `.pnsproj`, Content Studio gọi AI trực tiếp (hiện dùng lệnh mẫu sao chép sang ChatGPT/Claude — không phát sinh phí API).
- Điều chỉnh tốc độ đọc giọng AI (chỉ khi có xử lý thật).
- Khóa toàn bộ phụ thuộc con (`pip freeze`) sau khi chạy đạt trên Windows; đóng gói cài đặt không cần Python (PyInstaller) nếu cần.

## P2
Avatar Studio (tự nguyện, gắn nhãn AI), sản xuất hàng loạt, thống kê tối thiểu, phiên bản học liệu.
