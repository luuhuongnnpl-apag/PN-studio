import { get, put } from "../api.js";
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
        h("div", { class: "notice warn" }, "Mẫu giọng là dữ liệu sinh trắc cá nhân: không đưa thư mục voices lên GitHub, Drive công khai hay gửi qua chat."))));
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
      h("div", { class: "card" }, h("h2", {}, "Năng lực theo chế độ"),
        h("table", {}, h("tbody", {},
          [["Nhập PDF thành slide", "Có (pdf.js)", "Có"], ["Nhập PPTX", "Xuất PDF trước", "Có (LibreOffice)"], ["Giọng thật / thu micro", "Có", "Có"],
           ["Giọng AI cá nhân", "Không", "Có (VieNeu, CPU)"], ["MP4 1080p + SRT", "Có (ffmpeg.wasm, chậm hơn)", "Có (FFmpeg)"], ["Dùng trên máy khác", "Có, dữ liệu riêng từng trình duyệt", "Chỉ máy cài Engine"]]
            .map(([a, b, c]) => h("tr", {}, h("td", {}, a), h("td", {}, b), h("td", {}, c))))),
        h("small", {}, "Cột 2: chế độ trình duyệt · Cột 3: PNS Engine. Chuyển dự án giữa hai chế độ bằng file .pnsproj."))));
}
