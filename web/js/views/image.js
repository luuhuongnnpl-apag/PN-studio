import { post } from "../api.js";
import { h, toast, errToast } from "../ui.js";
import { pickAsset } from "./media.js";

const ASPECTS = { original: "Giữ nguyên", "16:9": "16:9 (video, slide)", "4:3": "4:3", "1:1": "1:1 (vuông)", "4:5": "4:5 (bài đăng)", "9:16": "9:16 (dọc, short)" };
const RATIO = { "16:9": [16, 9], "4:3": [4, 3], "1:1": [1, 1], "4:5": [4, 5], "9:16": [9, 16] };

// Cùng thuật toán với studios.crop_box ở Engine để khung xem trước khớp kết quả.
function cropBox(w, h, aspect, cx, cy, zoom) {
  let cw = w, ch = h;
  if (RATIO[aspect]) { const [rw, rh] = RATIO[aspect]; if (w * rh / rw <= h) { cw = w; ch = w * rh / rw; } else { cw = h * rw / rh; ch = h; } }
  cw = Math.max(1, Math.round(cw / zoom)); ch = Math.max(1, Math.round(ch / zoom));
  const x = Math.round(Math.min(Math.max(cx * w - cw / 2, 0), w - cw));
  const y = Math.round(Math.min(Math.max(cy * h - ch / 2, 0), h - ch));
  return [x, y, cw, ch];
}

const sel = (opts, cur, label) => h("select", { "aria-label": label }, Object.entries(opts).map(([k, v]) => h("option", { value: k, selected: k === cur }, v)));

function resultCard(a) {
  return h("div", { class: "card", style: { marginTop: "14px" } }, h("h3", {}, "Đã lưu vào Thư viện media"),
    h("img", { src: `/api/assets/${a.id}/file`, alt: a.name, style: { maxWidth: "100%", maxHeight: "360px", borderRadius: "8px", border: "1px solid var(--line)" } }),
    h("p", {}, h("b", {}, a.name), ` · ${a.meta.width}×${a.meta.height}`),
    h("div", { class: "row" }, h("a", { class: "btn ghost sm", href: `/api/assets/${a.id}/file?download=1` }, "Tải về"), h("a", { class: "btn ghost sm", href: "#/media" }, "Mở Thư viện media")));
}

