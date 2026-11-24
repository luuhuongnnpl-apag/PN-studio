// Danh mục phân hệ PNS. status: ready (dùng được ngay với Engine) | p2 (chưa khả dụng).
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  dashboard: I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  projects: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  media: I('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  voice: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  lecture: I('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/><path d="M10 8l4 2-4 2z"/>'),
  audio: I('<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>'),
  video: I('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'),
  content: I('<path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h6M8 8h4"/>'),
  image: I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>'),
  podcast: I('<circle cx="12" cy="11" r="3"/><path d="M6.5 16a8 8 0 1 1 11 0M12 14v7"/>'),
  avatar: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  elearning: I('<path d="M2 8l10-5 10 5-10 5z"/><path d="M6 10v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/><path d="M22 8v6"/>'),
  interactive: I('<path d="M9 11V5a2 2 0 0 1 4 0v6"/><path d="M13 9a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-1a5 5 0 0 1-4-2l-2-3a2 2 0 0 1 3-2l1 1"/>'),
  publish: I('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};

export const MODULES = [
  { id: "dashboard", group: "Nền tảng", name: "Bảng điều khiển", status: "ready", desc: "Dự án gần đây, job đang chạy, dung lượng." },
  { id: "projects", group: "Nền tảng", name: "Dự án", status: "ready", desc: "Tạo, nhân bản, tìm, lọc, lưu trữ, sao lưu dự án." },
  { id: "media", group: "Nền tảng", name: "Thư viện media", status: "ready", desc: "Slide, ảnh, PDF, audio, video và quyền sử dụng." },
  { id: "lecture", group: "Studio", name: "Lecture Studio", status: "ready", desc: "Video bài giảng từ PDF/PPTX: cảnh, lời giảng, nguồn, phụ đề." },
  { id: "voice", group: "Studio", name: "Voice Studio", status: "ready", desc: "Giọng thật, giọng AI cá nhân (VieNeu, CPU), từ điển đọc luật." },
  { id: "video", group: "Studio", name: "Video Studio", status: "ready", desc: "Dòng thời gian, kết xuất MP4 1080p/720p và phụ đề SRT." },
  { id: "audio", group: "Studio", name: "Audio Studio", status: "ready", desc: "Ghép nhiều đoạn, cắt đầu/cuối, fade, âm lượng, chuẩn hóa EBU R128." },
  { id: "content", group: "Studio", name: "Content Studio", status: "ready", desc: "Nhập kịch bản theo cảnh kèm nguồn – căn cứ; rà soát viện dẫn điều luật." },
  { id: "image", group: "Studio", name: "Image Studio", status: "ready", desc: "Cắt theo tỷ lệ, đổi kích thước, xoay; ảnh bìa bài giảng theo nhận diện." },
  { id: "podcast", group: "Studio", name: "Podcast Studio", status: "ready", desc: "Tập podcast từ âm thanh các cảnh: chương mục, ảnh bìa, MP3, mục RSS." },
  { id: "avatar", group: "Studio", name: "Avatar Studio", status: "p2", desc: "Người dẫn ảo trên cơ sở tự nguyện, có nhãn AI." },
  { id: "interactive", group: "Studio", name: "Interactive Studio", status: "ready", desc: "Câu hỏi trắc nghiệm tự dừng theo mốc video; gói HTML độc lập." },
  { id: "elearning", group: "Studio", name: "Học liệu điện tử", status: "ready", desc: "Ghép video bài giảng thành học liệu: mục lục, lời giảng, căn cứ, tài liệu, kiểm tra; gói web hoặc SCORM 1.2." },
  { id: "publish", group: "Phát hành", name: "Trung tâm xuất bản", status: "ready", desc: "Duyệt bản kết xuất, phiên bản, gói xuất cho PNL/PND." },
  { id: "settings", group: "Phát hành", name: "Cài đặt", status: "ready", desc: "Engine, lưu trữ, giọng AI, liên kết PNL/PND, sao lưu." },
];

export const PLANS = {
  avatar: ["Chỉ dùng hình ảnh của người đã đồng ý bằng văn bản", "Gắn nhãn AI bắt buộc trên khung hình", "Cần đánh giá model mã nguồn mở chạy được trên CPU máy cá nhân trước khi cam kết — chưa có model đạt chất lượng nên chưa mở"],
};
