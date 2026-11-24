"""Cầu nối giọng AI: cho phép bản web PNS (GitHub Pages/Firebase, chạy trong trình duyệt) dùng VieNeu-TTS
của PNS Engine trên chính máy này.

Bảo mật:
- Engine vẫn chỉ nghe 127.0.0.1; trình duyệt của người dùng gọi http://127.0.0.1:<cổng>/bridge/*.
- Chỉ nhận Origin trong danh sách cho phép (mặc định trang GitHub Pages của PNS) + khóa ghép nối
  (X-PNS-Bridge-Key) tạo ngẫu nhiên, lưu ở máy, xem/đổi trong Cài đặt của Engine.
- Chỉ mở đúng một việc: sinh giọng từ văn bản + mẫu giọng gửi kèm. Không đọc/ghi dự án, thư viện, mẫu giọng của Engine.
- Mẫu giọng gửi lên chỉ ghi tạm để sinh, xóa ngay khi xong; file kết quả tự xóa sau 1 giờ.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import time
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from . import media
from .config import VERSION
from .media import RunContext
from .storage import new_id, valid_id
from .textnorm import normalize

if TYPE_CHECKING:
    from .core import PNSEngine

DEFAULT_ORIGINS = ["https://luuhuongnnpl-apag.github.io"]
MAX_REF_BYTES = 8 * 2 ** 20
MAX_TEXT = 20000
OUT_TTL = 3600


def bridge_key(eng: "PNSEngine") -> str:
    k = eng.store.kv_get("bridgeKey", None)
    if not k:
        k = secrets.token_urlsafe(24)
        eng.store.kv_set("bridgeKey", k)
    return k


def rotate_key(eng: "PNSEngine") -> str:
    eng.store.kv_set("bridgeKey", secrets.token_urlsafe(24))
    return bridge_key(eng)


def origins(eng: "PNSEngine") -> list[str]:
    extra = [o.strip().rstrip("/") for o in os.environ.get("PNS_WEB_ORIGINS", "").split(",") if o.strip()]
    saved = eng.store.kv_get("bridgeOrigins", None)
    base = saved if isinstance(saved, list) else DEFAULT_ORIGINS
    return list(dict.fromkeys([*base, *extra]))


def set_origins(eng: "PNSEngine", values: list) -> list[str]:
    clean = []
    for v in values if isinstance(values, list) else []:
        v = str(v).strip().rstrip("/")
        if v and len(v) < 200 and (v.startswith("https://") or v.startswith("http://127.") or
                                   v.startswith("http://localhost")) and v.count("/") == 2:
            clean.append(v)
    eng.store.kv_set("bridgeOrigins", clean[:10])
    return origins(eng)


def info(eng: "PNSEngine") -> dict:
    return {"key": bridge_key(eng), "origins": origins(eng), "port": eng.s.port,
            "webUrl": "https://luuhuongnnpl-apag.github.io/PN-studio/"}


def _cors(resp: Response, origin: str) -> Response:
    resp.headers["Access-Control-Allow-Origin"] = origin
    resp.headers["Vary"] = "Origin"
    return resp


def guard(eng: "PNSEngine", request: Request) -> Response | None:
    """Kiểm tra request /bridge/*. Trả về Response khi phải chặn hoặc là preflight; None nếu cho qua."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    allowed = origins(eng)
    if origin and origin not in allowed:
        return JSONResponse({"error": f"Trang {origin} chưa được phép dùng PNS Engine. "
                                      "Thêm ở Cài đặt → Cầu nối web của Engine."}, status_code=403)
    if request.method == "OPTIONS":                       # preflight CORS + Private Network Access
        r = Response(status_code=204)
        if origin:
            _cors(r, origin)
            r.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            r.headers["Access-Control-Allow-Headers"] = "X-PNS-Bridge-Key, Content-Type"
            r.headers["Access-Control-Max-Age"] = "600"
            if request.headers.get("access-control-request-private-network") == "true":
                r.headers["Access-Control-Allow-Private-Network"] = "true"
        return r
    supplied = request.headers.get("x-pns-bridge-key") or ""
    if not secrets.compare_digest(supplied, bridge_key(eng)):
        r = JSONResponse({"error": "Sai hoặc thiếu khóa ghép nối. Mở Cài đặt của PNS Engine trên máy, "
                                   "bấm «Kết nối bản web» để ghép lại."}, status_code=401)
        return _cors(r, origin) if origin else r
    return None


def add_cors(request: Request, resp: Response) -> Response:
    origin = (request.headers.get("origin") or "").rstrip("/")
    return _cors(resp, origin) if origin else resp


def _cleanup(out_dir: Path) -> None:
    cutoff = time.time() - OUT_TTL
    for f in out_dir.glob("*.wav"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


def register(app: FastAPI, eng: "PNSEngine") -> None:
    out_dir = eng.s.sub("tmp", "bridge")

    @app.get("/bridge/status")
    def status():
        return {"ok": True, "app": "PNS Engine", "version": VERSION, "tts": eng.tts.status(eng.tts_config()),
                "model": eng.tts.model_id(eng.tts_config()), "dictionary": eng.dictionary()}

    @app.post("/bridge/normalize")
    def bridge_normalize(body: dict = Body(...)):
        dic = body.get("dictionary")
        dic = [d for d in dic if isinstance(d, dict)][:500] if isinstance(dic, list) else None
        return {"spoken": normalize(str(body.get("text", ""))[:MAX_TEXT], dic if dic is not None else eng.dictionary())}

    @app.post("/bridge/tts")
    async def tts(text: str = Form(...), raw: str = Form("0"), dictionary: str = Form(""),
                  ref: UploadFile = File(...)):
        if not eng.tts.installed():
            raise ValueError("PNS Engine chưa cài giọng AI. Chạy INSTALL_VOICE_AI.bat trên máy rồi mở lại START_PNS.bat.")
        text = (text or "")[:MAX_TEXT]
        if not text.strip():
            raise ValueError("Lời đọc trống")
        data = await ref.read(MAX_REF_BYTES + 1)
        if len(data) > MAX_REF_BYTES:
            raise ValueError("Mẫu giọng quá lớn (tối đa 8 MB; nên 3–15 giây)")
        if len(data) < 1000:
            raise ValueError("Mẫu giọng rỗng")
        dic = None
        if dictionary:
            import json
            try:
                parsed = json.loads(dictionary)
                dic = [d for d in parsed if isinstance(d, dict)][:500] if isinstance(parsed, list) else None
            except ValueError:
                raise ValueError("Từ điển đọc không hợp lệ") from None
        _cleanup(out_dir)
        tag = new_id("br")
        src = eng.s.sub("tmp") / f"{tag}-ref.bin"
        src.write_bytes(data)
        is_raw = raw == "1"

        def job(ctx: RunContext, progress: Callable[[float, str], None]) -> dict:
            refwav = eng.s.sub("tmp") / f"{tag}-ref.wav"
            try:
                progress(0.02, "Chuẩn bị mẫu giọng")
                # Cùng cách xử lý mẫu như Voice Studio của Engine: mono 24 kHz, chuẩn hóa âm lượng.
                media.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-y", "-i", str(src), "-vn",
                           "-af", "loudnorm=I=-18:TP=-2:LRA=11", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le",
                           str(refwav)], ctx, 120)
                dur = media.probe_duration_ms(refwav)
                if dur < 2000:
                    raise ValueError("Mẫu giọng quá ngắn (cần tối thiểu 2 giây)")
                sha = hashlib.sha256(refwav.read_bytes()).hexdigest()
                spoken = text if is_raw else normalize(text, dic if dic is not None else eng.dictionary())
                out = out_dir / f"{tag}.wav"
                res = eng.tts.synthesize(spoken, refwav, sha, eng.tts_config(), out, ctx, progress)
                return {"file": out.name, "spoken": spoken, "model": eng.tts.model_id(eng.tts_config()), **res}
            finally:
                src.unlink(missing_ok=True)
                refwav.unlink(missing_ok=True)

        return eng.jobs.submit("bridge-tts", job, params={"chars": len(text)}, message="Chờ sinh giọng AI (bản web)")

    def bridge_job(jid: str) -> dict:
        j = eng.jobs.get(jid) if valid_id(jid, "jb") else None
        if not j or j["type"] != "bridge-tts":
            raise HTTPException(404, "Không tìm thấy tác vụ")
        return j

    @app.get("/bridge/jobs/{jid}")
    def job_status(jid: str):
        return bridge_job(jid)

    @app.post("/bridge/jobs/{jid}/cancel")
    def job_cancel(jid: str):
        bridge_job(jid)
        return {"cancelled": eng.jobs.cancel(jid)}

    @app.get("/bridge/jobs/{jid}/audio")
    def job_audio(jid: str):
        j = bridge_job(jid)
        if j["status"] != "done" or not j.get("result"):
            raise HTTPException(409, "Tác vụ chưa xong")
        f = out_dir / j["result"]["file"]
        if not f.exists():
            raise HTTPException(410, "File đã hết hạn (giữ 1 giờ) — hãy tạo lại")
        return FileResponse(f, media_type="audio/wav")
