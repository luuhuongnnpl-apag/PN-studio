"""Kết xuất video bài giảng: khung hình slide (letterbox, không méo) + âm thanh thật/AI -> MP4 H.264/AAC + SRT.

Bộ nhớ đệm theo cảnh: đổi lời một cảnh chỉ làm mất hiệu lực audio/clip của cảnh đó.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

from .media import RunContext, ffmpeg, probe_duration_ms, run
from .storage import new_id, now_ms
from .textnorm import split_sentences

FPS = 25
LEAD_MS = 250
TAIL_MS = 600
QUALITY = {"preview": {"size": (1280, 720), "crf": "26"}, "final": {"size": (1920, 1080), "crf": "20"}}
RENDER_TAG = "r1"
AI_LABEL = "Lời thuyết minh tạo bằng AI"

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def _font(size: int):
    for f in FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


def frame_ms(ms: int) -> int:
    step = 1000 // FPS
    return ((ms + step - 1) // step) * step


def compose_frame(slide: Path | None, title: str, size: tuple[int, int], ai_label: bool, dst: Path) -> None:
    W, H = size
    canvas = Image.new("RGB", (W, H), "white")
    if slide:
        with Image.open(slide) as im:
            im = im.convert("RGB")
            scale = min(W / im.width, H / im.height)
            nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
            im = im.resize((nw, nh), Image.LANCZOS)
            canvas.paste(im, ((W - nw) // 2, (H - nh) // 2))
    else:   # thẻ tiêu đề khi cảnh chưa có slide
        d = ImageDraw.Draw(canvas)
        d.rectangle([0, 0, W, H], fill="#102c43")
        d.rectangle([W * 0.08, H * 0.62, W * 0.2, H * 0.62 + 6], fill="#c4a578")
        f = _font(int(H * 0.06))
        d.multiline_text((W * 0.08, H * 0.38), _wrap(title or "", 38), font=f, fill="white", spacing=12)
    if ai_label:
        d = ImageDraw.Draw(canvas)
        f = _font(max(14, H // 48))
        bbox = d.textbbox((0, 0), AI_LABEL, font=f)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad = H // 90
        x, y = W - tw - pad * 3, H - th - pad * 3
        d.rounded_rectangle([x - pad, y - pad, x + tw + pad, y + th + pad * 1.6], radius=pad, fill=(16, 44, 67))
        d.text((x, y), AI_LABEL, font=f, fill=(255, 255, 255))
    canvas.save(dst, "PNG")


def _wrap(text: str, width: int) -> str:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return "\n".join(lines[:4])


def auto_captions(text: str, audio_ms: int) -> list[dict]:
    """Phụ đề theo câu; mốc thời gian ƯỚC LƯỢNG theo tỷ lệ số ký tự (chưa có căn chỉnh từng từ)."""
    sents = split_sentences(text)
    if not sents or audio_ms <= 0:
        return []
    total = sum(len(s) for s in sents)
    t, out = LEAD_MS, []
    for s in sents:
        d = int(audio_ms * len(s) / total)
        out.append({"startMs": t, "endMs": t + d, "text": s})
        t += d
    out[-1]["endMs"] = LEAD_MS + audio_ms
    return out


def srt_time(ms: int) -> str:
    h, rem = divmod(max(0, ms), 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms_ = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms_:03d}"


def build_srt(cues: list[dict]) -> str:
    lines = []
    for i, c in enumerate(cues, 1):
        lines += [str(i), f"{srt_time(c['startMs'])} --> {srt_time(c['endMs'])}", c["text"].strip(), ""]
    return "\n".join(lines)


def render_clip(frame: Path, audio: Path | None, duration_ms: int, quality: str, dst: Path,
                ctx: RunContext) -> None:
    q = QUALITY[quality]
    args = [ffmpeg(), "-hide_banner", "-nostdin", "-y", "-loop", "1", "-framerate", str(FPS), "-i", str(frame)]
    if audio:
        args += ["-i", str(audio)]
        af = f"[1:a]aresample=48000,aformat=channel_layouts=stereo,adelay={LEAD_MS}|{LEAD_MS},apad[a]"
    else:
        args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        af = "[1:a]anull[a]"
    args += ["-filter_complex", af, "-map", "0:v", "-map", "[a]", "-t", f"{duration_ms / 1000:.3f}",
             "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", q["crf"],
             "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", str(FPS * 2),
             "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", str(dst)]
    run(args, ctx, 1800)


def concat_clips(clips: list[Path], dst: Path, work: Path, ctx: RunContext) -> None:
    lst = work / "concat.txt"
    lst.write_text("".join(f"file '{c.resolve().as_posix()}'\n" for c in clips), encoding="utf-8")
    run([ffmpeg(), "-hide_banner", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(dst)], ctx, 3600)


def sha_text(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def render_project(engine, project: dict, quality: str, ctx: RunContext,
                   progress: Callable[[float, str], None]) -> dict:
    """engine: đối tượng PNSEngine (truy cập store, tts, voices). Trả về bản ghi render."""
    store = engine.store
    scenes = [s for s in project["scenes"] if not s.get("excluded")]
    if not scenes:
        raise ValueError("Dự án chưa có cảnh nào để kết xuất")
    size = QUALITY[quality]["size"]
    clip_dir = store.s.sub("cache", "clips")
    rid = new_id("rd")
    out_dir = store.s.sub("renders", project["id"], rid)
    work = out_dir / "work"
    work.mkdir(exist_ok=True)
    n = len(scenes)

    # 1) Bảo đảm audio AI cho các cảnh dùng giọng AI (cache theo đoạn => chỉ cảnh đổi lời mới sinh lại)
    for i, s in enumerate(scenes):
        ctx.check()
        if s.get("audioMode") == "tts" and s.get("audioStale", True):
            progress(0.4 * i / n, f"Sinh giọng AI cảnh {i + 1}/{n}")
            engine.generate_scene_tts(project["id"], s, ctx, lambda f, m: None)
    project = engine.get_project(project["id"])   # lấy lại liên kết audio mới
    scenes = [s for s in project["scenes"] if not s.get("excluded")]

    clips, cues, timeline, offset, ai_used, reused = [], [], [], 0, False, 0
    for i, s in enumerate(scenes):
        ctx.check()
        progress(0.4 + 0.5 * i / n, f"Kết xuất cảnh {i + 1}/{n}")
        slide = store.asset_path(s["slideAssetId"]) if s.get("slideAssetId") else None
        slide_sha = store.asset(s["slideAssetId"])["sha256"] if slide else sha_text("title", s.get("title", ""))
        audio_path, audio_sha, audio_ms = None, "silence", 0
        mode = s.get("audioMode", "none")
        if mode in ("recorded", "tts") and s.get("audioAssetId"):
            a = store.asset(s["audioAssetId"])
            if a:
                audio_path, audio_sha = store.asset_path(a["id"]), a["sha256"]
                audio_ms = int(a["meta"].get("durationMs") or probe_duration_ms(audio_path))
        if mode in ("recorded", "tts") and not audio_path:
            raise ValueError(f"Cảnh {i + 1} «{s.get('title', '')}» chọn giọng nhưng chưa có âm thanh")
        is_ai = mode == "tts"
        ai_used |= is_ai
        dur = frame_ms(LEAD_MS + audio_ms + TAIL_MS) if audio_path else frame_ms(int(s.get("silentDurationMs") or 5000))
        key = sha_text(RENDER_TAG, quality, slide_sha, audio_sha, str(dur), str(is_ai))
        clip = clip_dir / f"{key}.mp4"
        was_cached = clip.exists()
        if was_cached:
            reused += 1
        else:
            frame = work / f"frame-{i:03d}.png"
            compose_frame(slide, s.get("title", ""), size, is_ai, frame)
            tmp = work / f"clip-{i:03d}.mp4"
            render_clip(frame, audio_path, dur, quality, tmp, ctx)
            shutil.move(str(tmp), clip)
        clips.append(clip)
        scene_cues = s.get("captions") if s.get("captionsEdited") else auto_captions(
            s.get("scriptOriginal", ""), audio_ms if audio_path else max(0, dur - LEAD_MS - TAIL_MS))
        for c in scene_cues or []:
            st, en = max(0, int(c["startMs"])), min(dur, int(c["endMs"]))
            if en > st and c.get("text", "").strip():
                cues.append({"startMs": offset + st, "endMs": offset + en, "text": c["text"]})
        timeline.append({"sceneId": s["id"], "title": s.get("title", ""), "startMs": offset, "durationMs": dur,
                         "audioMode": mode, "reusedClip": was_cached})
        offset += dur

    progress(0.92, "Ghép video")
    mp4 = out_dir / "lecture.mp4"
    concat_clips(clips, mp4, work, ctx)
    real_ms = probe_duration_ms(mp4)
    cues = [c for c in cues if c["startMs"] < real_ms]
    for c in cues:
        c["endMs"] = min(c["endMs"], real_ms)
    (out_dir / "lecture.srt").write_text(build_srt(cues), encoding="utf-8")
    shutil.rmtree(work, ignore_errors=True)
    record = {"id": rid, "projectId": project["id"], "projectRevision": project["revision"],
              "title": project["title"], "quality": quality, "resolution": f"{size[0]}x{size[1]}",
              "durationMs": real_ms, "sceneCount": n, "clipsReused": reused, "aiNarration": ai_used,
              "captionMode": "theo câu, mốc ước lượng theo tỷ lệ ký tự (chưa căn chỉnh từng từ)",
              "timeline": timeline, "createdAt": now_ms(), "approval": None, "sizeBytes": mp4.stat().st_size,
              "platform": sys.platform}
    (out_dir / "render.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record
