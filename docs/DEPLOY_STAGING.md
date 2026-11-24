# Triển khai web staging, rollback, chi phí

## Phương án ưu tiên: Hosting site riêng trong project `phuc-nguyen-library`
Site Hosting thứ hai trong cùng project (gói Spark miễn phí cho phép nhiều site) — không chạm site PNL, Functions `pnl-vandap`, Firestore rules hay dữ liệu.

Chạy trên máy có quyền Owner/Editor của project (cần duyệt trước khi chạy):
```bash
npm i -g firebase-tools && firebase login
firebase hosting:sites:create phuc-nguyen-studio --project phuc-nguyen-library   # tạo site, 1 lần
# Bản xem trước (kênh preview, tự hết hạn sau 7 ngày, không ảnh hưởng URL chính):
firebase hosting:channel:deploy staging --only pns --expires 7d
# Chỉ khi sếp duyệt lên chính thức:
firebase deploy --only hosting:pns
```
`firebase.json` của repo PNS chỉ khai báo `hosting` target `pns` (thư mục `web/`), nên lệnh trên không thể ghi đè cấu hình PNL. URL dự kiến (chỉ có sau khi tạo site): `https://phuc-nguyen-studio.web.app`.

Nếu không được tạo site: dùng GitHub Pages của repo `phuc-nguyen-studio` (Settings → Pages → thư mục `/web` qua Actions) làm staging tạm; trang web không chứa dữ liệu cá nhân.

## Rollback
- Web: Firebase Console → Hosting → site `phuc-nguyen-studio` → Release history → *Rollback*; hoặc `firebase hosting:clone phuc-nguyen-studio:<version> phuc-nguyen-studio:live`. Kênh preview: `firebase hosting:channel:delete staging`.
- Engine: giữ thư mục mã nguồn cũ; chạy lại `START_PNS.bat` của bản cũ. Dữ liệu (`%LOCALAPPDATA%\PhucNguyenStudio`) tương thích ngược theo `schemaVersion`; sao lưu thư mục dữ liệu trước khi cập nhật.
- Dự án: khôi phục từ `.pnsproj`. Bản phát hành: thu hồi duyệt trong Trung tâm xuất bản; bản đã đăng trên PNL gỡ thủ công.

## Chi phí dự kiến
| Hạng mục | Chi phí |
|---|---|
| Engine, FFmpeg, pypdfium2, VieNeu-TTS (Apache-2.0) | 0 đ — chạy trên máy cá nhân |
| Firebase Hosting site thứ hai (Spark) | 0 đ trong hạn mức 10 GB lưu trữ / 360 MB/ngày truyền tải |
| GitHub repo công khai | 0 đ |
| P1 Firestore/Storage cho metadata, video đã duyệt | Spark miễn phí trong hạn mức; video lớn có thể cần Blaze → **phải xin duyệt trước, không bật tự động** |
Không có API trả phí bắt buộc.
