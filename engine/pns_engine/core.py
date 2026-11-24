"""Nghiệp vụ PNS Engine: dự án, cảnh, liên kết âm thanh, giọng, kết xuất, gói xuất bản, sao lưu."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable

from . import media
from .config import SCHEMA_VERSION, VERSION, Settings
from .jobs import JobRunner
from .media import MediaError, RunContext
from .render import render_project
from .storage import Store, new_id, now_ms, valid_id
from .textnorm import DEFAULT_DICTIONARY, normalize, word_count
from .tts import DEFAULT_TTS, TTSEngine

PROJECT_KINDS = {"lecture", "video", "audio", "image", "podcast", "other"}
PROJECT_STATUS = {"draft", "review", "approved", "published"}
SCENE_STATUS = {"draft", "review", "approved"}
AUDIO_MODES = {"none", "recorded", "tts"}
AUDIO_BINDING_FIELDS = {"audioAssetId", "audioDurationMs", "audioStale", "audioInfo", "spokenText"}


def _s(v: Any, n: int) -> str:
    return v[:n] if isinstance(v, str) else ""


def _url(v: Any) -> str:
    v = _s(v, 500).strip()
    return v if re.match(r"^https://[^\s<>\"']+$", v) else ""


class PNSEngine:
    def __init__(self, settings: Settings | None = None):
        self.s = settings or Settings()
        self.store = Store(self.s)
        self.jobs = JobRunner(self.store)
        self.tts = TTSEngine(self.s.sub("cache", "tts"), test_mode=self.s.tts_test_mode)

    # ================= cấu hình =================
    def dictionary(self) -> list[dict]:
        return self.store.kv_get("dictionary", DEFAULT_DICTIONARY)

    def set_dictionary(self, entries: list) -> list[dict]:
        clean = []
        for e in entries[:2000]:
            if isinstance(e, dict) and _s(e.get("written"), 80).strip() and _s(e.get("spoken"), 200).strip():
                clean.append({"written": _s(e["written"], 80).strip(), "spoken": _s(e["spoken"], 200).strip(),
                              "caseSensitive": bool(e.get("caseSensitive", True))})
        self.store.kv_set("dictionary", clean)
        return clean

    def tts_config(self) -> dict:
        return {**DEFAULT_TTS, **self.store.kv_get("tts", {})}

    def set_tts_config(self, cfg: dict) -> dict:
        new = self.tts_config()
        if cfg.get("mode") in ("v3turbo", "v3nano"):
            new["mode"] = cfg["mode"]
        if cfg.get("precision") in ("fp32", "int8"):
            new["precision"] = cfg["precision"]
        if isinstance(cfg.get("threads"), int) and 0 <= cfg["threads"] <= 32:
            new["threads"] = cfg["threads"]
        self.store.kv_set("tts", new)
        return new

    def app_settings(self) -> dict:
        return {"pnlUrl": "", "pndUrl": "", **self.store.kv_get("app", {})}

    def set_app_settings(self, body: dict) -> dict:
        new = {"pnlUrl": _url(body.get("pnlUrl")), "pndUrl": _url(body.get("pndUrl"))}
        self.store.kv_set("app", new)
        return new

    # ================= dự án =================
    def spoken_text(self, scene: dict) -> str:
        if scene.get("spokenOverride") and scene.get("scriptSpoken", "").strip():
            return scene["scriptSpoken"]
        return normalize(scene.get("scriptOriginal", ""), self.dictionary())

    def _voice_sig(self, voice_id: str | None) -> str:
        v = self.voice(voice_id) if voice_id else None
        return v["sha256"] if v else "none"

    def spoken_hash(self, scene: dict) -> str:
        raw = json.dumps([self.spoken_text(scene), scene.get("voiceId"), self._voice_sig(scene.get("voiceId")),
                          self.tts.model_id(self.tts_config()), self.tts_config()], ensure_ascii=False)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get_project(self, pid: str) -> dict | None:
        if not valid_id(pid, "pj"):
            return None
        p = self.store.project_row(pid)
        if not p:
            return None
        bind = {(r["scene_id"], r["mode"]): r for r in self.store.q(
            "SELECT * FROM scene_audio WHERE project_id=?", (pid,))}
        for sc in p.get("scenes", []):
            sc["spokenText"] = self.spoken_text(sc)
            sc["wordCount"] = word_count(sc.get("scriptOriginal", ""))
            mode = sc.get("audioMode", "none")
            b = bind.get((sc["id"], mode)) if mode != "none" else None
            sc["audioAssetId"] = b["asset_id"] if b else None
            sc["audioDurationMs"] = b["duration_ms"] if b else None
            sc["audioInfo"] = json.loads(b["info"]) if b and b["info"] else None
            sc["audioStale"] = mode == "tts" and (not b or b["spoken_hash"] != self.spoken_hash(sc))
        return p

    def _clean_scene(self, sc: dict) -> dict:
        if not isinstance(sc, dict):
            raise ValueError("Cảnh không hợp lệ")
        sid = sc.get("id") if valid_id(sc.get("id", ""), "sc") else new_id("sc")
        caps = []
        for c in (sc.get("captions") or [])[:500]:
            try:
                st, en = int(c["startMs"]), int(c["endMs"])
                if 0 <= st < en:
                    caps.append({"startMs": st, "endMs": en, "text": _s(c.get("text"), 500)})
            except (KeyError, TypeError, ValueError):
                continue
        slide = sc.get("slideAssetId")
        voice = sc.get("voiceId")
        return {
            "id": sid, "title": _s(sc.get("title"), 200) or "Cảnh mới",
            "slideAssetId": slide if slide and valid_id(slide, "as") else None,
            "sourcePage": sc.get("sourcePage") if isinstance(sc.get("sourcePage"), int) else None,
            "scriptOriginal": _s(sc.get("scriptOriginal"), self.s.max_script_chars),
            "scriptSpoken": _s(sc.get("scriptSpoken"), self.s.max_script_chars),
            "spokenOverride": bool(sc.get("spokenOverride")),
            "sourceNotes": _s(sc.get("sourceNotes"), 5000),
            "needsVerification": bool(sc.get("needsVerification")),
            "audioMode": sc.get("audioMode") if sc.get("audioMode") in AUDIO_MODES else "none",
            "voiceId": voice if voice and valid_id(voice, "vc") else None,
            "silentDurationMs": max(1000, min(600000, int(sc.get("silentDurationMs") or 5000))),
            "captions": caps, "captionsEdited": bool(sc.get("captionsEdited")) and bool(caps),
            "status": sc.get("status") if sc.get("status") in SCENE_STATUS else "draft",
            "excluded": bool(sc.get("excluded")),
        }

    def clean_project_body(self, body: dict) -> dict:
        scenes = body.get("scenes", [])
        if not isinstance(scenes, list) or len(scenes) > self.s.max_scenes:
            raise ValueError(f"Danh sách cảnh không hợp lệ (tối đa {self.s.max_scenes})")
        clean = [self._clean_scene(sc) for sc in scenes]
        ids = [c["id"] for c in clean]
        if len(set(ids)) != len(ids):
            raise ValueError("Trùng ID cảnh")
        course = body.get("course") if isinstance(body.get("course"), dict) else {}
        links = body.get("links") if isinstance(body.get("links"), dict) else {}
        status = body.get("status") if body.get("status") in PROJECT_STATUS else "draft"
        return {"title": _s(body.get("title"), 200).strip() or "Dự án chưa đặt tên", "status": status,
                "description": _s(body.get("description"), 2000),
                "course": {k: _s(course.get(k), 200) for k in ("course", "chapter", "lesson")},
                "links": {"pndSource": _url(links.get("pndSource")), "pnlTarget": _url(links.get("pnlTarget"))},
                "tags": [_s(t, 40) for t in (body.get("tags") or [])[:20] if isinstance(t, str)],
                "scenes": clean}

    def create_project(self, body: dict) -> dict:
        kind = body.get("kind") if body.get("kind") in PROJECT_KINDS else "lecture"
        clean = self.clean_project_body(body)
        p = self.store.create_project(clean["title"], kind, clean["course"], clean["scenes"],
                                      {k: clean[k] for k in ("description", "links", "tags")})
        return self.get_project(p["id"])  # type: ignore[return-value]

    def save_project(self, pid: str, body: dict, revision: int | None) -> dict:
        clean = self.clean_project_body(body)
        self.store.save_project(pid, clean, revision)
        return self.get_project(pid)  # type: ignore[return-value]

    def duplicate_project(self, pid: str) -> dict:
        src = self.get_project(pid)
        if not src:
            raise KeyError(pid)
        body = {k: src.get(k) for k in ("course", "links", "tags", "description", "scenes")}
        body["title"] = src["title"] + " (bản sao)"
        body["kind"] = src["kind"]
        new = self.create_project({**body, "scenes": [{**sc, "id": None} for sc in body["scenes"]]})
        # Sao chép liên kết âm thanh (tài sản dùng chung, không nhân bản file)
        for old, nsc in zip(src["scenes"], new["scenes"]):
            for r in self.store.q("SELECT * FROM scene_audio WHERE project_id=? AND scene_id=?", (pid, old["id"])):
                self._bind(new["id"], nsc["id"], r["mode"], r["asset_id"], r["duration_ms"], r["spoken_hash"],
                           json.loads(r["info"] or "null"))
        return self.get_project(new["id"])  # type: ignore[return-value]

    def delete_project(self, pid: str) -> None:
        self.store.x("DELETE FROM scene_audio WHERE project_id=?", (pid,))
        self.store.delete_project(pid)

    def _bind(self, pid: str, sid: str, mode: str, asset_id: str, dur: int, spoken_hash: str | None,
              info: dict | None) -> None:
        self.store.x("INSERT INTO scene_audio VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id,scene_id,mode) "
                     "DO UPDATE SET asset_id=excluded.asset_id, duration_ms=excluded.duration_ms, "
                     "spoken_hash=excluded.spoken_hash, info=excluded.info, updated_at=excluded.updated_at",
                     (pid, sid, mode, asset_id, dur, spoken_hash, json.dumps(info or {}, ensure_ascii=False),
                      now_ms()))

    def _scene(self, pid: str, sid: str) -> tuple[dict, dict]:
        p = self.get_project(pid)
        if not p:
            raise KeyError("Không tìm thấy dự án")
        sc = next((s for s in p["scenes"] if s["id"] == sid), None)
        if not sc:
            raise KeyError("Không tìm thấy cảnh (hãy lưu dự án trước)")
        return p, sc

    # ================= tài sản =================
    def ingest_upload(self, tmp: Path, filename: str, kind_hint: str = "") -> dict:
        """Kiểm tra định dạng thật của file rồi đưa vào thư viện media."""
        ext = Path(filename).suffix.lower()
        name = Path(filename).name[:200]
        if ext in media.PDF_EXT:
            media.check_pdf(tmp)
            pages = media.pdf_page_count(tmp)
            return self.store.add_asset(tmp, "pdf", name, "application/pdf", {"pages": pages})
        if ext in media.IMAGE_EXT:
            w, h = media.check_image(tmp)
            return self.store.add_asset(tmp, "image", name, f"image/{ext.strip('.').replace('jpg', 'jpeg')}",
                                        {"width": w, "height": h, "rights": ""})
        if ext in media.AUDIO_EXT:
            out = tmp.with_name(tmp.stem + ".norm.wav")
            dur = media.normalize_audio(tmp, out)      # giải mã được mới nhận
            tmp.unlink(missing_ok=True)
            return self.store.add_asset(out, "audio", name, "audio/wav",
                                        {"durationMs": dur, "original": ext, "normalized": "EBU R128 -16 LUFS"})
        if ext in media.VIDEO_EXT:
            dur = media.probe_duration_ms(tmp)
            return self.store.add_asset(tmp, "video", name, "video/mp4" if ext == ".mp4" else "video/" + ext[1:],
                                        {"durationMs": dur})
        if ext in media.PPTX_EXT:
            with open(tmp, "rb") as f:
                if f.read(4) not in (b"PK\x03\x04", b"\xd0\xcf\x11\xe0"):
                    raise MediaError("File trình chiếu không hợp lệ")
            return self.store.add_asset(tmp, "presentation", name, "application/octet-stream", {})
        raise MediaError("Định dạng chưa hỗ trợ. Chấp nhận: PDF, PPTX, PNG/JPG/WEBP, WAV/M4A/MP3/OGG/FLAC, MP4")

    def import_slides_job(self, pid: str, asset_id: str, mode: str = "append") -> dict:
        a = self.store.asset(asset_id)
        if not a or a["kind"] not in ("pdf", "presentation"):
            raise ValueError("Chọn file PDF hoặc PPTX trong thư viện")
        if not self.get_project(pid):
            raise KeyError("Không tìm thấy dự án")

        def job(ctx: RunContext, progress: Callable[[float, str], None]) -> dict:
            src = self.store.asset_path(asset_id)
            work = Path(tempfile.mkdtemp(dir=self.s.sub("tmp")))
            try:
                if a["kind"] == "presentation":
                    progress(0.05, "Chuyển PPTX sang PDF bằng LibreOffice")
                    src = media.pptx_to_pdf(src, work, ctx)
                pages = media.render_pdf(src, work, self.s.max_pdf_pages,
                                         lambda f: progress(0.1 + 0.8 * f, "Kết xuất trang PDF"), ctx)
                new_scenes = []
                for page, png, w, h in pages:
                    sa = self.store.add_asset(png, "slide", f"{a['name']} – trang {page}", "image/png",
                                              {"width": w, "height": h, "page": page, "sourceAssetId": asset_id})
                    new_scenes.append({"title": f"Trang {page}", "slideAssetId": sa["id"], "sourcePage": page})
                with self.store._lock:
                    p = self.get_project(pid)
                    if not p:
                        raise KeyError("Dự án đã bị xóa")
                    base = [] if mode == "replace" else p["scenes"]
                    if len(base) + len(new_scenes) > self.s.max_scenes:
                        raise ValueError(f"Vượt giới hạn {self.s.max_scenes} cảnh")
                    self.save_project(pid, {**p, "scenes": base + new_scenes}, None)
                return {"pages": len(pages), "slides": [s["slideAssetId"] for s in new_scenes]}
            finally:
                shutil.rmtree(work, ignore_errors=True)

        return self.jobs.submit("import-slides", job, pid, params={"assetId": asset_id, "mode": mode},
                                message="Chờ kết xuất slide")

    def attach_recorded(self, pid: str, sid: str, asset_id: str) -> dict:
        self._scene(pid, sid)
        a = self.store.asset(asset_id)
        if not a or a["kind"] != "audio":
            raise ValueError("Chọn file âm thanh trong thư viện")
        self._bind(pid, sid, "recorded", asset_id, int(a["meta"].get("durationMs") or 0), None,
                   {"source": a["name"]})
        return self.get_project(pid)  # type: ignore[return-value]

    def detach_audio(self, pid: str, sid: str, mode: str) -> dict:
        self.store.x("DELETE FROM scene_audio WHERE project_id=? AND scene_id=? AND mode=?", (pid, sid, mode))
        return self.get_project(pid)  # type: ignore[return-value]

    # ================= giọng =================
    def voices(self) -> list[dict]:
        out = []
        for r in self.store.q("SELECT * FROM voices ORDER BY created_at DESC"):
            d = dict(r)
            d["consent"] = json.loads(d["consent"])
            d["meta"] = json.loads(d["meta"])
            d.pop("file")
            out.append(d)
        return out

    def voice(self, vid: str | None) -> dict | None:
        if not vid or not valid_id(vid, "vc"):
            return None
        rows = self.store.q("SELECT * FROM voices WHERE id=?", (vid,))
        if not rows:
            return None
        d = dict(rows[0])
        d["consent"] = json.loads(d["consent"])
        d["meta"] = json.loads(d["meta"])
        return d

    def voice_path(self, vid: str) -> Path | None:
        v = self.voice(vid)
        return self.s.data_dir / "voices" / vid / v["file"] if v else None

    def add_voice(self, tmp: Path, filename: str, name: str, consent_owner: str, consent: bool,
                  start_ms: int = 0, end_ms: int = 0) -> dict:
        if not consent:
            raise ValueError("Cần xác nhận quyền sử dụng giọng nói")
        if Path(filename).suffix.lower() not in media.AUDIO_EXT:
            raise MediaError("Mẫu giọng phải là WAV/M4A/MP3/OGG/FLAC/WEBM")
        vid = new_id("vc")
        folder = self.s.sub("voices", vid)
        cut = tmp
        if end_ms > start_ms >= 0 and end_ms - start_ms >= 1000:
            cut = folder / "cut.wav"
            media.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-y", "-ss", f"{start_ms / 1000:.3f}",
                       "-to", f"{end_ms / 1000:.3f}", "-i", str(tmp), str(cut)])
        dst = folder / "sample.wav"
        # Mẫu tham chiếu: mono 24 kHz, chuẩn hóa âm lượng (VieNeu tự khử nhiễu khi denoise=True)
        media.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-y", "-i", str(cut), "-vn",
                   "-af", "loudnorm=I=-18:TP=-2:LRA=11", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(dst)])
        if cut != tmp:
            cut.unlink(missing_ok=True)
        tmp.unlink(missing_ok=True)
        dur = media.probe_duration_ms(dst)
        if dur < 2000:
            shutil.rmtree(folder, ignore_errors=True)
            raise MediaError("Mẫu giọng quá ngắn (cần tối thiểu 2 giây, nên 3–15 giây)")
        warn = "Mẫu dài hơn 20 giây; nên cắt còn 3–15 giây câu nói rõ, không nhạc nền." if dur > 20000 else ""
        sha = _sha(dst)
        consent_rec = {"owner": _s(consent_owner, 120), "confirmedAt": now_ms(),
                       "statement": "Người dùng xác nhận có quyền sử dụng giọng nói này để tạo âm thanh AI; "
                                    "mẫu giọng chỉ lưu trên máy cá nhân."}
        self.store.x("INSERT INTO voices VALUES(?,?,?,?,?,?,?)",
                     (vid, _s(name, 120) or "Giọng của tôi", "sample.wav", sha,
                      json.dumps(consent_rec, ensure_ascii=False),
                      json.dumps({"durationMs": dur, "warning": warn, "approved": False}, ensure_ascii=False),
                      now_ms()))
        return self.voice(vid)  # type: ignore[return-value]

    def update_voice(self, vid: str, body: dict) -> dict:
        v = self.voice(vid)
        if not v:
            raise KeyError("Không tìm thấy giọng")
        meta = v["meta"]
        if "approved" in body:
            meta["approved"] = bool(body["approved"])
        if "note" in body:
            meta["note"] = _s(body["note"], 1000)
        name = _s(body.get("name"), 120) or v["name"]
        self.store.x("UPDATE voices SET name=?, meta=? WHERE id=?", (name, json.dumps(meta, ensure_ascii=False), vid))
        return self.voice(vid)  # type: ignore[return-value]

    def delete_voice(self, vid: str) -> None:
        self.store.x("DELETE FROM voices WHERE id=?", (vid,))
        shutil.rmtree(self.s.data_dir / "voices" / vid, ignore_errors=True)

    def voice_test_job(self, vid: str, text: str) -> dict:
        ref = self.voice_path(vid)
        if not ref:
            raise KeyError("Không tìm thấy giọng")
        text = _s(text, 3000).strip()
        if not text:
            raise ValueError("Nhập câu thử giọng")
        v = self.voice(vid)

        def job(ctx: RunContext, progress: Callable[[float, str], None]) -> dict:
            spoken = normalize(text, self.dictionary())
            out = self.s.sub("voices", vid) / f"test-{new_id('ts')[3:]}.wav"
            info = self.tts.synthesize(spoken, ref, v["sha256"], self.tts_config(), out, ctx, progress)
            return {"file": out.name, "spoken": spoken, **info}

        return self.jobs.submit("voice-test", job, params={"voiceId": vid}, message="Chờ sinh giọng thử")

    def generate_scene_tts(self, pid: str, scene: dict, ctx: RunContext,
                           progress: Callable[[float, str], None]) -> dict:
        vid = scene.get("voiceId")
        ref = self.voice_path(vid) if vid else None
        if not ref:
            raise ValueError(f"Cảnh «{scene.get('title', '')}» chưa chọn giọng AI")
        text = self.spoken_text(scene).strip()
        if not text:
            raise ValueError(f"Cảnh «{scene.get('title', '')}» chưa có lời giảng")
        tmp = self.s.sub("tmp") / f"{new_id('tt')}.wav"
        info = self.tts.synthesize(text, ref, self.voice(vid)["sha256"], self.tts_config(), tmp, ctx, progress)
        asset = self.store.add_asset(tmp, "audio", f"Giọng AI – {scene.get('title', '')}", "audio/wav",
                                     {"durationMs": info["durationMs"], "ai": True, "voiceId": vid,
                                      "model": self.tts.model_id(self.tts_config())}, project_id=pid)
        self._bind(pid, scene["id"], "tts", asset["id"], info["durationMs"], self.spoken_hash(scene), info)
        return {"assetId": asset["id"], **info}

    def scene_tts_job(self, pid: str, sid: str) -> dict:
        _, sc = self._scene(pid, sid)
        if not self.tts.installed():
            raise ValueError("Chưa cài VieNeu-TTS. Chạy INSTALL_VOICE_AI.bat; giọng thu âm thật vẫn dùng được.")

        def job(ctx: RunContext, progress: Callable[[float, str], None]) -> dict:
            _, fresh = self._scene(pid, sid)
            return self.generate_scene_tts(pid, fresh, ctx, progress)

        return self.jobs.submit("scene-tts", job, pid, sid, message="Chờ sinh giọng AI")

    # ================= kết xuất & xuất bản =================
    def render_job(self, pid: str, quality: str) -> dict:
        if quality not in ("preview", "final"):
            raise ValueError("Chất lượng không hợp lệ")
        if not self.get_project(pid):
            raise KeyError("Không tìm thấy dự án")

        def job(ctx: RunContext, progress: Callable[[float, str], None]) -> dict:
            return render_project(self, self.get_project(pid), quality, ctx, progress)

        return self.jobs.submit("render", job, pid, params={"quality": quality}, message="Chờ kết xuất video")

    def renders(self, pid: str) -> list[dict]:
        base = self.s.data_dir / "renders" / pid
        out = []
        if base.exists():
            for f in base.glob("rd_*/render.json"):
                try:
                    out.append(json.loads(f.read_text(encoding="utf-8")))
                except Exception:
                    continue
        return sorted(out, key=lambda r: -r["createdAt"])

    def render_dir(self, pid: str, rid: str) -> Path | None:
        if not (valid_id(pid, "pj") and valid_id(rid, "rd")):
            return None
        d = self.s.data_dir / "renders" / pid / rid
        return d if (d / "render.json").exists() else None

    def set_approval(self, pid: str, rid: str, approved: bool, approver: str, note: str) -> dict:
        d = self.render_dir(pid, rid)
        if not d:
            raise KeyError("Không tìm thấy bản kết xuất")
        rec = json.loads((d / "render.json").read_text(encoding="utf-8"))
        if approved and rec.get("quality") != "final":
            raise ValueError("Chỉ duyệt bản 1080p (final), không duyệt bản xem trước 720p")
        rec["approval"] = {"approvedBy": _s(approver, 120) or "local-owner", "approvedAt": now_ms(),
                           "note": _s(note, 1000)} if approved else None
        (d / "render.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
        return rec

    def delete_render(self, pid: str, rid: str) -> None:
        d = self.render_dir(pid, rid)
        if d:
            shutil.rmtree(d, ignore_errors=True)

    def publish_package(self, pid: str, rid: str) -> Path:
        """Gói phát hành cục bộ cho PNL/PND: MP4 + SRT + publication.json. Không tự đăng lên web."""
        d = self.render_dir(pid, rid)
        p = self.get_project(pid)
        if not d or not p:
            raise KeyError("Không tìm thấy bản kết xuất")
        rec = json.loads((d / "render.json").read_text(encoding="utf-8"))
        if not rec.get("approval"):
            raise ValueError("Bản kết xuất chưa được duyệt")
        pub = {"schemaVersion": SCHEMA_VERSION, "generator": f"PNS {VERSION}", "projectId": pid,
               "projectTitle": p["title"], "course": p.get("course", {}), "revision": rec["projectRevision"],
               "renderId": rid, "videoPath": "lecture.mp4", "captionPath": "lecture.srt",
               "durationMs": rec["durationMs"], "resolution": rec["resolution"],
               "approvedBy": rec["approval"]["approvedBy"], "approvedAt": rec["approval"]["approvedAt"],
               "aiNarration": rec["aiNarration"], "captionMode": rec["captionMode"],
               "sources": [{"scene": s["title"], "notes": s.get("sourceNotes", "")}
                           for s in p["scenes"] if s.get("sourceNotes")],
               "target": {"pnlTarget": p["links"].get("pnlTarget", ""), "pndSource": p["links"].get("pndSource", "")},
               "visibility": "Chưa công khai — người quản trị PNL/PND tải lên thủ công sau khi duyệt"}
        out = d / f"PNS_{pid}_{rid}.zip"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(d / "lecture.mp4", "lecture.mp4", compress_type=zipfile.ZIP_STORED)
            z.write(d / "lecture.srt", "lecture.srt")
            z.writestr("publication.json", json.dumps(pub, ensure_ascii=False, indent=2))
        return out

    # ================= sao lưu / khôi phục =================
    def export_project(self, pid: str) -> Path:
        """Gói .pnsproj: manifest + slide/ảnh/audio thu thật/audio AI. KHÔNG chứa mẫu giọng."""
        p = self.get_project(pid)
        if not p:
            raise KeyError("Không tìm thấy dự án")
        out = self.s.sub("backups") / f"{re.sub(r'[^A-Za-z0-9_-]+', '-', p['title'])[:50]}-{pid}.pnsproj"
        binds = [dict(r) for r in self.store.q("SELECT * FROM scene_audio WHERE project_id=?", (pid,))]
        asset_ids = {s["slideAssetId"] for s in p["scenes"] if s.get("slideAssetId")} | {b["asset_id"] for b in binds}
        manifest = {"format": "pns-project", "schemaVersion": SCHEMA_VERSION, "generator": f"PNS {VERSION}",
                    "exportedAt": now_ms(), "project": {k: v for k, v in p.items() if k not in ("archived",)},
                    "sceneAudio": binds, "assets": []}
        for s in manifest["project"]["scenes"]:
            for k in AUDIO_BINDING_FIELDS | {"wordCount"}:
                s.pop(k, None)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for aid in sorted(asset_ids):
                a = self.store.asset(aid)
                path = self.store.asset_path(aid)
                if a and path and path.exists():
                    manifest["assets"].append({k: a[k] for k in ("id", "kind", "name", "mime", "file", "sha256", "meta")})
                    z.write(path, f"assets/{aid}/{a['file']}")
            z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        return out

    def import_project(self, pkg: Path) -> dict:
        try:
            z = zipfile.ZipFile(pkg)
        except zipfile.BadZipFile:
            raise ValueError("Gói dự án không hợp lệ")
        with z:
            total = sum(i.file_size for i in z.infolist())
            if total > 4 * 1024 ** 3:
                raise ValueError("Gói quá lớn")
            m = json.loads(z.read("manifest.json"))
            if m.get("format") != "pns-project" or not isinstance(m.get("project"), dict):
                raise ValueError("Không phải gói dự án PNS")
            if int(m.get("schemaVersion", 0)) > SCHEMA_VERSION:
                raise ValueError("Gói được tạo bởi phiên bản PNS mới hơn")
            remap: dict[str, str] = {}
            names = set(z.namelist())
            for a in m.get("assets", []):
                aid, fname = a.get("id", ""), a.get("file", "")
                if not valid_id(aid, "as") or not re.fullmatch(r"file\.[a-z0-9]{1,6}", fname):
                    continue                      # chặn path traversal: chỉ nhận tên chuẩn
                member = f"assets/{aid}/{fname}"
                if member not in names:
                    continue
                if self.store.asset(aid) and self.store.asset(aid)["sha256"] == a.get("sha256"):
                    remap[aid] = aid              # đã có sẵn, dùng lại
                    continue
                tmp = self.s.sub("tmp") / f"imp-{new_id('im')}{Path(fname).suffix}"
                with z.open(member) as src, open(tmp, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                kind = a.get("kind") if a.get("kind") in ("slide", "image", "audio", "pdf", "video") else "image"
                new = self.store.add_asset(tmp, kind, _s(a.get("name"), 200), _s(a.get("mime"), 80) or "application/octet-stream",
                                           a.get("meta") if isinstance(a.get("meta"), dict) else {})
                remap[aid] = new["id"]
            proj = m["project"]
            for s in proj.get("scenes", []):
                if s.get("slideAssetId"):
                    s["slideAssetId"] = remap.get(s["slideAssetId"])
                s["oldId"] = s.get("id")
                s["id"] = None
            proj["title"] = _s(proj.get("title"), 180) + " (khôi phục)"
            new_p = self.create_project({**proj, "kind": proj.get("kind", "lecture")})
            old_to_new = {old.get("oldId"): n["id"] for old, n in zip(proj.get("scenes", []), new_p["scenes"])}
            for b in m.get("sceneAudio", []):
                sid = old_to_new.get(b.get("scene_id"))
                aid = remap.get(b.get("asset_id"))
                if sid and aid and b.get("mode") in ("recorded", "tts"):
                    self._bind(new_p["id"], sid, b["mode"], aid, int(b.get("duration_ms") or 0),
                               b.get("spoken_hash"), json.loads(b.get("info") or "{}"))
        return self.get_project(new_p["id"])  # type: ignore[return-value]

    # ================= tổng quan =================
    def health(self) -> dict:
        return {"app": "Phuc Nguyen Studio Engine", "version": VERSION, "schemaVersion": SCHEMA_VERSION,
                "ffmpeg": media.ffmpeg_version(), "libreoffice": bool(media.soffice_path()),
                "tts": self.tts.status(self.tts_config()), "dataDir": str(self.s.data_dir)}

    def dashboard(self) -> dict:
        return {"recent": self.store.list_projects()[:8], "jobs": self.jobs.list(limit=12),
                "activeJobs": self.jobs.active(), "usage": self.store.usage(),
                "counts": {"projects": len(self.store.list_projects()),
                           "assets": self.store.q("SELECT COUNT(*) c FROM assets")[0]["c"],
                           "voices": self.store.q("SELECT COUNT(*) c FROM voices")[0]["c"]}}


def _sha(path: Path) -> str:
    from .storage import sha256_file
    return sha256_file(path)
