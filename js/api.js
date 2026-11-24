// Kết nối PNS Engine (cùng origin 127.0.0.1). Khi chạy trên web (Firebase/GitHub Pages) engine = null.
const token = document.querySelector('meta[name="pns-token"]')?.content || "";
const local = ["127.0.0.1", "localhost"].includes(location.hostname);

// mode: "engine" (PNS Engine cục bộ) | "browser" (xử lý ngay trong trình duyệt) | "web" (chỉ giới thiệu)
export const engine = { available: false, mode: "web", health: null, token };
let backend = null;

export async function detectEngine() {
  if (local && token) {
    try {
      engine.mode = "engine";
      engine.health = await get("api/health");
      engine.available = true;
      return true;
    } catch { engine.mode = "web"; }
  }
  try {
    if (!("serviceWorker" in navigator) || !window.indexedDB) throw new Error("Trình duyệt không hỗ trợ");
    await navigator.serviceWorker.register("sw.js", { scope: "./" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) => { navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }); setTimeout(r, 4000); });
    backend = await import("./local/backend.js");
    navigator.storage?.persist?.().catch(() => {});
    engine.mode = "browser";
    engine.health = await backend.handle("GET", "api/health");
    engine.available = true;
  } catch (e) { console.warn("Không bật được chế độ trình duyệt:", e); engine.mode = "web"; }
  return engine.available;
}

async function local_(method, url, body) {
  try { return await backend.handle(method, url, body); }
  catch (e) { throw new ApiError(e.message || String(e), e.status || 422); }
}

export class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function call(method, url, body, isForm) {
  if (engine.mode === "browser") return local_(method, url, body);
  const opts = { method, headers: { "X-PNS-Token": token } };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  }
  let r;
  try { r = await fetch(url, opts); } catch { throw new ApiError("Mất kết nối với PNS Engine. Kiểm tra cửa sổ START_PNS.", 0); }
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) {
    let msg = `Lỗi ${r.status}`;
    if (ct.includes("json")) { const j = await r.json(); msg = j.error || j.detail || msg; }
    throw new ApiError(typeof msg === "string" ? msg : JSON.stringify(msg), r.status);
  }
  return ct.includes("json") ? r.json() : r.blob();
}

export const get = (u) => call("GET", u);
export const post = (u, b = {}) => call("POST", u, b);
export const put = (u, b) => call("PUT", u, b);
export const patch = (u, b) => call("PATCH", u, b);
export const del = (u) => call("DELETE", u);
export const postForm = (u, fd) => call("POST", u, fd, true);

// Tải file lên có tiến độ (XHR để theo dõi upload)
export function upload(url, file, fields = {}, onProgress = () => {}) {
  if (engine.mode === "browser") return local_("POST", url, { file, ...fields });
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("X-PNS-Token", token);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText); } catch {}
      x.status < 300 ? resolve(j) : reject(new ApiError(j.error || j.detail || `Lỗi ${x.status}`, x.status));
    };
    x.onerror = () => reject(new ApiError("Mất kết nối với PNS Engine", 0));
    x.send(fd);
  });
}

// Theo dõi job tới khi xong
export async function waitJob(job, onTick = () => {}) {
  for (;;) {
    const j = await get(`api/jobs/${job.id}`);
    onTick(j);
    if (["done", "failed", "cancelled"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 700));
  }
}

// Tải file nhị phân từ POST (gói phát hành) rồi lưu
export async function downloadPost(url, filename) {
  const blob = await post(url);
  saveBlob(blob, filename);
}

export function saveBlob(blob, filename) {
  const u = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: u, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
