# Hướng dẫn sử dụng PNS — hai mục tiêu chính

## 0. Chọn cách làm việc

| Bạn đang ở | Mở | Giọng AI cá nhân | Dữ liệu |
|---|---|---|---|
| Máy Windows đã cài PNS | `START_PNS.bat` → `http://127.0.0.1:7860` | Có (VieNeu-TTS trên CPU) | Trên máy `%LOCALAPPDATA%\PhucNguyenStudio` |
| Bản web | https://luuhuongnnpl-apag.github.io/PN-studio/ | Có, nếu cùng máy đang mở START_PNS và đã ghép nối | Trong trình duyệt đang dùng |
| Bản web trên máy khác (không có Engine) | như trên | Không — dùng giọng thu âm thật | Trong trình duyệt đó |

Chuyển dự án giữa các nơi: **Dự án → Sao lưu (.pnsproj)** rồi **Khôi phục** ở nơi kia. Mẫu giọng không đi kèm file sao lưu (dữ liệu sinh trắc).

### Chuẩn bị một lần trên máy Windows
1. Chạy `START_PNS.bat`. Lần đầu cần Internet (tạo môi trường Python, cài thư viện, khoảng 2–5 phút).
2. Chạy `INSTALL_VOICE_AI.bat`: cài VieNeu-TTS, tải model và đọc thử một câu. Màn hình in thời gian và RTF; RTF > 1,5 nghĩa là máy chậm → **Cài đặt → Giọng AI → v3 Nano**.
3. Mở lại `START_PNS.bat`. Engine tự nạp sẵn model trong nền nên lần sinh giọng đầu không phải chờ thêm.
4. Nếu muốn làm trên bản web: trong Engine vào **Cài đặt → Cầu nối bản web → Kết nối bản web với máy này**. Trang web mở ra, tự lưu khóa ghép nối và báo «Đã ghép nối». Chrome/Edge có thể hỏi «cho phép truy cập thiết bị trong mạng cục bộ» → **Cho phép**. Làm một lần cho mỗi trình duyệt.

## 1. Video bài giảng từ slide + giọng AI (từ giọng thật của bạn)

1. **Voice Studio → Thêm mẫu giọng**: thu micro hoặc chọn file 3–15 giây, đọc rõ, phòng yên tĩnh, không nhạc nền. Nhập tên người sở hữu, tick xác nhận quyền → Lưu.
2. Bấm **Sinh câu thử**, nghe so sánh với giọng thật; đạt thì bấm **Duyệt độ giống**. Chưa giống: thu lại mẫu sạch hơn hoặc dài hơn (10–15 giây).
3. **Voice Studio → Từ điển đọc**: kiểm tra cách đọc viết tắt (BLDS, BLTTDS, HN&GĐ…), thêm từ riêng của học phần; ô «Xem trước» cho thấy văn bản sẽ đọc.
4. **Lecture Studio → Dự án mới → Nhập PDF/PPTX**: mỗi trang thành một cảnh.
5. Lời giảng: gõ từng cảnh, hoặc **Content Studio** → «Sao chép lệnh mẫu cho ChatGPT/Claude» → dán kết quả vào ô kịch bản → Xem trước → Áp dụng. Xem bảng **Rà soát kịch bản** để bổ sung căn cứ còn thiếu.
6. Ở mỗi cảnh chọn **Âm thanh → Giọng AI**, chọn mẫu giọng (hoặc giữ «Giọng thật» cho cảnh muốn tự thu). **Tạo giọng AI cảnh này** để nghe thử; sửa lời giảng thì cảnh tự chuyển sang «cần tạo lại».
7. **Video Studio → Kết xuất**: bản 720p để xem nhanh, bản 1080p để phát hành. Cảnh giọng AI còn thiếu được sinh tự động trước khi dựng.
8. **Trung tâm xuất bản → Duyệt** bản 1080p → tải gói MP4 + SRT (video có giọng AI được gắn nhãn «Lời thuyết minh tạo bằng AI»).

Mẹo cho nhanh: thời gian sinh xấp xỉ RTF × độ dài âm thanh (RTF 0,5 → 10 phút lời giảng mất khoảng 5 phút). Đoạn đã sinh được lưu đệm: sửa một cảnh chỉ sinh lại cảnh đó.

## 2. Học liệu điện tử

1. Mỗi bài học là một dự án đã kết xuất 1080p và đã duyệt (mục 1). Muốn có câu hỏi tự dừng trong video: **Interactive Studio** → chọn đúng bản kết xuất → thêm câu hỏi theo mốc thời gian.
2. **Học liệu điện tử → Tạo học liệu mới**: nhập tên, học phần, giảng viên, giới thiệu, mục tiêu học tập (mỗi dòng một mục tiêu), ảnh bìa (tạo nhanh ở **Image Studio → Ảnh bìa**).
3. **+ Thêm bài** cho từng bài: chọn dự án và bản video; bật/tắt Lời giảng, Căn cứ pháp lý, Câu hỏi trong video; **+ Tài liệu** để đính kèm PDF văn bản luật, đề cương, phiếu bài tập.
4. **Bài kiểm tra cuối** (tùy chọn): thêm từng câu hoặc «Nhập nhanh» theo mẫu:
   ```
   Câu 1. Thời điểm mở thừa kế là?
   A. Ngày lập di chúc
   *B. Thời điểm người có tài sản chết
   Giải thích: Khoản 1 Điều 611 BLDS 2015
   ```
   Đặt điểm đạt (mặc định 70%).
5. **Kiểm tra** → xem cảnh báo (bản chưa duyệt, dự án sửa sau khi kết xuất, câu hỏi gắn bản khác). **Xem thử như người học** để chạy thử.
6. Xuất:
   - **Gói web (HTML)**: giải nén → mở `index.html`, hoặc đăng cả thư mục lên PNL/GitHub Pages. Tiến độ lưu trên trình duyệt người học.
   - **Gói SCORM 1.2**: Moodle → Thêm hoạt động → Gói SCORM → tải nguyên file `.zip`. LMS ghi nhận trạng thái (chưa xong/hoàn thành/đạt/chưa đạt), điểm bài kiểm tra và vị trí học tiếp.

Người học hoàn thành một bài khi xem tối thiểu 90% video (chỉnh được) và trả lời các câu hỏi trong video; tua nhanh không được tính là đã xem.

## 3. Khi có sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Bản web báo «Không kết nối được PNS Engine» | Mở `START_PNS.bat`; Cài đặt → Kiểm tra lại; trình duyệt hỏi truy cập mạng cục bộ → Cho phép. Safari chưa hỗ trợ — dùng Chrome/Edge. |
| «Sai hoặc thiếu khóa ghép nối» | Engine đã đổi khóa: bấm lại «Kết nối bản web với máy này». |
| Giọng AI chưa giống | Thu mẫu mới sạch hơn, 10–15 giây, cùng micro sẽ dùng; tránh vọng phòng. |
| Sinh giọng chậm | Cài đặt → Giọng AI: v3 Nano; đóng bớt ứng dụng nặng; sinh từng cảnh lúc soạn thay vì dồn khi kết xuất. |
| Kết xuất trên bản web chậm | Bản web dùng ffmpeg.wasm (chậm hơn 3–5 lần); video dài nên kết xuất bằng Engine trên máy. |
| Gói SCORM tải lên Moodle báo lỗi | Tải nguyên file `.zip` (không giải nén); kiểm tra giới hạn dung lượng tải lên của Moodle. |
