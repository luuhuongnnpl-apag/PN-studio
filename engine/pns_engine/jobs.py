"""Hàng đợi job: một job CPU tại một thời điểm, có tiến độ, hủy, lỗi rõ ràng."""
from __future__ import annotations

import json
import logging
import queue
import threading
import traceback
from typing import Any, Callable

from .media import Cancelled, MediaError, RunContext
from .storage import Store, new_id, now_ms

log = logging.getLogger("pns.jobs")
JobFn = Callable[[RunContext, Callable[[float, str], None]], dict]


class JobRunner:
    def __init__(self, store: Store):
        self.store = store
        self.q: queue.Queue[tuple[str, JobFn]] = queue.Queue()
        self.ctx: dict[str, RunContext] = {}
        self._t = threading.Thread(target=self._loop, name="pns-jobs", daemon=True)
        self._t.start()

    def submit(self, type_: str, fn: JobFn, project_id: str | None = None, scene_id: str | None = None,
               params: dict | None = None, message: str = "Đang chờ") -> dict:
        jid = new_id("jb")
        t = now_ms()
        self.store.x("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                     (jid, project_id, scene_id, type_, "queued", 0.0, message, None, None,
                      json.dumps(params or {}, ensure_ascii=False), t, t))
        self.ctx[jid] = RunContext()
        self.q.put((jid, fn))
        return self.get(jid)  # type: ignore[return-value]

    def get(self, jid: str) -> dict | None:
        rows = self.store.q("SELECT * FROM jobs WHERE id=?", (jid,))
        return _row(rows[0]) if rows else None

    def list(self, project_id: str | None = None, limit: int = 50) -> list[dict]:
        if project_id:
            rows = self.store.q("SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT ?",
                                (project_id, limit))
        else:
            rows = self.store.q("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,))
        return [_row(r) for r in rows]

    def active(self) -> list[dict]:
        return [_row(r) for r in self.store.q(
            "SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY created_at")]

    def cancel(self, jid: str) -> bool:
        job = self.get(jid)
        if not job or job["status"] not in ("queued", "running"):
            return False
        ctx = self.ctx.get(jid)
        if ctx:
            ctx.cancel()
        if job["status"] == "queued":
            self._update(jid, status="cancelled", message="Đã hủy")
        return True

    def _update(self, jid: str, **kw: Any) -> None:
        cols = ", ".join(f"{k}=?" for k in kw) + ", updated_at=?"
        vals = [json.dumps(v, ensure_ascii=False) if k == "result" else v for k, v in kw.items()]
        self.store.x(f"UPDATE jobs SET {cols} WHERE id=?", (*vals, now_ms(), jid))

    def _loop(self) -> None:
        while True:
            jid, fn = self.q.get()
            job = self.get(jid)
            ctx = self.ctx.get(jid) or RunContext()
            if not job or job["status"] != "queued" or ctx.cancelled:
                self.ctx.pop(jid, None)
                continue
            self._update(jid, status="running", message="Đang xử lý", progress=0.0)

            def progress(frac: float, msg: str = "", _j: str = jid) -> None:
                self._update(_j, progress=round(max(0.0, min(1.0, frac)), 3), message=msg or "Đang xử lý")

            try:
                result = fn(ctx, progress)
                self._update(jid, status="done", progress=1.0, message="Hoàn tất", result=result or {})
            except Cancelled:
                self._update(jid, status="cancelled", message="Đã hủy")
            except (MediaError, ValueError, KeyError) as e:
                self._update(jid, status="failed", message="Lỗi", error=str(e)[:1000])
            except Exception as e:  # lỗi không lường trước: ghi log kỹ thuật, báo gọn cho người dùng
                log.error("job %s failed: %s", jid, traceback.format_exc())
                self._update(jid, status="failed", message="Lỗi", error=f"{type(e).__name__}: {e}"[:1000])
            finally:
                self.ctx.pop(jid, None)


def _row(r) -> dict:
    d = dict(r)
    d["result"] = json.loads(d["result"]) if d.get("result") else None
    d["params"] = json.loads(d["params"]) if d.get("params") else {}
    d["projectId"] = d.pop("project_id")
    d["sceneId"] = d.pop("scene_id")
    d["createdAt"] = d.pop("created_at")
    d["updatedAt"] = d.pop("updated_at")
    return d
