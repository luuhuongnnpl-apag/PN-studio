"""Khởi chạy PNS Engine: python run.py [--no-browser] [--port 7860]"""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import sys
import os
import threading
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pns_engine.config import VERSION, Settings  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Phuc Nguyen Studio Engine")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    s = Settings()
    if args.port:
        s.port = args.port
    s.data_dir.mkdir(parents=True, exist_ok=True)
    logdir = s.data_dir / "logs"
    logdir.mkdir(exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(logdir / "engine.log", maxBytes=2_000_000, backupCount=3,
                                                   encoding="utf-8")
    logging.basicConfig(level=logging.INFO, handlers=[handler, logging.StreamHandler()],
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    import uvicorn
    from pns_engine.app import create_app

    app = create_app(s)
    url = f"http://127.0.0.1:{s.port}/"
    print(f"\n  PHUC NGUYEN STUDIO Engine {VERSION}\n  Mo trinh duyet: {url}\n  Du lieu: {s.data_dir}\n"
          f"  Dong cua so nay de tat Engine.\n")
    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    if os.environ.get("PNS_PRELOAD_TTS", "1") != "0":       # nạp sẵn giọng AI (nếu đã cài) để lần sinh đầu nhanh
        eng = app.state.engine
        threading.Timer(3, lambda: eng.tts.preload(eng.tts_config())).start()
    uvicorn.run(app, host="127.0.0.1", port=s.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
