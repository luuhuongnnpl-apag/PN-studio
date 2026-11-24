"""Cấu hình PNS Engine. Mọi đường dẫn dữ liệu nằm trên máy cá nhân."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

VERSION = "0.2.0"
SCHEMA_VERSION = 1

ROOT = Path(__file__).resolve().parents[2]          # thư mục repo
WEB_DIR = ROOT / "web"


def default_data_dir() -> Path:
    env = os.environ.get("PNS_DATA")
    if env:
        return Path(env)
    if sys.platform == "win32" and os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "PhucNguyenStudio"
    return Path.home() / ".phuc-nguyen-studio"


@dataclass
class Settings:
    data_dir: Path = field(default_factory=default_data_dir)
    host: str = "127.0.0.1"
    port: int = int(os.environ.get("PNS_PORT", "7860"))
    max_upload_mb: int = 300
    max_pdf_pages: int = 300
    max_scenes: int = 300
    max_script_chars: int = 20000
    tts_test_mode: bool = os.environ.get("PNS_TEST_TTS") == "1"   # chỉ dùng cho kiểm thử tự động

    @property
    def db_path(self) -> Path:
        return self.data_dir / "pns.sqlite3"

    def sub(self, *parts: str) -> Path:
        p = self.data_dir.joinpath(*parts)
        p.mkdir(parents=True, exist_ok=True)
        return p
