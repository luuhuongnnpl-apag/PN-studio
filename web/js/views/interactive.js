import { downloadPost, get, put } from "../api.js";
import { ctx } from "../state.js";
import { h, toast, errToast, fmtDur, fmtTime } from "../ui.js";
import { projectPicker } from "./common.js";

const L = "ABCDEF";

export default async function interactive(view, args) {
  let cleanupFn = null;
  let pid = args[0] || ctx.project()?.id || "";
  const body = h("div");
  const picker = await projectPicker(pid, (p) => { pid = p?.id || ""; history.replaceState(null, "", `#/interactive/${pid}`); render(); });
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Interactive Studio"),
    h("p", {}, "Câu hỏi trắc nghiệm tự dừng theo mốc thời gian video — xuất gói HTML độc lập, không đụng hệ thống khảo thí PNL")),
  h("span", { class: "spacer" }), h("div", { style: { minWidth: "280px" } }, picker.el)), body);

  async function render() {
    cleanupFn?.(); cleanupFn = null;
    if (!pid) { body.replaceChildren(h("div", { class: "empty" }, "Chọn dự án đã kết xuất video ở Video Studio.")); return; }
    const [p, renders, cfg] = await Promise.all([get(`/api/projects/${pid}`), get(`/api/projects/${pid}/renders`), get(`/api/projects/${pid}/interactive`)]);
    ctx.setProject(p);
    if (!renders.length) {
      body.replaceChildren(h("div", { class: "notice warn" }, "Dự án chưa có bản kết xuất video. ", h("a", { href: `#/video/${pid}` }, "Mở Video Studio để kết xuất")));
      return;
    }
    let rid = renders.some((r) => r.id === cfg.renderId) ? cfg.renderId : (renders.find((r) => r.approval) || renders[0]).id;
    const qs = cfg.questions.map((q) => ({ ...q, options: [...q.options] }));
    let dirty = !cfg.renderId;
    const rsel = h("select", { "aria-label": "Bản kết xuất", onchange: () => { rid = rsel.value; dirty = true; video.src = src(); state(); } },
      renders.map((r) => h("option", { value: r.id, selected: r.id === rid },
        `${r.quality === "final" ? "1080p" : "720p"} · ${fmtDur(r.durationMs)} · ${fmtTime(r.createdAt)}${r.approval ? " · đã duyệt" : ""}`)));
    const src = () => `/api/projects/${pid}/renders/${rid}/lecture.mp4`;
    const video = h("video", { controls: true, preload: "metadata", src: src(), style: { width: "100%", borderRadius: "10px", background: "#000" } });
    const reqC = h("input", { type: "checkbox", checked: cfg.requireCorrect, onchange: () => (dirty = true) });
    const showE = h("input", { type: "checkbox", checked: cfg.showExplain, onchange: () => (dirty = true) });
    const list = h("div");
    const status = h("div");
    const cur = () => renders.find((r) => r.id === rid);
    const state = () => {
      const r = cur();
      status.replaceChildren(r.approval ? h("span", { class: "badge ok" }, "Bản đã duyệt — tải gói được") :
        h("span", { class: "badge warn" }, "Bản chưa duyệt — duyệt ở Trung tâm xuất bản trước khi tải gói"));
    };

    function draw() {
      qs.sort((a, b) => a.atMs - b.atMs);
      list.replaceChildren(qs.length ? qs.map((q, i) => qCard(q, i)) : h("div", { class: "empty" }, "Chưa có câu hỏi. Tua video tới mốc cần hỏi rồi bấm «Thêm câu hỏi tại thời điểm này»."));
    }
    function qCard(q, i) {
      const mark = () => (dirty = true);
      return h("div", { class: "card st-item" },
        h("div", { class: "row" }, h("b", {}, `Câu ${i + 1}`),
          h("label", { style: { margin: 0 } }, "tại giây"),
          h("input", { type: "number", min: 0, step: 0.5, value: (q.atMs / 1000).toFixed(1), style: { width: "100px" }, onchange: (e) => { q.atMs = Math.max(0, Math.round(+e.target.value * 1000)); mark(); draw(); } }),
          h("small", { class: "muted" }, fmtDur(q.atMs)),
          h("button", { class: "btn ghost sm", onclick: () => { video.currentTime = Math.max(0, q.atMs / 1000 - 3); video.play(); } }, "▶ Xem đoạn trước câu hỏi"),
          h("span", { class: "spacer" }), h("button", { class: "icon-btn", "aria-label": "Xóa câu hỏi", onclick: () => { qs.splice(i, 1); mark(); draw(); } }, "×")),
        h("label", {}, "Câu hỏi"), h("textarea", { style: { minHeight: "60px" }, value: q.text, oninput: (e) => { q.text = e.target.value; mark(); } }),
        h("label", {}, "Phương án (chọn ô tròn ở đáp án đúng)"),
        q.options.map((o, k) => h("div", { class: "row", style: { marginBottom: "6px" } },
          h("input", { type: "radio", name: `c-${i}`, checked: q.correct === k, "aria-label": `Đáp án đúng ${L[k]}`, onchange: () => { q.correct = k; mark(); } }),
          h("b", {}, L[k]), h("input", { type: "text", value: o, style: { flex: 1, width: "auto" }, oninput: (e) => { q.options[k] = e.target.value; mark(); } }),
          h("button", { class: "icon-btn", "aria-label": "Bỏ phương án", disabled: q.options.length <= 2, onclick: () => { q.options.splice(k, 1); if (q.correct >= q.options.length) q.correct = -1; else if (q.correct > k) q.correct--; mark(); draw(); } }, "×"))),
        q.options.length < 6 && h("button", { class: "btn ghost sm", onclick: () => { q.options.push(""); mark(); draw(); } }, "+ Phương án"),
        h("label", {}, "Giải thích / căn cứ (hiện sau khi trả lời)"), h("textarea", { style: { minHeight: "50px" }, value: q.explain || "", oninput: (e) => { q.explain = e.target.value; mark(); } }));
    }

    const save = async () => {
      const r = await put(`/api/projects/${pid}/interactive`, { renderId: rid, requireCorrect: reqC.checked, showExplain: showE.checked,
        questions: qs.map((q) => ({ ...q, options: q.options.filter((o) => o.trim()) })) });
      qs.splice(0, qs.length, ...r.questions.map((q) => ({ ...q, options: [...q.options] }))); dirty = false; draw();
      return r;
    };
    const late = () => qs.some((q) => q.atMs >= cur().durationMs);
    body.replaceChildren(h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)", alignItems: "start" } },
      h("div", { class: "card", style: { position: "sticky", top: "70px" } },
        h("label", { style: { marginTop: 0 } }, "Bản kết xuất dùng làm video"), rsel, h("div", { style: { margin: "10px 0" } }, video),
        h("div", { class: "row" }, h("button", { class: "btn", onclick: () => {
          qs.push({ atMs: Math.round(video.currentTime * 1000), text: "", options: ["", ""], correct: -1, explain: "" }); dirty = true; video.pause(); draw();
          list.lastChild?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        } }, "+ Thêm câu hỏi tại thời điểm này"), status),
        h("label", { class: "check" }, reqC, "Bắt buộc chọn đúng mới xem tiếp (không tua qua câu chưa trả lời)"),
        h("label", { class: "check" }, showE, "Hiện giải thích sau khi trả lời"),
        h("div", { class: "row" },
          h("button", { class: "btn ghost", onclick: async () => { try { await save(); toast("Đã lưu câu hỏi", "ok"); } catch (e) { errToast(e); } } }, "Lưu"),
          h("button", { class: "btn ghost", onclick: async () => {
            try { await save(); window.open(`/api/projects/${pid}/interactive/preview`, "_blank", "noopener"); } catch (e) { errToast(e); } } }, "Xem thử như người học"),
          h("button", { class: "btn gold", onclick: async () => {
            try {
              if (late()) return toast("Có câu hỏi đặt sau khi video kết thúc", "err");
              await save(); await downloadPost(`/api/projects/${pid}/interactive/package`, `PNS_interactive_${pid}.zip`);
            } catch (e) { errToast(e); } } }, "Tải gói video tương tác")),
        h("p", { class: "muted" }, "Gói gồm index.html + MP4 + phụ đề: mở trực tiếp trên máy hoặc đăng lên PNL/GitHub Pages. Kết quả trả lời chỉ hiện trên máy người học.")),
      h("div", {}, list)));
    state(); draw();
    const leave = (e) => { if (dirty && qs.length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    cleanupFn = () => window.removeEventListener("beforeunload", leave);
  }

  await render();
  return () => cleanupFn?.();
}
