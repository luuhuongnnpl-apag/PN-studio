# Phúc Nguyên Studio (PNS)

Nền tảng sản xuất nội dung số đa phương tiện của hệ sinh thái Phúc Nguyên — **web app độc lập, ngang hàng** Phúc Nguyên Library (PNL) và Phúc Nguyên Digital (PND).

| Thành phần | Vai trò | Chạy ở đâu |
|---|---|---|
| `web/` | Giao diện PNS: trang chủ, bảng điều khiển, dự án, thư viện media, các Studio, trung tâm xuất bản, cài đặt | Phục vụ bởi PNS Engine (đầy đủ chức năng) **và** Firebase Hosting site riêng (chế độ web: giới thiệu + hướng dẫn) |
| `engine/` | **PNS Engine**: FastAPI cục bộ — dự án, media, PDF/PPTX → slide, giọng thật, giọng AI (VieNeu-TTS ONNX/CPU), kết xuất MP4/SRT, duyệt, gói phát hành, sao lưu | Máy Windows của giảng viên, chỉ `127.0.0.1` |

## Hai cách dùng
| | Chế độ trình duyệt (GitHub Pages / Firebase) | PNS Engine (máy Windows) |
|---|---|---|
| Mở | https://luuhuongnnpl-apag.github.io/PN-studio/ | `START_PNS.bat` → http://127.0.0.1:7860 |
| PDF → slide, lời giảng, giọng thật/thu micro, MP4 1080p + SRT, duyệt, gói phát hành | Có (pdf.js, ffmpeg.wasm) | Có (FFmpeg) |
| PPTX | Xuất PDF trước | Có (LibreOffice) |
| Giọng AI cá nhân (VieNeu) | Có — sinh bởi PNS Engine trên cùng máy qua **cầu nối** (ghép nối một lần) | Có |
| Học liệu điện tử (gói web / SCORM 1.2) | Có | Có |
| Dữ liệu | Trong trình duyệt của máy đang dùng | `%LOCALAPPDATA%\PhucNguyenStudio` |

Chuyển dự án giữa hai chế độ bằng file `.pnsproj` (Dự án → Sao lưu / Khôi phục), tương thích hai chiều.

## Dùng nhanh
1. Máy Windows: chạy `START_PNS.bat` (tự đề nghị cài Python 3.12 nếu thiếu) → `http://127.0.0.1:7860`.
2. Giọng AI cá nhân: chạy `INSTALL_VOICE_AI.bat` một lần (cài VieNeu-TTS, tải và chạy thử model), mở lại `START_PNS.bat`.
3. Muốn làm trên bản web: trong Engine vào **Cài đặt → Kết nối bản web với máy này** (một lần cho mỗi trình duyệt). Bản web dùng giọng AI của máy khi cửa sổ START_PNS đang mở.

Hướng dẫn từng bước cho hai mục tiêu (video từ slide + giọng AI; học liệu điện tử): [docs/HUONG_DAN_SU_DUNG.md](docs/HUONG_DAN_SU_DUNG.md). Cài đặt chi tiết: [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md).

## Quy trình video bài giảng (P0 — đã chạy được)
PDF/PPTX → mỗi trang một cảnh (giữ tỷ lệ) → lời giảng + nguồn/căn cứ từng cảnh → giọng thật (tải lên/thu micro) hoặc giọng AI từ mẫu giọng có xác nhận quyền → phụ đề tự động/sửa tay → MP4 1080p H.264/AAC + SRT → duyệt → gói phát hành cho PNL/PND.

## Học liệu điện tử (v0.3.0)
Ghép nhiều video bài giảng đã duyệt thành một học liệu: trang giới thiệu, mục tiêu, mục lục bài, video có phụ đề và chương mục, câu hỏi tự dừng trong video, tab Lời giảng / Căn cứ pháp lý / Tài liệu (PDF văn bản luật…), bài kiểm tra cuối có điểm đạt; tiến độ hoàn thành theo % thời lượng đã xem. Xuất **gói web HTML** (mở trực tiếp hoặc đăng PNL/GitHub Pages) hoặc **gói SCORM 1.2** (Moodle/LMS ghi nhận trạng thái, điểm, học tiếp). Câu hỏi kiểm tra nhập nhanh từ văn bản (`*A.` hoặc `Đáp án: A`).

