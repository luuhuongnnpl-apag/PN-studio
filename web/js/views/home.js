import { engine } from "../api.js";
import { MODULES, ICONS } from "../modules.js";
import { h } from "../ui.js";

const STATUS = { ready: ["Sẵn sàng", "ok"], p1: ["Giai đoạn P1", "gold"], p2: ["Giai đoạn P2", ""] };

export default function home(view) {
  const studios = MODULES.filter((m) => m.group === "Studio" || m.id === "publish");
  view.append(
    h("section", { class: "hero" },
      h("div", { class: "eyebrow" }, "HỆ SINH THÁI PHÚC NGUYÊN"),
      h("h1", {}, "Phúc Nguyên Studio"),
      h("p", {}, "Nền tảng sản xuất nội dung số đa phương tiện: từ slide PDF, kịch bản có nguồn, giọng nói thật hoặc giọng AI cá nhân đến video bài giảng MP4 kèm phụ đề — xử lý ngay trên máy tính của giảng viên, không phụ thuộc dịch vụ trả phí."),
      h("div", { class: "row" },
        engine.available
          ? [h("a", { class: "btn gold", href: "#/dashboard" }, "Vào bảng điều khiển"), h("a", { class: "btn ghost", href: "#/lecture" }, "Tạo video bài giảng")]
          : [h("a", { class: "btn gold", href: "#start" }, "Bắt đầu sử dụng"), h("a", { class: "btn ghost", href: "http://127.0.0.1:7860/", rel: "noopener" }, "Mở PNS Engine trên máy này")])),

    h("h2", { style: { marginTop: "28px" } }, "Các studio"),
    h("div", { class: "cards" }, studios.map((m) => {
      const [label, cls] = STATUS[m.status];
      return h("a", { class: "card studio-card", href: `#/${m.id}` },
        h("span", { class: `badge ${cls}` }, label),
        h("div", { class: "ico", html: ICONS[m.id] }), h("h3", {}, m.name), h("p", {}, m.desc));
    })),

    h("h2", { style: { marginTop: "28px" } }, "Vị trí trong hệ sinh thái"),
    h("div", { class: "eco" },
      h("div", { class: "card" }, h("h3", {}, "Phúc Nguyên Digital (PND)"), h("p", { class: "muted" }, "Kho tài liệu nguồn. PNS chỉ tham chiếu tài liệu qua liên kết mà tài khoản có quyền xem; không sao chép kho.")),
      h("div", { class: "card me" }, h("h3", {}, "Phúc Nguyên Studio (PNS)"), h("p", { class: "muted" }, "Nơi sản xuất: dự án, media, giọng, kết xuất, duyệt. Bản nháp và mẫu giọng ở lại máy cá nhân.")),
      h("div", { class: "card" }, h("h3", {}, "Phúc Nguyên Library (PNL)"), h("p", { class: "muted" }, "Đích xuất bản học liệu đã duyệt. PNS tạo gói MP4 + SRT + hồ sơ phát hành; không tự động đăng, không chạm dữ liệu lớp/điểm."))),

    h("h2", { id: "start", style: { marginTop: "28px" } }, "Cách hoạt động"),
    h("div", { class: "grid g3" },
      step("1", "Cài PNS Engine trên Windows", "Tải mã nguồn, chạy START_PNS.bat. Engine chỉ lắng nghe 127.0.0.1, không mở ra mạng."),
      step("2", "Sản xuất cục bộ", "Nhập PDF/PPTX, viết lời giảng, thu âm hoặc dùng giọng AI cá nhân, kết xuất MP4 1080p + SRT."),
      step("3", "Duyệt và phát hành", "Duyệt bản 1080p, tải gói phát hành, đăng lên PNL/PND bằng tài khoản quản trị.")),
    !engine.available && h("div", { class: "notice info", style: { marginTop: "16px" } },
      "Bạn đang xem PNS ở chế độ web. Các chức năng sản xuất (dự án, media, giọng, kết xuất) chạy trong PNS Engine trên máy cá nhân; ",
      "đồng bộ đám mây có phân quyền sẽ mở ở giai đoạn P1 sau khi duyệt cấu hình Firebase."));
}

function step(n, t, d) {
  return h("div", { class: "card" }, h("div", { class: "kpi" }, n), h("h3", {}, t), h("p", { class: "muted" }, d));
}
