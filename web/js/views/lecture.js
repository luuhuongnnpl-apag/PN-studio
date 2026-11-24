// Lecture Studio: thumbnail trái, canvas giữa, thuộc tính phải, kịch bản/phụ đề dưới.
// Undo/redo, tự lưu (có kiểm tra revision), cảnh báo chưa lưu.
import { del, get, post, put, waitJob } from "../api.js";
import { ctx } from "../state.js";
import { h, toast, errToast, confirmBox, fmtDur, newSceneId, progressBar, recorder } from "../ui.js";
import { pickAsset, uploadFiles } from "./media.js";
import { newProjectDialog } from "./projects.js";

const EDITABLE = ["title", "status", "description", "course", "links", "tags", "scenes"];
const SCENE_STATUS = { draft: "Nháp", review: "Chờ duyệt", approved: "Đã duyệt" };

export default async function lecture(view, args) {
  const pid = args[0] || ctx.project()?.id;
  if (!pid) return chooser(view);
  let project;
  try { project = await get(`api/projects/${pid}`); }
  catch (e) { if (ctx.project()?.id === pid) ctx.setProject(null); return chooser(view, e.message); }
  if (!args[0]) { history.replaceState(null, "", `#/lecture/${pid}`); }
  ctx.setProject(project);
  view.className = "full";
  return new Editor(view, project).cleanup;
}

async function chooser(view, err) {
  const list = (await get("api/projects?kind=lecture")).slice(0, 30);
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Lecture Studio"), h("p", {}, "Chọn dự án bài giảng để biên tập"))),
    err && h("div", { class: "notice err" }, err),
    h("div", { class: "row", style: { marginBottom: "14px" } }, h("button", { class: "btn gold", onclick: async () => {
      const p = await newProjectDialog(); if (p) location.hash = `#/lecture/${p.id}`; } }, "+ Dự án bài giảng mới")),
    list.length ? h("div", { class: "cards" }, list.map((p) => h("a", { class: "card studio-card", href: `#/lecture/${p.id}` },
      h("h3", {}, p.title), h("p", {}, `${p.sceneCount} cảnh`)))) : h("div", { class: "empty" }, "Chưa có dự án bài giảng."));
}

