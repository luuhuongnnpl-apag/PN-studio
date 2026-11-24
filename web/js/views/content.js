import { get, post, saveBlob } from "../api.js";
import { ctx } from "../state.js";
import { h, toast, errToast, fmtDur } from "../ui.js";
import { projectPicker } from "./common.js";

const SAMPLE = `## Cảnh 1: Khái niệm di sản
Chào các em. Theo Điều 612 Bộ luật Dân sự 2015, di sản bao gồm tài sản riêng của người chết…
Nguồn: Điều 612 Bộ luật Dân sự 2015

## Cảnh 2: Người thừa kế
…
[Cần kiểm chứng]`;

function promptFor(p) {
  const lines = p.scenes.map((s, i) => `- Cảnh ${i + 1}: ${s.title}${s.sourcePage ? ` (slide trang ${s.sourcePage})` : ""}`);
  return `Vai trò: trợ lý soạn lời giảng video bài giảng luật bằng tiếng Việt.
Bài giảng: «${p.title}»${p.course?.course ? ` — học phần ${p.course.course}` : ""}.
Danh sách cảnh (giữ nguyên số thứ tự và số lượng):
${lines.join("\n") || "- (chưa có cảnh)"}

Yêu cầu đầu ra, đúng định dạng sau cho TỪNG cảnh, không thêm lời dẫn ngoài định dạng:
## Cảnh <số>: <tiêu đề>
<lời giảng nói tự nhiên, 80–180 từ, câu ngắn, xưng "các em">
Nguồn: <điều, khoản, tên văn bản và số hiệu — mỗi căn cứ một dòng "Nguồn:">
Ràng buộc: chỉ viện dẫn văn bản còn hiệu lực; không tự bịa điều luật. Chỗ nào chưa chắc chắn, thêm dòng [Cần kiểm chứng] trong cảnh đó.`;
}

