// Voice Studio + giọng AI theo cảnh ở chế độ trình duyệt. Mẫu giọng lưu trong IndexedDB của trình duyệt này;
// việc sinh giọng chạy trên PNS Engine của máy qua cầu nối (bridge.js). Hợp đồng API giống PNS Engine.
import * as db from "./db.js";
import * as bridge from "./bridge.js";
import { addAsset, bind, encodeWav, getProject, submit, HttpError, newId, sha } from "./backend.js";

const nf = (m = "Không tìm thấy") => new HttpError(m, 404);
const bad = (m) => new HttpError(m, 422);
const str = (v, n) => (typeof v === "string" ? v.slice(0, n).trim() : "");
const now = () => Date.now();

export const list = async () => (await db.get("kv", "voices")) || [];
const saveList = (l) => db.put("kv", l, "voices");
export const voice = async (id) => (await list()).find((v) => v.id === id) || null;
export const dictionary = async () => (await db.get("kv", "dictionary")) ?? null;   // null = dùng từ điển mặc định của Engine

// Engine status theo cùng dạng api/voices của PNS Engine
export async function ttsStatus(force = false) {
  const b = await bridge.status(force);
  if (!b.connected) return { installed: false, loaded: false, bridge: true, connected: false, paired: b.paired, engine: "VieNeu-TTS qua PNS Engine",
    lastError: b.error, config: {}, license: "Apache-2.0 (chạy trên PNS Engine của máy)" };
  return { ...b.tts, bridge: true, connected: true, paired: true, engineVersion: b.version, model: b.model };
}

// Mẫu tham chiếu: cắt đoạn → mono 24 kHz → chuẩn hóa mức (Engine chuẩn hóa lại bằng loudnorm khi sinh)
async function prepareSample(file, startMs, endMs) {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  let buf;
  try { buf = await ac.decodeAudioData(await file.arrayBuffer()); }
  catch { throw bad("Không giải mã được mẫu giọng (định dạng hỏng hoặc trình duyệt không hỗ trợ)"); }
  finally { ac.close(); }
  const total = Math.round(buf.duration * 1000);
  const st = Math.max(0, Math.min(startMs || 0, total)), en = endMs > st + 999 ? Math.min(endMs, total) : total;
  const len = (en - st) / 1000;
  if (len < 2) throw bad("Mẫu giọng quá ngắn (cần tối thiểu 2 giây, nên 3–15 giây)");
  const off = new OfflineAudioContext(1, Math.ceil(len * 24000), 24000);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start(0, st / 1000, len);
  const out = (await off.startRendering()).getChannelData(0);
  let peak = 0, sum = 0;
  for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]); if (v > peak) peak = v; sum += v * v; }
  const rms = Math.sqrt(sum / out.length);
  if (peak < 0.003) throw bad("Mẫu giọng gần như im lặng — kiểm tra micro");
  return { wav: encodeWav(out, 24000, Math.min(0.125 / Math.max(rms, 1e-6), 0.79 / peak)), durationMs: Math.round(len * 1000) };
}

async function addVoice(b) {
  if (b.consent !== "yes") throw bad("Cần xác nhận quyền sử dụng giọng nói");
  if (!str(b.owner, 120)) throw bad("Nhập tên người sở hữu giọng");
  if (!(b.file instanceof Blob)) throw bad("Chọn hoặc thu mẫu giọng");
  const { wav, durationMs } = await prepareSample(b.file, +b.startMs || 0, +b.endMs || 0);
  const id = newId("vc");
  await db.put("blobs", wav, `v:${id}`);
  const rec = { id, name: str(b.name, 120) || "Giọng của tôi", sha256: await sha(await wav.arrayBuffer()), createdAt: now(),
    consent: { owner: str(b.owner, 120), confirmedAt: now(), statement: "Người dùng xác nhận có quyền sử dụng giọng nói này để tạo âm thanh AI; mẫu lưu trong trình duyệt và chỉ gửi tới PNS Engine trên chính máy này khi sinh giọng." },
    meta: { durationMs, warning: durationMs > 20000 ? "Mẫu dài hơn 20 giây; nên cắt còn 3–15 giây câu nói rõ, không nhạc nền." : "", approved: false, tests: [] } };
  await saveList([rec, ...(await list())]);
  return rec;
}

async function voiceTest(id, text) {
  const v = await voice(id);
  if (!v) throw nf("Không tìm thấy giọng");
  text = str(text, 2000);
  if (!text) throw bad("Nhập câu thử");
  return submit("voice-test", async (j, tick) => {
    const { wav, result } = await bridge.synth({ text, dictionary: await dictionary(), ref: await db.get("blobs", `v:${id}`),
      onProgress: (p, m) => tick(0.05 + p * 0.9, m), isCancelled: () => j._cancel });
    const file = `test-${newId("ts").slice(3, 11)}.wav`;
    await db.put("blobs", wav, `vt:${id}:${file}`);
    const l = await list(), r = l.find((x) => x.id === id);
    if (r) { r.meta.tests = [...(r.meta.tests || []), file].slice(-5); await saveList(l); }
    return { ...result, file, spoken: result.spoken };
  }, null, null, { voiceId: id });
}