class Editor {
  constructor(view, project) {
    this.view = view;
    this.p = project;
    this.sel = project.scenes[0]?.id || null;
    this.undo = []; this.redo = [];
    this.dirty = false; this.saving = false; this.conflict = false;
    this.voices = []; this.engineTts = null;
    this.timer = null; this.snapTimer = null; this.lastSnap = this.snapshot();
    this.build();
    this.loadVoices();
    this.onKey = (e) => this.key(e);
    this.onBeforeUnload = (e) => { if (this.dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("beforeunload", this.onBeforeUnload);
    this.cleanup = () => {
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("beforeunload", this.onBeforeUnload);
      if (this.dirty) this.save();
    };
  }

  // ---------- trạng thái & lịch sử ----------
  snapshot() { return JSON.stringify(Object.fromEntries(EDITABLE.map((k) => [k, this.p[k]]))); }
  scene() { return this.p.scenes.find((s) => s.id === this.sel); }
  idx() { return this.p.scenes.findIndex((s) => s.id === this.sel); }

  change({ redraw = "all", immediateSnap = true } = {}) {
    this.dirty = true;
    this.setState("Chưa lưu…");
    clearTimeout(this.snapTimer);
    const snap = () => {
      const now = this.snapshot();
      if (now !== this.lastSnap) { this.undo.push(this.lastSnap); if (this.undo.length > 80) this.undo.shift(); this.redo = []; this.lastSnap = now; this.updUndo(); }
    };
    immediateSnap ? snap() : (this.snapTimer = setTimeout(snap, 700));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 1500);
    if (redraw === "all") this.draw();
    else if (redraw === "list") this.drawList();
  }

  restore(s) {
    const o = JSON.parse(s);
    Object.assign(this.p, o);
    if (!this.scene()) this.sel = this.p.scenes[0]?.id || null;
    this.lastSnap = s;
    this.dirty = true; clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), 800);
    this.setState("Chưa lưu…"); this.draw(); this.updUndo();
  }
  doUndo() { if (!this.undo.length) return; this.redo.push(this.snapshot()); this.restore(this.undo.pop()); }
  doRedo() { if (!this.redo.length) return; this.undo.push(this.snapshot()); this.restore(this.redo.pop()); }

  async save() {
    if (this.saving || this.conflict) { if (this.saving) { clearTimeout(this.timer); this.timer = setTimeout(() => this.save(), 800); } return; }
    if (!this.dirty) return;
    clearTimeout(this.timer);
    this.saving = true; this.setState("Đang lưu…");
    const sent = this.snapshot();
    try {
      const r = await put(`api/projects/${this.p.id}`, { ...JSON.parse(sent), revision: this.p.revision });
      this.p.revision = r.revision;
      this.mergeComputed(r);
      this.dirty = this.snapshot() !== sent;
      this.setState(this.dirty ? "Chưa lưu…" : "Đã lưu");
      ctx.setProject(r);
      this.drawList(); this.drawProps(); this.drawBottomInfo();
      if (this.dirty) this.timer = setTimeout(() => this.save(), 800);
    } catch (e) {
      if (e.status === 409) { this.conflict = true; this.showConflict(); }
      else { this.setState("Lưu lỗi"); errToast(e); this.timer = setTimeout(() => this.save(), 5000); }
    } finally { this.saving = false; }
  }

  // Lấy các trường do Engine tính (văn bản đọc, âm thanh) mà không ghi đè chỉnh sửa đang gõ
  mergeComputed(server) {
    const by = Object.fromEntries(server.scenes.map((s) => [s.id, s]));
    for (const s of this.p.scenes) {
      const v = by[s.id]; if (!v) continue;
      for (const k of ["spokenText", "wordCount", "audioAssetId", "audioDurationMs", "audioStale", "audioInfo"]) s[k] = v[k];
    }
  }

  async refresh() {
    const r = await get(`api/projects/${this.p.id}`);
    if (this.dirty) { this.p.revision = r.revision; this.mergeComputed(r); }
    else { this.p = r; this.lastSnap = this.snapshot(); }
    if (!this.scene()) this.sel = this.p.scenes[0]?.id || null;
    this.draw();
  }

  async flush() {
    for (let i = 0; i < 40 && (this.saving || this.dirty) && !this.conflict; i++) {
      if (!this.saving) await this.save(); else await new Promise((r) => setTimeout(r, 250));
    }
    if (this.dirty || this.conflict) throw new Error("Chưa lưu được dự án — kiểm tra kết nối Engine");
  }

  showConflict() {
    this.setState("Xung đột");
    this.banner.replaceChildren(h("div", { class: "notice err", style: { margin: 0 } }, "Dự án đã được thay đổi ở tab/cửa sổ khác. ",
      h("button", { class: "btn sm", onclick: async () => { this.conflict = false; this.dirty = false; this.banner.replaceChildren(); this.p = await get(`api/projects/${this.p.id}`); this.undo = []; this.redo = []; this.lastSnap = this.snapshot(); this.draw(); this.setState("Đã tải lại"); } }, "Tải bản mới nhất (bỏ thay đổi chưa lưu)")));
  }

  setState(t) { this.stateEl.textContent = t; }
  updUndo() { this.bUndo.disabled = !this.undo.length; this.bRedo.disabled = !this.redo.length; }

  key(e) {
    const inText = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); this.save(); return; }
    if (inText) return;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); this.doUndo(); }
    else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); this.doRedo(); }
    else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); this.move(-1); }
    else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); this.move(1); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const i = this.idx() + (e.key === "ArrowUp" ? -1 : 1);
      if (this.p.scenes[i]) { e.preventDefault(); this.select(this.p.scenes[i].id, true); }
    }
  }

  // ---------- dựng khung ----------
  build() {
    this.stateEl = h("span", { class: "save-state", role: "status" }, "Đã lưu");
    this.bUndo = h("button", { class: "icon-btn", "aria-label": "Hoàn tác (Ctrl+Z)", title: "Hoàn tác (Ctrl+Z)", disabled: true, onclick: () => this.doUndo() }, "↶");
    this.bRedo = h("button", { class: "icon-btn", "aria-label": "Làm lại (Ctrl+Y)", title: "Làm lại (Ctrl+Y)", disabled: true, onclick: () => this.doRedo() }, "↷");
    this.titleIn = h("input", { type: "text", class: "title", "aria-label": "Tên dự án", value: this.p.title,
      oninput: () => { this.p.title = this.titleIn.value; this.change({ redraw: "none", immediateSnap: false }); } });
    this.jobBox = h("div", { style: { maxWidth: "300px", flex: "0 1 300px" } });
    this.banner = h("div", { class: "ed-banner" });
    const bar = h("div", { class: "ed-bar" }, this.titleIn, this.bUndo, this.bRedo, this.stateEl,
      h("span", { class: "spacer" }), this.jobBox,
      h("button", { class: "btn ghost sm", onclick: () => this.importSlides() }, "Nhập PDF/PPTX"),
      h("button", { class: "btn ghost sm", onclick: () => this.addScene() }, "+ Cảnh"),
      h("button", { class: "btn ghost sm", onclick: () => this.genAll() }, "Cập nhật giọng AI"),
      h("button", { class: "btn gold sm", onclick: async () => { try { await this.flush(); location.hash = `#/video/${this.p.id}`; } catch (e) { errToast(e); } } }, "Kết xuất video →"));
    this.list = h("div", { class: "ed-scenes", role: "listbox", "aria-label": "Danh sách cảnh" });
    this.stage = h("div", { class: "ed-stage" });
    this.props = h("div", { class: "ed-props" });
    this.bottom = h("div", { class: "ed-bottom" });
    this.view.append(h("div", { class: "editor" }, bar, this.banner, this.list, this.stage, this.props, this.bottom));
    this.draw();
  }

  draw() { this.titleIn.value = this.p.title; this.drawList(); this.drawStage(); this.drawProps(); this.drawBottom(); }

  // ---------- danh sách cảnh ----------
  drawList() {
    const total = this.p.scenes.reduce((a, s) => a + (s.audioMode === "none" ? s.silentDurationMs || 5000 : s.audioDurationMs || 0), 0);
    this.list.replaceChildren(h("div", { class: "row", style: { marginBottom: "8px" } }, h("small", {}, `${this.p.scenes.length} cảnh · ~${fmtDur(total)}`)),
      ...this.p.scenes.map((s, i) => {
        const b = h("button", { class: `scene ${s.id === this.sel ? "active" : ""}`, role: "option", "aria-selected": String(s.id === this.sel), draggable: "true",
          onclick: () => this.select(s.id),
          ondragstart: (e) => { e.dataTransfer.setData("text/plain", s.id); b.classList.add("dragging"); },
          ondragend: () => b.classList.remove("dragging"),
          ondragover: (e) => { e.preventDefault(); b.classList.add("dropafter"); },
          ondragleave: () => b.classList.remove("dropafter"),
          ondrop: (e) => { e.preventDefault(); b.classList.remove("dropafter"); this.reorder(e.dataTransfer.getData("text/plain"), i); } },
        h("div", { class: "st", style: s.slideAssetId ? { backgroundImage: `url(api/assets/${s.slideAssetId}/thumb)` } : {} }, s.slideAssetId ? "" : "Thẻ tiêu đề"),
        h("div", { class: "sl" }, h("small", {}, i + 1), h("b", {}, s.title), dotFor(s)));
        return b;
      }),
      !this.p.scenes.length && h("div", { class: "empty", style: { padding: "16px 8px" } }, "Chưa có cảnh. Nhập PDF/PPTX hoặc thêm cảnh."));
  }

  select(id, focus = false) {
    this.sel = id; this.drawList(); this.drawStage(); this.drawProps(); this.drawBottom();
    if (focus) this.list.querySelector(".scene.active")?.focus();
  }

  reorder(id, to) {
    const from = this.p.scenes.findIndex((s) => s.id === id);
    if (from < 0 || from === to) return;
    const [s] = this.p.scenes.splice(from, 1);
    this.p.scenes.splice(to, 0, s);
    this.change({ redraw: "list" });
  }

  move(d) {
    const i = this.idx(), j = i + d;
    if (i < 0 || j < 0 || j >= this.p.scenes.length) return;
    [this.p.scenes[i], this.p.scenes[j]] = [this.p.scenes[j], this.p.scenes[i]];
    this.change({ redraw: "list" });
  }

  addScene() {
    const s = { id: newSceneId(), title: "Cảnh mới", slideAssetId: null, sourcePage: null, scriptOriginal: "", scriptSpoken: "", spokenOverride: false,
      sourceNotes: "", needsVerification: false, audioMode: "none", voiceId: this.voices[0]?.id || null, silentDurationMs: 5000, captions: [], captionsEdited: false, status: "draft", excluded: false };
    const i = this.idx();
    this.p.scenes.splice(i < 0 ? this.p.scenes.length : i + 1, 0, s);
    this.sel = s.id;
    this.change();
  }

  duplicateScene() {
    const s = this.scene(); if (!s) return;
    const c = { ...structuredClone(s), id: newSceneId(), title: s.title + " (bản sao)" };
    this.p.scenes.splice(this.idx() + 1, 0, c);
    this.sel = c.id; this.change();
  }

  async removeScene() {
    const s = this.scene(); if (!s) return;
    if (!(await confirmBox("Xóa cảnh?", `Xóa cảnh «${s.title}»? Có thể hoàn tác bằng Ctrl+Z.`, "Xóa", true))) return;
    const i = this.idx();
    this.p.scenes.splice(i, 1);
    this.sel = this.p.scenes[Math.min(i, this.p.scenes.length - 1)]?.id || null;
    this.change();
  }

  // ---------- canvas ----------
  drawStage() {
    const s = this.scene();
    if (!s) { this.stage.replaceChildren(h("div", { class: "canvas" }, "Chọn hoặc thêm cảnh")); return; }
    const canvas = s.slideAssetId ? h("div", { class: "canvas", role: "img", "aria-label": `Slide cảnh ${s.title}`, style: { backgroundImage: `url(api/assets/${s.slideAssetId}/file)` } })
      : h("div", { class: "canvas titlecard" }, s.title);
    const audio = s.audioAssetId && s.audioMode !== "none" ? h("audio", { controls: true, src: `api/assets/${s.audioAssetId}/file`, preload: "metadata" }) : null;
    this.stage.replaceChildren(canvas, audio || h("small", {}, s.audioMode === "none" ? `Cảnh không lời — hiển thị ${(s.silentDurationMs / 1000).toFixed(1)} giây` : "Cảnh chưa có âm thanh"),
      h("div", { class: "row" },
        h("button", { class: "btn ghost sm", onclick: () => this.move(-1), title: "Alt+↑" }, "↑ Lên"),
        h("button", { class: "btn ghost sm", onclick: () => this.move(1), title: "Alt+↓" }, "↓ Xuống"),
        h("button", { class: "btn ghost sm", onclick: () => this.pickSlide() }, "Đổi slide"),
        s.slideAssetId && h("button", { class: "btn ghost sm", onclick: () => { s.slideAssetId = null; this.change(); } }, "Dùng thẻ tiêu đề"),
        h("button", { class: "btn ghost sm", onclick: () => this.duplicateScene() }, "Nhân bản cảnh"),
        h("button", { class: "btn danger sm", onclick: () => this.removeScene() }, "Xóa cảnh")));
  }

  async pickSlide() {
    const a = await pickAsset(["slide", "image"], "Chọn slide/ảnh cho cảnh");
    if (a && this.scene()) { this.scene().slideAssetId = a.id; this.change(); }
  }

  // ---------- thuộc tính ----------
  drawProps() {
    const s = this.scene();
    if (!s) { this.props.replaceChildren(h("h3", {}, "Thuộc tính"), h("p", { class: "muted" }, "Chưa chọn cảnh")); return; }
    const inp = (key, attrs = {}) => h("input", { type: "text", value: s[key] ?? "", ...attrs, oninput: (e) => { s[key] = e.target.value; this.change({ redraw: key === "title" ? "list" : "none", immediateSnap: false }); } });
    const status = h("select", { onchange: (e) => { s.status = e.target.value; this.change({ redraw: "list" }); } },
      Object.entries(SCENE_STATUS).map(([k, v]) => h("option", { value: k, selected: s.status === k }, v)));
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Nguồn âm thanh" }, [["recorded", "Giọng thật"], ["tts", "Giọng AI"], ["none", "Không lời"]].map(([k, v]) =>
      h("button", { type: "button", "aria-pressed": String(s.audioMode === k), onclick: () => { s.audioMode = k; this.change(); } }, v)));
    this.props.replaceChildren(
      h("h3", {}, `Cảnh ${this.idx() + 1}`),
      h("label", {}, "Tiêu đề cảnh"), inp("title"),
      h("div", { class: "grid g2" }, h("div", {}, h("label", {}, "Trạng thái"), status),
        h("div", {}, h("label", {}, "Trang nguồn"), h("input", { type: "number", min: 1, value: s.sourcePage ?? "", onchange: (e) => { s.sourcePage = e.target.value ? +e.target.value : null; this.change({ redraw: "none" }); } }))),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.needsVerification, onchange: (e) => { s.needsVerification = e.target.checked; this.change({ redraw: "list" }); } }), "Cần kiểm chứng căn cứ pháp lý"),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.excluded, onchange: (e) => { s.excluded = e.target.checked; this.change({ redraw: "list" }); } }), "Bỏ qua cảnh này khi kết xuất"),
      h("label", {}, "Nguồn / căn cứ"), h("textarea", { style: { minHeight: "70px" }, value: s.sourceNotes, placeholder: "VD: Điều 612 BLDS 2015; Án lệ số …", oninput: (e) => { s.sourceNotes = e.target.value; this.change({ redraw: "none", immediateSnap: false }); } }),
      h("h3", { style: { marginTop: "16px" } }, "Âm thanh"), seg, this.audioPanel(s));
  }

  audioPanel(s) {
    if (s.audioMode === "none") return h("div", {}, h("label", {}, "Thời lượng hiển thị (giây)"),
      h("input", { type: "number", min: 1, max: 600, step: 0.5, value: (s.silentDurationMs || 5000) / 1000, onchange: (e) => { s.silentDurationMs = Math.round(Math.max(1, +e.target.value) * 1000); this.change({ redraw: "list" }); } }));
    const box = h("div", { style: { marginTop: "8px" } });
    if (s.audioMode === "recorded") {
      box.append(s.audioAssetId ? h("div", { class: "notice ok" }, `Đã gắn bản thu ${fmtDur(s.audioDurationMs)}`, s.audioInfo?.source ? ` · ${s.audioInfo.source}` : "")
        : h("div", { class: "notice warn" }, "Chưa có bản thu cho cảnh này"),
        h("div", { class: "row" },
          h("button", { class: "btn ghost sm", onclick: async () => { const a = await pickAsset(["audio"], "Chọn bản thu"); if (a) this.attach(s, a.id); } }, "Chọn từ thư viện"),
          recorder(async (f) => { const [a] = await uploadFiles([f]); if (a) this.attach(s, a.id); }),
          s.audioAssetId && h("button", { class: "btn danger sm", onclick: async () => { try { this.mergeComputed(await del(`api/projects/${this.p.id}/scenes/${s.id}/audio/recorded`)); this.draw(); } catch (e) { errToast(e); } } }, "Gỡ")),
        h("small", {}, "Nhận WAV, M4A, MP3… Âm thanh được chuẩn hóa −16 LUFS, 48 kHz."));
      return box;
    }
    // Giọng AI
    const vsel = h("select", { "aria-label": "Giọng AI", onchange: (e) => { s.voiceId = e.target.value || null; this.change(); } },
      h("option", { value: "" }, "— Chọn mẫu giọng —"), this.voices.map((v) => h("option", { value: v.id, selected: s.voiceId === v.id }, v.name + (v.meta.approved ? "" : " (chưa duyệt)"))));
    const st = this.engineTts;
    box.append(h("label", {}, "Mẫu giọng"), vsel,
      !this.voices.length && h("small", {}, "Chưa có mẫu. ", h("a", { href: "#/voice" }, "Thêm ở Voice Studio")),
      st && st.browser ? h("div", { class: "notice warn" }, "Giọng AI chỉ tạo được trong PNS Engine trên máy Windows. Ở chế độ trình duyệt hãy chọn Giọng thật.")
        : st && !st.installed ? h("div", { class: "notice warn" }, "Chưa cài VieNeu-TTS — chuyển sang Giọng thật hoặc chạy INSTALL_VOICE_AI.bat.")
        : s.audioAssetId && !s.audioStale ? h("div", { class: "notice ok" }, `Giọng AI sẵn sàng ${fmtDur(s.audioDurationMs)}`, s.audioInfo?.rtf ? ` · RTF ${s.audioInfo.rtf}` : "")
        : h("div", { class: "notice warn" }, s.audioAssetId ? "Lời giảng/giọng đã đổi — cần tạo lại" : "Chưa tạo giọng AI cho cảnh này"),
      h("button", { class: "btn sm", disabled: !s.voiceId || (st && !st.installed), onclick: () => this.genScene(s) }, "Tạo giọng AI cảnh này"),
      h("p", { class: "muted", style: { fontSize: ".8rem" } }, "Video có giọng AI được gắn nhãn «Lời thuyết minh tạo bằng AI»."));
    return box;
  }

  async attach(s, assetId) {
    try { await this.flush(); this.mergeComputed(await post(`api/projects/${this.p.id}/scenes/${s.id}/audio`, { assetId })); this.draw(); toast("Đã gắn âm thanh", "ok"); }
    catch (e) { errToast(e); }
  }

  async loadVoices() {
    try { const r = await get("api/voices"); this.voices = r.voices; this.engineTts = r.engine; this.drawProps(); } catch {}
  }

  // ---------- job ----------
  async runJob(promise, label) {
    const job = await promise;
    const cancel = h("button", { class: "btn danger sm", onclick: () => post(`api/jobs/${job.id}/cancel`) }, "Hủy");
    const j = await waitJob(job, (x) => this.jobBox.replaceChildren(h("small", {}, `${label}: ${x.message || ""}`), progressBar(x.progress), cancel));
    this.jobBox.replaceChildren();
    if (j.status === "failed") toast(`${label} lỗi: ${j.error}`, "err");
    else if (j.status === "cancelled") toast(`${label}: đã hủy`);
    return j;
  }

  async genScene(s) {
    try {
      await this.flush();
      const j = await this.runJob(post(`api/projects/${this.p.id}/scenes/${s.id}/tts`), "Giọng AI");
      if (j.status === "done") { toast(`Đã tạo giọng AI (${j.result.seconds}s xử lý)`, "ok"); await this.refresh(); }
    } catch (e) { errToast(e); }
  }

  async genAll() {
    const todo = this.p.scenes.filter((s) => s.audioMode === "tts" && s.audioStale && !s.excluded);
    if (!todo.length) return toast("Không có cảnh giọng AI nào cần cập nhật");
    for (const s of todo) {
      if (!s.voiceId) { toast(`Cảnh «${s.title}» chưa chọn giọng`, "err"); continue; }
      await this.genScene(s);
    }
  }

  async importSlides() {
    const a = await pickAsset(["pdf", "presentation"], "Nhập slide từ PDF hoặc PPTX");
    if (!a) return;
    let replace = false;
    if (this.p.scenes.length) replace = await confirmBox("Thay thế các cảnh hiện có?", "Chọn «Thay thế» để bỏ các cảnh cũ, «Hủy» để thêm vào cuối danh sách.", "Thay thế", true);
    try {
      await this.flush();
      const j = await this.runJob(post(`api/projects/${this.p.id}/import-slides`, { assetId: a.id, replace }), "Nhập slide");
      if (j.status === "done") {
        this.undo.push(this.snapshot()); this.updUndo();
        this.p = await get(`api/projects/${this.p.id}`); this.lastSnap = this.snapshot();
        this.sel = this.p.scenes.find((s) => s.slideAssetId === j.result.slides[0])?.id || this.p.scenes[0]?.id;
        this.draw(); toast(`Đã nhập ${j.result.pages} trang`, "ok");
      }
    } catch (e) { errToast(e); }
  }

  // ---------- kịch bản & phụ đề ----------
  drawBottom() {
    const s = this.scene();
    this.bottomTab = this.bottomTab || "script";
    if (!s) { this.bottom.replaceChildren(); return; }
    const tabs = h("div", { class: "tabs", role: "tablist" }, [["script", "Lời giảng"], ["spoken", "Văn bản đọc"], ["captions", "Phụ đề"]].map(([k, v]) =>
      h("button", { role: "tab", "aria-selected": String(this.bottomTab === k), onclick: () => { this.bottomTab = k; this.drawBottom(); } }, v)));
    this.info = h("small", { class: "muted" });
    let panel;
    if (this.bottomTab === "script") {
      panel = h("div", {}, h("textarea", { "aria-label": "Lời giảng (văn bản gốc, dùng làm phụ đề)", value: s.scriptOriginal,
        placeholder: "Lời giảng phân tích cho cảnh này (không đọc lại slide). Có thể dán kịch bản từ ChatGPT/Claude — nhớ kiểm chứng điều luật.",
        oninput: (e) => { s.scriptOriginal = e.target.value; this.change({ redraw: "none", immediateSnap: false }); this.drawBottomInfo(); } }));
    } else if (this.bottomTab === "spoken") {
      panel = h("div", {},
        h("label", { class: "check", style: { margin: "0 0 6px" } }, h("input", { type: "checkbox", checked: s.spokenOverride, onchange: (e) => {
          s.spokenOverride = e.target.checked; if (s.spokenOverride && !s.scriptSpoken) s.scriptSpoken = s.spokenText || ""; this.change({ redraw: "none" }); this.drawBottom(); } }),
          "Tự sửa văn bản đọc (bỏ tự động theo từ điển)"),
        s.spokenOverride
          ? h("textarea", { value: s.scriptSpoken, "aria-label": "Văn bản đọc", oninput: (e) => { s.scriptSpoken = e.target.value; this.change({ redraw: "none", immediateSnap: false }); } })
          : h("div", { class: "notice info", style: { whiteSpace: "pre-wrap" } }, s.spokenText || "(Lưu để xem văn bản đọc tự động)"));
    } else {
      panel = this.captionPanel(s);
    }
    this.bottom.replaceChildren(h("div", { class: "row" }, tabs, h("span", { class: "spacer" }), this.info), panel);
    this.drawBottomInfo();
  }

  drawBottomInfo() {
    const s = this.scene(); if (!s || !this.info) return;
    const words = (s.scriptOriginal.match(/[\p{L}\p{N}]+/gu) || []).length;
    this.info.textContent = `${words} từ · ước ${fmtDur((words / 140) * 60000)} ở tốc độ 140 từ/phút${s.needsVerification ? " · ⚠ cần kiểm chứng" : ""}`;
  }

  captionPanel(s) {
    const wrap = h("div");
    const auto = async () => {
      try { await this.flush(); s.captions = await get(`api/projects/${this.p.id}/scenes/${s.id}/captions-auto`); s.captionsEdited = true; this.change({ redraw: "none" }); this.drawBottom(); }
      catch (e) { errToast(e); }
    };
    if (!s.captionsEdited) {
      wrap.append(h("div", { class: "notice info" }, "Phụ đề đang tự động: mỗi câu của lời giảng là một dòng, mốc thời gian ƯỚC LƯỢNG theo độ dài câu (chưa căn chỉnh từng từ)."),
        h("button", { class: "btn sm", onclick: auto }, "Chuyển sang sửa tay"));
      return wrap;
    }
    const ms = (v) => { const [m, sec] = String(v).split(":"); return sec === undefined ? Math.round(+m * 1000) : Math.round((+m * 60 + +sec) * 1000); };
    const show = (v) => `${Math.floor(v / 60000)}:${((v % 60000) / 1000).toFixed(2).padStart(5, "0")}`;
    const rows = s.captions.map((c, i) => h("tr", {},
      h("td", { style: { width: "110px" } }, h("input", { type: "text", value: show(c.startMs), "aria-label": "Bắt đầu", onchange: (e) => { c.startMs = ms(e.target.value); this.change({ redraw: "none" }); } })),
      h("td", { style: { width: "110px" } }, h("input", { type: "text", value: show(c.endMs), "aria-label": "Kết thúc", onchange: (e) => { c.endMs = ms(e.target.value); this.change({ redraw: "none" }); } })),
      h("td", {}, h("input", { type: "text", value: c.text, "aria-label": "Nội dung", oninput: (e) => { c.text = e.target.value; this.change({ redraw: "none", immediateSnap: false }); } })),
      h("td", { style: { width: "40px" } }, h("button", { class: "icon-btn", "aria-label": "Xóa dòng", onclick: () => { s.captions.splice(i, 1); this.change({ redraw: "none" }); this.drawBottom(); } }, "×"))));
    const bad = s.captions.some((c) => !(c.endMs > c.startMs));
    wrap.append(bad && h("div", { class: "notice err" }, "Có dòng có mốc kết thúc không lớn hơn mốc bắt đầu."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Bắt đầu"), h("th", {}, "Kết thúc"), h("th", {}, "Nội dung (mốc tính từ đầu cảnh, phút:giây)"), h("th", {}))), h("tbody", {}, rows)),
      h("div", { class: "row", style: { marginTop: "8px" } },
        h("button", { class: "btn ghost sm", onclick: () => { const last = s.captions.at(-1); s.captions.push({ startMs: last ? last.endMs : 250, endMs: (last ? last.endMs : 250) + 3000, text: "" }); this.change({ redraw: "none" }); this.drawBottom(); } }, "+ Dòng"),
        h("button", { class: "btn ghost sm", onclick: auto }, "Tạo lại từ lời giảng"),
        h("button", { class: "btn ghost sm", onclick: () => { s.captionsEdited = false; s.captions = []; this.change({ redraw: "none" }); this.drawBottom(); } }, "Về chế độ tự động")));
    return wrap;
  }
}

function dotFor(s) {
  if (s.excluded) return h("span", { class: "badge", title: "Bỏ qua khi kết xuất" }, "bỏ");
  if (s.needsVerification) return h("span", { class: "badge warn", title: "Cần kiểm chứng" }, "!");
  if (s.audioMode === "tts") return h("span", { class: `badge ${s.audioStale ? "warn" : "gold"}`, title: s.audioStale ? "Giọng AI cần tạo lại" : "Giọng AI" }, "AI");
  if (s.audioMode === "recorded") return h("span", { class: `badge ${s.audioAssetId ? "ok" : "warn"}`, title: s.audioAssetId ? "Giọng thật" : "Chưa có bản thu" }, "♪");
  return s.status === "approved" ? h("span", { class: "badge ok" }, "✓") : null;
}
