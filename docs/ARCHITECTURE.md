# Kiến trúc PNS v0.1

## Tổng thể
```
 Firebase Hosting (site phuc-nguyen-studio)        Máy Windows của giảng viên
 ┌──────────────────────────────┐                 ┌──────────────────────────────────────┐
 │ web/ ở chế độ web            │                 │ PNS Engine (FastAPI, 127.0.0.1:7860)  │
 │ trang chủ, giới thiệu studio,│                 │  ├ web/ (cùng origin, đủ chức năng)   │
 │ hướng dẫn mở Engine          │                 │  ├ SQLite + thư mục media/giọng/cache │
 │ (không dữ liệu cá nhân)      │                 │  ├ pypdfium2, FFmpeg, LibreOffice?    │
 └──────────────────────────────┘                 │  └ VieNeu-TTS ONNX CPU (tùy chọn)     │
            ▲  P1: Auth + Firestore metadata      └──────────────────────────────────────┘
            │  (upload có chủ đích, có duyệt)                 │ gói phát hành .zip (thủ công)
            └───────────────────────────────────── PNL / PND ◄┘
```
Cùng một mã `web/` chạy hai chế độ: `api.js` chỉ coi là có Engine khi trang được phục vụ từ `127.0.0.1`/`localhost` **và** có mã phiên do Engine chèn. Web trên Firebase không bao giờ gọi localhost.

## Engine (`engine/pns_engine`)
| Mô-đun | Nội dung |
|---|---|
| `app.py` | API REST + phục vụ giao diện; middleware bảo mật |
| `core.py` | Nghiệp vụ: dự án/cảnh, liên kết âm thanh, giọng, kết xuất, duyệt, gói phát hành, sao lưu |
| `storage.py` | SQLite (WAL) + thư mục tài sản; ID ổn định dạng `pj_/sc_/as_/vc_/jb_/rd_` + 16 hex |
| `media.py` | FFmpeg (tìm PATH hoặc imageio-ffmpeg), PDF → PNG 1920×1080 giữ tỷ lệ, PPTX → PDF qua LibreOffice, chuẩn hóa âm lượng EBU R128 |
| `textnorm.py` | Từ điển viết tắt + đọc số tiếng Việt (Điều/khoản, ngày, tiền, %, số hiệu văn bản) |
| `tts.py` | Bộ chuyển VieNeu (`Vieneu(mode, backend="onnx", precision)` → `infer(text, ref_audio)`), chia đoạn ≤400 ký tự, cache theo hash |
| `render.py` | Khung hình letterbox + nhãn AI, clip từng cảnh, ghép MP4 (+faststart), SRT |
| `studios.py` | Image (crop/resize/ảnh bìa), Audio (dạng sóng, cắt/fade/ghép), Content (tách kịch bản, rà soát viện dẫn), Podcast (MP3 + chương ID3 + RSS item), Interactive (câu hỏi theo mốc; trình phát dùng chung `web/player/interactive.html` + `interactive.js`) |
| `jobs.py` | Một luồng worker: một job CPU tại một thời điểm, tiến độ, hủy (kill tiến trình con), lỗi rõ ràng |

### Bộ nhớ đệm và vô hiệu hóa (A08)
- Audio AI: `sha256(văn bản đọc + model + cấu hình)` cho từng đoạn ⊕ sha mẫu giọng. Cảnh lưu `spoken_hash`; khác hash ⇒ `audioStale`.
- Clip cảnh: `sha256(phiên bản renderer, chất lượng, sha slide, sha audio, thời lượng, cờ AI)`. Đổi lời cảnh 2 ⇒ chỉ đoạn TTS và clip cảnh 2 sinh lại (đã kiểm thử: `clipsReused == 2`, đúng 1 file TTS mới).
- Liên kết âm thanh nằm ở bảng `scene_audio` (không nằm trong tài liệu dự án) để job phía server không xung đột với tự lưu của trình duyệt.

### Bảo mật
- Chỉ bind `127.0.0.1`; kiểm tra `Host` (chống DNS rebinding) và `Origin` (chống CSRF); không CORS.
- Mã phiên ngẫu nhiên mỗi lần khởi động: chèn vào trang + cookie `HttpOnly; SameSite=Strict`; mọi thao tác ghi bắt buộc header `X-PNS-Token`.
- CSP `script-src 'self'`, `frame-ancestors 'none'`; giao diện không dùng `innerHTML` với dữ liệu người dùng.
- Upload: giới hạn dung lượng, kiểm tra định dạng thật (magic PDF, Pillow verify, FFmpeg giải mã), lưu bằng tên do hệ thống đặt (`file.ext`), không dùng tên người dùng làm đường dẫn; nhập `.pnsproj` chỉ nhận mục `assets/<id hợp lệ>/file.<ext>` (chặn zip-slip).
- Tiến trình con gọi bằng danh sách tham số, không shell; có timeout.
- Mẫu giọng chỉ ở `voices/` cục bộ, không có trong gói sao lưu, gói phát hành hay repo.

