// IndexedDB của chế độ trình duyệt. sw.js đọc cùng CSDL này (tên/phiên bản/store phải khớp).
const NAME = "pns", VERSION = 1;
const STORES = { kv: null, projects: "id", assets: "id", renders: "id", sceneAudio: "key", blobs: null };
let dbp = null;

export function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      for (const [n, key] of Object.entries(STORES))
        if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, key ? { keyPath: key } : undefined);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function wrap(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then((v) => (out = v));
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("Giao dịch IndexedDB bị hủy (có thể hết dung lượng)"));
  });
}

export const get = (s, k) => tx(s, "readonly", (o) => wrap(o.get(k)));
export const all = (s) => tx(s, "readonly", (o) => wrap(o.getAll()));
export const put = (s, v, k) => tx(s, "readwrite", (o) => wrap(k === undefined ? o.put(v) : o.put(v, k)));
export const del = (s, k) => tx(s, "readwrite", (o) => wrap(o.delete(k)));
export const keys = (s) => tx(s, "readonly", (o) => wrap(o.getAllKeys()));