export default async function image(view) {
  const body = h("div");
  let tab = "crop";
  const tabs = h("div", { class: "tabs", role: "tablist" }, [["crop", "Cắt & đổi kích thước"], ["cover", "Ảnh bìa bài giảng"]].map(([k, v]) =>
    h("button", { role: "tab", "aria-selected": String(k === tab), onclick: (e) => { tab = k; tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", "false")); e.target.setAttribute("aria-selected", "true"); draw(); } }, v)));
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Image Studio"),
    h("p", {}, "Cắt theo tỷ lệ, đổi kích thước, tạo ảnh bìa — không sửa file gốc, kết quả lưu thành ảnh mới"))), tabs, body);
  const draw = () => (tab === "crop" ? cropTab(body) : coverTab(body));
  draw();
}

function cropTab(box) {
  let src = null, img = null;
  const st = { aspect: "16:9", cx: 0.5, cy: 0.5, zoom: 1, rotate: 0, flip: false };
  const canvas = h("canvas", { class: "img-canvas", "aria-label": "Xem trước khung cắt — kéo để di chuyển" });
  const info = h("small", { class: "muted" });
  const f = {
    aspect: sel(ASPECTS, st.aspect, "Tỷ lệ"), zoom: h("input", { type: "range", min: 1, max: 5, step: 0.05, value: 1, "aria-label": "Phóng to" }),
    rotate: sel({ 0: "0°", 90: "90°", 180: "180°", 270: "270°" }, "0", "Xoay"), flip: h("input", { type: "checkbox" }),
    width: h("input", { type: "number", min: 0, max: 4096, step: 1, value: 1920 }), format: sel({ png: "PNG (sắc nét, slide)", jpg: "JPG (nhẹ, ảnh chụp)" }, "png", "Định dạng"),
    name: h("input", { type: "text", placeholder: "Tên ảnh mới (tùy chọn)" }) };
  const out = h("div");

  function dims() { const r = img && (st.rotate % 180) ? [img.naturalHeight, img.naturalWidth] : img ? [img.naturalWidth, img.naturalHeight] : [0, 0]; return r; }
  function paint() {
    if (!img) return;
    const [W, H] = dims();
    const scale = Math.min(760 / W, 460 / H, 1);
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    const c = canvas.getContext("2d");
    c.save(); c.translate(canvas.width / 2, canvas.height / 2); c.rotate(st.rotate * Math.PI / 180); if (st.flip) c.scale(-1, 1);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    c.drawImage(img, -dw / 2, -dh / 2, dw, dh); c.restore();
    const [x, y, cw, ch] = st.aspect === "original" && st.zoom === 1 ? [0, 0, W, H] : cropBox(W, H, st.aspect, st.cx, st.cy, st.zoom);
    c.fillStyle = "rgba(16,44,67,.55)";
    c.fillRect(0, 0, canvas.width, y * scale); c.fillRect(0, (y + ch) * scale, canvas.width, canvas.height);
    c.fillRect(0, y * scale, x * scale, ch * scale); c.fillRect((x + cw) * scale, y * scale, canvas.width, ch * scale);
    c.strokeStyle = "#c4a578"; c.lineWidth = 2; c.strokeRect(x * scale + 1, y * scale + 1, cw * scale - 2, ch * scale - 2);
    const w = +f.width.value || cw;
    info.textContent = `Gốc ${W}×${H} · vùng cắt ${cw}×${ch} → kết quả ${w}×${Math.round(ch * w / cw)}`;
  }
  let drag = null;
  canvas.onpointerdown = (e) => { if (!img) return; drag = { x: e.offsetX, y: e.offsetY, cx: st.cx, cy: st.cy }; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = (e) => { if (!drag) return; st.cx = Math.min(1, Math.max(0, drag.cx + (e.offsetX - drag.x) / canvas.width)); st.cy = Math.min(1, Math.max(0, drag.cy + (e.offsetY - drag.y) / canvas.height)); paint(); };
  canvas.onpointerup = () => (drag = null);
  f.aspect.onchange = () => { st.aspect = f.aspect.value; paint(); };
  f.zoom.oninput = () => { st.zoom = +f.zoom.value; paint(); };
  f.rotate.onchange = () => { st.rotate = +f.rotate.value; paint(); };
  f.flip.onchange = () => { st.flip = f.flip.checked; paint(); };
  f.width.oninput = paint;

  const srcLabel = h("small", {}, "Chưa chọn ảnh");
  const choose = async () => {
    const a = await pickAsset(["image", "slide"], "Chọn ảnh hoặc slide");
    if (!a) return;
    src = a; srcLabel.textContent = a.name;
    img = new Image(); img.onload = paint; img.src = `/api/assets/${a.id}/file`;
    f.width.value = Math.min(1920, a.meta.width || 1920);
  };
  const go = h("button", { class: "btn gold", onclick: async () => {
    if (!src) return toast("Chọn ảnh trước", "err");
    go.disabled = true;
    try {
      const a = await post("/api/image/transform", { assetId: src.id, ...st, width: +f.width.value || 0, format: f.format.value, name: f.name.value });
      out.replaceChildren(resultCard(a)); toast("Đã tạo ảnh mới", "ok");
    } catch (e) { errToast(e); } finally { go.disabled = false; }
  } }, "Tạo ảnh mới");

  box.replaceChildren(h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,1fr) 320px", alignItems: "start" } },
    h("div", { class: "card" }, h("div", { class: "row" }, h("button", { class: "btn ghost sm", onclick: choose }, "Chọn ảnh/slide"), srcLabel),
      h("div", { class: "img-stage" }, canvas), info, h("p", { class: "muted" }, "Kéo trên ảnh để dời khung cắt. Phần tối là phần bị cắt bỏ.")),
    h("div", { class: "card" }, h("h3", {}, "Thiết lập"),
      h("label", {}, "Tỷ lệ khung"), f.aspect, h("label", {}, "Phóng to vùng cắt"), f.zoom,
      h("div", { class: "grid g2" }, h("div", {}, h("label", {}, "Xoay"), f.rotate), h("div", {}, h("label", {}, "Chiều rộng (px, 0 = giữ)"), f.width)),
      h("label", { class: "check" }, f.flip, "Lật ngang"), h("label", {}, "Định dạng"), f.format, h("label", {}, "Tên"), f.name,
      h("div", { style: { marginTop: "12px" } }, go))), out);
}

function coverTab(box) {
  const f = { eyebrow: h("input", { type: "text", placeholder: "VD: Luật dân sự 2" }), title: h("input", { type: "text", placeholder: "VD: Chương 3. Thừa kế theo pháp luật" }),
    subtitle: h("input", { type: "text", placeholder: "VD: Điều 649–655 BLDS 2015" }), author: h("input", { type: "text", placeholder: "Giảng viên" }),
    org: h("input", { type: "text", placeholder: "Đơn vị" }), template: sel({ navy: "Navy – dải nhấn", light: "Nền trắng", photo: "Ảnh nền + phủ navy" }, "navy", "Mẫu"),
    size: sel({ "16:9": "16:9 – bìa video 1920×1080", "1:1": "1:1 – bìa podcast/bài đăng", "9:16": "9:16 – video dọc" }, "16:9", "Kích thước"),
    format: sel({ png: "PNG", jpg: "JPG" }, "png", "Định dạng") };
  let bg = null;
  const bgLabel = h("small", {}, "Chưa chọn ảnh nền");
  const bgRow = h("div", { class: "row", hidden: true }, h("button", { class: "btn ghost sm", onclick: async () => { const a = await pickAsset(["image", "slide"], "Chọn ảnh nền"); if (a) { bg = a; bgLabel.textContent = a.name; } } }, "Chọn ảnh nền"), bgLabel);
  f.template.onchange = () => (bgRow.hidden = f.template.value !== "photo");
  const out = h("div");
  const go = h("button", { class: "btn gold", onclick: async () => {
    if (!f.title.value.trim()) return toast("Nhập tiêu đề", "err");
    go.disabled = true;
    try {
      const a = await post("/api/image/cover", { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), bgAssetId: bg?.id || null });
      out.replaceChildren(resultCard(a)); toast("Đã tạo ảnh bìa", "ok");
    } catch (e) { errToast(e); } finally { go.disabled = false; }
  } }, "Tạo ảnh bìa");
  box.replaceChildren(h("div", { class: "card", style: { maxWidth: "820px" } }, h("h3", {}, "Ảnh bìa theo nhận diện Phúc Nguyên"),
    h("p", { class: "muted" }, "Chữ được ngắt dòng tự động, hỗ trợ đầy đủ dấu tiếng Việt. Dùng làm ảnh bìa video, podcast hoặc bài đăng."),
    h("div", { class: "grid g2" }, h("div", {}, h("label", {}, "Dòng nhỏ phía trên (học phần)"), f.eyebrow), h("div", {}, h("label", {}, "Tiêu đề *"), f.title),
      h("div", {}, h("label", {}, "Phụ đề / căn cứ"), f.subtitle), h("div", {}, h("label", {}, "Giảng viên"), f.author),
      h("div", {}, h("label", {}, "Đơn vị"), f.org), h("div", {}, h("label", {}, "Mẫu"), f.template),
      h("div", {}, h("label", {}, "Kích thước"), f.size), h("div", {}, h("label", {}, "Định dạng"), f.format)),
    h("div", { style: { marginTop: "10px" } }, bgRow), h("div", { style: { marginTop: "12px" } }, go)), out);
}
