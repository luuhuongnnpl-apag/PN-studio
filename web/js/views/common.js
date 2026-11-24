import { get, post } from "../api.js";
import { ctx } from "../state.js";
import { h, JOB, JOB_TYPE, fmtTime, progressBar, errToast } from "../ui.js";

export function jobTable(jobs, onChange) {
  if (!jobs.length) return h("div", { class: "empty" }, "Chưa có job nào.");
  return h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Loại"), h("th", {}, "Trạng thái"), h("th", { style: { width: "34%" } }, "Tiến độ"), h("th", {}, "Thời gian"), h("th", {}))),
    h("tbody", {}, jobs.map((j) => h("tr", {},
      h("td", {}, JOB_TYPE[j.type] || j.type),
      h("td", {}, h("span", { class: `badge ${j.status === "done" ? "ok" : j.status === "failed" ? "err" : j.status === "running" ? "warn" : ""}` }, JOB[j.status] || j.status)),
      h("td", {}, ["queued", "running"].includes(j.status) ? [progressBar(j.progress), h("small", {}, j.message || "")] :
        j.error ? h("small", { style: { color: "var(--err)" } }, j.error) : h("small", {}, j.message || "")),
      h("td", {}, h("small", {}, fmtTime(j.createdAt))),
      h("td", {}, ["queued", "running"].includes(j.status) &&
        h("button", { class: "btn danger sm", onclick: async () => { try { await post(`/api/jobs/${j.id}/cancel`); onChange?.(); } catch (e) { errToast(e); } } }, "Hủy"))))));
}

// Chọn dự án làm việc (dùng chung cho Video Studio, Trung tâm xuất bản)
export async function projectPicker(current, onPick) {
  const list = await get("/api/projects");
  const sel = h("select", { "aria-label": "Chọn dự án", onchange: () => {
    const p = list.find((x) => x.id === sel.value);
    ctx.setProject(p);
    onPick(p);
  } }, h("option", { value: "" }, "— Chọn dự án —"), list.map((p) => h("option", { value: p.id, selected: p.id === current }, p.title)));
  return { el: sel, list };
}
