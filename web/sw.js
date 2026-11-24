// Service worker của chế độ trình duyệt: phục vụ file media (ảnh, slide, audio, video, phụ đề) từ IndexedDB
// theo cùng đường dẫn api/... của PNS Engine, để giao diện dùng chung một mã. Chỉ đăng ký khi KHÔNG có Engine.
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open("pns", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    r.onupgradeneeded = () => { r.transaction.abort(); rej(new Error("no db")); }; });
}
async function get(store, key) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}

function respond(blob, type, req, filename) {
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (filename) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
  const range = req.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const size = blob.size;
    const start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(blob.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  return new Response(blob, { headers: { ...headers, "Content-Length": String(blob.size) } });
}

const nf = () => new Response("Không tìm thấy", { status: 404 });

async function serve(req, url) {
  const p = url.pathname.slice(SCOPE.length).split("/");   // api, ...
  const dl = url.searchParams.has("download");
  if (p[1] === "assets" && p[2]) {
    const a = await get("assets", p[2]); if (!a) return nf();
    if (p[3] === "thumb") { const t = await get("blobs", `t:${a.id}`); return t ? respond(t, "image/jpeg", req) : nf(); }
    const b = await get("blobs", `a:${a.id}`); return b ? respond(b, a.mime, req, dl ? a.name : null) : nf();
  }
  if (p[1] === "projects" && p[3] === "renders" && p[5]) {
    const r = await get("renders", p[4]); if (!r || r.projectId !== p[2]) return nf();
    const stem = (r.title || "bai-giang").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60);
    if (p[5] === "lecture.mp4") { const b = await get("blobs", `r:${r.id}:mp4`); return b ? respond(b, "video/mp4", req, dl ? stem + ".mp4" : null) : nf(); }
    const srt = await get("blobs", `r:${r.id}:srt`); if (!srt) return nf();
    if (p[5] === "lecture.srt") return respond(srt, "application/x-subrip; charset=utf-8", req, dl ? stem + ".srt" : null);
    if (p[5] === "lecture.vtt") return new Response("WEBVTT\n\n" + (await srt.text()).replace(/(\d\d:\d\d:\d\d),(\d{3})/g, "$1.$2"), { headers: { "Content-Type": "text/vtt; charset=utf-8" } });
  }
  if (p[1] === "projects" && p[3] === "podcasts" && p[5]) {           // tập podcast (Podcast Studio)
    const e = await get("kv", `podEp:${p[4]}`); if (!e || e.projectId !== p[2]) return nf();
    if (p[5] === e.file) { const b = await get("blobs", `p:${e.id}:audio`); return b ? respond(b, e.mime, req, dl ? e.file : null) : nf(); }
    if (p[5] === "cover.jpg") { const b = await get("blobs", `p:${e.id}:cover`); return b ? respond(b, "image/jpeg", req) : nf(); }
  }
  return nf();
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || !url.pathname.startsWith(SCOPE + "api/")) return;
  e.respondWith(serve(e.request, url).catch(() => nf()));
});
