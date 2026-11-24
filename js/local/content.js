// Content Studio ở chế độ trình duyệt — bản JS tương đương engine/pns_engine/studios.py (parse_script,
// apply_script, content_check, export_script). Module thuần (không DOM) để kiểm thử bằng Node.
const L = "[\\p{L}\\p{N}_]";
const HEAD_RE = /^\s*(?:#{1,4}\s*)?(?:\*\*)?\s*\[?(?:cảnh|canh|slide|trang|scene|phần)\s*(\d{1,3})\]?\s*(?:[:.\-–—)]\s*)?(.*?)\s*(?:\*\*)?\s*$/iu;
const MD_HEAD_RE = /^\s*#{1,4}\s+(.+?)\s*#*\s*$/u;
const SRC_RE = /^\s*(?:[-*]\s*)?(?:\*\*)?\s*(nguồn|căn cứ|can cu|source|tham khảo)\s*(?:\*\*)?\s*:\s*(.*)$/iu;
const VERIFY_RE = /\[\s*cần kiểm chứng\s*\]|\(\s*cần kiểm chứng\s*\)/giu;
const ARTICLE_RE = new RegExp(`(?<!${L})Điều\\s+(\\d{1,4}[a-zđ]?)(?!${L})`, "gu");
const DOCNO_RE = new RegExp(`(?<!${L})\\d{1,4}/\\d{4}/[A-ZĐ]{1,5}(?:\\d{1,3}|-[A-ZĐ]{1,6}(?:-[A-ZĐ]{1,6})?)(?!${L})`, "gu");
export const WPM = 140;

export const wordCount = (t) => (String(t || "").match(/[\p{L}\p{N}]+/gu) || []).length;
const strip = (s, chars) => { const re = new RegExp(`^[${chars}]+|[${chars}]+$`, "gu"); return s.replace(re, ""); };

export function parseScript(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").slice(0, 200000).split("\n");
  const sceneHeads = lines.some((l) => HEAD_RE.test(l));
  const mdHeads = !sceneHeads && lines.some((l) => MD_HEAD_RE.test(l));
  const has = sceneHeads || mdHeads;
  const blocks = [];
  let cur = null;
  const start = (title, num) => { cur = { title, num, body: [], src: [], verify: false }; blocks.push(cur); };
  for (let ln of lines) {
    const m = sceneHeads ? HEAD_RE.exec(ln) : null;
    if (m) { start(strip(m[2].trim(), " *#:–—\\-"), +m[1]); continue; }
    const m2 = mdHeads ? MD_HEAD_RE.exec(ln) : null;
    if (m2) { start(strip(m2[1], " *"), null); continue; }
    if (!has && ln.trim() === "---") { cur = null; continue; }
    if (!cur) { if (!ln.trim() || has) continue; start("", null); }
    if (new RegExp(VERIFY_RE.source, "iu").test(ln)) { cur.verify = true; ln = ln.replace(VERIFY_RE, ""); }
    const ms = SRC_RE.exec(ln);
    if (ms) { cur.src.push(ms[2].trim()); continue; }
    cur.body.push(ln.replace(/\s+$/, ""));
  }
  const out = [];
  blocks.forEach((b, i) => {
    const body = b.body.join("\n").replace(/\n{3,}/g, "\n\n").trim().replace(/\*\*(.+?)\*\*/g, "$1");
    if (!body && !b.title && !b.src.length) return;
    out.push({ title: (b.title || `Cảnh ${i + 1}`).slice(0, 200), num: b.num, scriptOriginal: body,
      sourceNotes: b.src.filter(Boolean).join("\n").slice(0, 5000), needsVerification: b.verify });
  });
  return out;
}

// Trả về danh sách cảnh mới (chưa lưu); bên gọi lưu với kiểm tra revision.
export function mergeScript(scenes, parsed, mode, keepTitles) {
  scenes = scenes.map((s) => ({ ...s }));
  const fresh = (x) => ({ title: x.title, scriptOriginal: x.scriptOriginal, sourceNotes: x.sourceNotes, needsVerification: x.needsVerification });
  if (mode === "append") return [...scenes, ...parsed.map(fresh)];
  const numbered = parsed.every((y) => y.num);
  parsed.forEach((x, i) => {
    const idx = x.num && numbered ? x.num - 1 : i;
    if (idx >= 0 && idx < scenes.length) {
      const sc = scenes[idx];
      if (!keepTitles && x.title && !/^Cảnh \d+$/.test(x.title)) sc.title = x.title;
      sc.scriptOriginal = x.scriptOriginal;
      if (x.sourceNotes) sc.sourceNotes = x.sourceNotes;
      sc.needsVerification = !!sc.needsVerification || x.needsVerification;
    } else scenes.push(fresh(x));
  });
  return scenes;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const uniq = (a) => [...new Set(a)];

export function contentCheck(p) {
  const rows = []; let total = 0;
  p.scenes.forEach((s, k) => {
    if (s.excluded) return;
    const script = s.scriptOriginal || "", notes = s.sourceNotes || "";
    const words = wordCount(script); total += words;
    const arts = uniq([...script.matchAll(ARTICLE_RE)].map((m) => m[1])).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    const docs = uniq([...script.matchAll(DOCNO_RE)].map((m) => m[0])).sort();
    const issues = [];
    if (!script.trim()) issues.push("Chưa có lời giảng");
    if ((arts.length || docs.length) && !notes.trim()) issues.push("Có viện dẫn văn bản/điều luật nhưng chưa ghi nguồn – căn cứ");
    else if (notes.trim()) {
      const miss = [...arts.filter((a) => !new RegExp(`(?<!${L})Điều\\s+${esc(a)}(?!${L})`, "u").test(notes)).map((a) => `Điều ${a}`),
        ...docs.filter((d) => !notes.includes(d))];
      if (miss.length) issues.push("Chưa có trong ghi chú căn cứ: " + miss.join(", "));
    }
    if (s.needsVerification) issues.push("Đang đánh dấu cần kiểm chứng");
    if (words > 600) issues.push(`Lời giảng dài (${words} từ ≈ ${(Math.round(words / WPM * 10) / 10)} phút) — cân nhắc tách cảnh`);
    rows.push({ index: k + 1, sceneId: s.id, title: s.title || "", words, estMs: Math.floor(words / WPM * 60000), articles: arts, documents: docs, issues });
  });
  return { scenes: rows, totalWords: total, estMs: Math.floor(total / WPM * 60000), wpm: WPM,
    issueCount: rows.reduce((a, r) => a + r.issues.length, 0),
    note: "PNS chỉ đối chiếu viện dẫn với ghi chú căn cứ; không tự xác nhận hiệu lực văn bản. Cần tra cứu nguồn chính thức trước khi duyệt." };
}

export function exportScript(p) {
  const out = [`# ${p.title}`, ""];
  const c = p.course || {};
  const meta = [c.course, c.chapter, c.lesson].filter(Boolean).join(" · ");
  if (meta) out.push(meta, "");
  p.scenes.forEach((s, i) => {
    out.push(`## Cảnh ${i + 1}: ${s.title || ""}`);
    if (s.needsVerification) out.push("[Cần kiểm chứng]");
    out.push("", (s.scriptOriginal || "").trim(), "");
    for (const line of (s.sourceNotes || "").split("\n")) if (line.trim()) out.push(`Nguồn: ${line.trim()}`);
    out.push("");
  });
  return out.join("\n").replace(/\s+$/, "") + "\n";
}
