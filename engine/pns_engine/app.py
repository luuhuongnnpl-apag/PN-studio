"""PNS Engine HTTP API — chỉ lắng nghe 127.0.0.1, cùng origin với giao diện, không CORS."""
from __future__ import annotations

import logging
import secrets
import shutil
from pathlib import Path

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import media
from .config import WEB_DIR, Settings
from .core import PNSEngine
from .media import MediaError
from .storage import new_id, valid_id
from .textnorm import normalize

log = logging.getLogger("pns")


def create_app(settings: Settings | None = None, extra_hosts: tuple[str, ...] = ()) -> FastAPI:
    s = settings or Settings()
    eng = PNSEngine(s)
    token = secrets.token_urlsafe(32)
    allowed_hosts = {f"127.0.0.1:{s.port}", f"localhost:{s.port}", *extra_hosts}
    allowed_origins = {f"http://{h}" for h in allowed_hosts}
    app = FastAPI(title="PNS Engine", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine = eng
    app.state.token = token

    # ---------------- bảo mật ----------------
    @app.middleware("http")
    async def guard(request: Request, call_next):
        host = request.headers.get("host", "")
        if host not in allowed_hosts:                      # chống DNS rebinding
            return JSONResponse({"error": "Host không được phép"}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin not in allowed_origins:        # chống CSRF từ trang lạ
            return JSONResponse({"error": "Origin không được phép"}, status_code=403)
        if request.url.path.startswith("/api/"):
            supplied = request.headers.get("x-pns-token") or request.cookies.get("pns_token")
            if not supplied or not secrets.compare_digest(supplied, token):
                return JSONResponse({"error": "Thiếu hoặc sai mã phiên. Hãy mở PNS từ START_PNS.bat."},
                                    status_code=401)
            if request.method not in ("GET", "HEAD") and request.headers.get("x-pns-token") != token:
                return JSONResponse({"error": "Thao tác ghi cần mã phiên trong header"}, status_code=401)
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["X-Frame-Options"] = "DENY"
        return resp

    @app.exception_handler(MediaError)
    async def media_err(_: Request, e: MediaError):
        return JSONResponse({"error": str(e)}, status_code=422)

    @app.exception_handler(ValueError)
    async def value_err(_: Request, e: ValueError):
        msg = str(e)
        if msg == "conflict":
            return JSONResponse({"error": "Dự án đã được thay đổi ở nơi khác. Tải lại để tiếp tục."}, status_code=409)
        return JSONResponse({"error": msg}, status_code=422)

    @app.exception_handler(KeyError)
    async def key_err(_: Request, e: KeyError):
        return JSONResponse({"error": str(e.args[0]) if e.args else "Không tìm thấy"}, status_code=404)

    async def save_upload(up: UploadFile) -> Path:
        ext = Path(up.filename or "").suffix.lower()
        if not ext or len(ext) > 9:
            raise MediaError("Tên file thiếu phần mở rộng")
        tmp = s.sub("tmp") / f"up-{new_id('up')}{ext}"
        limit, size = s.max_upload_mb * 1024 * 1024, 0
        with open(tmp, "wb") as f:
            while chunk := await up.read(1 << 20):
                size += len(chunk)
                if size > limit:
                    f.close()
                    tmp.unlink(missing_ok=True)
                    raise MediaError(f"File vượt giới hạn {s.max_upload_mb} MB")
                f.write(chunk)
        if size == 0:
            tmp.unlink(missing_ok=True)
            raise MediaError("File rỗng")
        return tmp

    def need(obj, what="Không tìm thấy"):
        if obj is None:
            raise HTTPException(404, what)
        return obj

    # ---------------- hệ thống ----------------
    @app.get("/api/health")
    def health():
        return eng.health()

    @app.get("/api/dashboard")
    def dashboard():
        return eng.dashboard()

    @app.get("/api/settings")
    def get_settings():
        return {"app": eng.app_settings(), "tts": eng.tts_config(), "limits": {
            "maxUploadMB": s.max_upload_mb, "maxPdfPages": s.max_pdf_pages, "maxScenes": s.max_scenes}}

    @app.put("/api/settings")
    def put_settings(body: dict = Body(...)):
        return {"app": eng.set_app_settings(body.get("app") or {}), "tts": eng.set_tts_config(body.get("tts") or {})}

    # ---------------- dự án ----------------
    @app.get("/api/projects")
    def list_projects(q: str = "", archived: bool = False, kind: str = "", status: str = ""):
        return eng.store.list_projects(q[:100], archived, kind[:20], status[:20])

    @app.post("/api/projects")
    def create_project(body: dict = Body(...)):
        return eng.create_project(body)

    @app.get("/api/projects/{pid}")
    def get_project(pid: str):
        return need(eng.get_project(pid), "Không tìm thấy dự án")

    @app.put("/api/projects/{pid}")
    def put_project(pid: str, body: dict = Body(...)):
        need(eng.get_project(pid), "Không tìm thấy dự án")
        rev = body.get("revision")
        return eng.save_project(pid, body, int(rev) if isinstance(rev, int) else None)

    @app.post("/api/projects/{pid}/duplicate")
    def duplicate(pid: str):
        return eng.duplicate_project(pid)

    @app.post("/api/projects/{pid}/archive")
    def archive(pid: str, body: dict = Body(default={})):
        need(eng.get_project(pid))
        eng.store.set_archived(pid, bool(body.get("archived", True)))
        return {"ok": True}

    @app.delete("/api/projects/{pid}")
    def delete_project(pid: str, confirm: str = ""):
        p = need(eng.get_project(pid))
        if confirm != pid:
            raise HTTPException(400, "Thiếu xác nhận xóa")
        eng.delete_project(p["id"])
        return {"ok": True}

    @app.get("/api/projects/{pid}/export")
    def export_project(pid: str):
        path = eng.export_project(pid)
        return FileResponse(path, filename=path.name, media_type="application/zip")

    @app.post("/api/projects/import")
    async def import_project(file: UploadFile = File(...)):
        if Path(file.filename or "").suffix.lower() not in (".pnsproj", ".zip"):
            raise MediaError("Chọn file .pnsproj")
        tmp = await save_upload(file)
        try:
            return eng.import_project(tmp)
        finally:
            tmp.unlink(missing_ok=True)

    @app.post("/api/projects/{pid}/import-slides")
    def import_slides(pid: str, body: dict = Body(...)):
        return eng.import_slides_job(pid, str(body.get("assetId", "")), "replace" if body.get("replace") else "append")

    @app.post("/api/projects/{pid}/scenes/{sid}/audio")
    def attach_audio(pid: str, sid: str, body: dict = Body(...)):
        return eng.attach_recorded(pid, sid, str(body.get("assetId", "")))

    @app.delete("/api/projects/{pid}/scenes/{sid}/audio/{mode}")
    def detach_audio(pid: str, sid: str, mode: str):
        if mode not in ("recorded", "tts"):
            raise HTTPException(400, "Chế độ không hợp lệ")
        return eng.detach_audio(pid, sid, mode)

    @app.post("/api/projects/{pid}/scenes/{sid}/tts")
    def scene_tts(pid: str, sid: str):
        return eng.scene_tts_job(pid, sid)

    @app.get("/api/projects/{pid}/scenes/{sid}/captions-auto")
    def captions_auto(pid: str, sid: str):
        from .render import auto_captions
        _, sc = eng._scene(pid, sid)
        return auto_captions(sc.get("scriptOriginal", ""), int(sc.get("audioDurationMs") or 0) or
                             max(1000, int(sc.get("silentDurationMs") or 5000) - 850))

    @app.post("/api/projects/{pid}/render")
    def render(pid: str, body: dict = Body(default={})):
        return eng.render_job(pid, body.get("quality", "preview"))

    @app.get("/api/projects/{pid}/renders")
    def renders(pid: str):
        need(eng.get_project(pid))
        return eng.renders(pid)

    @app.get("/api/projects/{pid}/renders/{rid}/{name}")
    def render_file(pid: str, rid: str, name: str, download: bool = False):
        d = need(eng.render_dir(pid, rid), "Không tìm thấy bản kết xuất")
        if name == "lecture.vtt":   # trình duyệt chỉ hiển thị phụ đề WebVTT trong <track>
            import re as _re
            srt = (d / "lecture.srt").read_text(encoding="utf-8")
            vtt = "WEBVTT\n\n" + _re.sub(r"(\d\d:\d\d:\d\d),(\d{3})", r"\1.\2", srt)
            return Response(vtt, media_type="text/vtt; charset=utf-8")
        if name not in ("lecture.mp4", "lecture.srt"):
            raise HTTPException(404)
        p = eng.get_project(pid)
        stem = "".join(c if c.isalnum() else "-" for c in (p["title"] if p else "bai-giang"))[:60]
        mt = "video/mp4" if name.endswith(".mp4") else "application/x-subrip; charset=utf-8"
        return FileResponse(d / name, media_type=mt,
                            filename=f"{stem}{Path(name).suffix}" if download else None)

    @app.post("/api/projects/{pid}/renders/{rid}/approval")
    def approval(pid: str, rid: str, body: dict = Body(...)):
        return eng.set_approval(pid, rid, bool(body.get("approved")), str(body.get("approver", "")),
                                str(body.get("note", "")))

    @app.delete("/api/projects/{pid}/renders/{rid}")
    def delete_render(pid: str, rid: str):
        eng.delete_render(pid, rid)
        return {"ok": True}

    @app.post("/api/projects/{pid}/renders/{rid}/package")
    def package(pid: str, rid: str):
        path = eng.publish_package(pid, rid)
        return FileResponse(path, filename=path.name, media_type="application/zip")

    # ---------------- thư viện media ----------------
    @app.get("/api/assets")
    def list_assets(kind: str = "", q: str = ""):
        return eng.store.list_assets(kind[:20], q[:100])

    @app.post("/api/assets")
    async def upload_asset(file: UploadFile = File(...)):
        tmp = await save_upload(file)
        try:
            return eng.ingest_upload(tmp, file.filename or "file")
        finally:
            tmp.unlink(missing_ok=True)

    @app.patch("/api/assets/{aid}")
    def patch_asset(aid: str, body: dict = Body(...)):
        a = need(eng.store.asset(aid))
        meta = a["meta"]
        for k in ("rights", "note"):
            if k in body:
                meta[k] = str(body[k])[:1000]
        eng.store.update_asset_meta(aid, meta)
        return eng.store.asset(aid)

    @app.get("/api/assets/{aid}/usage")
    def asset_usage(aid: str):
        need(eng.store.asset(aid))
        return {"projects": eng.store.asset_usage(aid)}

    @app.delete("/api/assets/{aid}")
    def delete_asset(aid: str):
        need(eng.store.asset(aid))
        used = eng.store.asset_usage(aid)
        if used:
            raise HTTPException(409, f"Tài sản đang được dùng trong {len(used)} dự án")
        eng.store.delete_asset(aid)
        return {"ok": True}

    @app.get("/api/assets/{aid}/file")
    def asset_file(aid: str, download: bool = False):
        a = need(eng.store.asset(aid))
        return FileResponse(eng.store.asset_path(aid), media_type=a["mime"], filename=a["name"] if download else None)

    @app.get("/api/assets/{aid}/thumb")
    def asset_thumb(aid: str):
        a = need(eng.store.asset(aid))
        src = eng.store.asset_path(aid)
        dst = src.parent / "thumb.jpg"
        if a["kind"] in ("image", "slide"):
            media.thumbnail(src, dst)
        elif a["kind"] == "video":
            media.video_thumbnail(src, dst)
        elif a["kind"] == "pdf":
            if not dst.exists():
                import pypdfium2 as pdfium
                doc = pdfium.PdfDocument(str(src))
                try:
                    pg = doc[0]
                    pg.render(scale=360 / pg.get_size()[0]).to_pil().convert("RGB").save(dst, "JPEG", quality=80)
                finally:
                    doc.close()
        else:
            raise HTTPException(404)
        return FileResponse(dst, media_type="image/jpeg")

    # ---------------- giọng ----------------
    @app.get("/api/voices")
    def voices():
        return {"voices": eng.voices(), "engine": eng.tts.status(eng.tts_config())}

    @app.post("/api/voices")
    async def add_voice(file: UploadFile = File(...), name: str = Form(""), owner: str = Form(""),
                        consent: str = Form(""), startMs: int = Form(0), endMs: int = Form(0)):
        tmp = await save_upload(file)
        try:
            return eng.add_voice(tmp, file.filename or "voice.wav", name, owner, consent == "yes", startMs, endMs)
        finally:
            tmp.unlink(missing_ok=True)

    @app.patch("/api/voices/{vid}")
    def patch_voice(vid: str, body: dict = Body(...)):
        return eng.update_voice(vid, body)

    @app.delete("/api/voices/{vid}")
    def delete_voice(vid: str):
        need(eng.voice(vid))
        eng.delete_voice(vid)
        return {"ok": True}

    @app.get("/api/voices/{vid}/sample")
    def voice_sample(vid: str):
        return FileResponse(need(eng.voice_path(vid)), media_type="audio/wav")

    @app.post("/api/voices/{vid}/test")
    def voice_test(vid: str, body: dict = Body(...)):
        return eng.voice_test_job(vid, str(body.get("text", "")))

    @app.get("/api/voices/{vid}/tests/{name}")
    def voice_test_file(vid: str, name: str):
        need(eng.voice(vid))
        if not (name.startswith("test-") and name.endswith(".wav") and len(name) < 40 and "/" not in name
                and "\\" not in name and ".." not in name):
            raise HTTPException(404)
        path = s.data_dir / "voices" / vid / name
        return FileResponse(need(path if path.exists() else None), media_type="audio/wav")

    # ---------------- từ điển ----------------
    @app.get("/api/dictionary")
    def dictionary():
        return eng.dictionary()

    @app.put("/api/dictionary")
    def put_dictionary(body: list = Body(...)):
        return eng.set_dictionary(body)

    @app.post("/api/dictionary/preview")
    def dict_preview(body: dict = Body(...)):
        return {"spoken": normalize(str(body.get("text", ""))[:s.max_script_chars], eng.dictionary())}

    # ---------------- job ----------------
    @app.get("/api/jobs")
    def jobs(projectId: str = ""):
        return eng.jobs.list(projectId if valid_id(projectId, "pj") else None)

    @app.get("/api/jobs/{jid}")
    def job(jid: str):
        return need(eng.jobs.get(jid))

    @app.post("/api/jobs/{jid}/cancel")
    def cancel(jid: str):
        return {"cancelled": eng.jobs.cancel(jid)}

    # ---------------- giao diện ----------------
    index_html = (WEB_DIR / "index.html").read_text(encoding="utf-8")

    def index(_: Request) -> HTMLResponse:
        html = index_html.replace('<meta name="pns-token" content="">', f'<meta name="pns-token" content="{token}">')
        resp = HTMLResponse(html, headers={
            "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
                                       "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; "
                                       "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            "Cache-Control": "no-store"})
        resp.set_cookie("pns_token", token, httponly=True, samesite="strict", path="/")
        return resp

    app.add_api_route("/", index, methods=["GET"], include_in_schema=False)
    app.add_api_route("/index.html", index, methods=["GET"], include_in_schema=False)
    app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
    return app
