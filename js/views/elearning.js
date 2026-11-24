import { del, get, post, put, saveBlob } from "../api.js";
import { h, toast, errToast, confirmBox, promptBox, fmtBytes, fmtDur, fmtTime, progressBar } from "../ui.js";
import { pickAsset } from "./media.js";

const L = "ABCDEF";

// Bỏ phương án trống nhưng giữ đúng vị trí đáp án đúng
export function compact(q) {
  const keep = q.options.map((o, i) => [o, i]).filter(([o]) => o.trim());
  return { ...q, options: keep.map(([o]) => o), correct: keep.findIndex(([, i]) => i === q.correct) };
}

// Nhập nhanh câu hỏi: «Câu 1. …» / «1. …», phương án «A. …», đáp án đúng đánh dấu «*A.» hoặc dòng «Đáp án: A», «Giải thích: …»
export function parseQuestions(text) {
  const out = []; let q = null;
  const flush = () => { if (q && q.text && q.options.length >= 2) out.push(q); q = null; };
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const ln = raw.trim();
    if (!ln) continue;
    let m;
    if ((m = ln.match(/^(?:câu\s*)?(\d{1,3})\s*[.:)]\s*(.+)$/i))) { flush(); q = { text: m[2].trim(), options: [], correct: -1, explain: "" }; continue; }
    if (!q) { q = { text: ln, options: [], correct: -1, explain: "" }; continue; }
    if ((m = ln.match(/^(\*?)\s*([A-Fa-f])\s*[.)]\s*(\*?)\s*(.+)$/)) && q.options.length < 6) {
      if (m[1] || m[3] || /\*\s*$/.test(m[4])) q.correct = q.options.length;
      q.options.push(m[4].replace(/\s*\*\s*$/, "").trim()); continue;
    }
    if ((m = ln.match(/^đáp án\s*(?:đúng)?\s*[:：]\s*([A-Fa-f])\b/i))) { q.correct = L.indexOf(m[1].toUpperCase()); continue; }
    if ((m = ln.match(/^(?:giải thích|căn cứ)\s*[:：]\s*(.+)$/i))) { q.explain = (q.explain ? q.explain + " " : "") + m[1].trim(); continue; }
    if (q.options.length) q.options[q.options.length - 1] += " " + ln; else q.text += " " + ln;
  }
  flush();
  return out;
}

export default async function elearning(view, args) {
  const id = args[0];
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Học liệu điện tử"),
    h("p", {}, "Ghép các video bài giảng thành học liệu có mục lục, lời giảng, căn cứ pháp lý, tài liệu, câu hỏi trong video và bài kiểm tra cuối — xuất gói web hoặc SCORM 1.2 cho Moodle/LMS"))));
  if (!id) return listPage(view);
  return editor(view, id);
}

async function listPage(view) {
  const list = await get("api/elearning");
  const create = async () => {
    const title = await promptBox("Học liệu mới", "Tên học liệu", "");
    if (!title) return;
    try { const p = await post("api/elearning", { title }); location.hash = `#/elearning/${p.id}`; } catch (e) { errToast(e); }
  };
  view.append(h("div", { class: "row", style: { marginBottom: "14px" } }, h("button", { class: "btn gold", onclick: create }, "+ Tạo học liệu mới")),
    list.length ? h("div", { class: "grid g3" }, list.map((p) => h("a", { class: "card", href: `#/elearning/${p.id}`, style: { textDecoration: "none", color: "inherit" } },
      h("h3", { style: { marginTop: 0 } }, p.title), h("p", { class: "muted" }, p.course || "—"), h("small", {}, `${p.lessons} bài · sửa ${fmtTime(p.updatedAt)}`))))
      : h("div", { class: "empty" }, "Chưa có học liệu. Mỗi học liệu gồm một hoặc nhiều video bài giảng đã kết xuất ở Video Studio."));
}