export default async function content(view, args) {
  let pid = args[0] || ctx.project()?.id || "";
  const body = h("div");
  const picker = await projectPicker(pid, (p) => { pid = p?.id || ""; history.replaceState(null, "", `#/content/${pid}`); render(); });
  view.append(h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Content Studio"),
    h("p", {}, "Nhập kịch bản theo cảnh kèm nguồn – căn cứ; rà soát viện dẫn trước khi thu âm")),
  h("span", { class: "spacer" }), h("div", { style: { minWidth: "280px" } }, picker.el)), body);

  async function render() {
    if (!pid) { body.replaceChildren(h("div", { class: "empty" }, "Chọn dự án (hoặc tạo dự án ở mục Dự án) để soạn kịch bản.")); return; }
    const p = await get(`api/projects/${pid}`);
    ctx.setProject(p);
    const text = h("textarea", { style: { minHeight: "300px", fontFamily: "Consolas,monospace", fontSize: ".88rem" }, placeholder: SAMPLE, "aria-label": "Kịch bản" });
    const mode = h("select", { "aria-label": "Cách nhập" }, h("option", { value: "merge" }, "Ghép vào cảnh hiện có theo thứ tự (giữ slide, âm thanh)"), h("option", { value: "append" }, "Thêm thành cảnh mới ở cuối"));
    const keep = h("input", { type: "checkbox" });
    const preview = h("div");
    const check = h("div");

    const doPreview = async () => {
      try {
        const { scenes } = await post("api/content/parse", { text: text.value });
        if (!scenes.length) { preview.replaceChildren(h("div", { class: "notice warn" }, "Không nhận ra cảnh nào. Dùng tiêu đề «## Cảnh 1: …» hoặc tách khối bằng dòng ---.")); return null; }
        const merge = mode.value === "merge";
        preview.replaceChildren(h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Tiêu đề"), h("th", {}, "Vào cảnh"), h("th", {}, "Từ"), h("th", {}, "Nguồn"), h("th", {}))),
          h("tbody", {}, scenes.map((s, i) => {
            const idx = merge ? (s.num && scenes.every((x) => x.num) ? s.num - 1 : i) : p.scenes.length + i;
            return h("tr", {}, h("td", {}, i + 1), h("td", {}, s.title),
              h("td", {}, merge && idx < p.scenes.length ? `Cảnh ${idx + 1} «${p.scenes[idx].title}»` : h("span", { class: "badge gold" }, "Cảnh mới")),
              h("td", {}, s.scriptOriginal.split(/\s+/).filter(Boolean).length),
              h("td", {}, s.sourceNotes ? h("small", {}, s.sourceNotes) : h("span", { class: "badge warn" }, "Chưa có")),
              h("td", {}, s.needsVerification && h("span", { class: "badge warn" }, "Cần kiểm chứng")));
          }))));
        return scenes;
      } catch (e) { errToast(e); return null; }
    };
    const apply = h("button", { class: "btn gold", onclick: async () => {
      if (!(await doPreview())) return;
      apply.disabled = true;
      try {
        const fresh = await get(`api/projects/${pid}`);
        await post(`api/projects/${pid}/content/apply`, { text: text.value, mode: mode.value, keepTitles: keep.checked, revision: fresh.revision });
        toast("Đã nhập kịch bản vào dự án", "ok");
        render();
      } catch (e) { errToast(e); } finally { apply.disabled = false; }
    } }, "Áp dụng vào dự án");

    const copyPrompt = h("button", { class: "btn ghost sm", onclick: async () => {
      try { await navigator.clipboard.writeText(promptFor(p)); toast("Đã sao chép lệnh mẫu — dán vào ChatGPT/Claude, rồi dán kết quả vào ô kịch bản", "ok"); }
      catch { toast("Trình duyệt chặn sao chép", "err"); }
    } }, "Sao chép lệnh mẫu cho ChatGPT/Claude");

    body.replaceChildren(h("div", { class: "grid g2", style: { alignItems: "start" } },
      h("div", { class: "card" }, h("div", { class: "row" }, h("h2", { style: { margin: 0 } }, "Nhập kịch bản"), h("span", { class: "spacer" }), copyPrompt),
        h("p", { class: "muted" }, "Dán kịch bản từ Word, ChatGPT, Claude. Nhận dạng «Cảnh 1: …», «Slide 1 – …», «## …»; dòng «Nguồn:/Căn cứ:» vào ghi chú căn cứ; «[Cần kiểm chứng]» bật cờ kiểm chứng."),
        text, h("label", {}, "Cách nhập"), mode, h("label", { class: "check" }, keep, "Giữ nguyên tiêu đề cảnh hiện có"),
        h("div", { class: "row" }, h("button", { class: "btn ghost", onclick: doPreview }, "Xem trước"), apply), h("div", { style: { marginTop: "12px", overflowX: "auto" } }, preview)),
      h("div", { class: "card" }, h("div", { class: "row" }, h("h2", { style: { margin: 0 } }, "Rà soát kịch bản"), h("span", { class: "spacer" }),
        h("button", { class: "btn ghost sm", onclick: async () => { try { saveBlob(await get(`api/projects/${pid}/script.md`), `${(p.title || "kich-ban").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 60)}.md`); } catch (e) { errToast(e); } } }, "Tải kịch bản .md"), h("a", { class: "btn ghost sm", href: `#/lecture/${pid}` }, "Mở Lecture Studio")), check)));
    await drawCheck(check);
  }

  async function drawCheck(box) {
    const r = await get(`api/projects/${pid}/content/check`);
    box.replaceChildren(
      h("p", {}, `${r.scenes.length} cảnh · ${r.totalWords} từ · ước ${fmtDur(r.estMs)} ở tốc độ ${r.wpm} từ/phút · `,
        r.issueCount ? h("span", { class: "badge warn" }, `${r.issueCount} điểm cần xem`) : h("span", { class: "badge ok" }, "Không phát hiện vấn đề")),
      h("div", { class: "notice info" }, r.note),
      r.scenes.length ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Cảnh"), h("th", {}, "Từ / thời lượng"), h("th", {}, "Viện dẫn"), h("th", {}, "Cần xem"))),
        h("tbody", {}, r.scenes.map((s) => h("tr", {},
          h("td", {}, h("a", { href: `#/lecture/${pid}` }, `${s.index}. ${s.title}`)),
          h("td", {}, `${s.words} · ${fmtDur(s.estMs)}`),
          h("td", {}, h("small", {}, [...s.articles.map((a) => `Điều ${a}`), ...s.documents].join(", ") || "—")),
          h("td", {}, s.issues.length ? h("ul", { class: "tight" }, s.issues.map((x) => h("li", {}, x))) : h("span", { class: "badge ok" }, "Ổn"))))))
        : h("div", { class: "empty" }, "Dự án chưa có cảnh."));
  }

  await render();
}
