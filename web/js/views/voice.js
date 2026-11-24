import { del, get, patch, post, put, upload, waitJob } from "../api.js";
import { h, toast, errToast, confirmBox, fmtDur, fmtTime, progressBar, recorder } from "../ui.js";

const TEST_TEXT = "Chào các em. Khi giải quyết tình huống thừa kế, trước hết cần xác định di sản. Theo Điều 612 BLDS 2015, di sản bao gồm tài sản riêng của người chết và phần tài sản của người chết trong tài sản chung với người khác.";

export default async function voice(view) {
  const body = h("div");
  let tab = "voices";
  const tabs = h("div", { class: "tabs", role: "tablist" },
    [["voices", "Giọng nói"], ["dict", "Từ điển đọc"]].map(([k, v]) => h("button", { role: "tab", "aria-selected": String(k === tab),
      onclick: (e) => { tab = k; tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", "false")); e.target.setAttribute("aria-selected", "true"); render(); } }, v)));
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Voice Studio"),
    h("p", {}, "Giọng thật hoặc giọng AI cá nhân — mẫu giọng chỉ lưu trên máy này, không tải lên web"))), tabs, body);
  const render = () => (tab === "voices" ? voices(body) : dictionary(body)).catch(errToast);
  await render();
}

async function voices(box) {
  const { voices: list, engine: st } = await get("api/voices");
  const status = st.bridge && !st.connected
    ? h("div", { class: "notice warn" }, h("strong", {}, "Giọng AI chạy trên PNS Engine của máy này. "),
      st.paired ? `Chưa kết nối được (${st.lastError || "Engine đang tắt"}). ` : "Chưa ghép nối. ",
      "Mẫu giọng vẫn lưu và quản lý được ở đây; để sinh giọng: mở START_PNS.bat → ", h("a", { href: "#/settings" }, "Cài đặt → Giọng AI qua PNS Engine"), ".",
      h("button", { class: "btn ghost sm", style: { marginLeft: "8px" }, onclick: async () => { await get("api/voices?refresh=1"); voices(box); } }, "Kiểm tra lại"))
    : st.installed
    ? h("div", { class: "notice ok" }, h("strong", {}, `${st.engine} ${st.version || ""} đã cài. `),
      `Cấu hình: ${st.config.mode}, ${st.config.precision}. `, st.loaded ? "Model đã nạp." : "Model sẽ nạp ở lần sinh giọng đầu tiên (lần đầu tải trọng số từ Hugging Face).",
      st.lastError && h("div", { style: { color: "var(--err)" } }, "Lỗi gần nhất: ", st.lastError),
      st.lastBenchmark && h("div", {}, `Đo gần nhất: ${st.lastBenchmark.seconds}s xử lý cho ${st.lastBenchmark.audioSeconds}s âm thanh (RTF ${st.lastBenchmark.rtf})`, st.lastBenchmark.rssMB ? `, RAM tiến trình ${st.lastBenchmark.rssMB} MB` : ""))
    : h("div", { class: "notice warn" }, h("strong", {}, "Chưa cài giọng AI (VieNeu-TTS). "),
      "Chạy INSTALL_VOICE_AI.bat trong thư mục PNS rồi khởi động lại Engine. Trong lúc chờ, giọng thu âm thật vẫn dùng bình thường cho mọi cảnh.");

  // Form thêm mẫu giọng
  const f = { name: h("input", { type: "text", value: "Giọng của tôi" }), owner: h("input", { type: "text", placeholder: "Họ tên người sở hữu giọng" }),
    start: h("input", { type: "number", min: 0, step: 0.1, value: 0 }), end: h("input", { type: "number", min: 0, step: 0.1, value: 0 }),
    consent: h("input", { type: "checkbox" }) };
  let file = null;
  const picked = h("small", {}, "Chưa chọn mẫu");
  const preview = h("audio", { controls: true, hidden: true });
  const setFile = (x) => { file = x; picked.textContent = `${x.name} (${(x.size / 1024).toFixed(0)} KB)`; preview.src = URL.createObjectURL(x); preview.hidden = false; };
  const fileInp = h("input", { type: "file", accept: ".wav,.m4a,.mp3,.ogg,.flac,.webm", hidden: true, onchange: () => fileInp.files[0] && setFile(fileInp.files[0]) });
  const prog = h("div");
  const add = h("div", { class: "card" }, h("h2", {}, "Thêm mẫu giọng"),
    h("p", { class: "muted" }, "Mẫu sạch 3–15 giây, một người nói, không nhạc nền. Có thể cắt đoạn bằng mốc giây."),
    h("div", { class: "row" }, h("button", { class: "btn ghost sm", onclick: () => fileInp.click() }, "Chọn file"), fileInp, recorder(setFile), picked), preview,
    h("div", { class: "grid g2" }, h("div", {}, h("label", {}, "Tên giọng"), f.name), h("div", {}, h("label", {}, "Người sở hữu giọng"), f.owner),
      h("div", {}, h("label", {}, "Cắt từ giây"), f.start), h("div", {}, h("label", {}, "đến giây (0 = hết)"), f.end)),
    h("label", { class: "check" }, f.consent, "Tôi xác nhận có quyền sử dụng giọng nói này và đồng ý tạo âm thanh AI từ mẫu; mẫu chỉ lưu trên máy cá nhân (bản web: trong trình duyệt này, chỉ gửi tới PNS Engine trên chính máy khi sinh giọng)."),
    prog,
    h("button", { class: "btn gold", onclick: async () => {
      if (!file) return toast("Chọn hoặc thu mẫu giọng", "err");
      if (!f.consent.checked) return toast("Cần xác nhận quyền sử dụng giọng nói", "err");
      if (!f.owner.value.trim()) return toast("Nhập tên người sở hữu giọng", "err");
      try {
        prog.replaceChildren(progressBar(0.3));
        await upload("api/voices", file, { name: f.name.value, owner: f.owner.value, consent: "yes",
          startMs: Math.round(+f.start.value * 1000), endMs: Math.round(+f.end.value * 1000) });
        toast("Đã lưu mẫu giọng", "ok"); voices(box);
      } catch (e) { prog.replaceChildren(); errToast(e); }
    } }, "Lưu mẫu giọng"));

  box.replaceChildren(status, h("div", { class: "grid g2", style: { alignItems: "start" } },
    h("div", {}, list.length ? list.map((v) => voiceCard(v, st, () => voices(box))) : h("div", { class: "empty" }, "Chưa có mẫu giọng.")), add));
}

function voiceCard(v, st, reload) {
  const text = h("textarea", { style: { minHeight: "110px" }, value: TEST_TEXT, "aria-label": "Câu thử giọng" });
  const out = h("div");
  const warn = v.meta.warning && h("div", { class: "notice warn" }, v.meta.warning);
  return h("div", { class: "card", style: { marginBottom: "14px" } },
    h("div", { class: "row" }, h("h3", { style: { margin: 0 } }, v.name), v.meta.approved ? h("span", { class: "badge ok" }, "Đã duyệt độ giống") : h("span", { class: "badge warn" }, "Chưa duyệt"),
      h("span", { class: "spacer" }), h("small", {}, fmtDur(v.meta.durationMs))),
    h("small", {}, `Chủ sở hữu: ${v.consent.owner || "—"} · xác nhận quyền ${fmtTime(v.consent.confirmedAt)}`),
    h("audio", { controls: true, src: `api/voices/${v.id}/sample`, preload: "none" }), warn,
    h("label", {}, "Thử giọng AI với câu mẫu (số và viết tắt được đọc theo từ điển)"), text,
    h("div", { class: "row", style: { marginTop: "8px" } },
      h("button", { class: "btn sm", disabled: !st.installed, title: st.installed ? "" : st.bridge ? "Chưa kết nối PNS Engine" : "Chưa cài VieNeu-TTS", onclick: async (e) => {
        e.target.disabled = true;
        try {
          const job = await post(`api/voices/${v.id}/test`, { text: text.value });
          const j = await waitJob(job, (x) => out.replaceChildren(progressBar(x.progress), h("small", {}, x.message || "")));
          if (j.status !== "done") { out.replaceChildren(h("div", { class: "notice err" }, "Không sinh được giọng: ", j.error || j.status)); return; }
          const r = j.result;
          out.replaceChildren(h("audio", { controls: true, src: `api/voices/${v.id}/tests/${r.file}` }),
            h("small", {}, `Xử lý ${r.seconds}s cho ${r.audioSeconds}s âm thanh · RTF ${r.rtf}${r.rssMB ? ` · RAM ${r.rssMB} MB` : ""} · ${r.chunks} đoạn`),
            h("details", {}, h("summary", {}, "Văn bản đã đọc"), h("p", {}, r.spoken)));
        } catch (er) { errToast(er); } finally { e.target.disabled = !st.installed; }
      } }, "Sinh câu thử"),
      h("button", { class: "btn ghost sm", onclick: async () => { await patch(`api/voices/${v.id}`, { approved: !v.meta.approved }); reload(); } }, v.meta.approved ? "Bỏ duyệt" : "Duyệt độ giống"),
      h("button", { class: "btn danger sm", onclick: async () => { if (await confirmBox("Xóa mẫu giọng?", "Mẫu giọng và các câu thử sẽ bị xóa khỏi máy. Âm thanh đã tạo trong dự án vẫn giữ.", "Xóa", true)) { await del(`api/voices/${v.id}`); reload(); } } }, "Xóa")),
    out);
}

async function dictionary(box) {
  let entries = await get("api/dictionary");
  const tbody = h("tbody");
  const draw = () => tbody.replaceChildren(...entries.map((e, i) => h("tr", {},
    h("td", {}, h("input", { type: "text", value: e.written, "aria-label": "Viết", oninput: (ev) => (e.written = ev.target.value) })),
    h("td", {}, h("input", { type: "text", value: e.spoken, "aria-label": "Đọc", oninput: (ev) => (e.spoken = ev.target.value) })),
    h("td", {}, h("button", { class: "icon-btn", "aria-label": "Xóa dòng", onclick: () => { entries.splice(i, 1); draw(); } }, "×")))));
  draw();
  const src = h("textarea", { style: { minHeight: "90px" }, value: "Theo Điều 612 BLDS 2015, khoản 1 Điều 651; mức 1.500.000 đồng (2,5%). Luật 91/2015/QH13 có hiệu lực từ 01/01/2017." });
  const outp = h("p", { class: "notice info" });
  const prev = async () => { outp.textContent = (await post("api/dictionary/preview", { text: src.value })).spoken; };
  box.replaceChildren(h("div", { class: "grid g2", style: { alignItems: "start" } },
    h("div", { class: "card" }, h("h2", {}, "Từ điển viết tắt"),
      h("p", { class: "muted" }, "Văn bản gốc (phụ đề) giữ nguyên; chỉ văn bản phát âm được chuyển đổi. Số, Điều/khoản, ngày tháng, số hiệu văn bản được đọc tự động."),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Viết"), h("th", {}, "Đọc thành"), h("th", {}))), tbody),
      h("div", { class: "row", style: { marginTop: "10px" } },
        h("button", { class: "btn ghost sm", onclick: () => { entries.push({ written: "", spoken: "" }); draw(); tbody.lastChild.querySelector("input").focus(); } }, "+ Thêm dòng"),
        h("button", { class: "btn sm", onclick: async () => { try { entries = await put("api/dictionary", entries); draw(); toast("Đã lưu từ điển", "ok"); prev(); } catch (e) { errToast(e); } } }, "Lưu từ điển"))),
    h("div", { class: "card" }, h("h2", {}, "Xem trước cách đọc"), src, h("button", { class: "btn ghost sm", style: { margin: "8px 0" }, onclick: prev }, "Chuyển đổi"), outp)));
  prev();
}
