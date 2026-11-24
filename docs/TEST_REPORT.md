# Báo cáo kiểm thử — PNS v0.1.0 (24/11/2026)

Môi trường: Linux x86-64, Python 3.13, FFmpeg hệ thống, LibreOffice, Chrome (Playwright). **Chưa chạy trên Windows.**
- Kiểm thử tự động: `pytest engine/tests` — 11/11 PASS (log: `docs/test-log.txt`).
- Kiểm thử giao diện: `tools/ui_smoke.py` — luồng đầy đủ trên Chrome 1440×900 và 390×844, 0 lỗi console.
- `PNS_TEST_TTS=1` thay model bằng bộ sinh sóng sin để kiểm thử đường ống cache/render. **Không phải bằng chứng giọng AI chạy được.**

| ID | Kết quả | Bằng chứng / ghi chú |
|---|---|---|
| A01 Windows sạch | **NOT TESTED** | `START_PNS.bat` báo thiếu Python, tự cài thư viện khóa phiên bản; cần chạy trên máy sếp |
| A02 PDF nhiều trang | PASS | PDF 3 trang (2 trang 16:9 + 1 trang A4 dọc): thumbnail đúng thứ tự 1-2-3; trang dọc 764×1080 đúng tỷ lệ; kéo thả/Alt+↑↓ đổi thứ tự; lưu và mở lại |
| A03 Kịch bản | PASS | Sửa cảnh, hoàn tác/làm lại (xóa cảnh → Ctrl+Z khôi phục), xung đột revision → 409; sao lưu/khôi phục `.pnsproj` giữ nguyên lời giảng và liên kết âm thanh |
| A04 Giọng thật | PASS | Nạp M4A và WAV, chuẩn hóa −16 LUFS/48 kHz, nghe thử, gắn đúng cảnh 1 và 3; thu micro trong trình duyệt (MediaRecorder) có giao diện, **chưa thử với micro thật** |
| A05 Clone | **NOT TESTED** | Đã đối chiếu mã nguồn `vieneu` 3.8.5 trên PyPI (API `Vieneu(mode, backend="onnx")`, `infer(text, ref_audio)`, Apache-2.0 cả trọng số). Máy kiểm thử không truy cập được Hugging Face nên chưa tải được model. Cần sếp chạy *Sinh câu thử* với câu ACCEPTANCE, ghi thời gian/RTF/RAM hiển thị sẵn trên giao diện, và duyệt độ giống |
| A06 Lỗi model | PASS | Không cài VieNeu: API trả lỗi cụ thể, job kết xuất báo `failed` kèm lý do; đổi cảnh sang giọng thật thì kết xuất thành công. Hủy job đang chạy → `cancelled` |
| A07 Video | PASS | 3 cảnh (thu âm, AI-test, không lời): MP4 1920×1080 H.264/AAC, `+faststart`, tua được (HTTP 206); slide dọc letterbox không méo; nhãn «Lời thuyết minh tạo bằng AI»; SRT hợp lệ, mọi mốc ≤ thời lượng, giữ văn bản gốc «Điều 612 BLDS 2015» |
| A08 Sửa cảnh | PASS | Đổi lời cảnh 2 → chỉ cảnh 2 `audioStale`; kết xuất lại dùng lại 2/3 clip, sinh đúng 1 đoạn TTS mới; SRT mới chứa câu đã sửa, không còn câu cũ |
| A09 Bảo mật | PASS | Thiếu/sai mã phiên → 401; Host lạ → 403; Origin lạ → 403; không có header CORS; file giả PDF/WAV, `.exe` → 422; tên `../../../evil.pdf` lưu an toàn; gói `.pnsproj` chứa `../../../pwn.txt` bị bỏ qua; `.gitignore` chặn wav/mp3/mp4/khóa |
| A10 Firebase staging | **NOT TESTED** | Chưa có quyền Firebase. Đã có `firebase.json` site riêng (target `pns`) và bản nháp rules P1; chưa deploy |
| A11 Regression | PASS (theo thiết kế) | PNS ở repo riêng; không sửa repo PNL (git status sạch), không đụng `firebase.json`/Functions `pnl-vandap`, rules hay dữ liệu lớp/điểm |
| A12 Bàn giao | MỘT PHẦN | README, hướng dẫn Windows, khóa phụ thuộc lõi, log test, commit có mô tả. Chưa có repo GitHub/PR do chưa được cấp quyền tạo repo |

