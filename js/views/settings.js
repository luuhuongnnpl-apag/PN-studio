import { get, post, put } from "../api.js";
import { h, toast, errToast, fmtBytes } from "../ui.js";

export default async function settings(view) {
  const { engine } = await import("../api.js");
  if (engine.mode === "browser") return browserSettings(view);
  const [hl, st, dash] = await Promise.all([get("api/health"), get("api/settings"), get("api/dashboard")]);
  const f = {
    pnl: h("input", { type: "url", value: st.app.pnlUrl, placeholder: "https://… (địa chỉ PNL)" }),
    pnd: h("input", { type: "url", value: st.app.pndUrl, placeholder: "https://… (địa chỉ PND)" }),
    mode: h("select", {}, [["v3turbo", "v3 Turbo — chất lượng cao (mặc định)"], ["v3nano", "v3 Nano — cho CPU yếu"]].map(([k, v]) => h("option", { value: k, selected: st.tts.mode === k }, v))),
    prec: h("select", {}, [["fp32", "fp32 — an toàn mọi CPU"], ["int8", "int8 — nhanh hơn, cần CPU hỗ trợ VNNI"]].map(([k, v]) => h("option", { value: k, selected: st.tts.precision === k }, v))),
    threads: h("input", { type: "number", min: 0, max: 32, value: st.tts.threads }),
  };
  const u = dash.usage;
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Cài đặt"), h("p", {}, "Engine, lưu trữ, giọng AI, liên kết hệ sinh thái, sao lưu"))),
    h("div", { class: "grid g2", style: { alignItems: "start" } },
      h("div", { class: "card" }, h("h2", {}, "PNS Engine"),
        h("dl", { class: "kv" },
          h("dt", {}, "Phiên bản"), h("dd", {}, `${hl.version} (schema ${hl.schemaVersion})`),
          h("dt", {}, "FFmpeg"), h("dd", {}, hl.ffmpeg || h("span", { class: "badge err" }, "Chưa có")),
          h("dt", {}, "LibreOffice (PPTX)"), h("dd", {}, hl.libreoffice ? "Có" : "Chưa cài — hãy xuất PDF từ PowerPoint"),
          h("dt", {}, "Giọng AI"), h("dd", {}, hl.tts.installed ? `${hl.tts.engine} ${hl.tts.version || ""}` : "Chưa cài (chạy INSTALL_VOICE_AI.bat)"),
          h("dt", {}, "Giấy phép model"), h("dd", {}, hl.tts.license),
          h("dt", {}, "Địa chỉ"), h("dd", {}, `${location.origin} — chỉ máy này truy cập được`),
          h("dt", {}, "Thư mục dữ liệu"), h("dd", { class: "mono" }, hl.dataDir))),
      h("div", { class: "card" }, h("h2", {}, "Giọng AI (VieNeu-TTS, CPU)"),
        h("label", {}, "Model"), f.mode, h("label", {}, "Độ chính xác"), f.prec, h("label", {}, "Số luồng CPU (0 = tự động)"), f.threads,
        h("p", { class: "muted" }, "Đổi cấu hình sẽ làm các cảnh giọng AI cần sinh lại. Hãy thử giọng và ghi thời gian/RAM ở Voice Studio trước khi chọn."),
        h("button", { class: "btn", onclick: async () => { try { await put("api/settings", { tts: { mode: f.mode.value, precision: f.prec.value, threads: +f.threads.value } }); toast("Đã lưu cấu hình giọng", "ok"); } catch (e) { errToast(e); } } }, "Lưu")),
      h("div", { class: "card" }, h("h2", {}, "Liên kết hệ sinh thái"),
        h("label", {}, "Phúc Nguyên Library (PNL)"), f.pnl, h("label", {}, "Phúc Nguyên Digital (PND)"), f.pnd,
        h("p", { class: "muted" }, "Chỉ dùng để mở nhanh từ Trung tâm xuất bản. PNS không đọc hay ghi dữ liệu của PNL/PND."),
        h("button", { class: "btn", onclick: async () => { try { const r = await put("api/settings", { app: { pnlUrl: f.pnl.value.trim(), pndUrl: f.pnd.value.trim() } }); f.pnl.value = r.app.pnlUrl; f.pnd.value = r.app.pndUrl; toast("Đã lưu (chỉ nhận https://)", "ok"); } catch (e) { errToast(e); } } }, "Lưu")),
      h("div", { class: "card" }, h("h2", {}, "Lưu trữ & sao lưu"),
        h("dl", { class: "kv" }, h("dt", {}, "Media"), h("dd", {}, fmtBytes(u.assets)), h("dt", {}, "Mẫu giọng"), h("dd", {}, fmtBytes(u.voices)),
          h("dt", {}, "Bộ nhớ đệm"), h("dd", {}, fmtBytes(u.cache)), h("dt", {}, "Video"), h("dd", {}, fmtBytes(u.renders)), h("dt", {}, "Ổ đĩa trống"), h("dd", {}, fmtBytes(u.diskFree))),
        h("ul", {},
          h("li", {}, "Sao lưu từng dự án: Dự án → Sao lưu (file .pnsproj gồm kịch bản, slide, âm thanh; không gồm mẫu giọng)."),
          h("li", {}, "Khôi phục: Dự án → Khôi phục từ .pnsproj."),
          h("li", {}, "Sao lưu toàn bộ: đóng Engine rồi sao chép nguyên thư mục dữ liệu ở trên sang ổ khác.")),
        h("div", { class: "notice warn" }, "Mẫu giọng là dữ liệu sinh trắc cá nhân: không đưa thư mục voices lên GitHub, Drive công khai hay gửi qua chat.")),
      await engineBridgeCard()));
}

