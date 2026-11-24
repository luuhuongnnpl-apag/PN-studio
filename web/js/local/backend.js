// "Engine trong trình duyệt": cùng hợp đồng API với PNS Engine, dữ liệu ở IndexedDB,
// PDF bằng pdf.js, ghép video bằng ffmpeg.wasm. Giọng AI cá nhân KHÔNG có ở chế độ này (cần PNS Engine).
import * as db from "./db.js";

export const VERSION = "0.2.0-web";
export const SCHEMA = 1;
const LIMIT_MB = 300;
export const MAX_SCENES = 300;
const FPS = 5, LEAD = 250, TAIL = 600;
const QUALITY = { preview: { w: 1280, h: 720, crf: "28" }, final: { w: 1920, h: 1080, crf: "22" } };
const RENDER_TAG = "b1";
const MODES = new Set(["none", "recorded", "tts"]);

export class HttpError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const nf = (m = "Không tìm thấy") => new HttpError(m, 404);
const bad = (m) => new HttpError(m, 422);

// ---------- tiện ích ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const newId = (p) => { const b = new Uint8Array(8); crypto.getRandomValues(b); return `${p}_${hex(b)}`; };
const validId = (v, p) => typeof v === "string" && new RegExp(`^${p}_[0-9a-f]{16}$`).test(v);
const sha = async (data) => hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data));
const now = () => Date.now();
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const url = (v) => { v = str(v, 500).trim(); return /^https:\/\/[^\s<>"']+$/.test(v) ? v : ""; };
const extOf = (n) => (n.match(/\.[a-z0-9]{1,6}$/i)?.[0] || "").toLowerCase();

// ---------- hàng đợi job (một job tại một thời điểm) ----------
const jobs = new Map();
let chain = Promise.resolve();
export function submit(type, fn, projectId = null, sceneId = null, params = {}) {
  const j = { id: newId("jb"), projectId, sceneId, type, status: "queued", progress: 0, message: "Đang chờ", error: null, result: null, params, createdAt: now(), updatedAt: now(), _cancel: false };
  jobs.set(j.id, j);
  const tick = (p, m) => { j.progress = Math.max(0, Math.min(1, p)); if (m) j.message = m; j.updatedAt = now(); };
  chain = chain.then(async () => {
    if (j._cancel) return;
    j.status = "running"; j.message = "Đang xử lý";
    try {
      j.result = await fn(j, tick);
      Object.assign(j, { status: "done", progress: 1, message: "Hoàn tất" });
    } catch (e) {
      if (j._cancel) Object.assign(j, { status: "cancelled", message: "Đã hủy" });
      else Object.assign(j, { status: "failed", message: "Lỗi", error: String(e?.message || e).slice(0, 1000) });
      console.error(e);
    }
    j.updatedAt = now();
  });
  return pub(j);
}
const pub = (j) => Object.fromEntries(Object.entries(j).filter(([k]) => !k.startsWith("_")));
const checkCancel = (j) => { if (j._cancel) throw new Error("Đã hủy"); };

// ---------- dự án ----------
export async function getProject(pid) {
  if (!validId(pid, "pj")) return null;
  const p = await db.get("projects", pid);
  if (!p) return null;
  const binds = (await db.all("sceneAudio")).filter((b) => b.project_id === pid);
  const m = new Map(binds.map((b) => [`${b.scene_id}|${b.mode}`, b]));
  for (const s of p.scenes) {
    const b = s.audioMode !== "none" ? m.get(`${s.id}|${s.audioMode}`) : null;
    s.audioAssetId = b?.asset_id || null;
    s.audioDurationMs = b?.duration_ms ?? null;
    s.audioInfo = b?.info ? JSON.parse(b.info) : null;
    s.audioStale = s.audioMode === "tts";
    s.spokenText = "Văn bản đọc dùng cho giọng AI — chỉ tạo được trong PNS Engine trên máy cá nhân.";
    s.wordCount = (s.scriptOriginal.match(/[\p{L}\p{N}]+/gu) || []).length;
  }
  return p;
}

function cleanScene(s) {
  if (!s || typeof s !== "object") throw bad("Cảnh không hợp lệ");
  const caps = (Array.isArray(s.captions) ? s.captions : []).slice(0, 500)
    .map((c) => ({ startMs: Math.round(+c.startMs), endMs: Math.round(+c.endMs), text: str(c.text, 500) }))
    .filter((c) => Number.isFinite(c.startMs) && Number.isFinite(c.endMs) && 0 <= c.startMs && c.startMs < c.endMs);
  return {
    id: validId(s.id, "sc") ? s.id : newId("sc"), title: str(s.title, 200) || "Cảnh mới",
    slideAssetId: validId(s.slideAssetId, "as") ? s.slideAssetId : null,
    sourcePage: Number.isInteger(s.sourcePage) ? s.sourcePage : null,
    scriptOriginal: str(s.scriptOriginal, 20000), scriptSpoken: str(s.scriptSpoken, 20000), spokenOverride: !!s.spokenOverride,
    sourceNotes: str(s.sourceNotes, 5000), needsVerification: !!s.needsVerification,
    audioMode: MODES.has(s.audioMode) ? s.audioMode : "none", voiceId: validId(s.voiceId, "vc") ? s.voiceId : null,
    silentDurationMs: Math.max(1000, Math.min(600000, Math.round(+s.silentDurationMs || 5000))),
    captions: caps, captionsEdited: !!s.captionsEdited && caps.length > 0,
    status: ["draft", "review", "approved"].includes(s.status) ? s.status : "draft", excluded: !!s.excluded,
  };
}

function cleanBody(b) {
  if (!Array.isArray(b.scenes || []) || (b.scenes || []).length > MAX_SCENES) throw bad(`Danh sách cảnh không hợp lệ (tối đa ${MAX_SCENES})`);
  const scenes = (b.scenes || []).map(cleanScene);
  if (new Set(scenes.map((s) => s.id)).size !== scenes.length) throw bad("Trùng ID cảnh");
  const c = b.course || {}, l = b.links || {};
  return {
    title: str(b.title, 200).trim() || "Dự án chưa đặt tên",
    status: ["draft", "review", "approved", "published"].includes(b.status) ? b.status : "draft",
    description: str(b.description, 2000),
    course: { course: str(c.course, 200), chapter: str(c.chapter, 200), lesson: str(c.lesson, 200) },
    links: { pndSource: url(l.pndSource), pnlTarget: url(l.pnlTarget) },
    tags: (b.tags || []).filter((t) => typeof t === "string").slice(0, 20).map((t) => t.slice(0, 40)),
    scenes,
  };
}

async function createProject(b) {
  const kind = ["lecture", "video", "audio", "image", "podcast", "other"].includes(b.kind) ? b.kind : "lecture";
  const p = { id: newId("pj"), kind, archived: false, revision: 1, schemaVersion: SCHEMA, ownerId: "browser", createdAt: now(), updatedAt: now(), ...cleanBody(b) };
  await db.put("projects", p);
  return getProject(p.id);
}

export async function saveProject(pid, b, rev) {
  const cur = await db.get("projects", pid);
  if (!cur) throw nf("Không tìm thấy dự án");
  if (Number.isInteger(rev) && rev !== cur.revision) throw new HttpError("Dự án đã được thay đổi ở nơi khác. Tải lại để tiếp tục.", 409);
  await db.put("projects", { ...cur, ...cleanBody(b), revision: cur.revision + 1, updatedAt: now() });
  return getProject(pid);
}

async function bind(pid, sid, mode, aid, dur, info) {
  await db.put("sceneAudio", { key: `${pid}|${sid}|${mode}`, project_id: pid, scene_id: sid, mode, asset_id: aid, duration_ms: dur, spoken_hash: null, info: JSON.stringify(info || {}) });
}

async function deleteProject(pid) {
  for (const b of (await db.all("sceneAudio")).filter((b) => b.project_id === pid)) await db.del("sceneAudio", b.key);
  for (const r of (await db.all("renders")).filter((r) => r.projectId === pid)) await deleteRender(r.id);
  await (await import("./studios.js")).onDeleteProject(pid);
  await db.del("projects", pid);
}

// ---------- tài sản ----------
export async function addAsset(blob, kind, name, mime, meta, thumb) {
  const id = newId("as");
  const buf = await blob.arrayBuffer();
  const rec = { id, kind, name: str(name, 200), mime, file: `file${extOf(name) || ".bin"}`, sha256: await sha(buf), size: blob.size, meta: meta || {}, created_at: now() };
  await db.put("blobs", new Blob([buf], { type: mime }), `a:${id}`);
  if (thumb) await db.put("blobs", thumb, `t:${id}`);
  await db.put("assets", rec);
  return rec;
}

async function deleteAsset(id) {
  await db.del("blobs", `a:${id}`); await db.del("blobs", `t:${id}`); await db.del("assets", id);
}

async function assetUsage(id) {
  const used = new Set();
  for (const p of await db.all("projects")) if (JSON.stringify(p).includes(id)) used.add(p.id);
  for (const b of await db.all("sceneAudio")) if (b.asset_id === id) used.add(b.project_id);
  for (const pid of await (await import("./studios.js")).usedBy(id)) used.add(pid);
  return [...used];
}

export function canvasBlob(c, type = "image/jpeg", q = 0.82) { return new Promise((r) => c.toBlob(r, type, q)); }

export async function thumbFrom(source, w, h) {
  const c = document.createElement("canvas");
  c.width = 360; c.height = Math.max(1, Math.round((h / w) * 360));
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return canvasBlob(c);
}

let pdfjsP = null;
function pdfjs() {
  pdfjsP ||= import("../../vendor/pdfjs/pdf.min.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
    return m;
  });
  return pdfjsP;
}

async function renderPdfPage(doc, n, boxW, boxH) {
  const page = await doc.getPage(n);
  const v0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(boxW / v0.width, boxH / v0.height) });
  const c = document.createElement("canvas");
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return c;
}

