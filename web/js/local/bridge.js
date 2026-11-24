// Cầu nối tới PNS Engine trên máy (http://127.0.0.1:7860/bridge/*) để bản web dùng giọng AI cá nhân (VieNeu-TTS).
// Khóa ghép nối lấy ở Cài đặt của Engine; lưu trong localStorage của trình duyệt này.
const KEY = "pns.bridge";

export function getCfg() {
  try { return { url: "http://127.0.0.1:7860", key: "", ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
  catch { return { url: "http://127.0.0.1:7860", key: "" }; }
}
export function setCfg(c) {
  const url = String(c.url || "http://127.0.0.1:7860").trim().replace(/\/+$/, "");
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(url)) throw new Error("Địa chỉ Engine phải dạng http://127.0.0.1:7860");
  localStorage.setItem(KEY, JSON.stringify({ url, key: String(c.key || "").trim() }));
}

const OFFLINE = "Không kết nối được PNS Engine trên máy. Mở START_PNS.bat, giữ cửa sổ đen; nếu trình duyệt hỏi «truy cập thiết bị trong mạng cục bộ» hãy bấm Cho phép.";

async function req(path, opts = {}) {
  const c = getCfg();
  if (!c.key) throw new Error("Chưa ghép nối PNS Engine. Vào Cài đặt → Giọng AI qua PNS Engine.");
  let r;
  try {
    r = await fetch(c.url + path, { ...opts, mode: "cors", credentials: "omit", cache: "no-store",
      headers: { "X-PNS-Bridge-Key": c.key, ...(opts.headers || {}) } });
  } catch { throw new Error(OFFLINE); }
  if (!r.ok) {
    let m = `PNS Engine báo lỗi ${r.status}`;
    try { const j = await r.json(); m = j.error || j.detail || m; } catch {}
    const e = new Error(typeof m === "string" ? m : JSON.stringify(m)); e.status = r.status; throw e;
  }
  return r;
}

let last = { at: 0, v: null };
// Trạng thái kết nối (đệm 15 giây để không gọi liên tục)
export async function status(force = false) {
  if (!force && last.v && Date.now() - last.at < 15000) return last.v;
  let v;
  if (!getCfg().key) v = { connected: false, paired: false, error: "Chưa ghép nối" };
  else {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
      const r = await req("/bridge/status", { signal: ctl.signal }); clearTimeout(t);
      v = { connected: true, paired: true, ...(await r.json()) };
    } catch (e) { v = { connected: false, paired: true, error: e.message }; }
  }
  last = { at: Date.now(), v };
  return v;
}

// Sinh giọng: gửi văn bản + mẫu giọng, theo dõi job trên Engine, trả về WAV.
export async function synth({ text, raw = false, dictionary = null, ref, onProgress = () => {}, isCancelled = () => false }) {
  const fd = new FormData();
  fd.append("text", text); fd.append("raw", raw ? "1" : "0");
  if (dictionary) fd.append("dictionary", JSON.stringify(dictionary));
  fd.append("ref", ref, "ref.wav");
  const job = await (await req("/bridge/tts", { method: "POST", body: fd })).json();
  let j = job, misses = 0;
  for (;;) {
    if (isCancelled()) { await req(`/bridge/jobs/${job.id}/cancel`, { method: "POST" }).catch(() => {}); throw new Error("Đã hủy"); }
    await new Promise((r) => setTimeout(r, 700));
    try { j = await (await req(`/bridge/jobs/${job.id}`)).json(); misses = 0; }
    catch (e) { if (++misses > 5) throw e; continue; }         // Engine bận/chập chờn: thử lại vài lần
    onProgress(j.progress || 0, j.message || "PNS Engine đang sinh giọng");
    if (j.status === "done") break;
    if (j.status === "failed") throw new Error(j.error || "PNS Engine sinh giọng thất bại");
    if (j.status === "cancelled") throw new Error("Đã hủy trên PNS Engine");
  }
  const wav = await (await req(`/bridge/jobs/${job.id}/audio`)).blob();
  last.at = 0;
  return { wav: new Blob([wav], { type: "audio/wav" }), result: j.result };
}

export async function normalize(text, dictionary) {
  return (await req("/bridge/normalize", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, dictionary }) })).json();
}

// Nhận khóa từ đường dẫn «Kết nối bản web» của Engine: #/settings?bridge=<khóa>&engine=<url>
export function consumeHash() {
  const [path, qs = ""] = location.hash.split("?");
  const q = new URLSearchParams(qs);
  if (!q.get("bridge")) return false;
  try { setCfg({ url: q.get("engine") || getCfg().url, key: q.get("bridge") }); } catch { return false; }
  q.delete("bridge"); q.delete("engine");
  history.replaceState(null, "", path + (q.toString() ? "?" + q : ""));
  last.at = 0;
  return true;
}