// PNS Engine: cho phép bản web (GitHub Pages) dùng giọng AI của máy này
async function engineBridgeCard() {
  let info = await get("api/bridge");
  const box = h("div");
  const origins = h("textarea", { style: { minHeight: "60px" }, "aria-label": "Trang web được phép" });
  const draw = () => {
    origins.value = info.origins.join("\n");
    const link = `${info.webUrl}#/settings?bridge=${encodeURIComponent(info.key)}&engine=${encodeURIComponent(`http://127.0.0.1:${info.port}`)}`;
    box.replaceChildren(
      h("a", { class: "btn gold", href: link, target: "_blank", rel: "noopener" }, "Kết nối bản web với máy này"),
      h("p", { class: "muted" }, "Mở bản web PNS kèm khóa ghép nối (một lần cho mỗi trình duyệt). Sau đó bản web sinh giọng AI cá nhân bằng Engine này mỗi khi cửa sổ START_PNS đang mở."),
      h("details", {}, h("summary", {}, "Ghép nối thủ công"),
        h("dl", { class: "kv" }, h("dt", {}, "Địa chỉ Engine"), h("dd", { class: "mono" }, `http://127.0.0.1:${info.port}`),
          h("dt", {}, "Khóa ghép nối"), h("dd", { class: "mono", style: { wordBreak: "break-all" } }, info.key)),
        h("label", {}, "Trang web được phép (mỗi dòng một địa chỉ https://…)"), origins,
        h("div", { class: "row", style: { marginTop: "8px" } },
          h("button", { class: "btn ghost sm", onclick: async () => { try { info = await put("api/bridge/origins", { origins: origins.value.split(/\s+/).filter(Boolean) }); draw(); toast("Đã lưu", "ok"); } catch (e) { errToast(e); } } }, "Lưu danh sách"),
          h("button", { class: "btn danger sm", onclick: async () => { try { info = await post("api/bridge/rotate"); draw(); toast("Đã đổi khóa — trình duyệt cũ phải ghép nối lại", "ok"); } catch (e) { errToast(e); } } }, "Đổi khóa"))));
  };
  draw();
  return h("div", { class: "card" }, h("h2", {}, "Cầu nối bản web"),
    h("p", { class: "muted" }, "Bản web chỉ được gọi một việc: sinh giọng từ văn bản và mẫu giọng nó gửi kèm. Không đọc dự án, thư viện hay mẫu giọng lưu trong Engine; mẫu gửi lên bị xóa ngay sau khi sinh."), box);
}