// Âm thanh: giải mã → 48 kHz mono → chuẩn hóa mức (RMS ≈ −20 dBFS, đỉnh ≤ −1 dBFS) → WAV 16-bit
async function normalizeAudio(blob) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  let buf;
  try { buf = await ac.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw bad("Không giải mã được file âm thanh (định dạng hỏng hoặc trình duyệt không hỗ trợ)"); }
  finally { ac.close(); }
  if (buf.duration < 0.2) throw bad("File âm thanh quá ngắn hoặc không có tín hiệu");
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 48000), 48000);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const out = (await off.startRendering()).getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]); if (v > peak) peak = v; sum += v * v; }
  const rms = Math.sqrt(sum / out.length);
  const gain = peak > 0 ? Math.min(0.1 / Math.max(rms, 1e-6), 0.891 / peak) : 1;
  return { wav: encodeWav(out, 48000, gain), durationMs: Math.round(buf.duration * 1000) };
}

function encodeWav(samples, rate, gain = 1) {
  const n = samples.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i] * gain)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([b], { type: "audio/wav" });
}

const IMAGE = [".png", ".jpg", ".jpeg", ".webp"], AUDIO = [".wav", ".m4a", ".mp3", ".aac", ".ogg", ".flac", ".webm"], VIDEO = [".mp4", ".mov", ".webm", ".mkv"];

