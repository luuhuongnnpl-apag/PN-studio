import { get } from "../api.js";
import { ctx } from "../state.js";
import { h, fmtBytes, fmtTime, statusBadge } from "../ui.js";
import { jobTable } from "./common.js";

export default async function dashboard(view) {
  const box = h("div");
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Bảng điều khiển"), h("p", {}, "Tổng quan sản xuất trên máy này")),
    h("span", { class: "spacer" }),
    h("a", { class: "btn gold", href: "#/projects?new" }, "+ Dự án mới"), h("a", { class: "btn ghost", href: "#/media" }, "Tải media lên")), box);

  async function load() {
    const d = await get("api/dashboard");
    const u = d.usage;
    const total = u.assets + u.voices + u.cache + u.renders;
    box.replaceChildren(
      h("div", { class: "grid g4" },
        kpi("Dự án", d.counts.projects), kpi("Tài sản media", d.counts.assets), kpi("Mẫu giọng", d.counts.voices),
        kpi("Dữ liệu PNS", fmtBytes(total), `Ổ đĩa còn trống ${fmtBytes(u.diskFree)}`)),
      h("div", { class: "grid g2", style: { marginTop: "16px" } },
        h("div", { class: "card" }, h("h2", {}, "Dự án gần đây"),
          d.recent.length ? h("table", {}, h("tbody", {}, d.recent.map((p) => h("tr", {},
            h("td", {}, h("a", { href: `#/lecture/${p.id}`, onclick: () => ctx.setProject(p) }, p.title), h("br"), h("small", {}, `${p.sceneCount} cảnh`)),
            h("td", {}, statusBadge(p.status)), h("td", {}, h("small", {}, fmtTime(p.updatedAt)))))))
            : h("div", { class: "empty" }, "Chưa có dự án. ", h("a", { href: "#/projects?new" }, "Tạo dự án đầu tiên"))),
        h("div", { class: "card" }, h("h2", {}, "Job xử lý"), jobTable(d.jobs, load))),
      h("div", { class: "card", style: { marginTop: "16px" } }, h("h2", {}, "Dung lượng"),
        bar("Media", u.assets, total), bar("Mẫu giọng (chỉ trên máy này)", u.voices, total),
        bar("Bộ nhớ đệm (giọng AI, clip)", u.cache, total), bar("Video đã kết xuất", u.renders, total),
        h("small", {}, "Thư mục dữ liệu: ", h("span", { class: "mono" }, u.dataDir))));
  }
  await load();
  const t = setInterval(() => !document.hidden && load().catch(() => {}), 4000);
  return () => clearInterval(t);
}

const kpi = (label, v, sub) => h("div", { class: "card" }, h("small", {}, label), h("div", { class: "kpi" }, v), sub && h("small", {}, sub));
const bar = (label, v, total) => h("div", { style: { margin: "8px 0" } },
  h("div", { class: "row" }, h("span", {}, label), h("span", { class: "spacer" }), h("small", {}, fmtBytes(v))),
  h("div", { class: "progress" }, h("i", { style: { width: `${total ? Math.max(1, (v / total) * 100) : 0}%` } })));
