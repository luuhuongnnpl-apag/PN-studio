import { del, get, post, saveBlob, upload } from "../api.js";
import { ctx } from "../state.js";
import { h, modal, toast, errToast, fmtTime, statusBadge } from "../ui.js";

const KINDS = { lecture: "Video bài giảng", video: "Video", audio: "Âm thanh", image: "Hình ảnh", podcast: "Podcast", other: "Khác" };

export async function newProjectDialog() {
  const f = {
    title: h("input", { type: "text", placeholder: "VD: Luật dân sự – Thừa kế – Bài 1" }),
    kind: h("select", {}, Object.entries(KINDS).map(([k, v]) => h("option", { value: k }, v))),
    course: h("input", { type: "text", placeholder: "Không bắt buộc" }),
    chapter: h("input", { type: "text", placeholder: "Không bắt buộc" }),
    lesson: h("input", { type: "text", placeholder: "Không bắt buộc" }),
  };
  const body = h("div", {}, h("label", {}, "Tên dự án"), f.title, h("label", {}, "Loại"), f.kind,
    h("div", { class: "grid g3" }, h("div", {}, h("label", {}, "Học phần"), f.course), h("div", {}, h("label", {}, "Chương"), f.chapter), h("div", {}, h("label", {}, "Bài"), f.lesson)),
    h("small", {}, "Dự án không bắt buộc thuộc học phần."));
  return modal("Tạo dự án mới", body, [
    { label: "Hủy", cls: "ghost", result: false },
    { label: "Tạo dự án", value: async () => {
      if (!f.title.value.trim()) { toast("Nhập tên dự án", "err"); return null; }
      try {
        return await post("api/projects", { title: f.title.value.trim(), kind: f.kind.value,
          course: { course: f.course.value, chapter: f.chapter.value, lesson: f.lesson.value }, scenes: [] });
      } catch (e) { errToast(e); return null; }
    } }]);
}

export default async function projects(view, _args, query) {
  const state = { q: "", status: "", kind: "", archived: false };
  const list = h("div");
  const search = h("input", { type: "search", placeholder: "Tìm theo tên…", "aria-label": "Tìm dự án",
    oninput: () => { state.q = search.value; load(); } });
  const fStatus = h("select", { "aria-label": "Lọc trạng thái", onchange: () => { state.status = fStatus.value; load(); } },
    h("option", { value: "" }, "Mọi trạng thái"), ["draft", "review", "approved", "published"].map((s) => h("option", { value: s }, statusBadge(s).textContent)));
  const fKind = h("select", { "aria-label": "Lọc loại", onchange: () => { state.kind = fKind.value; load(); } },
    h("option", { value: "" }, "Mọi loại"), Object.entries(KINDS).map(([k, v]) => h("option", { value: k }, v)));
  const fArch = h("label", { class: "check", style: { margin: 0 } }, h("input", { type: "checkbox", onchange: (e) => { state.archived = e.target.checked; load(); } }), "Xem kho lưu trữ");
  const imp = h("input", { type: "file", accept: ".pnsproj,.zip", hidden: true, onchange: async () => {
    const file = imp.files[0]; imp.value = "";
    if (!file) return;
    try { const p = await upload("api/projects/import", file); toast(`Đã khôi phục «${p.title}»`, "ok"); load(); } catch (e) { errToast(e); }
  } });

  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Dự án"), h("p", {}, "Mỗi dự án có ID riêng, dùng xuyên suốt các studio")),
    h("span", { class: "spacer" }),
    h("button", { class: "btn ghost", onclick: () => imp.click() }, "Khôi phục từ .pnsproj"), imp,
    h("button", { class: "btn gold", onclick: create }, "+ Dự án mới")),
  h("div", { class: "row", style: { marginBottom: "16px" } }, h("div", { style: { flex: "1 1 260px" } }, search), h("div", {}, fStatus), h("div", {}, fKind), fArch),
  list);

  async function create() {
    const p = await newProjectDialog();
    if (p) { ctx.setProject(p); location.hash = p.kind === "lecture" ? `#/lecture/${p.id}` : "#/projects"; if (p.kind !== "lecture") load(); }
  }

  let seq = 0;
  async function load() {
    const my = ++seq;
    const qs = new URLSearchParams({ q: state.q, status: state.status, kind: state.kind, archived: state.archived });
    const data = await get(`api/projects?${qs}`);
    if (my !== seq) return;
    if (!data.length) { list.replaceChildren(h("div", { class: "empty" }, state.archived ? "Kho lưu trữ trống." : "Chưa có dự án phù hợp.")); return; }
    list.replaceChildren(h("div", { class: "cards" }, data.map(card)));
  }

  function card(p) {
    const open = () => { ctx.setProject(p); location.hash = `#/lecture/${p.id}`; };
    const thumb = h("div", { class: "thumb", style: p.cover ? { backgroundImage: `url(api/assets/${p.cover}/thumb)` } : {} }, p.cover ? "" : KINDS[p.kind]);
    return h("div", { class: "card pcard" }, thumb,
      h("div", { class: "body" },
        h("div", { class: "row" }, statusBadge(p.status), h("span", { class: "badge" }, KINDS[p.kind] || p.kind)),
        h("h3", {}, p.title),
        h("small", {}, [p.course?.course, p.course?.chapter, p.course?.lesson].filter(Boolean).join(" · ") || "Không gắn học phần"),
        h("small", {}, `${p.sceneCount} cảnh · cập nhật ${fmtTime(p.updatedAt)}`),
        h("div", { class: "acts" },
          !p.archived && h("button", { class: "btn sm", onclick: open }, "Mở"),
          h("button", { class: "btn ghost sm", onclick: async () => { try { await post(`api/projects/${p.id}/duplicate`); toast("Đã nhân bản", "ok"); load(); } catch (e) { errToast(e); } } }, "Nhân bản"),
          h("button", { class: "btn ghost sm", onclick: async () => { try { saveBlob(await get(`api/projects/${p.id}/export`), `${p.title}.pnsproj`); } catch (e) { errToast(e); } } }, "Sao lưu"),
          h("button", { class: "btn ghost sm", onclick: async () => { await post(`api/projects/${p.id}/archive`, { archived: !p.archived }); load(); } }, p.archived ? "Khôi phục" : "Lưu trữ"),
          h("button", { class: "btn danger sm", onclick: () => remove(p) }, "Xóa"))));
  }

  async function remove(p) {
    const inp = h("input", { type: "text", "aria-label": "Nhập tên dự án để xác nhận" });
    const ok = await modal("Xóa vĩnh viễn dự án?", h("div", {},
      h("p", {}, "Dự án và các bản video đã kết xuất sẽ bị xóa. Media trong thư viện được giữ lại. Nên sao lưu .pnsproj trước."),
      h("label", {}, `Gõ lại tên dự án «${p.title}» để xác nhận`), inp), [
      { label: "Hủy", cls: "ghost", result: false },
      { label: "Xóa vĩnh viễn", cls: "danger", value: () => inp.value.trim() === p.title.trim() ? true : (toast("Tên không khớp", "err"), null) }]);
    if (ok !== true) return;
    try {
      await del(`api/projects/${p.id}?confirm=${p.id}`);
      if (ctx.project()?.id === p.id) ctx.setProject(null);
      toast("Đã xóa dự án", "ok"); load();
    } catch (e) { errToast(e); }
  }

  await load();
  if (query?.has("new")) create();
}