async function ingest(file) {
  if (!file?.size) throw bad("File rỗng");
  if (file.size > LIMIT_MB * 1048576) throw bad(`File vượt giới hạn ${LIMIT_MB} MB`);
  const ext = extOf(file.name), name = file.name.split(/[\\/]/).pop();
  if (ext === ".pdf") {
    const head = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
    if (!head.trimStart().startsWith("%PDF-")) throw bad("File không phải PDF hợp lệ");
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const c = await renderPdfPage(doc, 1, 720, 720);
    const pages = doc.numPages; await doc.destroy();
    return addAsset(file, "pdf", name, "application/pdf", { pages }, await thumbFrom(c, c.width, c.height));
  }
  if (IMAGE.includes(ext)) {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { throw bad("File ảnh không hợp lệ"); }
    const t = await thumbFrom(bmp, bmp.width, bmp.height);
    return addAsset(file, "image", name, file.type || "image/png", { width: bmp.width, height: bmp.height, rights: "" }, t);
  }
  if (AUDIO.includes(ext) && !(ext === ".webm" && file.type.startsWith("video"))) {
    const { wav, durationMs } = await normalizeAudio(file);
    return addAsset(wav, "audio", name, "audio/wav", { durationMs, original: ext, normalized: "RMS −20 dBFS, đỉnh ≤ −1 dBFS (trình duyệt)" });
  }
  if (VIDEO.includes(ext)) {
    const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.src = URL.createObjectURL(file);
    try {
      await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(bad("File video không phát được trên trình duyệt này")); });
      v.currentTime = Math.min(0.5, v.duration / 2); await new Promise((r) => (v.onseeked = r));
      const t = await thumbFrom(v, v.videoWidth, v.videoHeight);
      return addAsset(file, "video", name, file.type || "video/mp4", { durationMs: Math.round(v.duration * 1000) }, t);
    } finally { URL.revokeObjectURL(v.src); }
  }
  if ([".pptx", ".ppt", ".odp"].includes(ext)) throw bad("Chế độ trình duyệt chưa đọc được PPTX. Hãy xuất PDF từ PowerPoint (File → Save As → PDF) rồi tải PDF lên.");
  throw bad("Định dạng chưa hỗ trợ. Chấp nhận: PDF, PNG/JPG/WEBP, WAV/M4A/MP3/OGG/FLAC/WEBM, MP4");
}

