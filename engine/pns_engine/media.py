"""Xử lý media: FFmpeg, PDF, PPTX, ảnh, âm thanh. Không dùng shell; mọi lệnh truyền dạng danh sách."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path
from typing import Callable

from PIL import Image

AUDIO_EXT = {".wav", ".m4a", ".mp3", ".aac", ".ogg", ".flac", ".webm"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv"}
PDF_EXT = {".pdf"}
PPTX_EXT = {".pptx", ".ppt", ".odp"}


class Cancelled(Exception):
    pass


class MediaError(Exception):
    pass


class RunContext:
    """Theo dõi tiến trình con để có thể hủy job."""

    def __init__(self) -> None:
        self.cancel_event = threading.Event()
        self.proc: subprocess.Popen | None = None

    @property
    def cancelled(self) -> bool:
        return self.cancel_event.is_set()

    def check(self) -> None:
        if self.cancelled:
            raise Cancelled()

    def cancel(self) -> None:
        self.cancel_event.set()
        p = self.proc
        if p and p.poll() is None:
            p.kill()


_NOWIN = 0x08000000 if sys.platform == "win32" else 0   # CREATE_NO_WINDOW


def run(cmd: list[str], ctx: RunContext | None = None, timeout: float = 3600) -> str:
    ctx = ctx or RunContext()
    ctx.check()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                            creationflags=_NOWIN)
    ctx.proc = proc
    start = time.time()
    try:
        while True:
            try:
                out, err = proc.communicate(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                if ctx.cancelled:
                    proc.kill()
                    proc.communicate()
                    raise Cancelled()
                if time.time() - start > timeout:
                    proc.kill()
                    proc.communicate()
                    raise MediaError(f"Quá thời gian xử lý ({int(timeout)} giây)")
    finally:
        ctx.proc = None
    if ctx.cancelled:
        raise Cancelled()
    if proc.returncode != 0:
        tail = err.decode("utf-8", "replace").strip().splitlines()[-6:]
        raise MediaError("Lỗi công cụ xử lý: " + " | ".join(tail))
    return err.decode("utf-8", "replace")


# ---------------- FFmpeg ----------------
_ffmpeg: str | None = None


def ffmpeg_path() -> str | None:
    global _ffmpeg
    if _ffmpeg:
        return _ffmpeg
    found = os.environ.get("PNS_FFMPEG") or shutil.which("ffmpeg")
    if not found:
        try:
            import imageio_ffmpeg  # gói pip có sẵn FFmpeg tĩnh (LGPL/GPL build) cho Windows
            found = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            found = None
    _ffmpeg = found
    return found


def ffmpeg() -> str:
    p = ffmpeg_path()
    if not p:
        raise MediaError("Không tìm thấy FFmpeg. Chạy lại START_PNS.bat để cài gói imageio-ffmpeg.")
    return p


def ffmpeg_version() -> str | None:
    p = ffmpeg_path()
    if not p:
        return None
    try:
        out = subprocess.run([p, "-version"], capture_output=True, timeout=15, creationflags=_NOWIN)
        return out.stdout.decode("utf-8", "replace").splitlines()[0]
    except Exception:
        return None


def probe_duration_ms(path: Path) -> int:
    """Thời lượng file media; WAV PCM đọc trực tiếp, định dạng khác hỏi FFmpeg."""
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as w:
                return int(w.getnframes() * 1000 / w.getframerate())
        except wave.Error:
            pass
    proc = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True, timeout=60,
                          creationflags=_NOWIN)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", proc.stderr.decode("utf-8", "replace"))
    if not m:
        raise MediaError("Không đọc được thời lượng file")
    h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return int((h * 3600 + mi * 60 + s) * 1000)


def normalize_audio(src: Path, dst: Path, ctx: RunContext | None = None, loudnorm: bool = True) -> int:
    """Chuyển về WAV 48 kHz stereo PCM, chuẩn hóa âm lượng (EBU R128, -16 LUFS). Trả về thời lượng ms."""
    af = "loudnorm=I=-16:TP=-1.5:LRA=11," if loudnorm else ""
    run([ffmpeg(), "-hide_banner", "-nostdin", "-y", "-i", str(src), "-vn",
         "-af", af + "aresample=48000", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(dst)], ctx, 900)
    dur = probe_duration_ms(dst)
    if dur < 200:
        raise MediaError("File âm thanh quá ngắn hoặc không có tín hiệu")
    return dur


def concat_wavs(parts: list[Path], dst: Path, gap_ms: int = 250, ctx: RunContext | None = None) -> None:
    """Nối các đoạn WAV cùng định dạng, chèn khoảng lặng ngắn giữa các đoạn."""
    if len(parts) == 1:
        shutil.copyfile(parts[0], dst)
        return
    args = [ffmpeg(), "-hide_banner", "-nostdin", "-y"]
    for p in parts:
        args += ["-i", str(p)]
    chains, labels = [], []
    for i in range(len(parts)):
        chains.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,apad=pad_dur={gap_ms/1000:.3f}[a{i}]")
        labels.append(f"[a{i}]")
    graph = ";".join(chains) + ";" + "".join(labels) + f"concat=n={len(parts)}:v=0:a=1[out]"
    run(args + ["-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", str(dst)], ctx, 900)


# ---------------- PDF / PPTX / ảnh ----------------
def check_pdf(path: Path) -> None:
    with open(path, "rb") as f:
        if not f.read(1024).lstrip().startswith(b"%PDF-"):
            raise MediaError("File không phải PDF hợp lệ")


def pdf_page_count(path: Path) -> int:
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(path))
    try:
        return len(doc)
    finally:
        doc.close()


def render_pdf(path: Path, out_dir: Path, max_pages: int, progress: Callable[[float], None],
               ctx: RunContext, box: tuple[int, int] = (1920, 1080)) -> list[tuple[int, Path, int, int]]:
    """Kết xuất từng trang PDF thành PNG vừa khung 1920x1080, giữ nguyên tỷ lệ."""
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(str(path))
    out = []
    try:
        n = len(doc)
        if n > max_pages:
            raise MediaError(f"PDF có {n} trang, vượt giới hạn {max_pages} trang")
        for i in range(n):
            ctx.check()
            page = doc[i]
            w, h = page.get_size()
            scale = min(box[0] / w, box[1] / h)
            img = page.render(scale=scale).to_pil().convert("RGB")
            dst = out_dir / f"page-{i + 1:03d}.png"
            img.save(dst, "PNG", optimize=False)
            out.append((i + 1, dst, img.width, img.height))
            page.close()
            progress((i + 1) / n)
    finally:
        doc.close()
    return out


def soffice_path() -> str | None:
    cands = [os.environ.get("PNS_SOFFICE"), shutil.which("soffice"), shutil.which("libreoffice")]
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
            if base:
                cands.append(str(Path(base) / "LibreOffice" / "program" / "soffice.exe"))
    for c in cands:
        if c and Path(c).exists():
            return c
    return None


def pptx_to_pdf(src: Path, out_dir: Path, ctx: RunContext) -> Path:
    exe = soffice_path()
    if not exe:
        raise MediaError("Chưa có LibreOffice để chuyển PPTX. Hãy xuất PDF từ PowerPoint (File → Save As → PDF) "
                         "rồi tải PDF lên, hoặc cài LibreOffice.")
    profile = out_dir / "lo-profile"
    run([exe, f"-env:UserInstallation={profile.resolve().as_uri()}", "--headless", "--convert-to", "pdf",
         "--outdir", str(out_dir), str(src)], ctx, 600)
    pdf = out_dir / (src.stem + ".pdf")
    if not pdf.exists():
        raise MediaError("LibreOffice không tạo được PDF")
    return pdf


def check_image(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            if im.width * im.height > 60_000_000:
                raise MediaError("Ảnh quá lớn")
            return im.width, im.height
    except MediaError:
        raise
    except Exception:
        raise MediaError("File ảnh không hợp lệ")


def thumbnail(src: Path, dst: Path, width: int = 360) -> Path:
    if dst.exists():
        return dst
    with Image.open(src) as im:
        im = im.convert("RGB")
        ratio = width / im.width
        im = im.resize((width, max(1, int(im.height * ratio))), Image.LANCZOS)
        im.save(dst, "JPEG", quality=82)
    return dst


def video_thumbnail(src: Path, dst: Path) -> Path:
    if not dst.exists():
        run([ffmpeg(), "-hide_banner", "-nostdin", "-y", "-ss", "0.5", "-i", str(src), "-frames:v", "1",
             "-vf", "scale=360:-2", str(dst)], None, 60)
    return dst
