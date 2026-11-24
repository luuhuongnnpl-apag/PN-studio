"""Các studio mở rộng: Image, Audio, Content, Podcast, Interactive.

Toàn bộ xử lý chạy trên máy cá nhân (Pillow + FFmpeg), không gọi API trả phí. Mọi thao tác đều
KHÔNG phá file gốc: kết quả được lưu thành tài sản mới trong thư viện media.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import zipfile
from html import escape
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable
from xml.sax.saxutils import escape as xml_escape

from PIL import Image, ImageDraw, ImageFont, ImageOps

from . import media
from .config import SCHEMA_VERSION, VERSION, WEB_DIR
from .media import MediaError, RunContext
from .render import FONT_CANDIDATES, build_srt, srt_time
from .storage import new_id, now_ms, valid_id
from .textnorm import word_count

if TYPE_CHECKING:
    from .core import PNSEngine

TEMPLATES = WEB_DIR / "player"          # dùng chung với chế độ trình duyệt (web/js/local/studios.js)


def _s(v: Any, n: int) -> str:
    return v[:n].strip() if isinstance(v, str) else ""


def _int(v: Any, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _float(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return default if x != x else max(lo, min(hi, x))


def _https(v: Any) -> str:
    v = _s(v, 500)
    return v if re.match(r"^https://[^\s<>\"']+$", v) else ""


# =====================================================================================
# IMAGE STUDIO
# =====================================================================================
ASPECTS = {"16:9": (16, 9), "4:3": (4, 3), "1:1": (1, 1), "4:5": (4, 5), "9:16": (9, 16)}
COVER_SIZES = {"16:9": (1920, 1080), "1:1": (1080, 1080), "9:16": (1080, 1920)}
BOLD_FONTS = [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]
NAVY, NAVY2, GOLD, WHITE = (16, 44, 67), (31, 74, 108), (196, 165, 120), (255, 255, 255)


def _font(size: int, bold: bool = False):
    for f in (BOLD_FONTS if bold else []) + FONT_CANDIDATES:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default(size)


def _wrap_px(draw: ImageDraw.ImageDraw, text: str, font, max_w: int, max_lines: int) -> list[str]:
    """Ngắt dòng theo độ rộng điểm ảnh thật của phông (đúng với chữ tiếng Việt có dấu)."""
    lines: list[str] = []
    for para in text.splitlines() or [""]:
        cur = ""
        for w in para.split():
            trial = f"{cur} {w}".strip()
            if draw.textlength(trial, font=font) <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and draw.textlength(lines[-1] + "…", font=font) > max_w:
            lines[-1] = lines[-1][:-1]
        lines[-1] = lines[-1].rstrip() + "…"
    return lines


def _open_rgb(path: Path) -> Image.Image:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, "white")
            bg.paste(im, mask=im.split()[-1])
            return bg
        return im.convert("RGB")


def _save_image_asset(eng: "PNSEngine", im: Image.Image, fmt: str, name: str, meta: dict) -> dict:
    ext = ".jpg" if fmt == "jpg" else ".png"
    tmp = eng.s.sub("tmp") / f"img-{new_id('im')}{ext}"
    if fmt == "jpg":
        im.convert("RGB").save(tmp, "JPEG", quality=90, optimize=True, progressive=True)
    else:
        im.save(tmp, "PNG", optimize=True)
    stem = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", name)[:150] or "anh"
    return eng.store.add_asset(tmp, "image", stem + ext, "image/jpeg" if fmt == "jpg" else "image/png",
                               {"width": im.width, "height": im.height, **meta})


def crop_box(w: int, h: int, aspect: str, cx: float, cy: float, zoom: float) -> tuple[int, int, int, int]:
    """Khung cắt lớn nhất theo tỷ lệ, thu nhỏ theo zoom, đặt tâm tại (cx, cy) và luôn nằm trong ảnh."""
    if aspect not in ASPECTS:
        cw, ch = w / zoom, h / zoom
    else:
        rw, rh = ASPECTS[aspect]
        cw, ch = (w, w * rh / rw) if w * rh / rw <= h else (h * rw / rh, h)
        cw, ch = cw / zoom, ch / zoom
    cw, ch = max(1, round(cw)), max(1, round(ch))
    x = round(min(max(cx * w - cw / 2, 0), w - cw))
    y = round(min(max(cy * h - ch / 2, 0), h - ch))
    return x, y, x + cw, y + ch


def image_transform(eng: "PNSEngine", body: dict) -> dict:
    aid = str(body.get("assetId", ""))
    a = eng.store.asset(aid)
    if not a or a["kind"] not in ("image", "slide"):
        raise ValueError("Chọn ảnh hoặc slide trong thư viện")
    aspect = body.get("aspect") if body.get("aspect") in (*ASPECTS, "original") else "original"
    cx, cy = _float(body.get("cx"), 0, 1, 0.5), _float(body.get("cy"), 0, 1, 0.5)
    zoom = _float(body.get("zoom"), 1, 5, 1)
    width = _int(body.get("width"), 0, 4096, 0)
    fmt = "jpg" if body.get("format") == "jpg" else "png"
    rotate = _int(body.get("rotate"), 0, 270, 0) // 90 * 90
    im = _open_rgb(eng.store.asset_path(aid))
    if rotate:
        im = im.rotate(-rotate, expand=True)
    if body.get("flip"):
        im = ImageOps.mirror(im)
    if aspect != "original" or zoom > 1:
        im = im.crop(crop_box(im.width, im.height, aspect, cx, cy, zoom))
    if width and width != im.width:
        im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
    name = _s(body.get("name"), 150) or f"{Path(a['name']).stem} ({aspect if aspect != 'original' else 'chỉnh'})"
    return _save_image_asset(eng, im, fmt, name, {
        "rights": a["meta"].get("rights", ""), "derivedFrom": aid,
        "edit": {"aspect": aspect, "cx": cx, "cy": cy, "zoom": zoom, "width": width, "rotate": rotate,
                 "flip": bool(body.get("flip"))}})


def image_cover(eng: "PNSEngine", body: dict) -> dict:
    """Ảnh bìa bài giảng theo nhận diện Phúc Nguyên (navy/trắng/champagne)."""
    title = _s(body.get("title"), 160)
    if not title:
        raise ValueError("Nhập tiêu đề ảnh bìa")
    eyebrow, subtitle = _s(body.get("eyebrow"), 80), _s(body.get("subtitle"), 200)
    author, org = _s(body.get("author"), 120), _s(body.get("org"), 160)
    size = body.get("size") if body.get("size") in COVER_SIZES else "16:9"
    template = body.get("template") if body.get("template") in ("navy", "light", "photo") else "navy"
    fmt = "jpg" if body.get("format") == "jpg" else "png"
    W, H = COVER_SIZES[size]
    canvas = Image.new("RGB", (W, H), NAVY if template != "light" else WHITE)
    bg_id = body.get("bgAssetId")
    if template == "photo":
        bg = eng.store.asset(bg_id) if isinstance(bg_id, str) else None
        if not bg or bg["kind"] not in ("image", "slide"):
            raise ValueError("Mẫu ảnh nền cần chọn một ảnh trong thư viện")
        photo = _open_rgb(eng.store.asset_path(bg_id))
        photo = photo.crop(crop_box(photo.width, photo.height, size, 0.5, 0.5, 1)).resize((W, H), Image.LANCZOS)
        canvas.paste(photo)
        shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shade)
        for i in range(W if W >= H else H):           # phủ chuyển màu navy để chữ luôn đọc được
            t = i / (W if W >= H else H)
            alpha = int(235 * max(0.0, 1 - t * 1.15)) if W >= H else int(235 * min(1.0, t * 1.4))
            if W >= H:
                sd.line([(i, 0), (i, H)], fill=(*NAVY, alpha))
            else:
                sd.line([(0, i), (W, i)], fill=(*NAVY, alpha))
        canvas = Image.alpha_composite(canvas.convert("RGBA"), shade).convert("RGB")
    d = ImageDraw.Draw(canvas)
    ink = NAVY if template == "light" else WHITE
    sub_ink = NAVY2 if template == "light" else (219, 230, 239)
    m = int(min(W, H) * 0.08)
    if template == "light":
        d.rectangle([0, 0, int(W * 0.018), H], fill=NAVY)
    if template == "navy":       # dải nhấn: bên phải (ngang/vuông) hoặc phía trên (dọc), không đè lên chữ
        if W > H:
            d.rectangle([W - int(W * 0.30), 0, W, H], fill=NAVY2)
        else:
            d.rectangle([0, 0, W, int(H * 0.14)], fill=NAVY2)
            d.rectangle([0, int(H * 0.14), W, int(H * 0.14) + max(4, W // 180)], fill=GOLD)
    text_w = int((W * 0.62) if (W > H and template != "light") else W - 2 * m)
    unit = min(W, H)
    y = int(H * (0.18 if W > H else 0.22 if W == H else 0.2))
    if eyebrow:
        f = _font(int(unit * 0.034), True)
        d.text((m, y), eyebrow.upper(), font=f, fill=GOLD)
        y += int(unit * 0.07)
    f_title = _font(int(unit * (0.075 if len(title) < 50 else 0.06)), True)
    for line in _wrap_px(d, title, f_title, text_w, 4):
        d.text((m, y), line, font=f_title, fill=ink)
        y += int(f_title.size * 1.22)
    y += int(unit * 0.025)
    d.rectangle([m, y, m + int(unit * 0.11), y + max(4, unit // 180)], fill=GOLD)
    y += int(unit * 0.05)
    if subtitle:
        f_sub = _font(int(unit * 0.036))
        for line in _wrap_px(d, subtitle, f_sub, text_w, 3):
            d.text((m, y), line, font=f_sub, fill=sub_ink)
            y += int(f_sub.size * 1.35)
    f_foot = _font(int(unit * 0.028))
    foot_y = H - m - int(f_foot.size * (2.6 if author and org else 1.2))
    for line in [author, org]:
        if line:
            d.text((m, foot_y), _wrap_px(d, line, f_foot, W - 2 * m, 1)[0], font=f_foot,
                   fill=GOLD if line == author else sub_ink)
            foot_y += int(f_foot.size * 1.4)
    name = _s(body.get("name"), 150) or f"Ảnh bìa – {title[:60]}"
    return _save_image_asset(eng, canvas, fmt, name, {
        "rights": "Ảnh bìa tạo bằng PNS" + (f"; ảnh nền: {bg_id}" if template == "photo" else ""),
        "cover": {"template": template, "size": size, "title": title}})


# =====================================================================================
# AUDIO STUDIO
# =====================================================================================
def _pcm(path: Path, rate: int, timeout: int = 300) -> bytes:
    proc = subprocess.run([media.ffmpeg(), "-hide_banner", "-nostdin", "-v", "error", "-i", str(path), "-vn",
                           "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"], capture_output=True, timeout=timeout,
                          creationflags=media._NOWIN)
    if proc.returncode != 0:
        raise MediaError("Không giải mã được âm thanh")
    return proc.stdout


def peaks(eng: "PNSEngine", aid: str, n: int = 800) -> dict:
    """Biên độ đỉnh theo cột cho hiển thị dạng sóng (lưu đệm cạnh file gốc)."""
    a = eng.store.asset(aid)
    if not a or a["kind"] not in ("audio", "video"):
        raise KeyError("Không tìm thấy file âm thanh")
    n = max(50, min(4000, n))
    cache = eng.store.asset_path(aid).parent / f"peaks-{n}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    import array
    raw = array.array("h")
    raw.frombytes(_pcm(eng.store.asset_path(aid), 8000)[: 8000 * 2 * 60 * 120])   # tối đa 2 giờ
    total = len(raw)
    step = max(1, total // n)
    vals = [round(max((abs(x) for x in raw[i:i + step]), default=0) / 32768, 3) for i in range(0, step * n, step)]
    out = {"durationMs": int(a["meta"].get("durationMs") or total * 1000 // 8000), "peaks": vals[:n]}
    cache.write_text(json.dumps(out), encoding="utf-8")
    return out


def clean_segments(eng: "PNSEngine", segs: Any) -> list[dict]:
    if not isinstance(segs, list) or not segs:
        raise ValueError("Thêm ít nhất một đoạn âm thanh")
    if len(segs) > 100:
        raise ValueError("Tối đa 100 đoạn")
    out = []
    for i, s in enumerate(segs, 1):
        a = eng.store.asset(str((s or {}).get("assetId", "")))
        if not a or a["kind"] != "audio":
            raise ValueError(f"Đoạn {i}: chưa chọn file âm thanh hợp lệ")
        dur = int(a["meta"].get("durationMs") or 0) or media.probe_duration_ms(eng.store.asset_path(a["id"]))
        st = _int(s.get("startMs"), 0, dur, 0)
        en = _int(s.get("endMs"), 0, dur, dur) or dur
        if en - st < 100:
            raise ValueError(f"Đoạn {i}: điểm cắt không hợp lệ (cần dài tối thiểu 0,1 giây)")
        length = en - st
        out.append({"assetId": a["id"], "name": a["name"], "ai": bool(a["meta"].get("ai")), "startMs": st, "endMs": en,
                    "fadeInMs": _int(s.get("fadeInMs"), 0, length // 2, 0),
                    "fadeOutMs": _int(s.get("fadeOutMs"), 0, length // 2, 0),
                    "gainDb": _float(s.get("gainDb"), -20, 20, 0)})
    return out


def audio_filter(segs: list[dict], gap_ms: int, base: int = 0) -> tuple[str, str]:
    """Đồ thị filter FFmpeg: cắt, fade, tăng/giảm âm lượng từng đoạn rồi nối, chèn khoảng lặng giữa đoạn."""
    chains, labels = [], []
    for i, s in enumerate(segs):
        length = (s["endMs"] - s["startMs"]) / 1000
        f = [f"[{base + i}:a]atrim=start={s['startMs'] / 1000:.3f}:end={s['endMs'] / 1000:.3f}", "asetpts=PTS-STARTPTS",
             "aresample=48000", "aformat=sample_fmts=s16:channel_layouts=stereo"]
        if s["fadeInMs"]:
            f.append(f"afade=t=in:st=0:d={s['fadeInMs'] / 1000:.3f}")
        if s["fadeOutMs"]:
            f.append(f"afade=t=out:st={max(0.0, length - s['fadeOutMs'] / 1000):.3f}:d={s['fadeOutMs'] / 1000:.3f}")
        if s["gainDb"]:
            f.append(f"volume={s['gainDb']:.1f}dB")
        if gap_ms and i < len(segs) - 1:
            f.append(f"apad=pad_dur={gap_ms / 1000:.3f}")
        chains.append(",".join(f) + f"[s{i}]")
        labels.append(f"[s{i}]")
    graph = ";".join(chains) + ";" + "".join(labels) + f"concat=n={len(segs)}:v=0:a=1[mix]"
    return graph, "[mix]"


def audio_edit_job(eng: "PNSEngine", body: dict) -> dict:
    segs = clean_segments(eng, body.get("segments"))
    gap = _int(body.get("gapMs"), 0, 10000, 0)
    loud = bool(body.get("normalize", True))
    name = _s(body.get("name"), 150) or "Âm thanh đã biên tập"

    def job(ctx: RunContext, progress: Callable[[float, str], None]) -> dict:
        progress(0.1, "Cắt, fade và nối đoạn")
        args = [media.ffmpeg(), "-hide_banner", "-nostdin", "-y"]
        for s in segs:
            args += ["-i", str(eng.store.asset_path(s["assetId"]))]
        graph, out = audio_filter(segs, gap)
        if loud:
            graph += f";{out}loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[fin]"
            out = "[fin]"
        tmp = eng.s.sub("tmp") / f"ae-{new_id('ae')}.wav"
        media.run(args + ["-filter_complex", graph, "-map", out, "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
                          str(tmp)], ctx, 1800)
        progress(0.9, "Lưu vào thư viện")
        dur = media.probe_duration_ms(tmp)
        ai = any(s["ai"] for s in segs)
        asset = eng.store.add_asset(tmp, "audio", f"{name}.wav", "audio/wav", {
            "durationMs": dur, "edited": True, "ai": ai, "normalized": "EBU R128 -16 LUFS" if loud else "",
            "segments": [{k: s[k] for k in ("assetId", "name", "startMs", "endMs", "fadeInMs", "fadeOutMs", "gainDb")}
                         for s in segs], "gapMs": gap})
        return {"assetId": asset["id"], "durationMs": dur, "ai": ai}

    return eng.jobs.submit("audio-edit", job, params={"segments": len(segs)}, message="Chờ biên tập âm thanh")


# =====================================================================================
# CONTENT STUDIO
# =====================================================================================
HEAD_RE = re.compile(r"^\s*(?:#{1,4}\s*)?(?:\*\*)?\s*\[?(?:cảnh|canh|slide|trang|scene|phần)\s*(\d{1,3})\]?"
                     r"\s*(?:[:.\-–—)]\s*)?(.*?)\s*(?:\*\*)?\s*$", re.IGNORECASE)
MD_HEAD_RE = re.compile(r"^\s*#{1,4}\s+(.+?)\s*#*\s*$")
SRC_RE = re.compile(r"^\s*(?:[-*]\s*)?(?:\*\*)?\s*(nguồn|căn cứ|can cu|source|tham khảo)\s*(?:\*\*)?\s*:\s*(.*)$",
                    re.IGNORECASE)
VERIFY_RE = re.compile(r"\[\s*cần kiểm chứng\s*\]|\(\s*cần kiểm chứng\s*\)", re.IGNORECASE)
ARTICLE_RE = re.compile(r"\bĐiều\s+(\d{1,4}[a-zđ]?)\b")
DOCNO_RE = re.compile(r"\b\d{1,4}/\d{4}/[A-ZĐ]{1,5}(?:\d{1,3}|-[A-ZĐ]{1,6}(?:-[A-ZĐ]{1,6})?)\b")
WPM = 140   # tốc độ giảng ước lượng (từ/phút)


def parse_script(text: str) -> list[dict]:
    """Tách kịch bản dán từ ChatGPT/Claude/Word thành cảnh: tiêu đề, lời giảng, nguồn/căn cứ, cờ kiểm chứng.

    Nhận dạng tiêu đề "Cảnh 3: …", "Slide 3 – …" (nếu không có thì dùng tiêu đề Markdown "## …"); phần
    trước tiêu đề đầu tiên được bỏ qua; dòng "Nguồn:/Căn cứ:" vào ghi chú căn cứ;
    "[Cần kiểm chứng]" bật cờ cần kiểm chứng. Không có tiêu đề nào ⇒ mỗi khối cách bằng dòng '---' là một cảnh.
    """
    text = (text or "").replace("\r\n", "\n")[:200_000]
    blocks: list[dict] = []
    cur: dict | None = None

    def start(title: str, num: int | None) -> dict:
        b = {"title": title, "num": num, "body": [], "src": [], "verify": False}
        blocks.append(b)
        return b

    lines = text.split("\n")
    scene_heads = any(HEAD_RE.match(ln) for ln in lines)          # "Cảnh 1: …" được ưu tiên
    md_heads = not scene_heads and any(MD_HEAD_RE.match(ln) for ln in lines)
    has_heads = scene_heads or md_heads
    for ln in lines:
        m = HEAD_RE.match(ln) if scene_heads else None
        if m:
            cur = start(m.group(2).strip(" *#:–—-"), int(m.group(1)))
            continue
        m2 = MD_HEAD_RE.match(ln) if md_heads else None
        if m2:
            cur = start(m2.group(1).strip(" *"), None)
            continue
        if not has_heads and ln.strip() == "---":
            cur = None
            continue
        if cur is None:
            if not ln.strip() or has_heads:      # phần mở đầu trước tiêu đề cảnh đầu tiên: bỏ qua
                continue
            cur = start("", None)
        if VERIFY_RE.search(ln):
            cur["verify"] = True
            ln = VERIFY_RE.sub("", ln)
        ms = SRC_RE.match(ln)
        if ms:
            cur["src"].append(ms.group(2).strip())
            continue
        cur["body"].append(ln.rstrip())
    out = []
    for i, b in enumerate(blocks, 1):
        body = re.sub(r"\n{3,}", "\n\n", "\n".join(b["body"])).strip()
        body = re.sub(r"\*\*(.+?)\*\*", r"\1", body)
        if not body and not b["title"] and not b["src"]:
            continue
        out.append({"title": (b["title"] or f"Cảnh {i}")[:200], "num": b["num"], "scriptOriginal": body,
                    "sourceNotes": "\n".join(x for x in b["src"] if x)[:5000], "needsVerification": b["verify"]})
    return out


def apply_script(eng: "PNSEngine", pid: str, text: str, mode: str, revision: int | None,
                 keep_titles: bool = False) -> dict:
    p = eng.get_project(pid)
    if not p:
        raise KeyError("Không tìm thấy dự án")
    parsed = parse_script(text)
    if not parsed:
        raise ValueError("Không tìm thấy nội dung kịch bản để nhập")
    scenes = [dict(s) for s in p["scenes"]]
    if mode == "append":
        scenes += [{"title": x["title"], "scriptOriginal": x["scriptOriginal"], "sourceNotes": x["sourceNotes"],
                    "needsVerification": x["needsVerification"]} for x in parsed]
    else:  # ghép theo thứ tự (hoặc theo số cảnh nếu kịch bản có đánh số), giữ slide và âm thanh đã gắn
        for i, x in enumerate(parsed):
            idx = x["num"] - 1 if x["num"] and all(y["num"] for y in parsed) else i
            if 0 <= idx < len(scenes):
                sc = scenes[idx]
                if not keep_titles and x["title"] and not re.fullmatch(r"Cảnh \d+", x["title"]):
                    sc["title"] = x["title"]
                sc["scriptOriginal"] = x["scriptOriginal"]
                if x["sourceNotes"]:
                    sc["sourceNotes"] = x["sourceNotes"]
                sc["needsVerification"] = bool(sc.get("needsVerification")) or x["needsVerification"]
            else:
                scenes.append({"title": x["title"], "scriptOriginal": x["scriptOriginal"],
                               "sourceNotes": x["sourceNotes"], "needsVerification": x["needsVerification"]})
    if len(scenes) > eng.s.max_scenes:
        raise ValueError(f"Vượt giới hạn {eng.s.max_scenes} cảnh")
    return eng.save_project(pid, {**p, "scenes": scenes}, revision)


def content_check(eng: "PNSEngine", pid: str) -> dict:
    """Rà soát kịch bản: viện dẫn điều luật chưa ghi căn cứ, cảnh trống, cờ kiểm chứng, thời lượng ước tính."""
    p = eng.get_project(pid)
    if not p:
        raise KeyError("Không tìm thấy dự án")
    rows, total_words = [], 0
    for i, s in enumerate(p["scenes"], 1):
        if s.get("excluded"):
            continue
        script, notes = s.get("scriptOriginal", ""), s.get("sourceNotes", "")
        words = word_count(script)
        total_words += words
        arts = sorted(set(ARTICLE_RE.findall(script)), key=lambda x: (len(x), x))
        docs = sorted(set(DOCNO_RE.findall(script)))
        issues = []
        if not script.strip():
            issues.append("Chưa có lời giảng")
        if (arts or docs) and not notes.strip():
            issues.append("Có viện dẫn văn bản/điều luật nhưng chưa ghi nguồn – căn cứ")
        elif notes.strip():
            miss = [a for a in arts if not re.search(rf"\bĐiều\s+{re.escape(a)}\b", notes)]
            miss += [d for d in docs if d not in notes]
            if miss:
                issues.append("Chưa có trong ghi chú căn cứ: " + ", ".join(("Điều " + m) if "/" not in m else m
                                                                          for m in miss))
        if s.get("needsVerification"):
            issues.append("Đang đánh dấu cần kiểm chứng")
        if words > 600:
            issues.append(f"Lời giảng dài ({words} từ ≈ {round(words / WPM, 1)} phút) — cân nhắc tách cảnh")
        rows.append({"index": i, "sceneId": s["id"], "title": s.get("title", ""), "words": words,
                     "estMs": int(words / WPM * 60000), "articles": arts, "documents": docs, "issues": issues})
    return {"scenes": rows, "totalWords": total_words, "estMs": int(total_words / WPM * 60000), "wpm": WPM,
            "issueCount": sum(len(r["issues"]) for r in rows),
            "note": "PNS chỉ đối chiếu viện dẫn với ghi chú căn cứ; không tự xác nhận hiệu lực văn bản. "
                    "Cần tra cứu nguồn chính thức trước khi duyệt."}


def export_script(p: dict) -> str:
    out = [f"# {p['title']}", ""]
    c = p.get("course") or {}
    meta = " · ".join(x for x in (c.get("course"), c.get("chapter"), c.get("lesson")) if x)
    if meta:
        out += [meta, ""]
    for i, s in enumerate(p["scenes"], 1):
        out.append(f"## Cảnh {i}: {s.get('title', '')}")
        if s.get("needsVerification"):
            out.append("[Cần kiểm chứng]")
        out += ["", s.get("scriptOriginal", "").strip(), ""]
        for line in (s.get("sourceNotes") or "").splitlines():
            if line.strip():
                out.append(f"Nguồn: {line.strip()}")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


# =====================================================================================
# PODCAST STUDIO
# =====================================================================================
PODCAST_DEFAULT = {"title": "", "description": "", "author": "", "coverAssetId": None, "introAssetId": None,
                   "outroAssetId": None, "gapMs": 600, "chapters": True, "audioBaseUrl": "", "explicit": False}


def podcast_config(eng: "PNSEngine", pid: str) -> dict:
    p = eng.get_project(pid)
    if not p:
        raise KeyError("Không tìm thấy dự án")
    cfg = {**PODCAST_DEFAULT, **eng.store.kv_get(f"podcast:{pid}", {})}
    cfg["title"] = cfg["title"] or p["title"]
    cfg["description"] = cfg["description"] or p.get("description", "")
    return cfg


def set_podcast_config(eng: "PNSEngine", pid: str, body: dict) -> dict:
    if not eng.get_project(pid):
        raise KeyError("Không tìm thấy dự án")

    def asset_of(key: str, kinds: tuple) -> str | None:
        v = body.get(key)
        if not v:
            return None
        a = eng.store.asset(str(v))
        if not a or a["kind"] not in kinds:
            raise ValueError("Tài sản được chọn không hợp lệ")
        return a["id"]

    cfg = {"title": _s(body.get("title"), 200), "description": _s(body.get("description"), 4000),
           "author": _s(body.get("author"), 160), "coverAssetId": asset_of("coverAssetId", ("image", "slide")),
           "introAssetId": asset_of("introAssetId", ("audio",)), "outroAssetId": asset_of("outroAssetId", ("audio",)),
           "gapMs": _int(body.get("gapMs"), 0, 5000, 600), "chapters": bool(body.get("chapters", True)),
           "audioBaseUrl": _https(body.get("audioBaseUrl")), "explicit": bool(body.get("explicit"))}
    eng.store.kv_set(f"podcast:{pid}", cfg)
    return podcast_config(eng, pid)


_mp3: bool | None = None


def has_mp3() -> bool:
    global _mp3
    if _mp3 is None:
        try:
            out = subprocess.run([media.ffmpeg(), "-hide_banner", "-encoders"], capture_output=True, timeout=20,
                                 creationflags=media._NOWIN).stdout.decode("utf-8", "replace")
            _mp3 = "libmp3lame" in out
        except Exception:
            _mp3 = False
    return _mp3


def podcast_dir(eng: "PNSEngine", pid: str, eid: str) -> Path | None:
    if not (valid_id(pid, "pj") and valid_id(eid, "pe")):
        return None
    d = eng.s.data_dir / "podcasts" / pid / eid
    return d if (d / "episode.json").exists() else None


def podcast_episodes(eng: "PNSEngine", pid: str) -> list[dict]:
    base = eng.s.data_dir / "podcasts" / pid
    out = []
    if valid_id(pid, "pj") and base.exists():
        for f in base.glob("pe_*/episode.json"):
            try:
                out.append(json.loads(f.read_text(encoding="utf-8")))
            except Exception:
                continue
    return sorted(out, key=lambda r: -r["createdAt"])


def podcast_build_job(eng: "PNSEngine", pid: str) -> dict:
    if not eng.get_project(pid):
        raise KeyError("Không tìm thấy dự án")

    def job(ctx: RunContext, progress: Callable[[float, str], None]) -> dict:
        p = eng.get_project(pid)
        cfg = podcast_config(eng, pid)
        scenes = [s for s in p["scenes"] if not s.get("excluded")]
        n = len(scenes) or 1
        for i, s in enumerate(scenes):            # bảo đảm giọng AI mới nhất (dùng lại bộ đệm)
            ctx.check()
            if s.get("audioMode") == "tts" and s.get("audioStale", True) and s.get("voiceId"):
                progress(0.35 * i / n, f"Sinh giọng AI cảnh {i + 1}/{n}")
                eng.generate_scene_tts(pid, s, ctx, lambda f, m: None)
        p = eng.get_project(pid)
        parts, skipped, ai = [], [], False
        for x, label in ((cfg["introAssetId"], "Mở đầu"),):
            if x:
                parts.append((x, label, False))
        for i, s in enumerate(s for s in p["scenes"] if not s.get("excluded")):
            if s.get("audioMode") in ("recorded", "tts") and s.get("audioAssetId"):
                parts.append((s["audioAssetId"], s.get("title") or f"Cảnh {i + 1}", True))
                ai |= s["audioMode"] == "tts"
            else:
                skipped.append(s.get("title") or f"Cảnh {i + 1}")
        if cfg["outroAssetId"]:
            parts.append((cfg["outroAssetId"], "Kết thúc", False))
        if not any(is_scene for _, _, is_scene in parts):
            raise ValueError("Chưa có cảnh nào có âm thanh (thu âm thật hoặc giọng AI) để dựng podcast")
        for aid, _, _ in parts:
            if eng.store.asset(aid) and eng.store.asset(aid)["meta"].get("ai"):
                ai = True
        eid = new_id("pe")
        out = eng.s.sub("podcasts", pid, eid)
        try:
            segs, chapters, t = [], [], 0
            for idx, (aid, label, _) in enumerate(parts):
                a = eng.store.asset(aid)
                dur = int(a["meta"].get("durationMs") or 0) or media.probe_duration_ms(eng.store.asset_path(aid))
                segs.append({"assetId": aid, "startMs": 0, "endMs": dur, "fadeInMs": 0, "fadeOutMs": 0, "gainDb": 0})
                gap = cfg["gapMs"] if idx < len(parts) - 1 else 0
                chapters.append({"title": label, "startMs": t, "endMs": t + dur + gap})
                t += dur + gap
            progress(0.45, "Ghép tập podcast")
            graph, lab = audio_filter(segs, cfg["gapMs"])
            graph += f";{lab}loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[fin]"
            title = cfg["title"]
            desc = cfg["description"] + ("\n\nTập này có sử dụng giọng đọc tạo bằng AI." if ai else "")
            ext = "mp3" if has_mp3() else "m4a"
            audio_out = out / f"episode.{ext}"
            meta_file = out / "chapters.txt"
            esc = lambda v: re.sub(r"([=;#\\\n])", r"\\\1", v)   # noqa: E731 — cú pháp FFMETADATA
            lines = [";FFMETADATA1", f"title={esc(title)}", f"artist={esc(cfg['author'])}",
                     f"album={esc(p.get('course', {}).get('course') or 'Phúc Nguyên Studio')}",
                     f"comment={esc(desc[:900])}", "genre=Podcast"]
            if cfg["chapters"] and len(chapters) > 1:
                for c in chapters:
                    lines += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={c['startMs']}", f"END={c['endMs']}",
                              f"title={esc(c['title'])}"]
            meta_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
            args = [media.ffmpeg(), "-hide_banner", "-nostdin", "-y"]
            for s in segs:
                args += ["-i", str(eng.store.asset_path(s["assetId"]))]
            args += ["-f", "ffmetadata", "-i", str(meta_file)]
            meta_idx = len(segs)
            cover = None
            if cfg["coverAssetId"] and eng.store.asset(cfg["coverAssetId"]):
                im = _open_rgb(eng.store.asset_path(cfg["coverAssetId"]))
                side = min(im.width, im.height)
                im = im.crop(crop_box(im.width, im.height, "1:1", 0.5, 0.5, 1)).resize(
                    (min(3000, max(1400, side)),) * 2, Image.LANCZOS)
                cover = out / "cover.jpg"
                im.save(cover, "JPEG", quality=88)
            maps = ["-filter_complex", graph, "-map", "[fin]", "-map_metadata", str(meta_idx),
                    "-map_chapters", str(meta_idx)]
            if cover and ext == "mp3":
                args += ["-i", str(cover)]
                maps += ["-map", f"{meta_idx + 1}:v", "-c:v", "mjpeg", "-disposition:v", "attached_pic",
                         "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"]
            enc = (["-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-id3v2_version", "3"]
                   if ext == "mp3" else ["-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
                                         "-movflags", "+faststart"])
            media.run(args + maps + enc + [str(audio_out)], ctx, 3600)
            meta_file.unlink(missing_ok=True)
            real = media.probe_duration_ms(audio_out)
            rec = {"id": eid, "projectId": pid, "projectRevision": p["revision"], "title": title,
                   "description": desc, "author": cfg["author"], "file": audio_out.name,
                   "mime": "audio/mpeg" if ext == "mp3" else "audio/mp4", "durationMs": real,
                   "sizeBytes": audio_out.stat().st_size, "chapters": chapters if cfg["chapters"] else [],
                   "skippedScenes": skipped, "aiNarration": ai, "cover": bool(cover),
                   "createdAt": now_ms(), "approval": None, "config": cfg}
            (out / "episode.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
            return rec
        except BaseException:
            shutil.rmtree(out, ignore_errors=True)
            raise

    return eng.jobs.submit("podcast", job, pid, message="Chờ dựng podcast")


def podcast_approval(eng: "PNSEngine", pid: str, eid: str, approved: bool, approver: str, note: str) -> dict:
    d = podcast_dir(eng, pid, eid)
    if not d:
        raise KeyError("Không tìm thấy tập podcast")
    rec = json.loads((d / "episode.json").read_text(encoding="utf-8"))
    rec["approval"] = {"approvedBy": _s(approver, 120) or "local-owner", "approvedAt": now_ms(),
                       "note": _s(note, 1000)} if approved else None
    (d / "episode.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return rec


def _rfc822(ms: int) -> str:
    from email.utils import formatdate
    return formatdate(ms / 1000, usegmt=True)


def podcast_package(eng: "PNSEngine", pid: str, eid: str) -> Path:
    d = podcast_dir(eng, pid, eid)
    if not d:
        raise KeyError("Không tìm thấy tập podcast")
    rec = json.loads((d / "episode.json").read_text(encoding="utf-8"))
    if not rec.get("approval"):
        raise ValueError("Tập podcast chưa được duyệt")
    base = rec["config"].get("audioBaseUrl", "").rstrip("/")
    url = f"{base}/{rec['file']}" if base else f"{{{{DIA_CHI_FILE_AUDIO}}}}/{rec['file']}"
    secs = rec["durationMs"] // 1000
    item = "\n".join([
        "<item>",
        f"  <title>{xml_escape(rec['title'])}</title>",
        f"  <description>{xml_escape(rec['description'])}</description>",
        f"  <enclosure url=\"{xml_escape(url)}\" length=\"{rec['sizeBytes']}\" type=\"{rec['mime']}\"/>",
        f"  <guid isPermaLink=\"false\">pns-{pid}-{eid}</guid>",
        f"  <pubDate>{_rfc822(rec['approval']['approvedAt'])}</pubDate>",
        f"  <itunes:duration>{secs // 3600:02d}:{secs % 3600 // 60:02d}:{secs % 60:02d}</itunes:duration>",
        f"  <itunes:author>{xml_escape(rec['author'])}</itunes:author>",
        f"  <itunes:explicit>{'true' if rec['config'].get('explicit') else 'false'}</itunes:explicit>",
        "</item>"])
    pub = {"schemaVersion": SCHEMA_VERSION, "generator": f"PNS {VERSION}", "type": "podcast-episode",
           **{k: rec[k] for k in ("projectId", "projectRevision", "title", "description", "author", "file",
                                  "mime", "durationMs", "chapters", "aiNarration")},
           "episodeId": eid, "approvedBy": rec["approval"]["approvedBy"], "approvedAt": rec["approval"]["approvedAt"],
           "visibility": "Chưa công khai — người quản trị PNL/PND tải lên thủ công sau khi duyệt"}
    out = d / f"PNS_podcast_{pid}_{eid}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(d / rec["file"], rec["file"], compress_type=zipfile.ZIP_STORED)
        if (d / "cover.jpg").exists():
            z.write(d / "cover.jpg", "cover.jpg", compress_type=zipfile.ZIP_STORED)
        z.writestr("episode.json", json.dumps(pub, ensure_ascii=False, indent=2))
        z.writestr("rss-item.xml", item + "\n")
        if rec["chapters"]:
            z.writestr("chapters.json", json.dumps({"version": "1.2.0", "chapters": [
                {"startTime": c["startMs"] / 1000, "title": c["title"]} for c in rec["chapters"]]},
                ensure_ascii=False, indent=2))
    return out


# =====================================================================================
# INTERACTIVE STUDIO
# =====================================================================================
def interactive_get(eng: "PNSEngine", pid: str) -> dict:
    if not eng.get_project(pid):
        raise KeyError("Không tìm thấy dự án")
    return {"renderId": None, "questions": [], "requireCorrect": False, "showExplain": True,
            **eng.store.kv_get(f"interactive:{pid}", {})}


def clean_questions(qs: Any) -> list[dict]:
    if not isinstance(qs, list):
        raise ValueError("Danh sách câu hỏi không hợp lệ")
    out = []
    for i, q in enumerate(qs[:200], 1):
        if not isinstance(q, dict):
            continue
        opts = [_s(o, 300) for o in (q.get("options") or []) if isinstance(o, str) and o.strip()][:6]
        text = _s(q.get("text"), 1000)
        if not text:
            raise ValueError(f"Câu {i}: chưa nhập nội dung câu hỏi")
        if len(opts) < 2:
            raise ValueError(f"Câu {i}: cần ít nhất 2 phương án")
        correct = q.get("correct")
        if not isinstance(correct, int) or isinstance(correct, bool) or not 0 <= correct < len(opts):
            raise ValueError(f"Câu {i}: chưa chọn đáp án đúng")
        qid = q.get("id") if isinstance(q.get("id"), str) and re.fullmatch(r"q[0-9a-f]{8}", q["id"]) else \
            "q" + new_id("qq")[3:11]
        out.append({"id": qid, "atMs": _int(q.get("atMs"), 0, 24 * 3600 * 1000, 0), "text": text, "options": opts,
                    "correct": correct, "explain": _s(q.get("explain"), 1500)})
    if len({q["id"] for q in out}) != len(out):
        raise ValueError("Trùng mã câu hỏi")
    return sorted(out, key=lambda q: q["atMs"])


def interactive_set(eng: "PNSEngine", pid: str, body: dict) -> dict:
    if not eng.get_project(pid):
        raise KeyError("Không tìm thấy dự án")
    rid = body.get("renderId")
    if rid and not eng.render_dir(pid, str(rid)):
        raise ValueError("Bản kết xuất không tồn tại")
    data = {"renderId": rid or None, "questions": clean_questions(body.get("questions") or []),
            "requireCorrect": bool(body.get("requireCorrect")), "showExplain": bool(body.get("showExplain", True))}
    eng.store.kv_set(f"interactive:{pid}", data)
    return data


def _player_html(title: str, data: dict, video_src: str, vtt_src: str | None, player: str) -> str:
    tpl = (TEMPLATES / "interactive.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e") \
        .replace("&", "\\u0026").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    track = f'<track kind="subtitles" srclang="vi" label="Tiếng Việt" src="{escape(vtt_src)}" default>' \
        if vtt_src else ""
    return (tpl.replace("{{TITLE}}", escape(title)).replace("{{VIDEO}}", escape(video_src))
            .replace("{{TRACK}}", track).replace("{{PLAYER}}", escape(player)).replace("{{DATA}}", payload))


def interactive_preview(eng: "PNSEngine", pid: str) -> str:
    p = eng.get_project(pid)
    cfg = interactive_get(eng, pid)
    if not cfg["renderId"] or not eng.render_dir(pid, cfg["renderId"]):
        raise ValueError("Chọn bản kết xuất video trước")
    base = f"/api/projects/{pid}/renders/{cfg['renderId']}"
    return _player_html(p["title"], {**cfg, "title": p["title"], "preview": True}, f"{base}/lecture.mp4",
                        f"{base}/lecture.vtt", "/player/interactive.js")


def interactive_package(eng: "PNSEngine", pid: str) -> Path:
    p = eng.get_project(pid)
    cfg = interactive_get(eng, pid)
    d = eng.render_dir(pid, cfg["renderId"]) if cfg["renderId"] else None
    if not d:
        raise ValueError("Chọn bản kết xuất video trước")
    rec = json.loads((d / "render.json").read_text(encoding="utf-8"))
    if not rec.get("approval"):
        raise ValueError("Bản kết xuất chưa được duyệt ở Trung tâm xuất bản")
    if not cfg["questions"]:
        raise ValueError("Chưa có câu hỏi nào")
    if any(q["atMs"] >= rec["durationMs"] for q in cfg["questions"]):
        raise ValueError("Có câu hỏi đặt sau thời điểm kết thúc video")
    srt = (d / "lecture.srt").read_text(encoding="utf-8")
    vtt = "WEBVTT\n\n" + re.sub(r"(\d\d:\d\d:\d\d),(\d{3})", r"\1.\2", srt)
    data = {**cfg, "title": p["title"], "durationMs": rec["durationMs"], "aiNarration": rec["aiNarration"],
            "generator": f"PNS {VERSION}", "projectId": pid, "projectRevision": rec["projectRevision"]}
    out = d / f"PNS_interactive_{pid}_{cfg['renderId']}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(d / "lecture.mp4", "lecture.mp4", compress_type=zipfile.ZIP_STORED)
        z.writestr("lecture.vtt", vtt)
        z.writestr("index.html", _player_html(p["title"], data, "lecture.mp4", "lecture.vtt", "player.js"))
        z.write(TEMPLATES / "interactive.js", "player.js")
        z.writestr("interactive.json", json.dumps(data, ensure_ascii=False, indent=2))
        z.writestr("HUONG_DAN.txt",
                   "Gói video tương tác PNS\n\n"
                   "- Mở index.html bằng trình duyệt (hoặc đăng cả thư mục lên PNL/GitHub Pages).\n"
                   "- Video tự dừng ở các mốc để người học trả lời; kết quả chỉ hiển thị trên máy người học,\n"
                   "  không gửi đi đâu và không thay thế hệ thống khảo thí của PNL.\n")
    return out


__all__ = ["image_transform", "image_cover", "peaks", "audio_edit_job", "parse_script", "apply_script",
           "content_check", "export_script", "podcast_config", "set_podcast_config", "podcast_build_job",
           "podcast_episodes", "podcast_dir", "podcast_approval", "podcast_package", "interactive_get",
           "interactive_set", "interactive_preview", "interactive_package", "build_srt", "srt_time"]


# =====================================================================================
# HỌC LIỆU ĐIỆN TỬ (E-learning): gói nhiều bài giảng video + lời giảng + căn cứ + tài liệu + kiểm tra cuối
# Đóng gói (HTML/SCORM 1.2) chạy phía giao diện (web/js/elearning/build.js) để dùng chung cho cả hai chế độ.
# =====================================================================================
def _asset_ok(eng: "PNSEngine", aid: Any, kinds: tuple) -> str | None:
    a = eng.store.asset(aid) if isinstance(aid, str) else None
    return a["id"] if a and a["kind"] in kinds else None


def clean_package(eng: "PNSEngine", body: dict, pkg_id: str) -> dict:
    lessons = []
    for i, ls in enumerate((body.get("lessons") or [])[:50], 1):
        if not isinstance(ls, dict):
            continue
        pid = ls.get("projectId")
        if not (isinstance(pid, str) and eng.get_project(pid)):
            raise ValueError(f"Bài {i}: chọn dự án bài giảng")
        rid = ls.get("renderId")
        rid = rid if isinstance(rid, str) and eng.render_dir(pid, rid) else None
        lid = ls.get("id") if isinstance(ls.get("id"), str) and valid_id(ls["id"], "ls") else new_id("ls")
        att = [x for x in (_asset_ok(eng, a, ("pdf", "image", "audio")) for a in (ls.get("attachments") or [])[:20]) if x]
        lessons.append({"id": lid, "title": _s(ls.get("title"), 200) or f"Bài {i}", "projectId": pid, "renderId": rid,
                        "intro": _s(ls.get("intro"), 3000), "transcript": bool(ls.get("transcript", True)),
                        "sources": bool(ls.get("sources", True)), "questions": bool(ls.get("questions", True)),
                        "attachments": list(dict.fromkeys(att))})
    if len({x["id"] for x in lessons}) != len(lessons):
        raise ValueError("Trùng mã bài học")
    quiz = body.get("quiz") or {}
    return {"id": pkg_id, "title": _s(body.get("title"), 200) or "Học liệu chưa đặt tên",
            "course": _s(body.get("course"), 200), "author": _s(body.get("author"), 160), "org": _s(body.get("org"), 200),
            "description": _s(body.get("description"), 4000),
            "objectives": [_s(o, 300) for o in (body.get("objectives") or [])[:20] if _s(o, 300)],
            "coverAssetId": _asset_ok(eng, body.get("coverAssetId"), ("image", "slide")),
            "lessons": lessons,
            "quiz": {"questions": clean_questions(quiz.get("questions") or []), "passScore": _int(quiz.get("passScore"), 0, 100, 70),
                     "title": _s(quiz.get("title"), 200) or "Bài kiểm tra cuối"},
            "completion": {"minWatch": _int((body.get("completion") or {}).get("minWatch"), 50, 100, 90)},
            "updatedAt": now_ms()}


def elearning_list(eng: "PNSEngine") -> list[dict]:
    out = []
    for r in eng.store.q("SELECT value FROM kv WHERE key LIKE 'elearn:%'"):
        p = json.loads(r["value"])
        out.append({k: p[k] for k in ("id", "title", "course", "updatedAt")} | {"lessons": len(p["lessons"])})
    return sorted(out, key=lambda x: -x["updatedAt"])


def elearning_get(eng: "PNSEngine", pkg_id: str) -> dict:
    p = eng.store.kv_get(f"elearn:{pkg_id}", None) if valid_id(pkg_id, "el") else None
    if not p:
        raise KeyError("Không tìm thấy học liệu")
    return p


def elearning_save(eng: "PNSEngine", pkg_id: str | None, body: dict) -> dict:
    if pkg_id:
        elearning_get(eng, pkg_id)
    pkg = clean_package(eng, body, pkg_id or new_id("el"))
    eng.store.kv_set(f"elearn:{pkg['id']}", pkg)
    return pkg


def elearning_delete(eng: "PNSEngine", pkg_id: str) -> None:
    elearning_get(eng, pkg_id)
    eng.store.x("DELETE FROM kv WHERE key=?", (f"elearn:{pkg_id}",))
