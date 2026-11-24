// Đóng gói học liệu điện tử: gói web HTML, gói SCORM 1.2 (Moodle/LMS) hoặc bản xem thử.
// Chạy trong giao diện nên dùng chung cho PNS Engine và chế độ trình duyệt (file tải qua đường dẫn api/… của từng chế độ).
import { engine, get } from "../api.js";

const version = () => engine.health?.version || "";

const PLAYER = new URL("../../player/", import.meta.url);
const ascii = (s) => String(s).normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
  .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "tep";
const pad = (n) => String(n).padStart(2, "0");
const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

async function fetchBlob(url) {
  const r = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!r.ok) throw new Error(`Không tải được ${url.split("/").slice(-2).join("/")} (lỗi ${r.status})`);
  return r.blob();
}

// Thu thập và kiểm tra dữ liệu. strict = gói phát hành (bắt buộc bản 1080p đã duyệt).
export async function collect(pkgId, strict) {
  const pkg = await get(`api/elearning/${pkgId}`);
  if (!pkg.lessons.length) throw new Error("Học liệu chưa có bài học nào");
  const assets = new Map((await get("api/assets")).map((a) => [a.id, a]));
  const warnings = [], lessons = [];
  let ai = false, bytes = 0;
  for (const [i, L] of pkg.lessons.entries()) {
    const tag = `Bài ${i + 1} «${L.title}»`;
    let p;
    try { p = await get(`api/projects/${L.projectId}`); } catch { throw new Error(`${tag}: dự án bài giảng không còn tồn tại`); }
    const renders = await get(`api/projects/${L.projectId}/renders`);
    const r = renders.find((x) => x.id === L.renderId);
    if (!r) throw new Error(`${tag}: chưa chọn bản kết xuất video (kết xuất ở Video Studio)`);
    if (strict && !(r.quality === "final" && r.approval)) throw new Error(`${tag}: bản video chưa được duyệt (duyệt bản 1080p ở Trung tâm xuất bản)`);
    if (!r.approval) warnings.push(`${tag}: bản video chưa duyệt — chỉ dùng để xem thử.`);
    if (r.projectRevision !== p.revision) warnings.push(`${tag}: dự án đã sửa sau lần kết xuất (r${r.projectRevision} → r${p.revision}); lời giảng/căn cứ lấy theo bản hiện tại.`);
    let questions = null;
    if (L.questions) {
      const ic = await get(`api/projects/${L.projectId}/interactive`);
      if (ic.questions.length && ic.renderId === r.id) questions = ic.questions.filter((q) => q.atMs < r.durationMs);
      else if (ic.questions.length) warnings.push(`${tag}: câu hỏi trong video gắn với bản kết xuất khác — bỏ qua (chọn lại bản ở Interactive Studio).`);
    }
    const scenes = p.scenes.filter((s) => !s.excluded);
    const atts = L.attachments.map((id) => assets.get(id)).filter(Boolean);
    if (atts.length < L.attachments.length) warnings.push(`${tag}: có tài liệu đính kèm đã bị xóa khỏi thư viện.`);
    ai ||= !!r.aiNarration;
    bytes += r.sizeBytes || 0;
    for (const a of atts) bytes += a.size || 0;
    lessons.push({ L, p, r, questions, scenes, atts, n: i + 1 });
  }
  if (pkg.quiz.questions.length && pkg.quiz.questions.length < 3) warnings.push("Bài kiểm tra cuối nên có từ 3 câu trở lên.");
  return { pkg, lessons, warnings, ai, bytes };
}

function courseData(c, urls) {
  const { pkg } = c;
  return {
    id: pkg.id, title: pkg.title, course: pkg.course, author: pkg.author, org: pkg.org, description: pkg.description,
    objectives: pkg.objectives, cover: urls.cover || null, aiNotice: c.ai, generator: `Phúc Nguyên Studio ${version()}`, builtAt: Date.now(),
    completion: pkg.completion,
    lessons: c.lessons.map(({ L, r, questions, scenes, atts, n }) => ({
      id: L.id, title: L.title, intro: L.intro, video: urls.video[n], vtt: urls.vtt[n], durationMs: r.durationMs, aiNarration: !!r.aiNarration,
      chapters: (r.timeline || []).map((t) => ({ title: t.title, startMs: t.startMs })),
      transcript: L.transcript ? scenes.filter((s) => (s.scriptOriginal || "").trim()).map((s) => ({ title: s.title, text: s.scriptOriginal.trim() })) : null,
      sources: L.sources ? scenes.filter((s) => (s.sourceNotes || "").trim()).map((s) => ({ title: s.title, notes: s.sourceNotes.trim() })) : null,
      questions, attachments: atts.map((a, k) => ({ name: a.name, size: a.size, href: urls.att[`${n}:${k}`] })),
    })),
    quiz: pkg.quiz.questions.length ? pkg.quiz : null,
  };
}

async function html(data, playerSrc) {
  const tpl = await (await fetch(new URL("lesson.html", PLAYER), { cache: "no-store" })).text();
  const payload = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return tpl.replace("{{TITLE}}", esc(data.title)).replace("{{PLAYER}}", esc(playerSrc)).replace("{{DATA}}", () => payload);
}

