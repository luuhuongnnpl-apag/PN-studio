"""Kho dữ liệu cục bộ: SQLite (metadata) + thư mục tài sản (file)."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import SCHEMA_VERSION, Settings

ID_RE = re.compile(r"^[a-z]{2,3}_[0-9a-f]{16}$")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def valid_id(value: str, prefix: str | None = None) -> bool:
    if not isinstance(value, str) or not ID_RE.match(value):
        return False
    return prefix is None or value.startswith(prefix + "_")


def now_ms() -> int:
    return int(time.time() * 1000)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


SCHEMA = """
CREATE TABLE IF NOT EXISTS projects(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL, data TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assets(
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  file TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, meta TEXT NOT NULL,
  project_id TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS assets_kind ON assets(kind);
CREATE TABLE IF NOT EXISTS voices(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, file TEXT NOT NULL, sha256 TEXT NOT NULL,
  consent TEXT NOT NULL, meta TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY, project_id TEXT, scene_id TEXT, type TEXT NOT NULL, status TEXT NOT NULL,
  progress REAL NOT NULL, message TEXT, error TEXT, result TEXT, params TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scene_audio(
  project_id TEXT NOT NULL, scene_id TEXT NOT NULL, mode TEXT NOT NULL, asset_id TEXT NOT NULL,
  duration_ms INTEGER NOT NULL, spoken_hash TEXT, info TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, scene_id, mode));
"""


class Store:
    def __init__(self, settings: Settings):
        self.s = settings
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        for d in ("assets", "voices", "cache/tts", "cache/clips", "renders", "tmp", "backups"):
            settings.sub(*d.split("/"))
        self._lock = threading.RLock()
        self._db = sqlite3.connect(settings.db_path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        # Job dở dang từ phiên trước không thể tiếp tục: đánh dấu lỗi rõ ràng.
        self._db.execute("UPDATE jobs SET status='failed', error='Engine đã khởi động lại khi job đang chạy' "
                         "WHERE status IN ('queued','running')")
        self._db.commit()

    # ---------- tiện ích ----------
    def q(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def x(self, sql: str, args: tuple = ()) -> None:
        with self._lock:
            self._db.execute(sql, args)
            self._db.commit()

    # ---------- kv ----------
    def kv_get(self, key: str, default: Any = None) -> Any:
        rows = self.q("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(rows[0]["value"]) if rows else default

    def kv_set(self, key: str, value: Any) -> None:
        self.x("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (key, json.dumps(value, ensure_ascii=False)))

    # ---------- dự án ----------
    def project_row(self, pid: str) -> dict | None:
        rows = self.q("SELECT * FROM projects WHERE id=?", (pid,))
        if not rows:
            return None
        r = rows[0]
        data = json.loads(r["data"])
        data.update(id=r["id"], title=r["title"], kind=r["kind"], status=r["status"],
                    archived=bool(r["archived"]), revision=r["revision"],
                    createdAt=r["created_at"], updatedAt=r["updated_at"])
        return data

    def list_projects(self, q: str = "", archived: bool = False, kind: str = "", status: str = "") -> list[dict]:
        sql = "SELECT id,title,kind,status,archived,revision,data,created_at,updated_at FROM projects WHERE archived=?"
        args: list[Any] = [1 if archived else 0]
        if q:
            sql += " AND title LIKE ?"
            args.append(f"%{q}%")
        if kind:
            sql += " AND kind=?"
            args.append(kind)
        if status:
            sql += " AND status=?"
            args.append(status)
        sql += " ORDER BY updated_at DESC LIMIT 500"
        out = []
        for r in self.q(sql, tuple(args)):
            d = json.loads(r["data"])
            scenes = d.get("scenes", [])
            out.append({"id": r["id"], "title": r["title"], "kind": r["kind"], "status": r["status"],
                        "archived": bool(r["archived"]), "revision": r["revision"],
                        "updatedAt": r["updated_at"], "createdAt": r["created_at"],
                        "sceneCount": len(scenes), "course": d.get("course", {}),
                        "cover": next((s.get("slideAssetId") for s in scenes if s.get("slideAssetId")), None)})
        return out

    def create_project(self, title: str, kind: str = "lecture", course: dict | None = None,
                       scenes: list | None = None, extra: dict | None = None) -> dict:
        pid = new_id("pj")
        t = now_ms()
        data = {"schemaVersion": SCHEMA_VERSION, "ownerId": "local", "course": course or {},
                "links": {"pndSource": "", "pnlTarget": ""}, "scenes": scenes or [], "publications": []}
        if extra:
            data.update(extra)
        self.x("INSERT INTO projects VALUES(?,?,?,?,?,?,?,?,?)",
               (pid, title, kind, "draft", 0, 1, json.dumps(data, ensure_ascii=False), t, t))
        return self.project_row(pid)  # type: ignore[return-value]

    def save_project(self, pid: str, body: dict, expected_revision: int | None) -> dict:
        """Ghi dự án với kiểm tra revision (tránh ghi đè khi mở 2 tab)."""
        with self._lock:
            cur = self.project_row(pid)
            if cur is None:
                raise KeyError(pid)
            if expected_revision is not None and expected_revision != cur["revision"]:
                raise ValueError("conflict")
            data = {k: v for k, v in body.items() if k not in
                    ("id", "title", "kind", "status", "archived", "revision", "createdAt", "updatedAt")}
            data["schemaVersion"] = SCHEMA_VERSION
            data.setdefault("ownerId", "local")
            self._db.execute(
                "UPDATE projects SET title=?, status=?, revision=revision+1, data=?, updated_at=? WHERE id=?",
                (body.get("title", cur["title"]), body.get("status", cur["status"]),
                 json.dumps(data, ensure_ascii=False), now_ms(), pid))
            self._db.commit()
        return self.project_row(pid)  # type: ignore[return-value]

    def set_archived(self, pid: str, archived: bool) -> None:
        self.x("UPDATE projects SET archived=?, updated_at=? WHERE id=?", (1 if archived else 0, now_ms(), pid))

    def delete_project(self, pid: str) -> None:
        self.x("DELETE FROM projects WHERE id=?", (pid,))
        shutil.rmtree(self.s.data_dir / "renders" / pid, ignore_errors=True)

    # ---------- tài sản ----------
    def add_asset(self, src: Path, kind: str, name: str, mime: str, meta: dict | None = None,
                  project_id: str | None = None, move: bool = True) -> dict:
        aid = new_id("as")
        folder = self.s.sub("assets", aid)
        ext = src.suffix.lower()[:8]
        dst = folder / f"file{ext}"
        if move:
            shutil.move(str(src), dst)
        else:
            shutil.copyfile(src, dst)
        digest = sha256_file(dst)
        self.x("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?)",
               (aid, kind, name[:200], mime, dst.name, digest, dst.stat().st_size,
                json.dumps(meta or {}, ensure_ascii=False), project_id, now_ms()))
        return self.asset(aid)  # type: ignore[return-value]

    def asset(self, aid: str) -> dict | None:
        if not valid_id(aid, "as"):
            return None
        rows = self.q("SELECT * FROM assets WHERE id=?", (aid,))
        if not rows:
            return None
        r = dict(rows[0])
        r["meta"] = json.loads(r["meta"])
        return r

    def asset_path(self, aid: str) -> Path | None:
        a = self.asset(aid)
        return (self.s.data_dir / "assets" / aid / a["file"]) if a else None

    def list_assets(self, kind: str = "", q: str = "") -> list[dict]:
        sql, args = "SELECT * FROM assets WHERE 1=1", []
        if kind:
            sql += " AND kind=?"
            args.append(kind)
        if q:
            sql += " AND name LIKE ?"
            args.append(f"%{q}%")
        sql += " ORDER BY created_at DESC LIMIT 1000"
        out = []
        for r in self.q(sql, tuple(args)):
            d = dict(r)
            d["meta"] = json.loads(d["meta"])
            out.append(d)
        return out

    def update_asset_meta(self, aid: str, meta: dict) -> None:
        self.x("UPDATE assets SET meta=? WHERE id=?", (json.dumps(meta, ensure_ascii=False), aid))

    def asset_usage(self, aid: str) -> list[str]:
        used = {r["id"] for r in self.q("SELECT id,data FROM projects") if aid in r["data"]}
        used |= {r["project_id"] for r in self.q("SELECT project_id FROM scene_audio WHERE asset_id=?", (aid,))}
        used |= {r["key"].split(":", 1)[1] for r in self.q(
            "SELECT key FROM kv WHERE (key LIKE 'podcast:%' OR key LIKE 'elearn:%') AND value LIKE ?", (f"%{aid}%",))}
        return sorted(used)

    def delete_asset(self, aid: str) -> None:
        self.x("DELETE FROM assets WHERE id=?", (aid,))
        shutil.rmtree(self.s.data_dir / "assets" / aid, ignore_errors=True)

    # ---------- dung lượng ----------
    def usage(self) -> dict:
        def size(p: Path) -> int:
            return sum(f.stat().st_size for f in p.rglob("*") if f.is_file()) if p.exists() else 0
        d = self.s.data_dir
        total, used, free = shutil.disk_usage(d)
        return {"assets": size(d / "assets"), "voices": size(d / "voices"),
                "cache": size(d / "cache"), "renders": size(d / "renders"),
                "diskFree": free, "dataDir": str(d)}