## Chế độ trình duyệt (v0.2, 24/11/2026)
Chrome, trang phục vụ tĩnh dưới đường dẫn con `/PN-studio/web/` (giống GitHub Pages), không có Engine — `tools/browser_mode_smoke.py`:
PASS — nhập PDF 3 trang thành slide (pdf.js), tải M4A và gắn cảnh, kết xuất MP4 1920×1080 dài 15 s trong 9,4 s (ffmpeg.wasm), phát được trong trình duyệt, duyệt, tải gói phát hành, sao lưu `.pnsproj`; 0 lỗi console.
PASS — `.pnsproj` từ trình duyệt khôi phục vào PNS Engine (giữ bản thu gắn cảnh) và ngược lại.
PASS — hồi quy chế độ Engine: 11/11 pytest, luồng giao diện đầy đủ 0 lỗi.
NOT TESTED — trên GitHub Pages thật, Firefox/Safari, video dài trên 10 phút (giới hạn bộ nhớ ffmpeg.wasm).

## Bài test nội dung
Chưa dùng PDF Thừa kế thật và mẫu `PNL_Voice_001.wav` (chủ sở hữu giữ riêng, không đưa vào repo). Đã dùng PDF/âm thanh tổng hợp. Chuẩn hóa văn bản đọc câu ACCEPTANCE viết bằng số («Điều 612 BLDS 2015») cho kết quả trùng khớp câu viết bằng chữ trong ACCEPTANCE.md (test `test_acceptance_phrase`).

## Lỗi/giới hạn đã biết
- Phụ đề tự động: mốc theo câu, **ước lượng** theo tỷ lệ ký tự (chưa căn chỉnh từng từ); có chế độ sửa tay.
- Tốc độ đọc giọng AI chưa có điều chỉnh (chỉ bật khi có xử lý thật).
- Chưa đo hiệu năng CPU của VieNeu trên máy mục tiêu; không đặt ngưỡng giả định.

## Bổ sung v0.2.0 (25/11/2026) — 5 studio mở rộng
- `pytest engine/tests` — 18/18 PASS (11 cũ + 7 mới trong `test_studios.py`).
- `tools/ui_smoke_studios.py` — luồng Image → Audio → Content → Podcast → kết xuất → Interactive (xem thử, trả lời câu hỏi) trên Chrome 1440×900, 0 lỗi console, chạy đạt ở **cả hai chế độ**: PNS Engine và chế độ trình duyệt (repo tĩnh dưới `/PN-studio/web/`, ffmpeg.wasm).
- Đối chiếu Content Studio Python ↔ JS trên 5 mẫu kịch bản (tiêu đề cảnh, Markdown, khối ---, nguồn, cờ kiểm chứng, Điều/số hiệu văn bản): kết quả tách cảnh và rà soát trùng khớp.

