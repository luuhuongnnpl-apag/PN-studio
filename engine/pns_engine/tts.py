"""Bộ chuyển đổi giọng AI (VieNeu-TTS, Apache-2.0, ONNX trên CPU).

Đã đối chiếu API gói `vieneu` 3.8.5 trên PyPI: Vieneu(mode="v3turbo"|"v3nano", backend="onnx",
precision="fp32"|"int8") -> .infer(text, ref_audio=..., denoise=True) -> ndarray; .save(audio, path).
Trọng số tải từ Hugging Face lần đầu (pnnbao-ump/VieNeu-TTS-v3-Turbo, Apache-2.0).
Nếu không cài/không nạp được, engine báo lỗi cụ thể; đường giọng thật vẫn hoạt động.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import struct
import threading
import time
import wave
from pathlib import Path
from typing import Callable

from .media import RunContext, concat_wavs, normalize_audio
from .textnorm import chunk_for_tts

DEFAULT_TTS = {"mode": "v3turbo", "precision": "fp32", "threads": 0}


class TTSUnavailable(Exception):
    pass


class TTSEngine:
    def __init__(self, cache_dir: Path, test_mode: bool = False):
        self.cache_dir = cache_dir
        self.test_mode = test_mode
        self._engine = None
        self._engine_key: str | None = None
        self._lock = threading.Lock()
        self.last_error: str | None = None
        self.last_benchmark: dict | None = None

    # ---------- trạng thái ----------
    def installed(self) -> bool:
        return self.test_mode or importlib.util.find_spec("vieneu") is not None

    def status(self, cfg: dict) -> dict:
        version = None
        if not self.test_mode and self.installed():
            try:
                from importlib.metadata import version as v
                version = v("vieneu")
            except Exception:
                pass
        return {"installed": self.installed(), "loaded": self._engine is not None,
                "engine": "TEST-SINE (chỉ kiểm thử tự động)" if self.test_mode else "VieNeu-TTS",
                "version": version, "config": cfg, "lastError": self.last_error,
                "lastBenchmark": self.last_benchmark, "license": "Apache-2.0 (mã nguồn và trọng số theo thẻ model)"}

    def model_id(self, cfg: dict) -> str:
        return "test-sine" if self.test_mode else f"vieneu:{cfg.get('mode')}:{cfg.get('precision')}"

    def _load(self, cfg: dict):
        key = json.dumps(cfg, sort_keys=True)
        if self._engine is not None and self._engine_key == key:
            return self._engine
        if not self.installed():
            raise TTSUnavailable("Chưa cài VieNeu-TTS. Chạy INSTALL_VOICE_AI.bat (cần Internet lần đầu).")
        try:
            from vieneu import Vieneu  # type: ignore
            kwargs = {"threads": int(cfg.get("threads") or 0)}
            if cfg.get("mode", "v3turbo") == "v3turbo":
                kwargs.update(backend="onnx", precision=cfg.get("precision", "fp32"))
            self._engine = Vieneu(mode=cfg.get("mode", "v3turbo"), **kwargs)
            self._engine_key = key
            self.last_error = None
            return self._engine
        except Exception as e:  # lỗi tải model, thiếu mạng, thiếu RAM...
            self._engine = None
            self.last_error = f"Không nạp được model: {type(e).__name__}: {e}"[:500]
            raise TTSUnavailable(self.last_error) from e

    # ---------- sinh giọng ----------
    def cache_key(self, text: str, voice_sha: str, cfg: dict) -> str:
        raw = json.dumps({"t": text, "v": voice_sha, "m": self.model_id(cfg), "c": cfg}, sort_keys=True,
                         ensure_ascii=False)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _synth_chunk(self, text: str, ref: Path, dst: Path, cfg: dict) -> None:
        if self.test_mode:
            _sine_wav(dst, seconds=max(0.6, len(text) / 15))
            return
        eng = self._load(cfg)
        audio = eng.infer(text, ref_audio=str(ref), denoise=True)
        eng.save(audio, str(dst))

    def synthesize(self, text: str, ref: Path, voice_sha: str, cfg: dict, dst: Path, ctx: RunContext,
                   progress: Callable[[float, str], None]) -> dict:
        """Sinh WAV đã chuẩn hóa cho một cảnh. Cache theo đoạn: hash(văn bản + mẫu + model + cấu hình)."""
        chunks = chunk_for_tts(text)
        if not chunks:
            raise ValueError("Lời đọc trống")
        parts, hits, t0 = [], 0, time.time()
        with self._lock:   # mỗi lúc một tác vụ CPU
            for i, ch in enumerate(chunks):
                ctx.check()
                key = self.cache_key(ch, voice_sha, cfg)
                cached = self.cache_dir / f"{key}.wav"
                if cached.exists():
                    hits += 1
                else:
                    progress(i / len(chunks), f"Đang sinh đoạn {i + 1}/{len(chunks)}")
                    raw = self.cache_dir / f"{key}.raw.wav"
                    try:
                        self._synth_chunk(ch, ref, raw, cfg)
                        normalize_audio(raw, cached, ctx, loudnorm=False)
                    except TTSUnavailable:
                        raise
                    except Exception as e:
                        self.last_error = f"{type(e).__name__}: {e}"[:500]
                        raise
                    finally:
                        raw.unlink(missing_ok=True)
                parts.append(cached)
            ctx.check()
            joined = dst.with_suffix(".join.wav")
            concat_wavs(parts, joined, ctx=ctx)
            dur = normalize_audio(joined, dst, ctx)
            joined.unlink(missing_ok=True)
        elapsed = time.time() - t0
        info = {"chunks": len(chunks), "cacheHits": hits, "seconds": round(elapsed, 2),
                "audioSeconds": round(dur / 1000, 2), "rtf": round(elapsed / max(dur / 1000, 0.01), 3),
                "rssMB": _rss_mb()}
        if hits < len(chunks):
            self.last_benchmark = info
        return {"durationMs": dur, **info}


def _sine_wav(path: Path, seconds: float, freq: float = 220.0, rate: int = 24000) -> None:
    n = int(seconds * rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate)))
                               for i in range(n)))


def _rss_mb() -> float | None:
    try:
        import psutil  # type: ignore
        return round(psutil.Process().memory_info().rss / 2 ** 20, 1)
    except Exception:
        return None
