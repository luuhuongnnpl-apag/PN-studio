import { del, get, post, waitJob } from "../api.js";
import { ctx } from "../state.js";
import { h, toast, errToast, confirmBox, fmtBytes, fmtDur, fmtTime, progressBar } from "../ui.js";
import { projectPicker } from "./common.js";

export default async function video(view, args) {
  let pid = args[0] || ctx.project()?.id || "";
  const body = h("div");
  const picker = await projectPicker(pid, (p) => { pid = p?.id || ""; history.replaceState(null, "", `#/video/${pid}`); load(); });
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Video Studio"), h("p", {}, "Dòng thời gian, kết xuất MP4 H.264/AAC và phụ đề SRT")),
    h("span", { class: "spacer" }), h("div", { style: { minWidth: "280px" } }, picker.el)), body);
  let alive = true;

  async function load() {
    if (!pid) { body.replaceChildren(h("div", { class: "empty" }, "Chọn dự án để kết xuất.")); return; }
    const [p, renders, jobs] = await Promise.all([get(`/api/projects/${pid}`), get(`/api/projects/${pid}/renders`), get(`/api/jobs?projectId=${pid}`)]);
    ctx.setProject(p);
    const scenes = p.scenes.filter((s) => !s.excluded);
    const dur = (s) => s.audioMode === "none" ? s.silentDurationMs : (s.audioDurationMs || 0) + 850;
    const total = scenes.reduce((a, s) => a + dur(s), 0) || 1;
    const issues = [];
    scenes.forEach((s, i) => {
      if (s.audioMode === "recorded" && !s.audioAssetId) issues.push(`Cảnh ${i + 1} «${s.title}»: chưa có bản thu.`);
      if (s.audioMode === "tts" && !s.voiceId) issues.push(`Cảnh ${i + 1} «${s.title}»: chưa chọn giọng AI.`);
      if (s.needsVerification) issues.push(`Cảnh ${i + 1} «${s.title}»: còn đánh dấu cần kiểm chứng căn cứ.`);
    });
    const staleTts = scenes.filter((s) => s.audioMode === "tts" && s.audioStale).length;
    const running = jobs.find((j) => j.type === "render" && ["queued", "running"].includes(j.status));
    const jobBox = h("div");
    const start = async (quality) => {
      try {
        const job = await post(`/api/projects/${pid}/render`, { quality });
        track(job, jobBox);
      } catch (e) { errToast(e); }
    };
    body.replaceChildren(
      h("div", { class: "card" }, h("div", { class: "row" }, h("h2", { style: { margin: 0 } }, p.title), h("span", { class: "spacer" }),
        h("a", { class: "btn ghost sm", href: `#/lecture/${pid}` }, "← Biên tập cảnh")),
        h("p", { class: "muted" }, `${scenes.length} cảnh · tổng ước ${fmtDur(total)}`),
        h("div", { class: "timeline", "aria-label": "Dòng thời gian" }, scenes.map((s, i) => h("div", { class: s.audioMode, style: { flex: `${dur(s)} 0 0` }, title: `${i + 1}. ${s.title} — ${fmtDur(dur(s))}` }, `${i + 1}. ${s.title}`))),
        h("div", { class: "row", style: { marginTop: "6px", fontSize: ".78rem" } }, h("span", { class: "badge" }, "Giọng thật"), h("span", { class: "badge gold" }, "Giọng AI"), h("span", { class: "badge" }, "Không lời")),
        issues.length ? h("div", { class: "notice warn" }, h("strong", {}, "Cần xử lý trước khi xuất bản:"), h("ul", {}, issues.map((x) => h("li", {}, x)))) : h("div", { class: "notice ok" }, "Các cảnh đã sẵn sàng."),
        staleTts > 0 && h("div", { class: "notice info" }, `${staleTts} cảnh giọng AI sẽ được sinh lại tự động khi kết xuất (các cảnh không đổi dùng bộ nhớ đệm).`),
        h("div", { class: "row" },
          h("button", { class: "btn ghost", disabled: !!running, onclick: () => start("preview") }, "Xem trước 720p"),
          h("button", { class: "btn gold", disabled: !!running, onclick: () => start("final") }, "Kết xuất 1080p"),
          h("small", {}, "Một job CPU tại một thời điểm; có thể hủy.")), jobBox),
      h("h2", { style: { marginTop: "22px" } }, "Bản đã kết xuất"),
      renders.length ? renders.map((r) => renderCard(p, r, load)) : h("div", { class: "empty" }, "Chưa có bản kết xuất."));
    if (running) track(running, jobBox);
  }

  async function track(job, box) {
    const cancel = h("button", { class: "btn danger sm", onclick: () => post(`/api/jobs/${job.id}/cancel`) }, "Hủy");
    const j = await waitJob(job, (x) => alive && box.replaceChildren(h("div", { class: "row" }, h("small", {}, x.message || ""), h("span", { class: "spacer" }), cancel), progressBar(x.progress)));
    if (!alive) return;
    if (j.status === "done") { toast(`Đã kết xuất ${j.result.resolution} (${fmtDur(j.result.durationMs)}, dùng lại ${j.result.clipsReused} cảnh)`, "ok"); load(); }
    else box.replaceChildren(h("div", { class: "notice err" }, j.status === "cancelled" ? "Đã hủy kết xuất." : `Kết xuất lỗi: ${j.error}`));
  }

  await load();
  return () => { alive = false; };
}

