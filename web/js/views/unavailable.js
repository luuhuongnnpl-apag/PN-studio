import { PLANS, ICONS } from "../modules.js";
import { h } from "../ui.js";

// Phân hệ chưa làm: ghi rõ chưa khả dụng, không có nút thao tác giả.
export function unavailable(view, mod) {
  view.append(h("div", { class: "page-head" },
    h("div", { class: "studio-card" }, h("div", { class: "ico", html: ICONS[mod.id] })),
    h("div", {}, h("h1", {}, mod.name), h("p", {}, mod.desc))),
  h("div", { class: "notice warn" }, h("strong", {}, `Chưa khả dụng — dự kiến giai đoạn ${mod.status.toUpperCase()}. `),
    "Phân hệ này chưa được lập trình nên không có thao tác nào ở đây. Lecture Studio, Voice Studio và Video Studio đã dùng được."),
  h("div", { class: "card" }, h("h3", {}, "Phạm vi dự kiến"),
    h("ul", {}, (PLANS[mod.id] || []).map((x) => h("li", {}, x)))));
}

export function needEngine(view, mod) {
  view.append(h("h1", {}, mod ? mod.name : "PNS"),
    h("div", { class: "notice info" },
      h("strong", {}, "Chức năng này chạy trong PNS Engine trên máy cá nhân. "),
      "Trang web công khai không lưu bản nháp, media hay mẫu giọng của bạn."),
    h("div", { class: "card" }, h("h3", {}, "Mở PNS Engine"),
      h("ol", {},
        h("li", {}, "Trên máy Windows đã cài, chạy START_PNS.bat (lần đầu cần Internet để cài thư viện)."),
        h("li", {}, "Trình duyệt tự mở http://127.0.0.1:7860 — giao diện giống trang này nhưng đầy đủ chức năng."),
        h("li", {}, "Chưa cài? Xem hướng dẫn INSTALL_WINDOWS.md trong mã nguồn.")),
      h("a", { class: "btn", href: "http://127.0.0.1:7860/", rel: "noopener" }, "Mở http://127.0.0.1:7860")));
}