| Studio | Kết quả | Bằng chứng |
|---|---|---|
| Image | PASS | Cắt 1:1 → 512×512 JPG giữ ghi chú quyền sử dụng; xoay 90° đổi chiều; ảnh bìa navy/nền trắng/ảnh nền ở 16:9, 1:1, 9:16 đúng kích thước, đã soát bằng mắt chữ tiếng Việt không đè dải màu |
| Audio | PASS | Dạng sóng 200 cột; ghép 2,0 s + 0,5 s lặng + 2,0 s = ~4,5 s; mốc cắt ngược, danh sách rỗng → 422 |
| Content | PASS | Nhận «## Cảnh n:», «**Slide n – …**», «Cảnh n:», Markdown, khối «---»; bỏ phần mở đầu; ghép giữ slide; revision lệch → 409; rà soát phát hiện «Điều 12» chưa có trong căn cứ; xuất `.md` rồi nhập lại khớp |
| Podcast | PASS | 1 s mở đầu + 3 s + 2 s, lặng 0,5 s → ~7 s MP3; 3 chương ID3 đọc được bằng FFmpeg; cảnh không âm thanh bị bỏ qua và báo; gói chỉ tải sau khi duyệt; URL không phải https bị loại |
| Interactive | PASS | Câu thiếu phương án/đáp án → 422; trình phát dừng đúng mốc, chấm đúng/sai; nội dung `</script><script>` không chèn được mã; gói chỉ tải với bản đã duyệt |

Giới hạn: chưa chạy trên Windows thật; chế độ trình duyệt chuẩn hóa bản thu gốc theo RMS (không phải EBU R128) như trước, còn bản xuất của Audio/Podcast Studio dùng loudnorm −16 LUFS ở cả hai chế độ; trên Firebase (CSP chặn script nội tuyến) trình phát dùng file `player/interactive.js` ngoài nên vẫn chạy; nghe thử MP3 trên ứng dụng podcast thật chưa làm; Avatar Studio vẫn chưa mở.

## Bổ sung v0.3.0 (24/11/2026) — cầu nối giọng AI cho bản web, Học liệu điện tử
- `pytest engine/tests` — 24/24 PASS (thêm `test_bridge.py` 4 test; `test_studios.py` thêm CRUD học liệu và kiểm tra đáp án).
- `tools/bridge_smoke.py` (bản web ↔ Engine thử nghiệm): ghép nối qua đường dẫn (khóa tự xóa khỏi URL) → thêm mẫu giọng trong trình duyệt → sinh câu thử qua Engine → dự án 2 cảnh giọng AI kết xuất (tự sinh giọng, `aiNarration` = true, văn bản đọc đã chuẩn hóa «Bộ luật Dân sự», «sáu trăm mười hai») → sửa lời cảnh 2 chỉ làm cảnh 2 «cũ» → tạo lại từ Lecture Studio. 0 lỗi console.
- `tools/elearning_smoke.py`, chạy đạt ở **cả hai chế độ**: soạn học liệu 2 bài + tài liệu PDF + 3 câu nhập nhanh (`*A.`, `Đáp án: B`, dấu `*` cuối dòng) → Kiểm tra → Xem thử (câu hỏi tự dừng trong video) → gói web và gói SCORM 1.2 → giải nén chạy trong LMS giả lập (`window.API`): trạng thái `incomplete` khi chưa làm kiểm tra, `passed` + `score.raw` = 100 sau khi nộp, `suspend_data` 164 ký tự.
- Hồi quy: `ui_smoke.py`, `browser_mode_smoke.py`, `ui_smoke_studios.py` (hai chế độ) đều 0 lỗi.
- Sửa lỗi phát hiện khi kiểm thử: Engine nhận `correct = -1` thành đáp án A (nay báo lỗi); bỏ phương án trống làm lệch đáp án đúng (nay giữ đúng vị trí); tên file câu thử giọng bị ghi đè ở bản web.

Giới hạn: môi trường phát triển không truy cập được huggingface.co nên chưa chạy model VieNeu thật (đã đối chiếu chữ ký API gói `vieneu` 3.8.5: `Vieneu(mode, backend="onnx", precision, threads)`, `infer(text, ref_audio, denoise)`, `save`); kết nối bản web công khai → 127.0.0.1 (Private Network Access) chỉ kiểm được phần tiêu đề CORS bằng test tự động, cần thử trên Chrome/Edge thật; SCORM mới thử với LMS giả lập, chưa thử trên Moodle của Học viện.
