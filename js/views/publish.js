import { downloadPost, get, post, put } from "../api.js";
import { ctx } from "../state.js";
import { h, modal, toast, errToast } from "../ui.js";
import { projectPicker } from "./common.js";
import { renderCard } from "./video.js";

export default async function publish(view, args) {
  let pid = args[0] || ctx.project()?.id || "";
  const body = h("div");
  const picker = await projectPicker(pid, (p) => { pid = p?.id || ""; history.replaceState(null, "", `#/publish/${pid}`); load(); });
  const settings = (await get("api/settings")).app;
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Trung tâm xuất bản"), h("p", {}, "Duyệt bản 1080p, lưu vết phiên bản, xuất gói cho PNL/PND")),
    h("span", { class: "spacer" }), h("div", { style: { minWidth: "280px" } }, picker.el)),
  h("div", { class: "notice info" }, "PNS không tự động đăng bài. Sau khi duyệt, tải gói phát hành (MP4 + SRT + publication.json) và đăng lên PNL/PND bằng tài khoản quản trị. ",
    settings.pnlUrl && h("a", { href: settings.pnlUrl, target: "_blank", rel: "noopener" }, "Mở PNL"), settings.pnlUrl && settings.pndUrl && " · ",
    settings.pndUrl && h("a", { href: settings.pndUrl, target: "_blank", rel: "noopener" }, "Mở PND")), body);

  async function load() {
    if (!pid) { body.replaceChildren(h("div", { class: "empty" }, "Chọn dự án.")); return; }
    const [p, renders] = await Promise.all([get(`api/projects/${pid}`), get(`api/projects/${pid}/renders`)]);
    const sc = p.scenes.filter((s) => !s.excluded);
    const checks = [
      [sc.length > 0, `${sc.length} cảnh được đưa vào video`],
      [!sc.some((s) => s.needsVerification), "Không còn cảnh đánh dấu cần kiểm chứng căn cứ"],
      [sc.every((s) => s.status === "approved"), `Cảnh đã duyệt: ${sc.filter((s) => s.status === "approved").length}/${sc.length}`],
      [sc.some((s) => s.sourceNotes), "Có ghi nguồn/căn cứ (đưa vào publication.json)"],
      [renders.some((r) => r.quality === "final" && r.projectRevision === p.revision), "Có bản 1080p khớp phiên bản biên tập mới nhất"],
    ];
    const finals = renders.filter((r) => r.quality === "final");
    body.replaceChildren(
      h("div", { class: "card", style: { marginBottom: "16px" } }, h("h2", {}, "Kiểm tra trước khi duyệt"),
        h("ul", { style: { listStyle: "none", padding: 0 } }, checks.map(([ok, t]) => h("li", {}, h("span", { class: `badge ${ok ? "ok" : "warn"}` }, ok ? "Đạt" : "Lưu ý"), " ", t))),
        h("small", {}, "Liên kết nguồn PND: ", p.links.pndSource || "chưa ghi", " · Đích PNL: ", p.links.pnlTarget || "chưa ghi", " — ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); editLinks(p); } }, "sửa"))),
      finals.length ? finals.map((r) => renderCard(p, r, load, r.approval
        ? [h("button", { class: "btn gold sm", onclick: async () => { try { await downloadPost(`api/projects/${pid}/renders/${r.id}/package`, `PNS_${p.title}_${r.id}.zip`); toast("Đã tạo gói phát hành", "ok"); } catch (e) { errToast(e); } } }, "Tải gói phát hành"),
           h("button", { class: "btn ghost sm", onclick: async () => { await post(`api/projects/${pid}/renders/${r.id}/approval`, { approved: false }); load(); } }, "Thu hồi duyệt")]
        : h("button", { class: "btn sm", onclick: () => approve(p, r) }, "Duyệt bản này")))
        : h("div", { class: "empty" }, "Chưa có bản 1080p. ", h("a", { href: `#/video/${pid}` }, "Kết xuất ở Video Studio")));
  }

  async function approve(p, r) {
    const who = h("input", { type: "text", placeholder: "Họ tên người duyệt" });
    const note = h("textarea", { style: { minHeight: "70px" }, placeholder: "Ghi chú duyệt (không bắt buộc)" });
    const ok = await modal("Duyệt bản kết xuất", h("div", {},
      h("p", {}, "Xác nhận đã xem toàn bộ video, kiểm tra căn cứ pháp lý, phát âm và nhãn giọng AI (nếu có)."),
      h("label", {}, "Người duyệt"), who, h("label", {}, "Ghi chú"), note), [
      { label: "Hủy", cls: "ghost", result: false },
      { label: "Duyệt", value: () => who.value.trim() ? true : (toast("Nhập tên người duyệt", "err"), null) }]);
    if (ok !== true) return;
    try { await post(`api/projects/${p.id}/renders/${r.id}/approval`, { approved: true, approver: who.value, note: note.value }); toast("Đã duyệt", "ok"); load(); }
    catch (e) { errToast(e); }
  }

  async function editLinks(p) {
    const pnd = h("input", { type: "url", value: p.links.pndSource, placeholder: "https://…" });
    const pnl = h("input", { type: "url", value: p.links.pnlTarget, placeholder: "https://…" });
    const ok = await modal("Liên kết hệ sinh thái", h("div", {}, h("label", {}, "Tài liệu nguồn trên PND (liên kết có quyền xem)"), pnd,
      h("label", {}, "Trang đích trên PNL"), pnl, h("small", {}, "Chỉ nhận địa chỉ https://. PNS không sao chép dữ liệu từ PND/PNL.")), [
      { label: "Hủy", cls: "ghost", result: false }, { label: "Lưu", result: true }]);
    if (!ok) return;
    try {
      await put(`api/projects/${p.id}`, { ...p, links: { pndSource: pnd.value.trim(), pnlTarget: pnl.value.trim() } });
      load();
    } catch (e) { errToast(e); }
  }

  await load();
}
