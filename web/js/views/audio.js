import { get, post, upload, waitJob } from "../api.js";
import { h, toast, errToast, fmtDur, progressBar, recorder } from "../ui.js";
import { pickAsset } from "./media.js";

// Bản nháp danh sách đoạn giữ trong trình duyệt (chỉ ID tài sản và mốc cắt, không chứa âm thanh).
const KEY = "pns.audioDraft";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const sec = (ms) => (ms / 1000).toFixed(2);

export default async function audio(view) {
  let segs = load();
  const list = h("div");
  const gap = h("input", { type: "number", min: 0, max: 10000, step: 50, value: 300 });
  const norm = h("input", { type: "checkbox", checked: true });
  const name = h("input", { type: "text", value: "Âm thanh đã biên tập" });
  const out = h("div");

  // Kiểm tra tài sản còn trong thư viện
  const assets = new Map((await get("/api/assets?kind=audio")).map((a) => [a.id, a]));
  segs = segs.filter((s) => assets.has(s.assetId));

  const add = (a) => { segs.push({ assetId: a.id, name: a.name, durationMs: a.meta.durationMs, startMs: 0, endMs: a.meta.durationMs, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 }); save(segs); draw(); };
  const addLib = async () => { const a = await pickAsset(["audio"], "Chọn file âm thanh"); if (a) add(a); };
  const rec = recorder(async (file) => {
    try { const a = await upload("/api/assets", file); toast("Đã lưu bản thu vào thư viện", "ok"); add(a); } catch (e) { errToast(e); }
  });

  function draw() {
    list.replaceChildren(segs.length ? segs.map((s, i) => segCard(s, i)) :
      h("div", { class: "empty" }, "Chưa có đoạn nào. Thêm file từ thư viện hoặc thu âm trực tiếp."));
  }

  function segCard(s, i) {
    const canvas = h("canvas", { class: "wave", width: 900, height: 90, "aria-label": "Dạng sóng — bấm nửa trái để đặt điểm đầu, nửa phải để đặt điểm cuối" });
    const player = h("audio", { src: `/api/assets/${s.assetId}/file`, preload: "none" });
    let peaks = null;
    const num = (key, min, max, step, label) => h("div", {}, h("label", {}, label), h("input", { type: "number", min, max, step, value: key.endsWith("Ms") ? sec(s[key]) : s[key],
      oninput: (e) => { const v = +e.target.value; s[key] = key.endsWith("Ms") ? Math.round(v * 1000) : v; clamp(); save(segs); paint(); } }));
    const clamp = () => {
      s.startMs = Math.max(0, Math.min(s.startMs, s.durationMs - 100)); s.endMs = Math.max(s.startMs + 100, Math.min(s.endMs, s.durationMs));
      const half = Math.floor((s.endMs - s.startMs) / 2); s.fadeInMs = Math.min(s.fadeInMs, half); s.fadeOutMs = Math.min(s.fadeOutMs, half);
      lenEl.textContent = `Dùng ${fmtDur(s.endMs - s.startMs)} / ${fmtDur(s.durationMs)}`;
    };
    function paint() {
      const c = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
      c.clearRect(0, 0, W, H);
      const x0 = s.startMs / s.durationMs * W, x1 = s.endMs / s.durationMs * W;
      c.fillStyle = "#f6efe3"; c.fillRect(x0, 0, x1 - x0, H);
      if (peaks) {
        const n = peaks.length;
        for (let k = 0; k < n; k++) {
          const x = k / n * W, v = peaks[k] * (H / 2 - 4);
          c.fillStyle = x >= x0 && x <= x1 ? "#102c43" : "#b7c4d1"; c.fillRect(x, H / 2 - v, Math.max(1, W / n - 0.5), v * 2 || 1);
        }
      }
      c.fillStyle = "#c4a578"; c.fillRect(x0, 0, 2, H); c.fillRect(x1 - 2, 0, 2, H);
    }
    canvas.onclick = (e) => {
      const ms = Math.round(e.offsetX / canvas.clientWidth * s.durationMs);
      if (ms < (s.startMs + s.endMs) / 2) s.startMs = ms; else s.endMs = ms;
      clamp(); save(segs); draw();
    };
    get(`/api/assets/${s.assetId}/peaks?n=450`).then((d) => { peaks = d.peaks; paint(); }).catch(() => {});
    const lenEl = h("small", { class: "muted" });
    clamp();
    const play = h("button", { class: "btn ghost sm", onclick: () => {
      if (!player.paused) { player.pause(); return; }
      player.currentTime = s.startMs / 1000; player.play();
    } }, "▶ Nghe đoạn đã chọn");
    player.ontimeupdate = () => { if (player.currentTime * 1000 >= s.endMs) player.pause(); };
    player.onplay = () => (play.textContent = "■ Dừng"); player.onpause = () => (play.textContent = "▶ Nghe đoạn đã chọn");
    const move = (d) => { const j = i + d; if (j < 0 || j >= segs.length) return; [segs[i], segs[j]] = [segs[j], segs[i]]; save(segs); draw(); };
    queueMicrotask(paint);
    return h("div", { class: "card st-item" },
      h("div", { class: "row" }, h("b", {}, `${i + 1}. ${s.name}`), lenEl, h("span", { class: "spacer" }),
        h("button", { class: "icon-btn", "aria-label": "Lên", disabled: i === 0, onclick: () => move(-1) }, "↑"),
        h("button", { class: "icon-btn", "aria-label": "Xuống", disabled: i === segs.length - 1, onclick: () => move(1) }, "↓"),
        h("button", { class: "icon-btn", "aria-label": "Bỏ đoạn", onclick: () => { segs.splice(i, 1); save(segs); draw(); } }, "×")),
      canvas, player,
      h("div", { class: "grid g4" }, num("startMs", 0, s.durationMs / 1000, 0.05, "Bắt đầu (giây)"), num("endMs", 0, s.durationMs / 1000, 0.05, "Kết thúc (giây)"),
        num("fadeInMs", 0, 30, 0.05, "Fade in (giây)"), num("fadeOutMs", 0, 30, 0.05, "Fade out (giây)")),
      h("div", { class: "row", style: { marginTop: "8px" } }, h("label", { style: { margin: 0 } }, "Âm lượng (dB)"),
        h("input", { type: "number", min: -20, max: 20, step: 0.5, value: s.gainDb, style: { width: "90px" }, oninput: (e) => { s.gainDb = +e.target.value || 0; save(segs); } }), play));
  }

  const go = h("button", { class: "btn gold", onclick: async () => {
    if (!segs.length) return toast("Thêm ít nhất một đoạn", "err");
    go.disabled = true;
    try {
      const job = await post("/api/audio/edit", { segments: segs, gapMs: +gap.value || 0, normalize: norm.checked, name: name.value });
      const j = await waitJob(job, (x) => out.replaceChildren(progressBar(x.progress), h("small", {}, x.message || "")));
      if (j.status !== "done") { out.replaceChildren(h("div", { class: "notice err" }, "Không xuất được: ", j.error || j.status)); return; }
      out.replaceChildren(h("div", { class: "notice ok" }, h("strong", {}, `Đã lưu «${name.value}.wav» (${fmtDur(j.result.durationMs)}) vào Thư viện media. `),
        j.result.ai ? "Có đoạn giọng AI — vẫn mang nhãn AI khi dùng. " : "", "Gắn vào cảnh ở Lecture Studio (Giọng thật → Chọn từ thư viện) hoặc dùng làm mở đầu/kết thúc podcast."),
      h("audio", { controls: true, src: `/api/assets/${j.result.assetId}/file` }));
    } catch (e) { errToast(e); } finally { go.disabled = false; }
  } }, "Xuất âm thanh");

  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Audio Studio"),
    h("p", {}, "Thu nhiều đoạn, cắt đầu/cuối, fade, chỉnh âm lượng, nối và chuẩn hóa EBU R128 — file gốc giữ nguyên"))),
  h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,1fr) 300px", alignItems: "start" } },
    h("div", {}, h("div", { class: "row", style: { marginBottom: "12px" } }, h("button", { class: "btn ghost sm", onclick: addLib }, "+ Thêm từ thư viện"), rec), list),
    h("div", { class: "card" }, h("h3", {}, "Xuất"), h("label", {}, "Tên file"), name,
      h("label", {}, "Khoảng lặng giữa các đoạn (ms)"), gap, h("label", { class: "check" }, norm, "Chuẩn hóa âm lượng −16 LUFS (khuyên dùng)"),
      go, out)));
  draw();
}