async function browserSettings(view) {
  const [st, dash] = await Promise.all([get("api/settings"), get("api/dashboard")]);
  const u = dash.usage;
  const persisted = (await navigator.storage?.persisted?.()) || false;
  const pnl = h("input", { type: "url", value: st.app.pnlUrl, placeholder: "https://… (địa chỉ PNL)" });
  const pnd = h("input", { type: "url", value: st.app.pndUrl, placeholder: "https://… (địa chỉ PND)" });
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Cài đặt"), h("p", {}, "Chế độ trình duyệt"))),
    h("div", { class: "grid g2", style: { alignItems: "start" } },
      h("div", { class: "card" }, h("h2", {}, "Lưu trữ trên trình duyệt"),
        h("dl", { class: "kv" }, h("dt", {}, "Media"), h("dd", {}, fmtBytes(u.assets)), h("dt", {}, "Video"), h("dd", {}, fmtBytes(u.renders)),
          h("dt", {}, "Bộ nhớ đệm"), h("dd", {}, fmtBytes(u.cache)), h("dt", {}, "Còn trống cho PNS"), h("dd", {}, fmtBytes(u.diskFree)),
          h("dt", {}, "Lưu bền vững"), h("dd", {}, persisted ? "Đã bật — trình duyệt không tự xóa dữ liệu" : "Chưa bật — trình duyệt có thể xóa khi thiếu dung lượng")),
        h("div", { class: "notice warn" }, "Dữ liệu chỉ nằm trong trình duyệt này trên máy này; xóa dữ liệu duyệt web sẽ mất dự án. Hãy sao lưu .pnsproj định kỳ (Dự án → Sao lưu)."),
        h("button", { class: "btn ghost", onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? "Đã bật lưu bền vững" : "Trình duyệt chưa cho phép — hãy cài trang như ứng dụng hoặc đánh dấu trang", ok ? "ok" : "err"); } }, "Bật lưu bền vững")),
      h("div", { class: "card" }, h("h2", {}, "Liên kết hệ sinh thái"), h("label", {}, "Phúc Nguyên Library (PNL)"), pnl, h("label", {}, "Phúc Nguyên Digital (PND)"), pnd,
        h("button", { class: "btn", style: { marginTop: "10px" }, onclick: async () => { try { await put("api/settings", { app: { pnlUrl: pnl.value.trim(), pndUrl: pnd.value.trim() } }); toast("Đã lưu (chỉ nhận https://)", "ok"); } catch (e) { errToast(e); } } }, "Lưu")),
      await browserBridgeCard(),
      h("div", { class: "card" }, h("h2", {}, "Năng lực theo chế độ"),
        h("table", {}, h("tbody", {},
          [["Nhập PDF thành slide", "Có (pdf.js)", "Có"], ["Nhập PPTX", "Xuất PDF trước", "Có (LibreOffice)"], ["Giọng thật / thu micro", "Có", "Có"],
           ["Giọng AI cá nhân", "Có — sinh trên PNS Engine của máy qua cầu nối", "Có (VieNeu, CPU)"], ["MP4 1080p + SRT", "Có (ffmpeg.wasm, chậm hơn)", "Có (FFmpeg)"], ["Dùng trên máy khác", "Có, dữ liệu riêng từng trình duyệt", "Chỉ máy cài Engine"]]
            .map(([a, b, c]) => h("tr", {}, h("td", {}, a), h("td", {}, b), h("td", {}, c))))),
        h("small", {}, "Cột 2: chế độ trình duyệt · Cột 3: PNS Engine. Chuyển dự án giữa hai chế độ bằng file .pnsproj."))));
}

// Bản web: ghép nối với PNS Engine trên máy để sinh giọng AI cá nhân
async function browserBridgeCard() {
  const B = await import("../local/bridge.js");
  const c = B.getCfg();
  const url = h("input", { type: "url", value: c.url });
  const key = h("input", { type: "password", value: c.key, placeholder: "Dán khóa ghép nối từ Cài đặt của PNS Engine", autocomplete: "off" });
  const out = h("div");
  const check = async () => {
    out.replaceChildren(h("small", {}, "Đang kiểm tra…"));
    const st = await B.status(true);
    out.replaceChildren(st.connected
      ? h("div", { class: "notice ok" }, h("strong", {}, `Đã kết nối PNS Engine ${st.version}. `),
        st.tts?.installed ? `Giọng AI sẵn sàng (${st.model}).` : "Engine chưa cài VieNeu-TTS — chạy INSTALL_VOICE_AI.bat trên máy.")
      : h("div", { class: "notice warn" }, st.error || "Chưa kết nối"));
  };
  setTimeout(check, 0);
  return h("div", { class: "card" }, h("h2", {}, "Giọng AI qua PNS Engine"),
    h("p", { class: "muted" }, "Giọng AI từ giọng thật của bạn được sinh bởi PNS Engine chạy trên chính máy này (VieNeu-TTS, CPU, miễn phí). Cách nhanh nhất: trên máy mở START_PNS.bat → Cài đặt → «Kết nối bản web với máy này»."),
    h("label", {}, "Địa chỉ Engine"), url, h("label", {}, "Khóa ghép nối"), key,
    h("div", { class: "row", style: { marginTop: "10px" } },
      h("button", { class: "btn", onclick: async () => { try { B.setCfg({ url: url.value, key: key.value }); toast("Đã lưu", "ok"); check(); } catch (e) { errToast(e); } } }, "Lưu & kiểm tra"),
      h("button", { class: "btn ghost sm", onclick: check }, "Kiểm tra lại")),
    out,
    h("small", { class: "muted" }, "Chrome/Edge có thể hỏi «cho phép trang truy cập thiết bị trong mạng cục bộ» — chọn Cho phép. Safari chưa hỗ trợ kết nối này."));
}