async function importSlides(pid, assetId, replace) {
  const a = await db.get("assets", assetId);
  if (!a || a.kind !== "pdf") throw bad("Chế độ trình duyệt nhập slide từ PDF (PPTX hãy xuất PDF trước)");
  if (!(await getProject(pid))) throw nf("Không tìm thấy dự án");
  return submit("import-slides", async (j, tick) => {
    const lib = await pdfjs();
    const blob = await db.get("blobs", `a:${assetId}`);
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const n = doc.numPages, scenes = [];
    try {
      if (n > 300) throw bad(`PDF có ${n} trang, vượt giới hạn 300`);
      for (let i = 1; i <= n; i++) {
        checkCancel(j);
        tick((i - 1) / n, `Kết xuất trang ${i}/${n}`);
        const c = await renderPdfPage(doc, i, 1920, 1080);
        const png = await canvasBlob(c, "image/png");
        const s = await addAsset(png, "slide", `${a.name} – trang ${i}`, "image/png", { width: c.width, height: c.height, page: i, sourceAssetId: assetId }, await thumbFrom(c, c.width, c.height));
        scenes.push({ title: `Trang ${i}`, slideAssetId: s.id, sourcePage: i });
      }
    } finally { await doc.destroy(); }
    const p = await getProject(pid);
    const base = replace ? [] : p.scenes;
    if (base.length + scenes.length > MAX_SCENES) throw bad(`Vượt giới hạn ${MAX_SCENES} cảnh`);
    await saveProject(pid, { ...p, scenes: [...base, ...scenes] });
    return { pages: n, slides: scenes.map((s) => s.slideAssetId) };
  }, pid, null, { assetId });
}

// ---------- kết xuất (ffmpeg.wasm) ----------
let ff = null;
export async function ffmpeg(onLog) {
  if (ff) return ff;
  const { FFmpeg } = await import("../../vendor/ffmpeg/index.js");
  const f = new FFmpeg();
  const base = new URL("../../vendor/ffmpeg-core/", import.meta.url).href;
  await f.load({ coreURL: base + "ffmpeg-core.js", wasmURL: base + "ffmpeg-core.wasm" });
  f.on("log", ({ message }) => onLog?.(message));
  ff = f;
  return f;
}

export async function run(f, j, args) {
  checkCancel(j);
  const code = await f.exec(args);
  checkCancel(j);
  if (code !== 0) throw new Error(`ffmpeg.wasm lỗi (mã ${code})`);
}

const frameMs = (ms) => Math.ceil(ms / (1000 / FPS)) * (1000 / FPS);

export function autoCaptions(text, audioMs) {
  const sents = splitSentences(text);
  if (!sents.length || audioMs <= 0) return [];
  const total = sents.reduce((a, s) => a + s.length, 0);
  let t = LEAD; const out = [];
  for (const s of sents) { const d = Math.floor((audioMs * s.length) / total); out.push({ startMs: t, endMs: t + d, text: s }); t += d; }
  out[out.length - 1].endMs = LEAD + audioMs;
  return out;
}

function splitSentences(text) {
  const out = [];
  for (let p of text.split(/(?<=[.!?…;:])\s+|\n+/).map((x) => x.trim()).filter(Boolean)) {
    while (p.length > 110) {
      let cut = p.lastIndexOf(", ", 110); if (cut < 40) cut = p.lastIndexOf(" ", 110);
      if (cut < 40) break;
      out.push(p.slice(0, cut + 1).trim()); p = p.slice(cut + 1).trim();
    }
    if (p) out.push(p);
  }
  return out;
}

const ts = (ms) => { ms = Math.max(0, ms); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
const buildSrt = (cues) => cues.map((c, i) => `${i + 1}\n${ts(c.startMs)} --> ${ts(c.endMs)}\n${c.text.trim()}\n`).join("\n");

async function composeFrame(slideBlob, title, W, H) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  if (slideBlob) {
    const im = await createImageBitmap(slideBlob);
    const s = Math.min(W / im.width, H / im.height), w = Math.round(im.width * s), h = Math.round(im.height * s);
    g.imageSmoothingQuality = "high"; g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  } else {
    g.fillStyle = "#102c43"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#c4a578"; g.fillRect(W * 0.08, H * 0.62, W * 0.12, 6);
    g.fillStyle = "#fff"; g.font = `${Math.round(H * 0.06)}px "Segoe UI", Arial, sans-serif`;
    const words = (title || "").split(/\s+/); let line = "", y = H * 0.42; const lines = [];
    for (const w of words) { if ((line + " " + w).length > 38 && line) { lines.push(line); line = w; } else line = (line + " " + w).trim(); }
    if (line) lines.push(line);
    lines.slice(0, 4).forEach((l, i) => g.fillText(l, W * 0.08, y + i * H * 0.075));
  }
  return new Uint8Array(await (await canvasBlob(c, "image/png")).arrayBuffer());
}