async function deleteVoice(id) {
  const v = await voice(id);
  if (!v) throw nf("Không tìm thấy giọng");
  for (const k of await db.keys("blobs")) if (typeof k === "string" && (k === `v:${id}` || k.startsWith(`vt:${id}:`))) await db.del("blobs", k);
  await saveList((await list()).filter((x) => x.id !== id));
}

// ----- giọng AI theo cảnh -----
export function spokenInput(s) {
  return s.spokenOverride && (s.scriptSpoken || "").trim() ? { text: s.scriptSpoken, raw: true } : { text: s.scriptOriginal || "", raw: false };
}
export async function ttsHash(s, voices, dict) {
  const v = voices.find((x) => x.id === s.voiceId);
  const inp = spokenInput(s);
  return sha(JSON.stringify([inp.raw ? 1 : 0, inp.text, inp.raw ? null : dict, v?.sha256 || "none"]));
}

export async function generateSceneTts(pid, s, j, tick) {
  const v = s.voiceId ? await voice(s.voiceId) : null;
  if (!v) throw bad(`Cảnh «${s.title}» chưa chọn giọng AI (mẫu giọng lưu ở trình duyệt này)`);
  const inp = spokenInput(s);
  if (!inp.text.trim()) throw bad(`Cảnh «${s.title}» chưa có lời giảng`);
  const dict = await dictionary();
  const { wav, result } = await bridge.synth({ ...inp, dictionary: dict, ref: await db.get("blobs", `v:${v.id}`),
    onProgress: tick, isCancelled: () => j._cancel });
  const durationMs = Math.round(result.durationMs);
  const a = await addAsset(wav, "audio", `Giọng AI – ${s.title}`, "audio/wav", { durationMs, ai: true, voiceId: v.id, model: result.model });
  await bind(pid, s.id, "tts", a.id, durationMs, { ...result, inputHash: await ttsHash(s, [v], dict) });
  return { ...result, assetId: a.id, durationMs };
}

export async function handle(M, parts, q, body) {
  const [r0, r1, r2, r3, r4] = parts;
  if (r0 === "dictionary") {
    if (r1 === "preview") return bridge.normalize(String(body?.text || "").slice(0, 20000), await dictionary());
    if (M === "PUT") {
      const clean = (Array.isArray(body) ? body : []).filter((e) => e && typeof e.written === "string" && typeof e.spoken === "string")
        .map((e) => ({ written: e.written.trim().slice(0, 100), spoken: e.spoken.trim().slice(0, 300) })).filter((e) => e.written && e.spoken).slice(0, 500);
      await db.put("kv", clean, "dictionary");
    }
    const d = await dictionary();
    if (d) return d;
    const st = await bridge.status();      // chưa tùy biến: hiển thị từ điển đang dùng trên PNS Engine
    return st.connected ? st.dictionary || [] : [];
  }
  if (r0 === "voices") {
    if (!r1 && M === "POST") return addVoice(body || {});
    if (!r1) return { voices: await list(), engine: await ttsStatus(q.get("refresh") === "1") };
    const v = await voice(r1); if (!v) throw nf("Không tìm thấy giọng");
    if (!r2 && M === "PATCH") {
      const l = await list(), x = l.find((y) => y.id === r1);
      if ("approved" in body) x.meta.approved = !!body.approved;
      if ("note" in body) x.meta.note = str(body.note, 1000);
      x.name = str(body.name, 120) || x.name; await saveList(l); return x;
    }
    if (!r2 && M === "DELETE") { await deleteVoice(r1); return { ok: true }; }
    if (r2 === "test" && M === "POST") return voiceTest(r1, body?.text);
    if (!r2) return v;
  }
  if (r0 === "projects" && r2 === "scenes" && r4 === "tts" && M === "POST") {
    const p = await getProject(r1); if (!p) throw nf("Không tìm thấy dự án");
    const s = p.scenes.find((x) => x.id === r3); if (!s) throw nf("Không tìm thấy cảnh");
    if (!(await ttsStatus(true)).connected) throw bad("Chưa kết nối PNS Engine trên máy để sinh giọng AI. Mở START_PNS.bat rồi vào Cài đặt → Giọng AI qua PNS Engine.");
    return submit("scene-tts", async (j, tick) => {
      const fresh = (await getProject(r1)).scenes.find((x) => x.id === r3);
      if (!fresh) throw nf("Cảnh đã bị xóa");
      return generateSceneTts(r1, fresh, j, tick);
    }, r1, r3);
  }
  return undefined;
}
