// Image, Audio, Content, Podcast, Interactive Studio ở chế độ trình duyệt — cùng hợp đồng API với PNS Engine
// (engine/pns_engine/studios.py). Ảnh bằng canvas, âm thanh/podcast bằng ffmpeg.wasm, dữ liệu ở IndexedDB.
import * as db from "./db.js";
import { addAsset, getProject, saveProject, submit, ffmpeg, run, thumbFrom, canvasBlob, fflate, HttpError, newId,
  VERSION, SCHEMA, MAX_SCENES } from "./backend.js";
import { parseScript, mergeScript, contentCheck, exportScript } from "./content.js";

const nf = (m = "Không tìm thấy") => new HttpError(m, 404);
const bad = (m) => new HttpError(m, 422);
const str = (v, n) => (typeof v === "string" ? v.slice(0, n).trim() : "");
const int = (v, lo, hi, d) => { const x = parseInt(v, 10); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const num = (v, lo, hi, d) => { const x = parseFloat(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
const https = (v) => { v = str(v, 500); return /^https:\/\/[^\s<>"']+$/.test(v) ? v : ""; };
const now = () => Date.now();
const kvGet = async (k, d) => (await db.get("kv", k)) ?? d;
const blobOf = (id) => db.get("blobs", `a:${id}`);

// =================== IMAGE ===================
const ASPECTS = { "16:9": [16, 9], "4:3": [4, 3], "1:1": [1, 1], "4:5": [4, 5], "9:16": [9, 16] };
const COVER = { "16:9": [1920, 1080], "1:1": [1080, 1080], "9:16": [1080, 1920] };
const NAVY = "#102c43", NAVY2 = "#1f4a6c", GOLD = "#c4a578";
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

export function cropBox(w, h, aspect, cx, cy, zoom) {
  let cw = w, ch = h;
  if (ASPECTS[aspect]) { const [rw, rh] = ASPECTS[aspect]; if (w * rh / rw <= h) { cw = w; ch = w * rh / rw; } else { cw = h * rw / rh; ch = h; } }
  cw = Math.max(1, Math.round(cw / zoom)); ch = Math.max(1, Math.round(ch / zoom));
  const x = Math.round(Math.min(Math.max(cx * w - cw / 2, 0), w - cw)), y = Math.round(Math.min(Math.max(cy * h - ch / 2, 0), h - ch));
  return [x, y, cw, ch];
}

async function bitmapOf(id) {
  const a = await db.get("assets", id);
  if (!a || !["image", "slide"].includes(a.kind)) return [null, null];
  return [a, await createImageBitmap(await blobOf(id), { imageOrientation: "from-image" })];
}

async function saveImage(canvas, fmt, name, meta) {
  const jpg = fmt === "jpg";
  const blob = await canvasBlob(canvas, jpg ? "image/jpeg" : "image/png", 0.9);
  const stem = (name.replace(/\.[A-Za-z0-9]{1,5}$/, "").slice(0, 150)) || "anh";
  return addAsset(blob, "image", stem + (jpg ? ".jpg" : ".png"), jpg ? "image/jpeg" : "image/png",
    { width: canvas.width, height: canvas.height, ...meta }, await thumbFrom(canvas, canvas.width, canvas.height));
}

function canvas(w, h, bg) { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); } return [c, x]; }

async function imageTransform(b) {
  const [a, bmp] = await bitmapOf(String(b.assetId || ""));
  if (!a) throw bad("Chọn ảnh hoặc slide trong thư viện");
  const aspect = b.aspect in ASPECTS || b.aspect === "original" ? b.aspect : "original";
  const cx = num(b.cx, 0, 1, 0.5), cy = num(b.cy, 0, 1, 0.5), zoom = num(b.zoom, 1, 5, 1), width = int(b.width, 0, 4096, 0);
  const rotate = Math.floor(int(b.rotate, 0, 270, 0) / 90) * 90, fmt = b.format === "jpg" ? "jpg" : "png";
  const rw = rotate % 180 ? bmp.height : bmp.width, rh = rotate % 180 ? bmp.width : bmp.height;
  const [rc, rx] = canvas(rw, rh, "#fff");
  rx.translate(rw / 2, rh / 2); rx.rotate(rotate * Math.PI / 180); if (b.flip) rx.scale(-1, 1);
  rx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  let [x, y, cw, ch] = aspect !== "original" || zoom > 1 ? cropBox(rw, rh, aspect, cx, cy, zoom) : [0, 0, rw, rh];
  const ow = width || cw, oh = Math.max(1, Math.round(ch * ow / cw));
  const [oc, ox] = canvas(ow, oh);
  ox.imageSmoothingQuality = "high"; ox.drawImage(rc, x, y, cw, ch, 0, 0, ow, oh);
  const base = a.name.replace(/\.[^.]+$/, "");
  return saveImage(oc, fmt, str(b.name, 150) || `${base} (${aspect !== "original" ? aspect : "chỉnh"})`, {
    rights: a.meta.rights || "", derivedFrom: a.id, edit: { aspect, cx, cy, zoom, width, rotate, flip: !!b.flip } });
}

function wrap(x, text, maxW, maxLines) {
  const lines = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? `${cur} ${w}` : w;
      if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let l = lines[maxLines - 1];
    while (l && x.measureText(l + "…").width > maxW) l = l.slice(0, -1);
    lines[maxLines - 1] = l.trimEnd() + "…";
  }
  return lines;
}

async function imageCover(b) {
  const title = str(b.title, 160);
  if (!title) throw bad("Nhập tiêu đề ảnh bìa");
  const size = b.size in COVER ? b.size : "16:9", tpl = ["navy", "light", "photo"].includes(b.template) ? b.template : "navy";
  const [W, H] = COVER[size];
  const [c, x] = canvas(W, H, tpl === "light" ? "#fff" : NAVY);
  if (tpl === "photo") {
    const [a, bmp] = typeof b.bgAssetId === "string" ? await bitmapOf(b.bgAssetId) : [null, null];
    if (!a) throw bad("Mẫu ảnh nền cần chọn một ảnh trong thư viện");
    const [sx, sy, sw, sh] = cropBox(bmp.width, bmp.height, size, 0.5, 0.5, 1);
    x.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
    const g = W >= H ? x.createLinearGradient(0, 0, W, 0) : x.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, "rgba(16,44,67,.92)"); g.addColorStop(W >= H ? 0.87 : 0.71, "rgba(16,44,67,0)");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  const unit = Math.min(W, H), m = Math.round(unit * 0.08);
  if (tpl === "light") { x.fillStyle = NAVY; x.fillRect(0, 0, Math.round(W * 0.018), H); }
  if (tpl === "navy") {
    x.fillStyle = NAVY2;
    if (W > H) x.fillRect(W - Math.round(W * 0.3), 0, W, H);
    else { x.fillRect(0, 0, W, Math.round(H * 0.14)); x.fillStyle = GOLD; x.fillRect(0, Math.round(H * 0.14), W, Math.max(4, W / 180)); }
  }
  const ink = tpl === "light" ? NAVY : "#fff", sub = tpl === "light" ? NAVY2 : "#dbe6ef";
  const textW = W > H && tpl !== "light" ? W * 0.62 : W - 2 * m;
  let y = Math.round(H * (W > H ? 0.18 : W === H ? 0.22 : 0.2));
  x.textBaseline = "top";
  const eyebrow = str(b.eyebrow, 80), subtitle = str(b.subtitle, 200), author = str(b.author, 120), org = str(b.org, 160);
  if (eyebrow) { x.font = `700 ${Math.round(unit * 0.034)}px ${FONT}`; x.fillStyle = GOLD; x.fillText(eyebrow.toUpperCase(), m, y); y += Math.round(unit * 0.07); }
  const ts = Math.round(unit * (title.length < 50 ? 0.075 : 0.06));
  x.font = `700 ${ts}px ${FONT}`; x.fillStyle = ink;
  for (const l of wrap(x, title, textW, 4)) { x.fillText(l, m, y); y += Math.round(ts * 1.22); }
  y += Math.round(unit * 0.025);
  x.fillStyle = GOLD; x.fillRect(m, y, Math.round(unit * 0.11), Math.max(4, Math.round(unit / 180)));
  y += Math.round(unit * 0.05);
  if (subtitle) { const s = Math.round(unit * 0.036); x.font = `400 ${s}px ${FONT}`; x.fillStyle = sub; for (const l of wrap(x, subtitle, textW, 3)) { x.fillText(l, m, y); y += Math.round(s * 1.35); } }
  const fs = Math.round(unit * 0.028); x.font = `400 ${fs}px ${FONT}`;
  let fy = H - m - Math.round(fs * (author && org ? 2.6 : 1.2));
  for (const [line, col] of [[author, GOLD], [org, sub]]) if (line) { x.fillStyle = col; x.fillText(wrap(x, line, W - 2 * m, 1)[0], m, fy); fy += Math.round(fs * 1.4); }
  return saveImage(c, b.format === "jpg" ? "jpg" : "png", str(b.name, 150) || `Ảnh bìa – ${title.slice(0, 60)}`, {
    rights: "Ảnh bìa tạo bằng PNS" + (tpl === "photo" ? `; ảnh nền: ${b.bgAssetId}` : ""), cover: { template: tpl, size, title } });
}

// =================== AUDIO ===================
async function peaks(id, n) {
  const a = await db.get("assets", id);
  if (!a || a.kind !== "audio") throw nf("Không tìm thấy file âm thanh");
  n = Math.max(50, Math.min(4000, n || 800));
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  let buf;
  try { buf = await ac.decodeAudioData(await (await blobOf(id)).arrayBuffer()); } finally { ac.close(); }
  const d = buf.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), out = [];
  for (let i = 0; i < n; i++) { let mx = 0; for (let k = i * step, e = Math.min(d.length, k + step); k < e; k++) { const v = Math.abs(d[k]); if (v > mx) mx = v; } out.push(Math.round(mx * 1000) / 1000); }
  return { durationMs: a.meta.durationMs || Math.round(buf.duration * 1000), peaks: out };
}

async function cleanSegments(segs) {
  if (!Array.isArray(segs) || !segs.length) throw bad("Thêm ít nhất một đoạn âm thanh");
  if (segs.length > 100) throw bad("Tối đa 100 đoạn");
  const out = [];
  for (const [i, s] of segs.entries()) {
    const a = await db.get("assets", String(s?.assetId || ""));
    if (!a || a.kind !== "audio") throw bad(`Đoạn ${i + 1}: chưa chọn file âm thanh hợp lệ`);
    const dur = a.meta.durationMs || 0, st = int(s.startMs, 0, dur, 0), en = int(s.endMs, 0, dur, dur) || dur;
    if (en - st < 100) throw bad(`Đoạn ${i + 1}: điểm cắt không hợp lệ (cần dài tối thiểu 0,1 giây)`);
    const len = en - st;
    out.push({ assetId: a.id, name: a.name, ai: !!a.meta.ai, startMs: st, endMs: en, fadeInMs: int(s.fadeInMs, 0, len >> 1, 0),
      fadeOutMs: int(s.fadeOutMs, 0, len >> 1, 0), gainDb: num(s.gainDb, -20, 20, 0) });
  }
  return out;
}

// Cùng đồ thị filter với studios.audio_filter của Engine.
function audioFilter(segs, gap) {
  const chains = segs.map((s, i) => {
    const len = (s.endMs - s.startMs) / 1000;
    const f = [`[${i}:a]atrim=start=${(s.startMs / 1000).toFixed(3)}:end=${(s.endMs / 1000).toFixed(3)}`, "asetpts=PTS-STARTPTS", "aresample=48000", "aformat=sample_fmts=s16:channel_layouts=stereo"];
    if (s.fadeInMs) f.push(`afade=t=in:st=0:d=${(s.fadeInMs / 1000).toFixed(3)}`);
    if (s.fadeOutMs) f.push(`afade=t=out:st=${Math.max(0, len - s.fadeOutMs / 1000).toFixed(3)}:d=${(s.fadeOutMs / 1000).toFixed(3)}`);
    if (s.gainDb) f.push(`volume=${s.gainDb.toFixed(1)}dB`);
    if (gap && i < segs.length - 1) f.push(`apad=pad_dur=${(gap / 1000).toFixed(3)}`);
    return f.join(",") + `[s${i}]`;
  });
  return chains.join(";") + ";" + segs.map((_, i) => `[s${i}]`).join("") + `concat=n=${segs.length}:v=0:a=1[mix]`;
}

async function writeInputs(f, segs) {
  for (const [i, s] of segs.entries()) await f.writeFile(`in${i}.wav`, new Uint8Array(await (await blobOf(s.assetId)).arrayBuffer()));
  return segs.flatMap((_, i) => ["-i", `in${i}.wav`]);
}
async function cleanFs(f, names) { for (const n of names) await f.deleteFile(n).catch(() => {}); }

async function durationOf(blob) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  try { return Math.round((await ac.decodeAudioData(await blob.arrayBuffer())).duration * 1000); } finally { ac.close(); }
}