async function renderProject(pid, quality) {
  const q = QUALITY[quality];
  if (!q) throw bad("Chất lượng không hợp lệ");
  if (!(await getProject(pid))) throw nf("Không tìm thấy dự án");
  return submit("render", async (j, tick) => {
    const p = await getProject(pid);
    const scenes = p.scenes.filter((s) => !s.excluded);
    if (!scenes.length) throw bad("Dự án chưa có cảnh nào để kết xuất");
    const tts = scenes.find((s) => s.audioMode === "tts");
    if (tts) throw bad(`Cảnh «${tts.title}» dùng giọng AI — chỉ kết xuất được trong PNS Engine. Hãy chuyển sang Giọng thật/Không lời, hoặc sao lưu dự án và mở bằng PNS Engine.`);
    tick(0.02, "Nạp ffmpeg.wasm (lần đầu tải khoảng 32 MB)");
    const f = await ffmpeg();
    const n = scenes.length; const clips = []; const cues = []; const timeline = []; let offset = 0, reused = 0;
    for (let i = 0; i < n; i++) {
      const s = scenes[i];
      tick(0.05 + (0.85 * i) / n, `Kết xuất cảnh ${i + 1}/${n}`);
      const slideRec = s.slideAssetId ? await db.get("assets", s.slideAssetId) : null;
      const audioRec = s.audioMode === "recorded" && s.audioAssetId ? await db.get("assets", s.audioAssetId) : null;
      if (s.audioMode === "recorded" && !audioRec) throw bad(`Cảnh ${i + 1} «${s.title}» chọn giọng thật nhưng chưa có bản thu`);
      const audioMs = audioRec ? audioRec.meta.durationMs : 0;
      const dur = audioRec ? frameMs(LEAD + audioMs + TAIL) : frameMs(s.silentDurationMs || 5000);
      const key = await sha([RENDER_TAG, quality, slideRec?.sha256 || "title:" + s.title, audioRec?.sha256 || "silence", dur].join("\x1f"));
      let clip = await db.get("blobs", `c:${key}`);
      const cached = !!clip;
      if (cached) reused++;
      else {
        await f.writeFile("frame.png", await composeFrame(slideRec ? await db.get("blobs", `a:${slideRec.id}`) : null, s.title, q.w, q.h));
        const args = ["-y", "-loop", "1", "-framerate", String(FPS), "-i", "frame.png"];
        let af;
        if (audioRec) {
          await f.writeFile("audio.wav", new Uint8Array(await (await db.get("blobs", `a:${audioRec.id}`)).arrayBuffer()));
          args.push("-i", "audio.wav");
          af = `[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${LEAD}|${LEAD},apad[a]`;
        } else { args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"); af = "[1:a]anull[a]"; }
        args.push("-filter_complex", af, "-map", "0:v", "-map", "[a]", "-t", (dur / 1000).toFixed(3),
          "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", q.crf, "-pix_fmt", "yuv420p",
          "-r", String(FPS), "-g", String(FPS * 2), "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "clip.mp4");
        await run(f, j, args);
        clip = new Blob([await f.readFile("clip.mp4")], { type: "video/mp4" });
        await db.put("blobs", clip, `c:${key}`);
        for (const x of ["frame.png", "audio.wav", "clip.mp4"]) await f.deleteFile(x).catch(() => {});
      }
      clips.push(clip);
      const sc = s.captionsEdited ? s.captions : autoCaptions(s.scriptOriginal, audioRec ? audioMs : Math.max(0, dur - LEAD - TAIL));
      for (const c of sc) { const st = Math.max(0, c.startMs), en = Math.min(dur, c.endMs); if (en > st && c.text.trim()) cues.push({ startMs: offset + st, endMs: offset + en, text: c.text }); }
      timeline.push({ sceneId: s.id, title: s.title, startMs: offset, durationMs: dur, audioMode: s.audioMode, reusedClip: cached });
      offset += dur;
    }
    tick(0.92, "Ghép video");
    const list = [];
    for (let i = 0; i < clips.length; i++) { await f.writeFile(`c${i}.mp4`, new Uint8Array(await clips[i].arrayBuffer())); list.push(`file 'c${i}.mp4'`); }
    await f.writeFile("list.txt", new TextEncoder().encode(list.join("\n")));
    await run(f, j, ["-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "out.mp4"]);
    const mp4 = new Blob([await f.readFile("out.mp4")], { type: "video/mp4" });
    for (let i = 0; i < clips.length; i++) await f.deleteFile(`c${i}.mp4`).catch(() => {});
    await f.deleteFile("list.txt").catch(() => {}); await f.deleteFile("out.mp4").catch(() => {});
    const rid = newId("rd");
    await db.put("blobs", mp4, `r:${rid}:mp4`);
    await db.put("blobs", new Blob([buildSrt(cues)], { type: "application/x-subrip" }), `r:${rid}:srt`);
    const rec = { id: rid, projectId: pid, projectRevision: p.revision, title: p.title, quality, resolution: `${q.w}x${q.h}`,
      durationMs: offset, sceneCount: n, clipsReused: reused, aiNarration: false,
      captionMode: "theo câu, mốc ước lượng theo tỷ lệ ký tự (chưa căn chỉnh từng từ)", timeline,
      createdAt: now(), approval: null, sizeBytes: mp4.size, platform: "browser/ffmpeg.wasm" };
    await db.put("renders", rec);
    return rec;
  }, pid, null, { quality });
}

async function deleteRender(rid) {
  await db.del("blobs", `r:${rid}:mp4`); await db.del("blobs", `r:${rid}:srt`); await db.del("renders", rid);
}

// ---------- sao lưu (.pnsproj, tương thích PNS Engine) ----------
export async function fflate() { return import("../../vendor/fflate/fflate.js"); }

async function exportProject(pid) {
  const p = await getProject(pid);
  if (!p) throw nf("Không tìm thấy dự án");
  const { zipSync, strToU8 } = await fflate();
  const binds = (await db.all("sceneAudio")).filter((b) => b.project_id === pid);
  const ids = new Set([...p.scenes.map((s) => s.slideAssetId).filter(Boolean), ...binds.map((b) => b.asset_id)]);
  const files = {}, assets = [];
  for (const id of ids) {
    const a = await db.get("assets", id), blob = await db.get("blobs", `a:${id}`);
    if (!a || !blob) continue;
    assets.push({ id, kind: a.kind, name: a.name, mime: a.mime, file: a.file, sha256: a.sha256, meta: a.meta });
    files[`assets/${id}/${a.file}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  const project = structuredClone(p);
  for (const s of project.scenes) for (const k of ["audioAssetId", "audioDurationMs", "audioStale", "audioInfo", "spokenText", "wordCount"]) delete s[k];
  delete project.archived;
  const manifest = { format: "pns-project", schemaVersion: SCHEMA, generator: `PNS ${VERSION}`, exportedAt: now(), project,
    sceneAudio: binds.map(({ key, ...b }) => b), assets };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(files)], { type: "application/zip" });
}

async function importProject(file) {
  const { unzipSync, strFromU8 } = await fflate();
  let z;
  try { z = unzipSync(new Uint8Array(await file.arrayBuffer())); } catch { throw bad("Gói dự án không hợp lệ"); }
  if (!z["manifest.json"]) throw bad("Không phải gói dự án PNS");
  const m = JSON.parse(strFromU8(z["manifest.json"]));
  if (m.format !== "pns-project" || typeof m.project !== "object") throw bad("Không phải gói dự án PNS");
  if ((m.schemaVersion || 0) > SCHEMA) throw bad("Gói được tạo bởi phiên bản PNS mới hơn");
  const remap = {};
  for (const a of m.assets || []) {
    if (!validId(a.id, "as") || !/^file\.[a-z0-9]{1,6}$/.test(a.file || "")) continue;
    const data = z[`assets/${a.id}/${a.file}`];
    if (!data) continue;
    const ex = await db.get("assets", a.id);
    if (ex && ex.sha256 === a.sha256) { remap[a.id] = a.id; continue; }
    const kind = ["slide", "image", "audio", "pdf", "video"].includes(a.kind) ? a.kind : "image";
    let thumb = null;
    if (kind === "slide" || kind === "image") { const bmp = await createImageBitmap(new Blob([data])); thumb = await thumbFrom(bmp, bmp.width, bmp.height); }
    const rec = await addAsset(new Blob([data], { type: a.mime }), kind, str(a.name, 200) || a.file, str(a.mime, 80) || "application/octet-stream", typeof a.meta === "object" ? a.meta : {}, thumb);
    remap[a.id] = rec.id;
  }
  const proj = m.project;
  const oldIds = (proj.scenes || []).map((s) => s.id);
  proj.scenes = (proj.scenes || []).map((s) => ({ ...s, id: null, slideAssetId: s.slideAssetId ? remap[s.slideAssetId] || null : null }));
  proj.title = str(proj.title, 180) + " (khôi phục)";
  const np = await createProject(proj);
  const map = Object.fromEntries(oldIds.map((o, i) => [o, np.scenes[i]?.id]));
  for (const b of m.sceneAudio || []) {
    const sid = map[b.scene_id], aid = remap[b.asset_id];
    if (sid && aid && b.mode === "recorded") await bind(np.id, sid, "recorded", aid, +b.duration_ms || 0, JSON.parse(b.info || "{}"));
  }
  return getProject(np.id);
}

async function publishPackage(pid, rid) {
  const r = await db.get("renders", rid), p = await getProject(pid);
  if (!r || !p || r.projectId !== pid) throw nf("Không tìm thấy bản kết xuất");
  if (!r.approval) throw bad("Bản kết xuất chưa được duyệt");
  const { zipSync, strToU8 } = await fflate();
  const pubj = { schemaVersion: SCHEMA, generator: `PNS ${VERSION}`, projectId: pid, projectTitle: p.title, course: p.course,
    revision: r.projectRevision, renderId: rid, videoPath: "lecture.mp4", captionPath: "lecture.srt", durationMs: r.durationMs,
    resolution: r.resolution, approvedBy: r.approval.approvedBy, approvedAt: r.approval.approvedAt, aiNarration: r.aiNarration,
    captionMode: r.captionMode, sources: p.scenes.filter((s) => s.sourceNotes).map((s) => ({ scene: s.title, notes: s.sourceNotes })),
    target: { pnlTarget: p.links.pnlTarget, pndSource: p.links.pndSource },
    visibility: "Chưa công khai — người quản trị PNL/PND tải lên thủ công sau khi duyệt" };
  return new Blob([zipSync({
    "lecture.mp4": [new Uint8Array(await (await db.get("blobs", `r:${rid}:mp4`)).arrayBuffer()), { level: 0 }],
    "lecture.srt": new Uint8Array(await (await db.get("blobs", `r:${rid}:srt`)).arrayBuffer()),
    "publication.json": strToU8(JSON.stringify(pubj, null, 2)),
  })], { type: "application/zip" });
}

// ---------- bộ định tuyến API ----------
async function usage() {
  const assets = (await db.all("assets")).reduce((a, x) => a + x.size, 0);
  const renders = (await db.all("renders")).reduce((a, x) => a + x.sizeBytes, 0);
  const est = (await navigator.storage?.estimate?.()) || {};
  return { assets, voices: 0, cache: Math.max(0, (est.usage || 0) - assets - renders), renders,
    diskFree: Math.max(0, (est.quota || 0) - (est.usage || 0)), dataDir: "Bộ nhớ trình duyệt (IndexedDB) trên máy này" };
}

const health = () => ({ app: "Phuc Nguyen Studio (trình duyệt)", mode: "browser", version: VERSION, schemaVersion: SCHEMA,
  ffmpeg: "ffmpeg.wasm 0.12 (GPL)", libreoffice: false, dataDir: "IndexedDB",
  tts: { installed: false, browser: true, engine: "VieNeu-TTS", license: "Chỉ có trong PNS Engine trên máy cá nhân", config: {} } });

const listProjects = async (q) => {
  const ps = await db.all("projects");
  const s = (q.get("q") || "").toLowerCase(), arch = q.get("archived") === "true";
  return ps.filter((p) => p.archived === arch && (!s || p.title.toLowerCase().includes(s)) && (!q.get("kind") || p.kind === q.get("kind")) && (!q.get("status") || p.status === q.get("status")))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({ id: p.id, title: p.title, kind: p.kind, status: p.status, archived: p.archived, revision: p.revision, updatedAt: p.updatedAt,
      createdAt: p.createdAt, sceneCount: p.scenes.length, course: p.course, cover: p.scenes.find((s) => s.slideAssetId)?.slideAssetId || null }));
};

export async function handle(method, rawUrl, body) {
  const u = new URL(rawUrl, "http://x/"), q = u.searchParams;
  const parts = u.pathname.replace(/^\/?(api\/)?/, "").split("/").filter(Boolean);
  const [r0, r1, r2, r3, r4, r5] = parts;
  const M = method;
  const studio = await (await import("./studios.js")).handle(M, parts, q, body);   // Image/Audio/Content/Podcast/Interactive
  if (studio !== undefined) return studio;

  if (r0 === "health") return health();
  if (r0 === "dashboard") {
    const ps = await listProjects(new URLSearchParams());
    const js = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(pub);
    return { recent: ps.slice(0, 8), jobs: js.slice(0, 12), activeJobs: js.filter((j) => ["queued", "running"].includes(j.status)), usage: await usage(),
      counts: { projects: ps.length, assets: (await db.keys("assets")).length, voices: 0 } };
  }
  if (r0 === "settings") {
    if (M === "PUT") await db.put("kv", { pnlUrl: url(body?.app?.pnlUrl), pndUrl: url(body?.app?.pndUrl) }, "app");
    return { app: { pnlUrl: "", pndUrl: "", ...((await db.get("kv", "app")) || {}) }, tts: {}, limits: { maxUploadMB: LIMIT_MB, maxPdfPages: 300, maxScenes: MAX_SCENES } };
  }
  if (r0 === "voices") return { voices: [], engine: health().tts };
  if (r0 === "jobs") {
    if (!r1) return [...jobs.values()].filter((j) => !q.get("projectId") || j.projectId === q.get("projectId")).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map(pub);
    const j = jobs.get(r1); if (!j) throw nf();
    if (r2 === "cancel") {
      if (!["queued", "running"].includes(j.status)) return { cancelled: false };
      j._cancel = true;
      if (j.status === "queued") Object.assign(j, { status: "cancelled", message: "Đã hủy" });
      if (j.type === "render" && ff) { ff.terminate(); ff = null; }
      return { cancelled: true };
    }
    return pub(j);
  }

  if (r0 === "assets") {
    if (!r1) {
      if (M === "POST") return ingest(body.file);
      const all = await db.all("assets"), s = (q.get("q") || "").toLowerCase();
      return all.filter((a) => (!q.get("kind") || a.kind === q.get("kind")) && (!s || a.name.toLowerCase().includes(s))).sort((a, b) => b.created_at - a.created_at);
    }
    const a = await db.get("assets", r1); if (!a) throw nf();
    if (r2 === "usage") return { projects: await assetUsage(r1) };
    if (M === "PATCH") { for (const k of ["rights", "note"]) if (k in body) a.meta[k] = String(body[k]).slice(0, 1000); await db.put("assets", a); return a; }
    if (M === "DELETE") { const u2 = await assetUsage(r1); if (u2.length) throw new HttpError(`Tài sản đang được dùng trong ${u2.length} dự án`, 409); await deleteAsset(r1); return { ok: true }; }
    return a;
  }

  if (r0 === "projects") {
    if (!r1) return M === "POST" ? createProject(body) : listProjects(q);
    if (r1 === "import") return importProject(body.file);
    const p = await getProject(r1); if (!p) throw nf("Không tìm thấy dự án");
    if (!r2) {
      if (M === "PUT") return saveProject(r1, body, body.revision);
      if (M === "DELETE") { if (q.get("confirm") !== r1) throw new HttpError("Thiếu xác nhận xóa", 400); await deleteProject(r1); return { ok: true }; }
      return p;
    }
    if (r2 === "duplicate") {
      const np = await createProject({ ...p, title: p.title + " (bản sao)", scenes: p.scenes.map((s) => ({ ...s, id: null })) });
      for (let i = 0; i < p.scenes.length; i++)
        for (const b of (await db.all("sceneAudio")).filter((b) => b.project_id === r1 && b.scene_id === p.scenes[i].id))
          await bind(np.id, np.scenes[i].id, b.mode, b.asset_id, b.duration_ms, JSON.parse(b.info || "{}"));
      return getProject(np.id);
    }
    if (r2 === "archive") { const raw = await db.get("projects", r1); raw.archived = body?.archived !== false; raw.updatedAt = now(); await db.put("projects", raw); return { ok: true }; }
    if (r2 === "export") return exportProject(r1);
    if (r2 === "import-slides") return importSlides(r1, body.assetId, !!body.replace);
    if (r2 === "render") return renderProject(r1, body?.quality || "preview");
    if (r2 === "scenes") {
      const sc = p.scenes.find((s) => s.id === r3); if (!sc) throw nf("Không tìm thấy cảnh (hãy lưu dự án trước)");
      if (r4 === "audio" && M === "POST") {
        const a = await db.get("assets", body.assetId);
        if (!a || a.kind !== "audio") throw bad("Chọn file âm thanh trong thư viện");
        await bind(r1, r3, "recorded", a.id, a.meta.durationMs || 0, { source: a.name });
        return getProject(r1);
      }
      if (r4 === "audio" && M === "DELETE") { await db.del("sceneAudio", `${r1}|${r3}|${r5}`); return getProject(r1); }
      if (r4 === "tts") throw bad("Giọng AI cá nhân chỉ chạy trong PNS Engine trên máy Windows. Ở chế độ trình duyệt hãy dùng Giọng thật.");
      if (r4 === "captions-auto") return autoCaptions(sc.scriptOriginal, sc.audioDurationMs || Math.max(1000, sc.silentDurationMs - 850));
    }
    if (r2 === "renders") {
      if (!r3) return (await db.all("renders")).filter((r) => r.projectId === r1).sort((a, b) => b.createdAt - a.createdAt);
      const r = await db.get("renders", r3); if (!r || r.projectId !== r1) throw nf("Không tìm thấy bản kết xuất");
      if (M === "DELETE") { await deleteRender(r3); return { ok: true }; }
      if (r4 === "approval") {
        if (body.approved && r.quality !== "final") throw bad("Chỉ duyệt bản 1080p (final), không duyệt bản xem trước 720p");
        r.approval = body.approved ? { approvedBy: str(body.approver, 120) || "chủ sở hữu", approvedAt: now(), note: str(body.note, 1000) } : null;
        await db.put("renders", r); return r;
      }
      if (r4 === "package") return publishPackage(r1, r3);
    }
  }
  if (r0 === "dictionary") return [];
  throw nf("Chức năng chưa có ở chế độ trình duyệt");
}
