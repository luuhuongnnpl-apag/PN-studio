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

## Trạng thái
- Phân hệ sẵn sàng: Bảng điều khiển, Dự án, Thư viện media, Lecture Studio, Voice Studio, Video Studio, Trung tâm xuất bản, Cài đặt.
- Chưa khả dụng (ghi rõ trên giao diện, không có nút giả): Audio, Content, Image, Podcast (P1); Avatar, Interactive (P2).
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