async function audioEdit(b) {
  const segs = await cleanSegments(b.segments);
  const gap = int(b.gapMs, 0, 10000, 0), loud = b.normalize !== false, name = str(b.name, 150) || "Âm thanh đã biên tập";
  return submit("audio-edit", async (j, tick) => {
    tick(0.05, "Nạp ffmpeg.wasm"); const f = await ffmpeg();
    tick(0.2, "Cắt, fade và nối đoạn");
    const ins = await writeInputs(f, segs);
    let graph = audioFilter(segs, gap), out = "[mix]";
    if (loud) { graph += `;[mix]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[fin]`; out = "[fin]"; }
    try {
      await run(f, j, ["-y", ...ins, "-filter_complex", graph, "-map", out, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", "out.wav"]);
      const wav = new Blob([await f.readFile("out.wav")], { type: "audio/wav" });
      const dur = await durationOf(wav), ai = segs.some((s) => s.ai);
      const a = await addAsset(wav, "audio", `${name}.wav`, "audio/wav", { durationMs: dur, edited: true, ai, normalized: loud ? "EBU R128 -16 LUFS" : "",
        segments: segs.map(({ name: n, assetId, startMs, endMs, fadeInMs, fadeOutMs, gainDb }) => ({ assetId, name: n, startMs, endMs, fadeInMs, fadeOutMs, gainDb })), gapMs: gap });
      return { assetId: a.id, durationMs: dur, ai };
    } finally { await cleanFs(f, [...segs.map((_, i) => `in${i}.wav`), "out.wav"]); }
  }, null, null, { segments: segs.length });
}

// =================== PODCAST ===================
const POD = { title: "", description: "", author: "", coverAssetId: null, introAssetId: null, outroAssetId: null, gapMs: 600, chapters: true, audioBaseUrl: "", explicit: false };
async function podConfig(pid, p) {
  const c = { ...POD, ...(await kvGet(`podcast:${pid}`, {})) };
  c.title ||= p.title; c.description ||= p.description || "";
  return c;
}
async function setPodConfig(pid, b) {
  const asset = async (k, kinds) => {
    if (!b[k]) return null;
    const a = await db.get("assets", String(b[k]));
    if (!a || !kinds.includes(a.kind)) throw bad("Tài sản được chọn không hợp lệ");
    return a.id;
  };
  await db.put("kv", { title: str(b.title, 200), description: str(b.description, 4000), author: str(b.author, 160),
    coverAssetId: await asset("coverAssetId", ["image", "slide"]), introAssetId: await asset("introAssetId", ["audio"]),
    outroAssetId: await asset("outroAssetId", ["audio"]), gapMs: int(b.gapMs, 0, 5000, 600), chapters: b.chapters !== false,
    audioBaseUrl: https(b.audioBaseUrl), explicit: !!b.explicit }, `podcast:${pid}`);
  return podConfig(pid, await getProject(pid));
}
async function episodes(pid) {
  const ids = await kvGet(`podEps:${pid}`, []);
  return (await Promise.all(ids.map((e) => db.get("kv", `podEp:${e}`)))).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}
async function deleteEpisode(pid, eid) {
  await db.del("blobs", `p:${eid}:audio`); await db.del("blobs", `p:${eid}:cover`); await db.del("kv", `podEp:${eid}`);
  await db.put("kv", (await kvGet(`podEps:${pid}`, [])).filter((x) => x !== eid), `podEps:${pid}`);
}

async function podcastBuild(pid) {
  return submit("podcast", async (j, tick) => {
    const p = await getProject(pid), cfg = await podConfig(pid, p);
    const parts = [], skipped = []; let ai = false;
    if (cfg.introAssetId) parts.push([cfg.introAssetId, "Mở đầu"]);
    p.scenes.filter((s) => !s.excluded).forEach((s, i) => {
      if (s.audioMode === "recorded" && s.audioAssetId) parts.push([s.audioAssetId, s.title || `Cảnh ${i + 1}`, true]);
      else skipped.push(s.title || `Cảnh ${i + 1}`);
    });
    if (cfg.outroAssetId) parts.push([cfg.outroAssetId, "Kết thúc"]);
    if (!parts.some((x) => x[2])) throw bad("Chưa có cảnh nào có bản thu âm để dựng podcast (giọng AI chỉ có ở PNS Engine)");
    const segs = [], chapters = []; let t = 0;
    for (const [k, [aid, label]] of parts.entries()) {
      const a = await db.get("assets", aid); ai ||= !!a.meta.ai;
      const dur = a.meta.durationMs || 0, gap = k < parts.length - 1 ? cfg.gapMs : 0;
      segs.push({ assetId: aid, startMs: 0, endMs: dur, fadeInMs: 0, fadeOutMs: 0, gainDb: 0 });
      chapters.push({ title: label, startMs: t, endMs: t + dur + gap }); t += dur + gap;
    }
    tick(0.05, "Nạp ffmpeg.wasm"); const f = await ffmpeg();
    tick(0.3, "Ghép tập podcast");
    const ins = await writeInputs(f, segs);
    const desc = cfg.description + (ai ? "\n\nTập này có sử dụng giọng đọc tạo bằng AI." : "");
    const e = (v) => String(v).replace(/([=;#\\\n])/g, "\\$1");
    const meta = [";FFMETADATA1", `title=${e(cfg.title)}`, `artist=${e(cfg.author)}`, `album=${e(p.course?.course || "Phúc Nguyên Studio")}`, `comment=${e(desc.slice(0, 900))}`, "genre=Podcast"];
    if (cfg.chapters && chapters.length > 1) for (const c of chapters) meta.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${c.startMs}`, `END=${c.endMs}`, `title=${e(c.title)}`);
    await f.writeFile("meta.txt", new TextEncoder().encode(meta.join("\n") + "\n"));
    let cover = null;
    const args = ["-y", ...ins, "-f", "ffmetadata", "-i", "meta.txt"];
    const mi = segs.length;
    const maps = ["-filter_complex", audioFilter(segs, cfg.gapMs) + ";[mix]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[fin]", "-map", "[fin]", "-map_metadata", String(mi), "-map_chapters", String(mi)];
    const [ca, bmp] = cfg.coverAssetId ? await bitmapOf(cfg.coverAssetId) : [null, null];
    if (ca) {
      const side = Math.min(3000, Math.max(1400, Math.min(bmp.width, bmp.height)));
      const [sx, sy, sw, sh] = cropBox(bmp.width, bmp.height, "1:1", 0.5, 0.5, 1);
      const [cc, cx] = canvas(side, side); cx.drawImage(bmp, sx, sy, sw, sh, 0, 0, side, side);
      cover = await canvasBlob(cc, "image/jpeg", 0.88);
      await f.writeFile("cover.jpg", new Uint8Array(await cover.arrayBuffer()));
      args.push("-i", "cover.jpg");
      maps.push("-map", `${mi + 1}:v`, "-c:v", "mjpeg", "-disposition:v", "attached_pic", "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)");
    }
    try {
      await run(f, j, [...args, ...maps, "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-id3v2_version", "3", "episode.mp3"]);
      const mp3 = new Blob([await f.readFile("episode.mp3")], { type: "audio/mpeg" });
      const eid = newId("pe");
      await db.put("blobs", mp3, `p:${eid}:audio`);
      if (cover) await db.put("blobs", cover, `p:${eid}:cover`);
      const rec = { id: eid, projectId: pid, projectRevision: p.revision, title: cfg.title, description: desc, author: cfg.author, file: "episode.mp3",
        mime: "audio/mpeg", durationMs: await durationOf(mp3), sizeBytes: mp3.size, chapters: cfg.chapters ? chapters : [], skippedScenes: skipped,
        aiNarration: ai, cover: !!cover, createdAt: now(), approval: null, config: cfg };
      await db.put("kv", rec, `podEp:${eid}`);
      await db.put("kv", [...(await kvGet(`podEps:${pid}`, [])), eid], `podEps:${pid}`);
      return rec;
    } finally { await cleanFs(f, [...segs.map((_, i) => `in${i}.wav`), "meta.txt", "cover.jpg", "episode.mp3"]); }
  }, pid);
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
async function podcastPackage(pid, rec) {
  if (!rec.approval) throw bad("Tập podcast chưa được duyệt");
  const { zipSync, strToU8 } = await fflate();
  const base = (rec.config.audioBaseUrl || "").replace(/\/+$/, "");
  const u = base ? `${base}/${rec.file}` : `{{DIA_CHI_FILE_AUDIO}}/${rec.file}`;
  const s = Math.floor(rec.durationMs / 1000), p2 = (n) => String(n).padStart(2, "0");
  const item = ["<item>", `  <title>${xml(rec.title)}</title>`, `  <description>${xml(rec.description)}</description>`,
    `  <enclosure url="${xml(u)}" length="${rec.sizeBytes}" type="${rec.mime}"/>`, `  <guid isPermaLink="false">pns-${pid}-${rec.id}</guid>`,
    `  <pubDate>${new Date(rec.approval.approvedAt).toUTCString()}</pubDate>`, `  <itunes:duration>${p2(Math.floor(s / 3600))}:${p2(Math.floor(s % 3600 / 60))}:${p2(s % 60)}</itunes:duration>`,
    `  <itunes:author>${xml(rec.author)}</itunes:author>`, `  <itunes:explicit>${rec.config.explicit ? "true" : "false"}</itunes:explicit>`, "</item>"].join("\n");
  const pub = { schemaVersion: SCHEMA, generator: `PNS ${VERSION}`, type: "podcast-episode", projectId: pid, projectRevision: rec.projectRevision,
    title: rec.title, description: rec.description, author: rec.author, file: rec.file, mime: rec.mime, durationMs: rec.durationMs, chapters: rec.chapters,
    aiNarration: rec.aiNarration, episodeId: rec.id, approvedBy: rec.approval.approvedBy, approvedAt: rec.approval.approvedAt,
    visibility: "Chưa công khai — người quản trị PNL/PND tải lên thủ công sau khi duyệt" };
  const files = { [rec.file]: [new Uint8Array(await (await db.get("blobs", `p:${rec.id}:audio`)).arrayBuffer()), { level: 0 }],
    "episode.json": strToU8(JSON.stringify(pub, null, 2)), "rss-item.xml": strToU8(item + "\n") };
  const cover = await db.get("blobs", `p:${rec.id}:cover`);
  if (cover) files["cover.jpg"] = [new Uint8Array(await cover.arrayBuffer()), { level: 0 }];
  if (rec.chapters.length) files["chapters.json"] = strToU8(JSON.stringify({ version: "1.2.0", chapters: rec.chapters.map((c) => ({ startTime: c.startMs / 1000, title: c.title })) }, null, 2));
  return new Blob([zipSync(files)], { type: "application/zip" });
}

// =================== INTERACTIVE ===================
async function interGet(pid) { return { renderId: null, questions: [], requireCorrect: false, showExplain: true, ...(await kvGet(`interactive:${pid}`, {})) }; }
function cleanQuestions(qs) {
  if (!Array.isArray(qs)) throw bad("Danh sách câu hỏi không hợp lệ");
  const out = [];
  qs.slice(0, 200).forEach((q, k) => {
    if (!q || typeof q !== "object") return;
    const i = k + 1, opts = (q.options || []).filter((o) => typeof o === "string" && o.trim()).map((o) => o.slice(0, 300).trim()).slice(0, 6);
    const text = str(q.text, 1000);
    if (!text) throw bad(`Câu ${i}: chưa nhập nội dung câu hỏi`);
    if (opts.length < 2) throw bad(`Câu ${i}: cần ít nhất 2 phương án`);
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= opts.length) throw bad(`Câu ${i}: chưa chọn đáp án đúng`);
    const id = typeof q.id === "string" && /^q[0-9a-f]{8}$/.test(q.id) ? q.id : "q" + newId("qq").slice(3, 11);
    out.push({ id, atMs: int(q.atMs, 0, 86400000, 0), text, options: opts, correct: q.correct, explain: str(q.explain, 1500) });
  });
  if (new Set(out.map((q) => q.id)).size !== out.length) throw bad("Trùng mã câu hỏi");
  return out.sort((a, b) => a.atMs - b.atMs);
}
const escHtml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
async function playerHtml(title, data, video, vtt, player) {
  const tpl = await (await fetch(new URL("../../player/interactive.html", import.meta.url))).text();
  const payload = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const track = vtt ? `<track kind="subtitles" srclang="vi" label="Tiếng Việt" src="${escHtml(vtt)}" default>` : "";
  return tpl.replace("{{TITLE}}", escHtml(title)).replace("{{VIDEO}}", escHtml(video)).replace("{{TRACK}}", track).replace("{{PLAYER}}", escHtml(player)).replace("{{DATA}}", () => payload);
}
const vttOf = async (rid) => "WEBVTT\n\n" + (await (await db.get("blobs", `r:${rid}:srt`)).text()).replace(/(\d\d:\d\d:\d\d),(\d{3})/g, "$1.$2");
async function renderOf(pid, cfg) {
  const r = cfg.renderId ? await db.get("renders", cfg.renderId) : null;
  if (!r || r.projectId !== pid) throw bad("Chọn bản kết xuất video trước");
  return r;
}

// =================== định tuyến ===================
// Trả về undefined nếu đường dẫn không thuộc các studio này.
export async function handle(M, parts, q, body) {
  const [r0, r1, r2, r3, r4] = parts;
  if (r0 === "image" && M === "POST") {
    if (r1 === "transform") return imageTransform(body || {});
    if (r1 === "cover") return imageCover(body || {});
  }
  if (r0 === "assets" && r2 === "peaks") return peaks(r1, +q.get("n") || 800);
  if (r0 === "audio" && r1 === "edit") return audioEdit(body || {});
  if (r0 === "content" && r1 === "parse") return { scenes: parseScript(String(body?.text || "")) };
  if (r0 !== "projects" || !r1 || !["content", "script.md", "podcast", "podcasts", "interactive"].includes(r2)) return undefined;

  const p = await getProject(r1);
  if (!p) throw nf("Không tìm thấy dự án");
  if (r2 === "script.md") return new Blob([exportScript(p)], { type: "text/markdown;charset=utf-8" });
  if (r2 === "content" && r3 === "check") return contentCheck(p);
  if (r2 === "content" && r3 === "apply") {
    const parsed = parseScript(String(body?.text || ""));
    if (!parsed.length) throw bad("Không tìm thấy nội dung kịch bản để nhập");
    const scenes = mergeScript(p.scenes, parsed, body.mode === "append" ? "append" : "merge", !!body.keepTitles);
    if (scenes.length > MAX_SCENES) throw bad(`Vượt giới hạn ${MAX_SCENES} cảnh`);
    return saveProject(r1, { ...p, scenes }, Number.isInteger(body.revision) ? body.revision : undefined);
  }
  if (r2 === "podcast") {
    if (!r3 && M === "PUT") return setPodConfig(r1, body || {});
    if (!r3) return { config: await podConfig(r1, p), episodes: await episodes(r1), format: "mp3" };
    if (r3 === "build") return podcastBuild(r1);
  }
  if (r2 === "podcasts" && r3) {
    const rec = await db.get("kv", `podEp:${r3}`);
    if (!rec || rec.projectId !== r1) throw nf("Không tìm thấy tập podcast");
    if (!r4 && M === "DELETE") { await deleteEpisode(r1, r3); return { ok: true }; }
    if (r4 === "approval") {
      rec.approval = body?.approved ? { approvedBy: str(body.approver, 120) || "chủ sở hữu", approvedAt: now(), note: str(body.note, 1000) } : null;
      await db.put("kv", rec, `podEp:${r3}`); return rec;
    }
    if (r4 === "package") return podcastPackage(r1, rec);
  }
  if (r2 === "interactive") {
    if (!r3 && M === "PUT") {
      const rid = body?.renderId || null;
      if (rid) { const r = await db.get("renders", rid); if (!r || r.projectId !== r1) throw bad("Bản kết xuất không tồn tại"); }
      const data = { renderId: rid, questions: cleanQuestions(body?.questions || []), requireCorrect: !!body?.requireCorrect, showExplain: body?.showExplain !== false };
      await db.put("kv", data, `interactive:${r1}`); return data;
    }
    if (!r3) return interGet(r1);
    const cfg = await interGet(r1), r = await renderOf(r1, cfg);
    if (r3 === "preview") {
      // Trang xem thử mở dưới dạng blob: video/phụ đề cũng là blob URL tạo ở trang PNS (cùng nguồn gốc).
      const v = URL.createObjectURL(await db.get("blobs", `r:${r.id}:mp4`));
      const t = URL.createObjectURL(new Blob([await vttOf(r.id)], { type: "text/vtt" }));
      setTimeout(() => { URL.revokeObjectURL(v); URL.revokeObjectURL(t); }, 6 * 3600 * 1000);
      return new Blob([await playerHtml(p.title, { ...cfg, title: p.title, preview: true }, v, t, new URL("../../player/interactive.js", import.meta.url).href)], { type: "text/html" });
    }
    if (r3 === "package") {
      if (!r.approval) throw bad("Bản kết xuất chưa được duyệt ở Trung tâm xuất bản");
      if (!cfg.questions.length) throw bad("Chưa có câu hỏi nào");
      if (cfg.questions.some((x) => x.atMs >= r.durationMs)) throw bad("Có câu hỏi đặt sau thời điểm kết thúc video");
      const data = { ...cfg, title: p.title, durationMs: r.durationMs, aiNarration: r.aiNarration, generator: `PNS ${VERSION}`, projectId: r1, projectRevision: r.projectRevision };
      const { zipSync, strToU8 } = await fflate();
      return new Blob([zipSync({
        "lecture.mp4": [new Uint8Array(await (await db.get("blobs", `r:${r.id}:mp4`)).arrayBuffer()), { level: 0 }],
        "lecture.vtt": strToU8(await vttOf(r.id)),
        "index.html": strToU8(await playerHtml(p.title, data, "lecture.mp4", "lecture.vtt", "player.js")),
        "player.js": strToU8(await (await fetch(new URL("../../player/interactive.js", import.meta.url))).text()),
        "interactive.json": strToU8(JSON.stringify(data, null, 2)),
        "HUONG_DAN.txt": strToU8("Gói video tương tác PNS\n\n- Mở index.html bằng trình duyệt (hoặc đăng cả thư mục lên PNL/GitHub Pages).\n- Video tự dừng ở các mốc để người học trả lời; kết quả chỉ hiển thị trên máy người học,\n  không gửi đi đâu và không thay thế hệ thống khảo thí của PNL.\n"),
      })], { type: "application/zip" });
    }
  }
  return undefined;
}

// Dọn dữ liệu studio khi xóa dự án; tài sản đang được cấu hình podcast tham chiếu.
export async function onDeleteProject(pid) {
  for (const e of await kvGet(`podEps:${pid}`, [])) await deleteEpisode(pid, e);
  await db.del("kv", `podEps:${pid}`); await db.del("kv", `podcast:${pid}`); await db.del("kv", `interactive:${pid}`);
}
export async function usedBy(id) {
  const out = [];
  for (const k of await db.keys("kv")) if (typeof k === "string" && k.startsWith("podcast:") && JSON.stringify(await db.get("kv", k)).includes(id)) out.push(k.slice(8));
  return out;
}