## Các studio mở rộng (v0.2.0)
| Studio | Làm được |
|---|---|
| Image | Cắt theo tỷ lệ 16:9/4:3/1:1/4:5/9:16 (kéo khung), phóng, xoay, lật, đổi kích thước, PNG/JPG; ảnh bìa bài giảng 3 mẫu × 3 kích thước, chữ tiếng Việt tự ngắt dòng |
| Audio | Ghép nhiều đoạn (thư viện/thu micro), dạng sóng, cắt đầu/cuối, fade, âm lượng dB, khoảng lặng, chuẩn hóa −16 LUFS |
| Content | Dán kịch bản từ Word/ChatGPT/Claude → tách cảnh, nguồn – căn cứ, cờ «Cần kiểm chứng»; ghép vào cảnh giữ slide/âm thanh; rà soát viện dẫn Điều/số hiệu văn bản chưa ghi căn cứ; ước thời lượng; xuất `.md`; lệnh mẫu cho AI |
| Podcast | Tập MP3 từ âm thanh các cảnh + mở đầu/kết thúc, chương mục ID3, ảnh bìa nhúng, nhãn AI; duyệt → gói `audio + cover + episode.json + rss-item.xml + chapters.json` |
| Interactive | Câu hỏi trắc nghiệm theo mốc video (bắt buộc đúng/giải thích); xem thử như người học; gói `index.html` độc lập + MP4 + VTT (chỉ từ bản 1080p đã duyệt) |

Mọi thao tác không sửa file gốc: kết quả lưu thành tài sản mới trong Thư viện media. Cả 5 studio chạy được ở **PNS Engine** và **chế độ trình duyệt** (GitHub Pages: ảnh bằng canvas, âm thanh/podcast bằng ffmpeg.wasm, dữ liệu ở IndexedDB); giọng AI cá nhân ở bản web được sinh bởi PNS Engine của máy qua cầu nối. Logic Content Studio có hai bản (Python `studios.py`, JS `web/js/local/content.js`) đã đối chiếu cho kết quả trùng khớp.

## Trạng thái
- Phân hệ sẵn sàng (v0.3.0): Bảng điều khiển, Dự án, Thư viện media, Lecture, Voice, Video, Audio, Content, Image, Podcast, Interactive Studio, **Học liệu điện tử**, Trung tâm xuất bản, Cài đặt; **cầu nối giọng AI** cho bản web.
- Chưa khả dụng (ghi rõ trên giao diện, không có nút giả): Avatar Studio (P2 — chưa có model mã nguồn mở chạy CPU đạt chất lượng).
- Kết quả kiểm thử thực tế: [docs/TEST_REPORT.md](docs/TEST_REPORT.md). Việc còn lại: [docs/ROADMAP.md](docs/ROADMAP.md).
- Kiến trúc, bảo mật, hợp đồng dữ liệu, liên thông PNL/PND: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Triển khai staging Firebase và rollback: [docs/DEPLOY_STAGING.md](docs/DEPLOY_STAGING.md).

## Phát triển
```bash
python -m venv .venv && .venv/bin/pip install -r engine/requirements-dev.txt
.venv/bin/python -m pytest -q engine/tests
python engine/run.py            # http://127.0.0.1:7860
```

## Nguồn gốc
Kế thừa nguyên mẫu PN Lecture Studio / PN Voice Studio (nhánh `pn-lecture-studio-v1`, thư mục `tools/pn-lecture-studio` của repo PNL, commit `cf0c372`): mô hình cảnh–lời giảng–ghi chú căn cứ, xuất/nhập JSON, Gradio + VieNeu cục bộ. Nhánh chính PNL không bị sửa.

Không commit mẫu giọng, khóa, token hay dữ liệu sinh viên. Chưa chọn giấy phép mã nguồn — chủ sở hữu quyết định.
