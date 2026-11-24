// Tiện ích giao diện: tạo phần tử an toàn (không innerHTML với dữ liệu người dùng), thông báo, hộp thoại.

// replaceChildren/append nhận cả mảng lồng nhau và bỏ qua giá trị rỗng (false/null) như h().
for (const name of ["replaceChildren", "append"]) {
  const orig = Element.prototype[name];
  Element.prototype[name] = function (...kids) {
    return orig.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false));
  };
}
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // chỉ dùng cho SVG tĩnh trong mã
    else if (["value", "checked", "disabled", "selected", "hidden"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);

export function toast(msg, kind = "") {
  const t = h("div", { class: `toast ${kind}`, role: kind === "err" ? "alert" : "status" }, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 3500);
}

export function errToast(e) { toast(e?.message || String(e), "err"); }

export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const d = h("dialog", { "aria-label": title });
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    const foot = h("div", { class: "dlg-foot" },
      actions.map((a) => h("button", { class: `btn ${a.cls || ""}`, type: "button",
        onclick: async () => { const v = a.value ? await a.value() : a.result; if (v !== undefined && v !== null) close(v); else if (!a.value) close(a.result); } }, a.label)));
    d.append(h("div", { class: "dlg" }, h("h2", {}, title), body), foot);
    d.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
    document.body.append(d);
    d.showModal();
    d.querySelector("input,select,textarea")?.focus();
  });
}

export async function confirmBox(title, text, okLabel = "Đồng ý", danger = false) {
  const r = await modal(title, h("p", {}, text), [
    { label: "Hủy", cls: "ghost", result: false },
    { label: okLabel, cls: danger ? "danger" : "", result: true }]);
  return r === true;
}

export async function promptBox(title, label, value = "") {
  const inp = h("input", { type: "text", value, "aria-label": label });
  const r = await modal(title, h("div", {}, h("label", {}, label), inp), [
    { label: "Hủy", cls: "ghost", result: false },
    { label: "Lưu", value: () => inp.value.trim() || null }]);
  return r === false || r == null ? null : r;
}

export const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};
export const fmtDur = (ms) => {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};
export const fmtTime = (t) => t ? new Date(t).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";

export const STATUS = { draft: "Bản nháp", review: "Chờ duyệt", approved: "Đã duyệt", published: "Đã xuất bản" };
export const statusBadge = (s) => h("span", { class: `badge ${s === "approved" || s === "published" ? "ok" : s === "review" ? "warn" : ""}` }, STATUS[s] || s);

export const JOB = { queued: "Đang chờ", running: "Đang chạy", done: "Hoàn tất", failed: "Lỗi", cancelled: "Đã hủy" };
export const JOB_TYPE = { "import-slides": "Nhập slide", "scene-tts": "Giọng AI cảnh", "voice-test": "Thử giọng", render: "Kết xuất video", "audio-edit": "Biên tập âm thanh", podcast: "Dựng podcast" };

export function progressBar(frac) {
  return h("div", { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(frac * 100) },
    h("i", { style: { width: `${Math.round(frac * 100)}%` } }));
}

export function newSceneId() {
  const b = new Uint8Array(8); crypto.getRandomValues(b);
  return "sc_" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Vùng kéo-thả + chọn file
export function dropZone(accept, label, onFiles, multiple = true) {
  const inp = h("input", { type: "file", accept, multiple, hidden: true, onchange: () => { onFiles([...inp.files]); inp.value = ""; } });
  const z = h("div", { class: "drop", tabindex: 0, role: "button", "aria-label": label,
    onclick: () => inp.click(), onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), inp.click()),
    ondragover: (e) => { e.preventDefault(); z.classList.add("over"); },
    ondragleave: () => z.classList.remove("over"),
    ondrop: (e) => { e.preventDefault(); z.classList.remove("over"); onFiles([...e.dataTransfer.files]); } },
  h("strong", {}, label), h("br"), h("small", {}, "Kéo thả file vào đây hoặc bấm để chọn"), inp);
  return z;
}

// Thu âm bằng micro (trình duyệt) — trả về File webm
export function recorder(onDone) {
  let rec, chunks = [], stream, started = 0, timer;
  const time = h("span", { class: "muted" }, "");
  const btn = h("button", { class: "btn ghost sm", type: "button" }, "● Thu âm");
  btn.onclick = async () => {
    if (rec && rec.state === "recording") { rec.stop(); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast("Không truy cập được micro. Kiểm tra quyền micro của trình duyệt.", "err"); return; }
    chunks = []; rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(timer); stream.getTracks().forEach((t) => t.stop());
      btn.textContent = "● Thu âm"; time.textContent = "";
      const f = new File(chunks, `thu-am-${Date.now()}.webm`, { type: "audio/webm" });
      onDone(f);
    };
    rec.start(); started = Date.now();
    btn.textContent = "■ Dừng";
    timer = setInterval(() => (time.textContent = ` ${fmtDur(Date.now() - started)}`), 500);
  };
  return h("span", { class: "row" }, btn, time);
}
