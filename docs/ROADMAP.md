# Chức năng chưa hoàn thành

## Cần sếp phối hợp
1. Kiểm thử Windows thật (A01), giọng AI VieNeu với mẫu giọng thật (A05): ghi thời gian, RTF, RAM; duyệt độ giống, phát âm, ngắt nghỉ.
2. Tạo repo GitHub `luuhuongnnpl-apag/phuc-nguyen-studio` (trống) hoặc cấp quyền để đẩy mã và mở PR.
3. Duyệt tạo Hosting site `phuc-nguyen-studio` trong project `phuc-nguyen-library` (A10).
4. Demo Thừa kế end-to-end bằng PDF và kịch bản thật.

## P1
- Đăng nhập Firebase Auth, metadata dự án trên Firestore (`pnStudioProjects`), xuất bản có duyệt (`pnStudioPublications`), kiểm thử rules bằng emulator; tài khoản không quyền bị từ chối; rollback theo revision.
- Audio Studio (trim/fade theo đoạn), timeline kéo thả nâng cao, transcript bằng Whisper CPU (căn chỉnh phụ đề theo từ).
- Image Studio (ảnh bìa, đổi kích thước), Content Studio (kịch bản có nguồn, AI tùy chọn), Podcast Studio.
- Điều chỉnh tốc độ đọc giọng AI (chỉ khi có xử lý thật).
- Khóa toàn bộ phụ thuộc con (`pip freeze`) sau khi chạy đạt trên Windows; đóng gói cài đặt không cần Python (PyInstaller) nếu cần.

## P2
Avatar Studio (tự nguyện, gắn nhãn AI), Interactive Studio (câu hỏi theo mốc, H5P), sản xuất hàng loạt, thống kê tối thiểu, phiên bản học liệu.