async function editor(view, id) {
  let pkg, projects;
  try { [pkg, projects] = await Promise.all([get(`api/elearning/${id}`), get("api/projects")]); }
  catch (e) { view.append(h("div", { class: "notice err" }, e.message, " ", h("a", { href: "#/elearning" }, "Về danh sách"))); return; }
  projects = projects.filter((p) => !p.archived);
  const assets = new Map((await get("api/assets")).map((a) => [a.id, a]));
  const renderCache = new Map();
  const rendersOf = async (pid) => { if (!renderCache.has(pid)) renderCache.set(pid, await get(`api/projects/${pid}/renders`).catch(() => [])); return renderCache.get(pid); };
  let dirty = false;
  const mark = () => { dirty = true; saveBtn.textContent = "Lưu*"; };

  // ----- thông tin chung -----
  const f = { title: h("input", { type: "text", value: pkg.title }), course: h("input", { type: "text", value: pkg.course, placeholder: "VD: Luật Dân sự 2 – Chương 3" }),
    author: h("input", { type: "text", value: pkg.author, placeholder: "Giảng viên" }), org: h("input", { type: "text", value: pkg.org, placeholder: "Đơn vị" }),
    description: h("textarea", { style: { minHeight: "80px" }, value: pkg.description }), objectives: h("textarea", { style: { minHeight: "90px" }, value: pkg.objectives.join("\n"), placeholder: "Mỗi dòng một mục tiêu, VD: Xác định được di sản thừa kế theo Điều 612 BLDS 2015" }),
    minWatch: h("input", { type: "number", min: 50, max: 100, value: pkg.completion.minWatch }) };
  Object.values(f).forEach((x) => x.addEventListener("input", mark));
  let cover = pkg.coverAssetId;
  const coverLab = h("small", {}, cover && assets.get(cover) ? assets.get(cover).name : "Chưa chọn");
  const info = h("div", { class: "card" }, h("h2", {}, "Thông tin chung"),
    h("label", {}, "Tên học liệu"), f.title, h("div", { class: "grid g3" }, h("div", {}, h("label", {}, "Học phần / chương"), f.course), h("div", {}, h("label", {}, "Giảng viên"), f.author), h("div", {}, h("label", {}, "Đơn vị"), f.org)),
    h("label", {}, "Giới thiệu"), f.description, h("label", {}, "Mục tiêu học tập"), f.objectives,
    h("div", { class: "grid g2" }, h("div", {}, h("label", {}, "Hoàn thành bài khi xem tối thiểu (%)"), f.minWatch),
      h("div", {}, h("label", {}, "Ảnh bìa (tùy chọn)"), h("div", { class: "row" }, coverLab,
        h("button", { class: "btn ghost sm", onclick: async () => { const a = await pickAsset(["image", "slide"], "Ảnh bìa học liệu"); if (a) { cover = a.id; assets.set(a.id, a); coverLab.textContent = a.name; mark(); } } }, "Chọn"),
        h("button", { class: "btn ghost sm", onclick: () => { cover = null; coverLab.textContent = "Chưa chọn"; mark(); } }, "Bỏ")))));

  // ----- bài học -----
  const lessons = pkg.lessons.map((x) => ({ ...x, attachments: [...x.attachments] }));
  const lessonBox = h("div");
  async function drawLessons() {
    const cards = [];
    for (const [i, ls] of lessons.entries()) cards.push(await lessonCard(ls, i));
    lessonBox.replaceChildren(...(cards.length ? cards : [h("div", { class: "empty" }, "Chưa có bài. Bấm «+ Thêm bài» và chọn dự án đã kết xuất video.")]));
  }
  async function lessonCard(ls, i) {
    const rs = await rendersOf(ls.projectId);
    if (!ls.renderId || !rs.some((r) => r.id === ls.renderId)) { const best = rs.find((r) => r.approval && r.quality === "final") || rs[0]; if (ls.renderId !== (best?.id || null)) { ls.renderId = best?.id || null; mark(); } }
    const cur = rs.find((r) => r.id === ls.renderId);
    const psel = h("select", { "aria-label": "Dự án bài giảng", onchange: async () => { ls.projectId = psel.value; ls.renderId = null; const p = projects.find((x) => x.id === ls.projectId); if (p && (!ls.title || /^Bài \d+$/.test(ls.title))) ls.title = p.title; mark(); drawLessons(); } },
      projects.map((p) => h("option", { value: p.id, selected: p.id === ls.projectId }, p.title)));
    const rsel = h("select", { "aria-label": "Bản kết xuất", onchange: () => { ls.renderId = rsel.value || null; mark(); drawLessons(); } },
      rs.length ? rs.map((r) => h("option", { value: r.id, selected: r.id === ls.renderId }, `${r.quality === "final" ? "1080p" : "720p"} · ${fmtDur(r.durationMs)} · ${fmtTime(r.createdAt)}${r.approval ? " · đã duyệt" : ""}${r.aiNarration ? " · giọng AI" : ""}`))
        : h("option", { value: "" }, "— Chưa có bản kết xuất —"));
    const chk = (k, label) => h("label", { class: "check", style: { margin: "0 14px 0 0" } }, h("input", { type: "checkbox", checked: ls[k], onchange: (e) => { ls[k] = e.target.checked; mark(); } }), label);
    const move = (d) => { const j = i + d; if (j < 0 || j >= lessons.length) return; [lessons[i], lessons[j]] = [lessons[j], lessons[i]]; mark(); drawLessons(); };
    return h("div", { class: "card st-item" },
      h("div", { class: "row" }, h("b", {}, `Bài ${i + 1}`), h("input", { type: "text", value: ls.title, style: { flex: 1, width: "auto" }, "aria-label": "Tên bài", oninput: (e) => { ls.title = e.target.value; mark(); } }),
        h("button", { class: "icon-btn", "aria-label": "Lên", disabled: i === 0, onclick: () => move(-1) }, "↑"),
        h("button", { class: "icon-btn", "aria-label": "Xuống", disabled: i === lessons.length - 1, onclick: () => move(1) }, "↓"),
        h("button", { class: "icon-btn", "aria-label": "Bỏ bài", onclick: () => { lessons.splice(i, 1); mark(); drawLessons(); } }, "×")),
      h("div", { class: "grid g2" }, h("div", {}, h("label", {}, "Dự án bài giảng"), psel), h("div", {}, h("label", {}, "Video (bản kết xuất)"), rsel)),
      !rs.length ? h("div", { class: "notice warn" }, "Dự án chưa kết xuất video. ", h("a", { href: `#/video/${ls.projectId}` }, "Mở Video Studio"))
        : cur && !(cur.approval && cur.quality === "final") ? h("div", { class: "notice warn" }, "Bản này chưa duyệt — xem thử được, nhưng gói phát hành cần bản 1080p đã duyệt. ", h("a", { href: "#/publish" }, "Trung tâm xuất bản")) : null,
      h("label", {}, "Lời dẫn bài học (tùy chọn)"), h("textarea", { style: { minHeight: "56px" }, value: ls.intro, oninput: (e) => { ls.intro = e.target.value; mark(); } }),
      h("div", { style: { margin: "10px 0" } }, chk("transcript", "Lời giảng"), chk("sources", "Căn cứ pháp lý"), chk("questions", "Câu hỏi trong video (Interactive Studio)")),
      h("div", { class: "row" }, h("b", { style: { fontSize: ".9rem" } }, "Tài liệu kèm:"),
        ls.attachments.map((aid, k) => h("span", { class: "badge" }, assets.get(aid)?.name || "(đã xóa)", " ", h("button", { class: "icon-btn", style: { width: "20px", height: "20px" }, "aria-label": "Bỏ tài liệu", onclick: () => { ls.attachments.splice(k, 1); mark(); drawLessons(); } }, "×"))),
        h("button", { class: "btn ghost sm", onclick: async () => { const a = await pickAsset(["pdf", "image", "audio"], "Tài liệu đính kèm (PDF văn bản luật, đề cương…)"); if (a && !ls.attachments.includes(a.id)) { assets.set(a.id, a); ls.attachments.push(a.id); mark(); drawLessons(); } } }, "+ Tài liệu")));
  }
  const addLesson = () => {
    if (!projects.length) return toast("Chưa có dự án bài giảng nào", "err");
    const used = new Set(lessons.map((x) => x.projectId)), p = projects.find((x) => !used.has(x.id)) || projects[0];
    lessons.push({ title: p.title, projectId: p.id, renderId: null, intro: "", transcript: true, sources: true, questions: true, attachments: [] });
    mark(); drawLessons();
  };

  // ----- kiểm tra cuối -----
  const quiz = { ...pkg.quiz, questions: pkg.quiz.questions.map((q) => ({ ...q, options: [...q.options] })) };
  const qTitle = h("input", { type: "text", value: quiz.title, oninput: (e) => { quiz.title = e.target.value; mark(); } });
  const qPass = h("input", { type: "number", min: 0, max: 100, value: quiz.passScore, oninput: (e) => { quiz.passScore = +e.target.value; mark(); } });
  const qBox = h("div");
  function drawQuiz() {
    qBox.replaceChildren(...(quiz.questions.length ? quiz.questions.map((q, i) => h("div", { class: "st-item", style: { borderBottom: "1px dashed var(--line)", paddingBottom: "10px" } },
      h("div", { class: "row" }, h("b", {}, `Câu ${i + 1}`), h("span", { class: "spacer" }), h("button", { class: "icon-btn", "aria-label": "Xóa câu", onclick: () => { quiz.questions.splice(i, 1); mark(); drawQuiz(); } }, "×")),
      h("textarea", { style: { minHeight: "48px" }, value: q.text, "aria-label": "Nội dung câu hỏi", oninput: (e) => { q.text = e.target.value; mark(); } }),
      q.options.map((o, k) => h("div", { class: "row", style: { marginTop: "6px" } },
        h("input", { type: "radio", name: `fq-${i}`, checked: q.correct === k, "aria-label": `Đáp án đúng ${L[k]}`, onchange: () => { q.correct = k; mark(); } }), h("b", {}, L[k]),
        h("input", { type: "text", value: o, style: { flex: 1, width: "auto" }, oninput: (e) => { q.options[k] = e.target.value; mark(); } }),
        h("button", { class: "icon-btn", "aria-label": "Bỏ phương án", disabled: q.options.length <= 2, onclick: () => { q.options.splice(k, 1); if (q.correct >= q.options.length) q.correct = -1; else if (q.correct > k) q.correct--; mark(); drawQuiz(); } }, "×"))),
      q.options.length < 6 && h("button", { class: "btn ghost sm", style: { marginTop: "6px" }, onclick: () => { q.options.push(""); mark(); drawQuiz(); } }, "+ Phương án"),
      h("input", { type: "text", value: q.explain || "", placeholder: "Giải thích / căn cứ (hiện sau khi nộp bài)", style: { marginTop: "6px" }, oninput: (e) => { q.explain = e.target.value; mark(); } })))
      : [h("div", { class: "empty" }, "Không bắt buộc. Thêm câu hỏi nếu muốn LMS ghi nhận điểm và trạng thái Đạt/Chưa đạt.")]));
  }
  const bulk = h("textarea", { style: { minHeight: "120px", fontFamily: "Consolas,monospace", fontSize: ".85rem" },
    placeholder: "Câu 1. Di sản gồm những gì?\n*A. Tài sản riêng và phần tài sản trong khối tài sản chung với người khác\nB. Chỉ tài sản riêng\nGiải thích: Điều 612 BLDS 2015" });
  const quizCard = h("div", { class: "card" }, h("h2", {}, "Bài kiểm tra cuối"),
    h("div", { class: "grid g2" }, h("div", {}, h("label", {}, "Tên bài kiểm tra"), qTitle), h("div", {}, h("label", {}, "Điểm đạt (%)"), qPass)),
    qBox, h("button", { class: "btn ghost sm", style: { marginTop: "8px" }, onclick: () => { quiz.questions.push({ text: "", options: ["", ""], correct: -1, explain: "" }); mark(); drawQuiz(); } }, "+ Câu hỏi"),
    h("details", { style: { marginTop: "12px" } }, h("summary", {}, "Nhập nhanh nhiều câu từ văn bản"),
      h("p", { class: "muted" }, "Mỗi câu bắt đầu «Câu n.»; phương án «A.», «B.»…; đánh dấu đáp án đúng bằng dấu * trước chữ cái (*A.) hoặc dòng «Đáp án: A»; dòng «Giải thích:» tùy chọn."),
      bulk, h("button", { class: "btn ghost sm", onclick: () => {
        const qs = parseQuestions(bulk.value);
        const badQ = qs.filter((q) => q.correct < 0).length;
        if (!qs.length) return toast("Không nhận ra câu hỏi nào", "err");
        quiz.questions.push(...qs); bulk.value = ""; mark(); drawQuiz();
        toast(`Đã thêm ${qs.length} câu${badQ ? ` — ${badQ} câu chưa có đáp án đúng` : ""}`, badQ ? "err" : "ok");
      } }, "Thêm vào bài kiểm tra")));

  // ----- lưu & xuất -----
  const body = () => ({ title: f.title.value, course: f.course.value, author: f.author.value, org: f.org.value, description: f.description.value,
    objectives: f.objectives.value.split("\n").map((x) => x.trim()).filter(Boolean), coverAssetId: cover, completion: { minWatch: +f.minWatch.value || 90 },
    lessons: lessons.map((x) => ({ ...x })), quiz: { ...quiz, questions: quiz.questions.map(compact) } });
  const save = async () => {
    const r = await put(`api/elearning/${id}`, body());
    lessons.splice(0, lessons.length, ...r.lessons.map((x) => ({ ...x, attachments: [...x.attachments] })));
    quiz.questions = r.quiz.questions.map((q) => ({ ...q, options: [...q.options] }));
    dirty = false; saveBtn.textContent = "Lưu"; drawQuiz(); await drawLessons(); dirty = false; saveBtn.textContent = "Lưu";
    return r;
  };
  const out = h("div");
  const busy = (msg) => out.replaceChildren(h("div", { class: "row" }, progressBar(0.5), h("small", {}, msg)));
  const showWarn = (w) => w.length ? h("div", { class: "notice warn" }, h("strong", {}, "Lưu ý:"), h("ul", { class: "tight" }, w.map((x) => h("li", {}, x)))) : null;
  const run = (fn) => async (e) => { const b = e.currentTarget; b.disabled = true; try { await save(); await fn(); } catch (er) { out.replaceChildren(h("div", { class: "notice err" }, er.message || String(er))); } finally { b.disabled = false; } };
  const B = () => import("../elearning/build.js");
  const saveBtn = h("button", { class: "btn", onclick: async () => { try { await save(); toast("Đã lưu học liệu", "ok"); } catch (e) { errToast(e); } } }, "Lưu");
  const actions = h("div", { class: "card", style: { position: "sticky", top: "70px" } }, h("h2", {}, "Lưu & xuất"),
    h("div", { style: { display: "grid", gap: "8px" } }, saveBtn,
      h("button", { class: "btn ghost", onclick: run(async () => {
        const c = await (await B()).collect(id, false);
        out.replaceChildren(h("div", { class: "notice ok" }, `${c.lessons.length} bài · ${fmtDur(c.lessons.reduce((a, x) => a + x.r.durationMs, 0))} video · khoảng ${fmtBytes(c.bytes)}${c.pkg.quiz.questions.length ? ` · kiểm tra ${c.pkg.quiz.questions.length} câu` : ""}`), showWarn(c.warnings));
      }) }, "Kiểm tra"),
      h("button", { class: "btn ghost", onclick: run(async () => {
        busy("Chuẩn bị bản xem thử…");
        const r = await (await B()).preview(id, busy);
        window.open(r.url, "_blank");
        out.replaceChildren(h("div", { class: "notice ok" }, "Đã mở bản xem thử ở tab mới (tiến độ xem thử lưu riêng)."), showWarn(r.warnings));
      }) }, "Xem thử như người học"),
      h("button", { class: "btn gold", onclick: run(async () => {
        busy("Đóng gói…"); const r = await (await B()).pack(id, "html", busy); saveBlob(r.blob, r.name);
        out.replaceChildren(h("div", { class: "notice ok" }, `Đã tạo ${r.name} (${fmtBytes(r.blob.size)}). Giải nén rồi mở index.html, hoặc đăng cả thư mục lên PNL/GitHub Pages.`), showWarn(r.warnings));
      }) }, "Tải gói web (HTML)"),
      h("button", { class: "btn gold", onclick: run(async () => {
        busy("Đóng gói SCORM…"); const r = await (await B()).pack(id, "scorm", busy); saveBlob(r.blob, r.name);
        out.replaceChildren(h("div", { class: "notice ok" }, `Đã tạo ${r.name} (${fmtBytes(r.blob.size)}). Moodle: Thêm hoạt động → Gói SCORM → tải nguyên file .zip.`), showWarn(r.warnings));
      }) }, "Tải gói SCORM 1.2 (Moodle/LMS)")),
    h("p", { class: "muted", style: { fontSize: ".85rem" } }, "Gói phát hành chỉ nhận video 1080p đã duyệt. Học viên học trên trình duyệt, không cần cài đặt; trong LMS, tiến độ – hoàn thành – điểm được ghi nhận qua SCORM."),
    out,
    h("hr"), h("button", { class: "btn danger sm", onclick: async () => { if (await confirmBox("Xóa học liệu?", "Chỉ xóa cấu hình học liệu; video, dự án và tài liệu vẫn giữ.", "Xóa", true)) { await del(`api/elearning/${id}`); dirty = false; location.hash = "#/elearning"; } } }, "Xóa học liệu"));

  view.append(h("p", {}, h("a", { href: "#/elearning" }, "← Danh sách học liệu")),
    h("div", { class: "grid", style: { gridTemplateColumns: "minmax(0,1fr) 300px", alignItems: "start" } },
      h("div", {}, info, h("div", { class: "card" }, h("div", { class: "row" }, h("h2", { style: { margin: 0 } }, "Bài học"), h("span", { class: "spacer" }), h("button", { class: "btn ghost sm", onclick: addLesson }, "+ Thêm bài")), lessonBox), quizCard),
      actions));
  drawQuiz(); await drawLessons(); dirty = false; saveBtn.textContent = "Lưu";
  const leave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", leave);
  return () => window.removeEventListener("beforeunload", leave);
}
