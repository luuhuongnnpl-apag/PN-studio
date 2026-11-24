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