// Xem thử: mở tab mới với video/tài liệu là blob URL (không cần đóng gói).
export async function preview(pkgId, onStep = () => {}) {
  const c = await collect(pkgId, false);
  const urls = { video: {}, vtt: {}, att: {}, cover: null };
  for (const { L, r, atts, n } of c.lessons) {
    onStep(`Chuẩn bị bài ${n}`);
    const base = `api/projects/${L.projectId}/renders/${r.id}`;
    urls.video[n] = URL.createObjectURL(await fetchBlob(`${base}/lecture.mp4`));
    urls.vtt[n] = URL.createObjectURL(await fetchBlob(`${base}/lecture.vtt`));
    for (const [k, a] of atts.entries()) urls.att[`${n}:${k}`] = URL.createObjectURL(await fetchBlob(`api/assets/${a.id}/file`));
  }
  if (c.pkg.coverAssetId) urls.cover = URL.createObjectURL(await fetchBlob(`api/assets/${c.pkg.coverAssetId}/file`));
  const page = await html({ ...courseData(c, urls), id: `${c.pkg.id}-preview` }, new URL("lesson.js", PLAYER).href);
  return { url: URL.createObjectURL(new Blob([page], { type: "text/html" })), warnings: c.warnings };
}

function manifest(pkg, files) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="PNS-${pkg.id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${xml(pkg.title)}</title>
      <item identifier="ITEM-1" identifierref="RES-1" isvisible="true">
        <title>${xml(pkg.title)}</title>${pkg.quiz.questions.length ? `
        <adlcp:masteryscore>${pkg.quiz.passScore}</adlcp:masteryscore>` : ""}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
${files.map((f) => `      <file href="${xml(f)}"/>`).join("\n")}
    </resource>
  </resources>
</manifest>
`;
}

// Gói phát hành: format "html" | "scorm". Trả về Blob zip (ghi luồng, video không nén lại).
export async function pack(pkgId, format, onStep = () => {}) {
  const c = await collect(pkgId, true);
  const { Zip, ZipPassThrough, ZipDeflate, strToU8 } = await import("../../vendor/fflate/fflate.js");
  const parts = [], files = [];
  let fail = null;
  const zip = new Zip((err, chunk) => { if (err) fail = err; else parts.push(chunk); });
  const put = (name, u8) => { const f = new ZipDeflate(name, { level: 6 }); zip.add(f); f.push(u8, true); files.push(name); };
  const putBlob = async (name, blob) => {
    const f = new ZipPassThrough(name); zip.add(f); files.push(name);
    const rd = blob.stream().getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; f.push(value, false); }
    f.push(new Uint8Array(0), true);
  };
  const urls = { video: {}, vtt: {}, att: {}, cover: null };
  for (const { L, r, atts, n } of c.lessons) {
    onStep(`Đóng gói bài ${n}/${c.lessons.length}: ${L.title}`);
    const base = `api/projects/${L.projectId}/renders/${r.id}`;
    urls.video[n] = `media/bai-${pad(n)}.mp4`; urls.vtt[n] = `media/bai-${pad(n)}.vtt`;
    await putBlob(urls.video[n], await fetchBlob(`${base}/lecture.mp4`));
    put(urls.vtt[n], new Uint8Array(await (await fetchBlob(`${base}/lecture.vtt`)).arrayBuffer()));
    for (const [k, a] of atts.entries()) {
      const name = `files/bai-${pad(n)}/${pad(k + 1)}-${ascii(a.name)}`;
      urls.att[`${n}:${k}`] = name;
      await putBlob(name, await fetchBlob(`api/assets/${a.id}/file`));
    }
    if (fail) throw fail;
  }
  if (c.pkg.coverAssetId) {
    const b = await fetchBlob(`api/assets/${c.pkg.coverAssetId}/file`);
    urls.cover = "cover" + (b.type.includes("png") ? ".png" : ".jpg"); await putBlob(urls.cover, b);
  }
  onStep("Tạo trang học liệu");
  const data = courseData(c, urls);
  put("index.html", strToU8(await html(data, "pns-lesson.js")));
  put("pns-lesson.js", strToU8(await (await fetch(new URL("lesson.js", PLAYER), { cache: "no-store" })).text()));
  put("course.json", strToU8(JSON.stringify(data, null, 2)));
  put("HUONG_DAN.txt", strToU8([
    `Học liệu điện tử: ${c.pkg.title}`, `Tạo bằng Phúc Nguyên Studio ${version()}.`, "",
    format === "scorm"
      ? "Gói SCORM 1.2: tải nguyên file .zip lên LMS (Moodle: Thêm hoạt động → Gói SCORM). LMS ghi nhận tiến độ, trạng thái hoàn thành và điểm bài kiểm tra cuối."
      : "Gói web: giải nén rồi mở index.html, hoặc đăng cả thư mục lên PNL/GitHub Pages. Tiến độ lưu trên trình duyệt người học, không gửi đi đâu.",
    "", "Hoàn thành một bài: xem tối thiểu " + c.pkg.completion.minWatch + "% video và trả lời các câu hỏi trong video.",
    c.ai ? "Một số bài có lời thuyết minh tạo bằng giọng AI (đã gắn nhãn trong học liệu)." : "",
    "Căn cứ pháp lý được trích theo thời điểm biên soạn; cần rà soát hiệu lực văn bản trước mỗi kỳ giảng dạy.",
  ].filter((x) => x !== null).join("\r\n")));
  if (format === "scorm") put("imsmanifest.xml", strToU8(manifest(c.pkg, [...files])));
  zip.end();
  if (fail) throw fail;
  return { blob: new Blob(parts, { type: "application/zip" }), warnings: c.warnings, name: `${ascii(c.pkg.title)}-${format === "scorm" ? "SCORM12" : "web"}.zip` };
}
