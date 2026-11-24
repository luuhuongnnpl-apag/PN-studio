// Ngữ cảnh dùng chung giữa các studio: dự án đang làm việc (project ID xuyên suốt).
const KEY = "pns.currentProject";

export const ctx = {
  project() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  },
  setProject(p) {
    try {
      if (p) localStorage.setItem(KEY, JSON.stringify({ id: p.id, title: p.title, kind: p.kind }));
      else localStorage.removeItem(KEY);
    } catch {}
  },
};