## Hợp đồng dữ liệu (schemaVersion 1)
```
Project { id, schemaVersion, title, kind, status(draft|review|approved|published), revision, ownerId,
          course{course,chapter,lesson}, links{pndSource,pnlTarget}, tags[], description, scenes[] }
Scene   { id, title, slideAssetId, sourcePage, scriptOriginal, scriptSpoken, spokenOverride, sourceNotes,
          needsVerification, audioMode(none|recorded|tts), voiceId, silentDurationMs, captions[], captionsEdited,
          status(draft|review|approved), excluded }
          + tính toán: spokenText, audioAssetId, audioDurationMs, audioStale, wordCount
Caption { startMs, endMs, text }      Job { id, projectId, sceneId, type, status, progress, message, error, result }
Render  { id, projectId, projectRevision, quality, resolution, durationMs, timeline[], aiNarration, approval }
Publication (publication.json) { projectId, revision, renderId, videoPath, captionPath, approvedBy, approvedAt, aiNarration, sources[], target }
```
Cấu hình studio theo dự án lưu ở bảng `kv` (không nằm trong tài liệu dự án để tự lưu của Lecture Studio không ghi đè):
`podcast:<pid>` { title, description, author, coverAssetId, introAssetId, outroAssetId, gapMs, chapters, audioBaseUrl } —
tập podcast ở `podcasts/<pid>/pe_*/episode.json`; `interactive:<pid>` { renderId, questions[{id, atMs, text, options[2..6], correct, explain}], requireCorrect, showExplain }.
Chế độ trình duyệt: `web/js/local/studios.js` (+ `content.js`) cùng hợp đồng API, lưu ở store `kv` (`podcast:`, `podEps:`, `podEp:`, `interactive:`) và `blobs` (`p:<eid>:audio|cover`); `sw.js` phục vụ file tập podcast.
Xóa dự án dọn cả hai. Ảnh bìa/âm thanh được cấu hình podcast tham chiếu được tính là «đang dùng» (không xóa được).

Ghi dự án dùng kiểm tra `revision` (409 khi lệch). Thứ tự cảnh = thứ tự mảng; ID không phụ thuộc vị trí.

## Liên thông PNL / PND
- **PND → PNS**: dự án ghi `links.pndSource` (chỉ URL https mà tài khoản có quyền). PNS không sao chép kho PND.
- **PNS → PNL**: Trung tâm xuất bản tạo gói `MP4 + SRT + publication.json` sau khi duyệt bản 1080p; quản trị viên đăng lên PNL. Không tự động xuất bản, không đụng dữ liệu lớp/điểm/khảo thí.
- **P1 (chưa làm)**: đăng nhập Firebase Auth dùng chung, metadata ở `pnStudioProjects`, `pnStudioPublications` theo bản nháp rules `firebase/firestore.pns.rules.draft` (owner/editor/viewer, mặc định từ chối, bản nháp không hiện cho sinh viên, rollback theo revision).

## Đối sánh định hướng (không sao chép giao diện)
Tổ chức kiểu Adobe Creative Cloud/Canva: một vỏ nền tảng, nhiều studio, thư viện tài sản dùng chung, dự án xuyên module. Lecture Studio theo mô hình cảnh của Synthesia/HeyGen; phụ đề/xuất kiểu Camtasia/CapCut; biên tập theo transcript (Descript), câu hỏi theo mốc (H5P) để ở P1/P2.


## Cầu nối giọng AI cho bản web (v0.3.0) — `engine/pns_engine/bridge.py`, `web/js/local/bridge.js`, `web/js/local/voices.js`
- Bản web (chế độ trình duyệt) giữ mẫu giọng trong IndexedDB; khi sinh giọng gửi `POST http://127.0.0.1:<cổng>/bridge/tts` (multipart: `text`, `raw`, `dictionary`, `ref`) → job → `GET /bridge/jobs/{id}` → `GET /bridge/jobs/{id}/audio` (WAV).
- `/bridge/*` có cơ chế riêng trong middleware: Host vẫn phải là 127.0.0.1/localhost; Origin phải thuộc danh sách cho phép (kv `bridgeOrigins` + biến môi trường `PNS_WEB_ORIGINS`); header `X-PNS-Bridge-Key` khớp khóa (kv `bridgeKey`); preflight trả CORS + `Access-Control-Allow-Private-Network`. `/api/*` vẫn chặn mọi Origin lạ.
- Engine chuẩn hóa mẫu (loudnorm, mono 24 kHz) và văn bản (từ điển gửi kèm hoặc từ điển của Engine) như Voice Studio; dùng chung bộ đệm đoạn TTS.
- Bản web đánh dấu cảnh giọng AI «cũ» bằng `inputHash = sha256(văn bản, chế độ đọc, từ điển, sha mẫu giọng)` lưu trong `info` của liên kết âm thanh; kết xuất tự sinh cảnh cũ qua cầu nối.

## Học liệu điện tử (v0.3.0)
- Cấu hình: kv `elearn:<el_id>` { title, course, author, org, description, objectives[], coverAssetId, lessons[{id, title, projectId, renderId, intro, transcript, sources, questions, attachments[]}], quiz{title, passScore, questions[]}, completion{minWatch} } — cùng hợp đồng ở `studios.clean_package` (Python) và `cleanPackage` (JS).
- Đóng gói chạy ở giao diện (`web/js/elearning/build.js`), dùng chung hai chế độ: tải video/VTT/tài liệu qua `api/...`, ghi zip theo luồng (fflate, video không nén lại). Trình học: `web/player/lesson.html` + `lesson.js` (không phụ thuộc ngoài, JSON dữ liệu trong thẻ `application/json`, chạy được dưới CSP chặt).
- SCORM 1.2: một SCO; `imsmanifest.xml` liệt kê mọi file, `masteryscore` = điểm đạt. Trình học tìm `window.API` ở cửa sổ cha/opener; ghi `cmi.core.lesson_status` (incomplete/completed/passed/failed), `score.raw/min/max`, `lesson_location`, `suspend_data` (tiến độ nén hex ≤ 4096 ký tự).
