import { del, get, patch, upload } from "../api.js";
import { h, modal, dropZone, toast, errToast, confirmBox, fmtBytes, fmtDur, fmtTime, progressBar } from "../ui.js";

export const KIND = { slide: "Slide", image: "Ảnh", pdf: "PDF", presentation: "PPTX", audio: "Âm thanh", video: "Video" };
export const ACCEPT = ".pdf,.pptx,.ppt,.odp,.png,.jpg,.jpeg,.webp,.wav,.m4a,.mp3,.aac,.ogg,.flac,.webm,.mp4,.mov,.mkv";

export async function uploadFiles(files, statusEl) {
  const done = [];
  for (const f of files) {
    const line = h("div", {}, h("small", {}, f.name), progressBar(0));
    statusEl?.append(line);
    try {
      const a = await upload("/api/assets", f, {}, (p) => line.lastChild.replaceWith(progressBar(p * 0.9)));
      line.remove(); done.push(a);
    } catch (e) {
      line.replaceChildren(h("small", { style: { color: "var(--err)" } }, `${f.name}: ${e.message}`));
      setTimeout(() => line.remove(), 8000);
    }
  }
  if (done.length) toast(`Đã thêm ${done.length} file vào thư viện`, "ok");
  return done;
}

export function assetThumb(a) {
  if (["slide", "image", "pdf", "video"].includes(a.kind))
    return h("div", { class: "thumb", style: { backgroundImage: `url(/api/assets/${a.id}/thumb)` } });
  return h("div", { class: "thumb" }, a.kind === "audio" ? `♪ ${fmtDur(a.meta.durationMs)}` : KIND[a.kind] || a.kind);
}

// Hộp chọn tài sản (dùng trong Lecture Studio)
export async function pickAsset(kinds, title) {
  const all = (await Promise.all(kinds.map((k) => get(`/api/assets?kind=${k}`)))).flat();
  let chosen = null;
  const grid = h("div", { class: "cards", style: { maxHeight: "50vh", overflow: "auto", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" } },
    all.length ? all.map((a) => {
      const b = h("button", { class: "card pcard asset", type: "button", onclick: () => { grid.querySelectorAll(".asset").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); chosen = a; } },
        assetThumb(a), h("div", { class: "body" }, h("small", {}, a.name)));
      return b;
    }) : h("div", { class: "empty" }, "Thư viện chưa có file phù hợp."));
  const status = h("div");
  const zone = dropZone(ACCEPT, "Tải file mới lên", async (files) => {
    const up = await uploadFiles(files, status);
    const ok = up.find((a) => kinds.includes(a.kind));
    if (ok) { chosen = ok; toast("Đã tải lên — bấm Chọn để dùng", "ok"); }
  }, false);
  return modal(title, h("div", {}, zone, status, h("div", { style: { marginTop: "10px" } }, grid)), [
    { label: "Hủy", cls: "ghost", result: false },
    { label: "Chọn", value: () => chosen || (toast("Chưa chọn file", "err"), null) }]);
}

export default async function media(view) {
  let kind = "", q = "", sel = null;
  const grid = h("div"), side = h("div");
  const status = h("div");
  const tabs = h("div", { class: "tabs", role: "tablist" }, [["", "Tất cả"], ...Object.entries(KIND)].map(([k, v]) =>
    h("button", { role: "tab", "aria-selected": String(k === kind), onclick: (e) => { kind = k; tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", "false")); e.target.setAttribute("aria-selected", "true"); load(); } }, v)));
  const search = h("input", { type: "search", placeholder: "Tìm theo tên file…", "aria-label": "Tìm media", oninput: () => { q = search.value; load(); } });

  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Thư viện media"), h("p", {}, "Tài sản dùng lại cho mọi dự án; ghi rõ quyền sử dụng"))),
    dropZone(ACCEPT, "Tải lên PDF, PPTX, ảnh, âm thanh, video", async (files) => { await uploadFiles(files, status); load(); }),
    status, h("div", { style: { margin: "14px 0 0" } }, tabs), h("div", { style: { marginBottom: "12px" } }, search),
    h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,1fr) 340px", alignItems: "start" } }, grid, side));

  async function load() {
    const data = await get(`/api/assets?kind=${kind}&q=${encodeURIComponent(q)}`);
    grid.replaceChildren(data.length ? h("div", { class: "cards", style: { gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))" } },
      data.map((a) => h("button", { class: `card pcard asset ${sel?.id === a.id ? "sel" : ""}`, type: "button", onclick: () => { sel = a; detail(); load(); } },
        assetThumb(a), h("div", { class: "body" }, h("span", { class: "badge" }, KIND[a.kind] || a.kind), h("small", {}, a.name)))))
      : h("div", { class: "empty" }, "Chưa có file."));
  }

  async function detail() {
    if (!sel) { side.replaceChildren(); return; }
    const a = sel;
    const usage = await get(`/api/assets/${a.id}/usage`);
    const rights = h("textarea", { style: { minHeight: "70px" }, value: a.meta.rights || "", "aria-label": "Quyền sử dụng" });
    const url = `/api/assets/${a.id}/file`;
    const preview = a.kind === "audio" ? h("audio", { controls: true, src: url, preload: "none" })
      : a.kind === "video" ? h("video", { controls: true, src: url, preload: "metadata" })
      : ["image", "slide"].includes(a.kind) ? h("img", { src: url, alt: a.name, style: { width: "100%", borderRadius: "8px" } })
      : assetThumb(a);
    side.replaceChildren(h("div", { class: "card" }, h("h3", {}, a.name), preview,
      h("dl", { class: "kv", style: { marginTop: "10px" } },
        h("dt", {}, "Loại"), h("dd", {}, KIND[a.kind] || a.kind), h("dt", {}, "Dung lượng"), h("dd", {}, fmtBytes(a.size)),
        a.meta.durationMs && [h("dt", {}, "Thời lượng"), h("dd", {}, fmtDur(a.meta.durationMs))],
        a.meta.width && [h("dt", {}, "Kích thước"), h("dd", {}, `${a.meta.width}×${a.meta.height}`)],
        a.meta.pages && [h("dt", {}, "Số trang"), h("dd", {}, a.meta.pages)],
        a.meta.ai && [h("dt", {}, "Nguồn"), h("dd", {}, "Giọng AI")],
        h("dt", {}, "Ngày tạo"), h("dd", {}, fmtTime(a.created_at)),
        h("dt", {}, "Đang dùng"), h("dd", {}, usage.projects.length ? `${usage.projects.length} dự án` : "Chưa dùng"),
        h("dt", {}, "SHA-256"), h("dd", { class: "mono" }, a.sha256.slice(0, 16) + "…")),
      h("label", {}, "Quyền sử dụng / nguồn"), rights,
      h("div", { class: "row", style: { marginTop: "8px" } },
        h("button", { class: "btn sm", onclick: async () => { try { sel = await patch(`/api/assets/${a.id}`, { rights: rights.value }); toast("Đã lưu", "ok"); } catch (e) { errToast(e); } } }, "Lưu"),
        h("a", { class: "btn ghost sm", href: `${url}?download=1` }, "Tải về"),
        h("button", { class: "btn danger sm", disabled: usage.projects.length > 0, title: usage.projects.length ? "Đang được dùng trong dự án" : "",
          onclick: async () => { if (await confirmBox("Xóa file?", `Xóa «${a.name}» khỏi thư viện?`, "Xóa", true)) { try { await del(`/api/assets/${a.id}`); sel = null; detail(); load(); } catch (e) { errToast(e); } } } }, "Xóa"))));
  }

  await load();
}
