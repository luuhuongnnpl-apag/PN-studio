import { detectEngine, engine, get } from "./api.js";
import { MODULES, ICONS } from "./modules.js";
import { h, $ } from "./ui.js";
import { ctx } from "./state.js";
import home from "./views/home.js";
import dashboard from "./views/dashboard.js";
import projects from "./views/projects.js";
import media from "./views/media.js";
import voice from "./views/voice.js";
import lecture from "./views/lecture.js";
import video from "./views/video.js";
import publish from "./views/publish.js";
import settings from "./views/settings.js";
import { unavailable, needEngine } from "./views/unavailable.js";

const VIEWS = { "": home, dashboard, projects, media, voice, lecture, video, publish, settings };
let cleanup = null;

function buildNav() {
  const nav = $("#nav");
  nav.replaceChildren(h("a", { class: "nav-item", href: "#/", "data-id": "" }, h("span", { html: ICONS.home }), "Trang chủ"));
  let group = "";
  for (const m of MODULES) {
    if (m.group !== group) { group = m.group; nav.append(h("div", { class: "nav-group" }, group)); }
    nav.append(h("a", { class: "nav-item", href: `#/${m.id}`, "data-id": m.id },
      h("span", { html: ICONS[m.id] }), m.name, m.status !== "ready" && h("span", { class: "tag" }, m.status.toUpperCase())));
  }
}

function engineBadge() {
  const pill = $("#engine-pill");
  if (engine.mode === "browser") {
    pill.replaceChildren(h("div", {}, h("span", { class: "dot ok" }), "Chế độ trình duyệt"),
      h("small", {}, "Dữ liệu lưu trên trình duyệt này · Giọng AI cần PNS Engine"));
  } else if (engine.available) {
    const t = engine.health.tts;
    pill.replaceChildren(h("div", {}, h("span", { class: "dot ok" }), `PNS Engine ${engine.health.version}`),
      h("small", {}, t.installed ? "Giọng AI: đã cài" : "Giọng AI: chưa cài"));
  } else {
    pill.replaceChildren(h("div", {}, h("span", { class: "dot off" }), "Chế độ web"),
      h("small", {}, "Sản xuất cần PNS Engine trên máy"));
  }
}

export async function renderCtx() {
  const el = $("#ctx");
  const p = ctx.project();
  if (!engine.available || !p) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `Dự án: ${p.title}`;
  el.href = `#/lecture/${p.id}`;
}

async function route() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const [path, qs = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const [id = "", ...args] = path.split("/").map(decodeURIComponent);
  const query = new URLSearchParams(qs);
  const mod = MODULES.find((m) => m.id === id);
  document.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.id === id));
  document.querySelectorAll(".nav-item").forEach((a) => a.dataset.id === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const view = $("#view");
  view.className = "";
  view.replaceChildren();
  $(".sidebar").classList.remove("open");
  $("#crumbs").replaceChildren(h("span", {}, "Phúc Nguyên Studio", mod ? [" / ", h("b", {}, mod.name)] : ""));
  document.title = (mod ? mod.name + " · " : "") + "Phúc Nguyên Studio";
  try {
    if (mod && mod.status !== "ready") cleanup = unavailable(view, mod);
    else if (!VIEWS[id]) view.append(h("div", { class: "empty" }, "Không tìm thấy trang. ", h("a", { href: "#/" }, "Về trang chủ")));
    else if (id && !engine.available) cleanup = needEngine(view, mod);
    else if (id === "voice" && engine.mode === "browser") cleanup = needEngine(view, mod, true);
    else cleanup = (await VIEWS[id](view, args, query)) || null;
  } catch (e) {
    view.append(h("div", { class: "notice err" }, "Lỗi hiển thị: ", e.message || String(e)));
  }
  renderCtx();
  view.focus({ preventScroll: true });
}

async function pollJobs() {
  if (!engine.available || document.hidden) return;
  try {
    const d = await get("api/jobs");
    const active = d.filter((j) => j.status === "running" || j.status === "queued");
    $("#jobs-mini").textContent = active.length ? `⏳ ${active.length} job đang xử lý` : "";
  } catch { $("#jobs-mini").textContent = "⚠ Mất kết nối Engine"; }
}

async function main() {
  buildNav();
  await detectEngine();
  engineBadge();
  $("#menu").onclick = () => $(".sidebar").classList.toggle("open");
  window.addEventListener("hashchange", route);
  await route();
  setInterval(pollJobs, 3000);
}
main();
