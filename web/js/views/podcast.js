import { del, downloadPost, get, post, put, waitJob } from "../api.js";
import { ctx } from "../state.js";
import { h, toast, errToast, confirmBox, promptBox, fmtBytes, fmtDur, fmtTime, progressBar } from "../ui.js";
import { projectPicker } from "./common.js";
import { pickAsset } from "./media.js";

export default async function podcast(view, args) {
  let pid = args[0] || ctx.project()?.id || "";
  const body = h("div");
  const picker = await projectPicker(pid, (p) => { pid = p?.id || ""; history.replaceState(null, "", `#/podcast/${pid}`); render(); });
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Podcast Studio"),
    h("p", {}, "Dựng tập podcast từ âm thanh các cảnh: mở đầu/kết thúc, chương mục, ảnh bìa, xuất MP3 và mục RSS sau khi duyệt")),
  h("span", { class: "spacer" }), h("div", { style: { minWidth: "280px" } }, picker.el)), body);

  async function render() {
    if (!pid) { body.replaceChildren(h("div", { class: "empty" }, "Chọn dự án có các cảnh đã gắn âm thanh (thu âm thật hoặc giọng AI).")); return; }
    const [p, d] = await Promise.all([get(`api/projects/${pid}`), get(`api/projects/${pid}/podcast`)]);
    ctx.setProject(p);
    const cfg = d.config;
    const sel = { coverAssetId: cfg.coverAssetId, introAssetId: cfg.introAssetId, outroAssetId: cfg.outroAssetId };
    const f = { title: h("input", { type: "text", value: cfg.title }), author: h("input", { type: "text", value: cfg.author, placeholder: "Giảng viên / đơn vị" }),
      description: h("textarea", { style: { minHeight: "90px" }, value: cfg.description }), gapMs: h("input", { type: "number", min: 0, max: 5000, step: 100, value: cfg.gapMs }),
      chapters: h("input", { type: "checkbox", checked: cfg.chapters }), audioBaseUrl: h("input", { type: "url", value: cfg.audioBaseUrl, placeholder: "https://… (thư mục sẽ chứa file MP3 trên PNL/PND)" }) };
    const slot = (key, kinds, label) => {
      const lab = h("small", {}, sel[key] ? "Đã chọn" : "Chưa chọn");
      if (sel[key]) get(`api/assets?kind=${kinds[0]}`).then((l) => { const a = l.find((x) => x.id === sel[key]); if (a) lab.textContent = a.name; });
      return h("div", { class: "row" }, h("span", { style: { minWidth: "110px", fontWeight: 600 } }, label), lab, h("span", { class: "spacer" }),
        h("button", { class: "btn ghost sm", onclick: async () => { const a = await pickAsset(kinds, label); if (a) { sel[key] = a.id; lab.textContent = a.name; } } }, "Chọn"),
        h("button", { class: "btn ghost sm", onclick: () => { sel[key] = null; lab.textContent = "Chưa chọn"; } }, "Bỏ"));
    };
    const saveCfg = async () => put(`api/projects/${pid}/podcast`, { ...sel, title: f.title.value, author: f.author.value, description: f.description.value,
      gapMs: +f.gapMs.value, chapters: f.chapters.checked, audioBaseUrl: f.audioBaseUrl.value });

    const scenes = p.scenes.filter((s) => !s.excluded);
    const withAudio = scenes.filter((s) => s.audioMode !== "none" && (s.audioAssetId || (s.audioMode === "tts" && s.voiceId)));
    const jobBox = h("div");
    const build = h("button", { class: "btn gold", disabled: !withAudio.length, onclick: async () => {
      build.disabled = true;
      try {
        await saveCfg();
        const j = await waitJob(await post(`api/projects/${pid}/podcast/build`), (x) => jobBox.replaceChildren(progressBar(x.progress), h("small", {}, x.message || "")));
        if (j.status !== "done") jobBox.replaceChildren(h("div", { class: "notice err" }, "Không dựng được: ", j.error || j.status));
        else { toast("Đã dựng tập podcast", "ok"); render(); }
      } catch (e) { errToast(e); } finally { build.disabled = false; }
    } }, "Dựng tập podcast");

    body.replaceChildren(h("div", { class: "grid g2", style: { alignItems: "start" } },
      h("div", { class: "card" }, h("h2", {}, "Thông tin tập"),
        h("label", {}, "Tên tập"), f.title, h("label", {}, "Tác giả"), f.author, h("label", {}, "Mô tả"), f.description,
        h("div", { style: { marginTop: "10px" } }, slot("coverAssetId", ["image", "slide"], "Ảnh bìa"), slot("introAssetId", ["audio"], "Nhạc/lời mở đầu"), slot("outroAssetId", ["audio"], "Lời kết thúc")),
        h("small", { class: "muted" }, "Ảnh bìa được cắt vuông tự động (tạo nhanh ở Image Studio → Ảnh bìa, kích thước 1:1)."),
        h("div", { class: "grid g2" }, h("div", {}, h("label", {}, "Khoảng lặng giữa cảnh (ms)"), f.gapMs), h("div", {}, h("label", { class: "check", style: { marginTop: "34px" } }, f.chapters, "Tạo chương mục theo cảnh"))),
        h("label", {}, "Địa chỉ thư mục audio khi đăng (cho mục RSS, tùy chọn)"), f.audioBaseUrl,
        h("div", { class: "row", style: { marginTop: "12px" } }, h("button", { class: "btn ghost", onclick: async () => { try { await saveCfg(); toast("Đã lưu", "ok"); } catch (e) { errToast(e); } } }, "Lưu thông tin"), build),
        jobBox),
      h("div", { class: "card" }, h("h2", {}, "Nội dung âm thanh"),
        h("p", { class: "muted" }, `${withAudio.length}/${scenes.length} cảnh có âm thanh · định dạng xuất ${d.format.toUpperCase()} 128 kbps, chuẩn hóa −16 LUFS`),
        h("ol", { class: "tight" }, scenes.map((s) => h("li", {}, s.title, " ",
          s.audioMode === "none" ? h("span", { class: "badge warn" }, "Không âm thanh — bỏ qua") :
          s.audioMode === "tts" ? h("span", { class: "badge gold" }, s.audioStale ? "Giọng AI — sẽ sinh lại" : `Giọng AI ${fmtDur(s.audioDurationMs)}`) :
          s.audioAssetId ? h("span", { class: "badge ok" }, `Thu âm ${fmtDur(s.audioDurationMs)}`) : h("span", { class: "badge warn" }, "Chưa có bản thu — bỏ qua")))),
        h("a", { class: "btn ghost sm", href: `#/lecture/${pid}` }, "Gắn âm thanh ở Lecture Studio"))),
    h("h2", { style: { marginTop: "22px" } }, "Các tập đã dựng"),
    d.episodes.length ? d.episodes.map((e) => episodeCard(e)) : h("div", { class: "empty" }, "Chưa có tập nào."));
  }

  function episodeCard(e) {
    const base = `api/projects/${pid}/podcasts/${e.id}`;
    return h("div", { class: "card", style: { marginBottom: "14px" } },
      h("div", { class: "row" }, e.cover && h("img", { src: `${base}/cover.jpg`, alt: "", style: { width: "72px", height: "72px", borderRadius: "8px", objectFit: "cover" } }),
        h("div", {}, h("h3", { style: { margin: 0 } }, e.title), h("small", {}, `${fmtDur(e.durationMs)} · ${fmtBytes(e.sizeBytes)} · ${fmtTime(e.createdAt)} · bản dự án r${e.projectRevision}`)),
        h("span", { class: "spacer" }), e.aiNarration && h("span", { class: "badge gold" }, "Có giọng AI"),
        e.approval ? h("span", { class: "badge ok" }, `Đã duyệt — ${e.approval.approvedBy}`) : h("span", { class: "badge warn" }, "Chưa duyệt")),
      h("audio", { controls: true, src: `${base}/${e.file}`, preload: "none", style: { width: "100%", margin: "10px 0" } }),
      e.skippedScenes.length > 0 && h("div", { class: "notice warn" }, "Bỏ qua cảnh không có âm thanh: ", e.skippedScenes.join("; ")),
      e.chapters.length > 0 && h("details", {}, h("summary", {}, `${e.chapters.length} chương mục`), h("ol", { class: "tight" }, e.chapters.map((c) => h("li", {}, `${fmtDur(c.startMs)} — ${c.title}`)))),
      h("div", { class: "row", style: { marginTop: "10px" } },
        e.approval ? h("button", { class: "btn ghost sm", onclick: () => approve(e, false) }, "Bỏ duyệt")
          : h("button", { class: "btn sm", onclick: () => approve(e, true) }, "Duyệt tập này"),
        h("button", { class: "btn gold sm", disabled: !e.approval, title: e.approval ? "" : "Cần duyệt trước", onclick: async () => {
          try { await downloadPost(`${base}/package`, `PNS_podcast_${e.id}.zip`); } catch (er) { errToast(er); } } }, "Tải gói phát hành (audio + RSS)"),
        h("a", { class: "btn ghost sm", href: `${base}/${e.file}?download=1` }, `Tải ${e.file.split(".")[1].toUpperCase()}`),
        h("span", { class: "spacer" }),
        h("button", { class: "btn danger sm", onclick: async () => { if (await confirmBox("Xóa tập podcast?", "File âm thanh của tập này sẽ bị xóa khỏi máy.", "Xóa", true)) { try { await del(base); render(); } catch (er) { errToast(er); } } } }, "Xóa")));
  }

  async function approve(e, ok) {
    let approver = "";
    if (ok) { approver = await promptBox("Duyệt tập podcast", "Người duyệt", ""); if (approver == null) return; }
    try { await post(`api/projects/${pid}/podcasts/${e.id}/approval`, { approved: ok, approver }); render(); } catch (er) { errToast(er); }
  }

  await render();
}
