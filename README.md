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
| Giọng AI cá nhân (VieNeu) | Không | Có |
| Dữ liệu | Trong trình duyệt của máy đang dùng | `%LOCALAPPDATA%\PhucNguyenStudio` |

Chuyển dự án giữa hai chế độ bằng file `.pnsproj` (Dự án → Sao lưu / Khôi phục), tương thích hai chiều.

## Dùng nhanh (Windows)
1. Cài Python 3.11 (tick *Add python.exe to PATH*).
2. Chạy `START_PNS.bat` → trình duyệt mở `http://127.0.0.1:7860`.
3. (Tùy chọn) giọng AI cá nhân: chạy `INSTALL_VOICE_AI.bat`, khởi động lại Engine.

Chi tiết: [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md).

## Quy trình video bài giảng (P0 — đã chạy được)
PDF/PPTX → mỗi trang một cảnh (giữ tỷ lệ) → lời giảng + nguồn/căn cứ từng cảnh → giọng thật (tải lên/thu micro) hoặc giọng AI từ mẫu giọng có xác nhận quyền → phụ đề tự động/sửa tay → MP4 1080p H.264/AAC + SRT → duyệt → gói phát hành cho PNL/PND.

## Các studio mở rộng (v0.2.0)
| Studio | Làm được |
|---|---|
| Image | Cắt theo tỷ lệ 16:9/4:3/1:1/4:5/9:16 (kéo khung), phóng, xoay, lật, đổi kích thước, PNG/JPG; ảnh bìa bài giảng 3 mẫu × 3 kích thước, chữ tiếng Việt tự ngắt dòng |
| Audio | Ghép nhiều đoạn (thư viện/thu micro), dạng sóng, cắt đầu/cuối, fade, âm lượng dB, khoảng lặng, chuẩn hóa −16 LUFS |
| Content | Dán kịch bản từ Word/ChatGPT/Claude → tách cảnh, nguồn – căn cứ, cờ «Cần kiểm chứng»; ghép vào cảnh giữ slide/âm thanh; rà soát viện dẫn Điều/số hiệu văn bản chưa ghi căn cứ; ước thời lượng; xuất `.md`; lệnh mẫu cho AI |
| Podcast | Tập MP3 từ âm thanh các cảnh + mở đầu/kết thúc, chương mục ID3, ảnh bìa nhúng, nhãn AI; duyệt → gói `audio + cover + episode.json + rss-item.xml + chapters.json` |
| Interactive | Câu hỏi trắc nghiệm theo mốc video (bắt buộc đúng/giải thích); xem thử như người học; gói `index.html` độc lập + MP4 + VTT (chỉ từ bản 1080p đã duyệt) |

Mọi thao tác không sửa file gốc: kết quả lưu thành tài sản mới trong Thư viện media. Cả 5 studio chạy được ở **PNS Engine** và **chế độ trình duyệt** (GitHub Pages: ảnh bằng canvas, âm thanh/podcast bằng ffmpeg.wasm, dữ liệu ở IndexedDB); riêng giọng AI cá nhân vẫn chỉ ở Engine. Logic Content Studio có hai bản (Python `studios.py`, JS `web/js/local/content.js`) đã đối chiếu cho kết quả trùng khớp.

## Trạng thái
- Phân hệ sẵn sàng (v0.2.0): Bảng điều khiển, Dự án, Thư viện media, Lecture Studio, Voice Studio, Video Studio, **Audio Studio, Content Studio, Image Studio, Podcast Studio, Interactive Studio**, Trung tâm xuất bản, Cài đặt.
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