export function renderCard(p, r, reload, extra) {
  const base = `/api/projects/${p.id}/renders/${r.id}`;
  return h("div", { class: "card", style: { marginBottom: "14px" } },
    h("div", { class: "row" }, h("h3", { style: { margin: 0 } }, r.quality === "final" ? "Bản 1080p" : "Bản xem trước 720p"),
      r.approval ? h("span", { class: "badge ok" }, `Đã duyệt bởi ${r.approval.approvedBy}`) : h("span", { class: "badge" }, "Chưa duyệt"),
      r.aiNarration && h("span", { class: "badge gold" }, "Có giọng AI"),
      r.projectRevision !== p.revision && h("span", { class: "badge warn", title: "Dự án đã chỉnh sửa sau lần kết xuất này" }, "Cũ hơn bản biên tập"),
      h("span", { class: "spacer" }), h("small", {}, fmtTime(r.createdAt))),
    h("div", { class: "grid g2", style: { marginTop: "10px", alignItems: "start" } },
      h("video", { controls: true, preload: "metadata", src: `${base}/lecture.mp4` }, h("track", { kind: "subtitles", srclang: "vi", label: "Tiếng Việt", src: `${base}/lecture.vtt`, default: true })),
      h("div", {},
        h("dl", { class: "kv" }, h("dt", {}, "Độ phân giải"), h("dd", {}, r.resolution), h("dt", {}, "Thời lượng"), h("dd", {}, fmtDur(r.durationMs)),
          h("dt", {}, "Dung lượng"), h("dd", {}, fmtBytes(r.sizeBytes)), h("dt", {}, "Số cảnh"), h("dd", {}, `${r.sceneCount} (dùng lại ${r.clipsReused})`),
          h("dt", {}, "Phiên bản dự án"), h("dd", {}, `#${r.projectRevision}`), h("dt", {}, "Phụ đề"), h("dd", {}, r.captionMode)),
        h("div", { class: "row", style: { marginTop: "10px" } },
          h("a", { class: "btn sm", href: `${base}/lecture.mp4?download=1` }, "Tải MP4"),
          h("a", { class: "btn ghost sm", href: `${base}/lecture.srt?download=1` }, "Tải SRT"),
          extra,
          h("button", { class: "btn danger sm", onclick: async () => { if (await confirmBox("Xóa bản kết xuất?", "File MP4/SRT của bản này sẽ bị xóa.", "Xóa", true)) { try { await del(base); reload(); } catch (e) { errToast(e); } } } }, "Xóa")))));
}
