"""Cầu nối giọng AI cho bản web: CORS, Private Network Access, khóa ghép nối, sinh giọng qua job."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from pns_engine import media  # noqa: E402
from pns_engine.app import create_app  # noqa: E402
from pns_engine.config import Settings  # noqa: E402

WEB = "https://luuhuongnnpl-apag.github.io"


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    d = tmp_path_factory.mktemp("bridge")
    app = create_app(Settings(data_dir=d / "data", tts_test_mode=True))
    c = TestClient(app, base_url="http://127.0.0.1:7860")
    c.headers["X-PNS-Token"] = app.state.token
    key = c.get("/api/bridge").json()["key"]
    ref = d / "ref.m4a"
    subprocess.run([media.ffmpeg(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=200:duration=4",
                    str(ref)], check=True)
    return {"c": c, "key": key, "ref": ref}


def web(key=None):
    """Client giả lập trang web: Origin GitHub Pages, không có mã phiên nội bộ."""
    h = {"Origin": WEB}
    if key:
        h["X-PNS-Bridge-Key"] = key
    return h


def test_preflight_and_auth(env):
    c, key = env["c"], env["key"]
    r = c.options("/bridge/tts", headers={"Origin": WEB, "Access-Control-Request-Method": "POST",
                                          "Access-Control-Request-Headers": "x-pns-bridge-key",
                                          "Access-Control-Request-Private-Network": "true"})
    assert r.status_code == 204 and r.headers["access-control-allow-origin"] == WEB
    assert r.headers["access-control-allow-private-network"] == "true"
    assert "X-PNS-Bridge-Key" in r.headers["access-control-allow-headers"]
    plain = TestClient(c.app, base_url="http://127.0.0.1:7860")       # không mã phiên
    assert plain.get("/bridge/status", headers=web(None)).status_code == 401
    assert plain.get("/bridge/status", headers=web("sai")).status_code == 401
    assert plain.get("/bridge/status", headers={"Origin": "https://evil.example", "X-PNS-Bridge-Key": key}).status_code == 403
    ok = plain.get("/bridge/status", headers=web(key))
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == WEB and ok.json()["tts"]["installed"]
    # cầu nối không mở API nội bộ cho trang web
    assert plain.get("/api/projects", headers=web(key)).status_code == 403
    # Host lạ vẫn bị chặn (chống DNS rebinding)
    assert TestClient(c.app, base_url="http://evil.example:7860").get("/bridge/status", headers=web(key)).status_code == 403


def test_tts_job_roundtrip(env):
    c, key, ref = env["c"], env["key"], env["ref"]
    plain = TestClient(c.app, base_url="http://127.0.0.1:7860")
    with open(ref, "rb") as f:
        r = plain.post("/bridge/tts", headers=web(key), data={"text": "Theo Điều 612 BLDS năm 2015.", "raw": "0",
                                                              "dictionary": '[{"written":"BLDS","spoken":"Bộ luật Dân sự"}]'},
                       files={"ref": ("ref.m4a", f, "audio/mp4")})
    assert r.status_code == 200, r.text
    assert r.headers["access-control-allow-origin"] == WEB
    jid = r.json()["id"]
    for _ in range(200):
        j = plain.get(f"/bridge/jobs/{jid}", headers=web(key)).json()
        if j["status"] in ("done", "failed", "cancelled"):
            break
        time.sleep(0.1)
    assert j["status"] == "done", j
    assert "Bộ luật Dân sự" in j["result"]["spoken"] and "sáu trăm mười hai" in j["result"]["spoken"]
    a = plain.get(f"/bridge/jobs/{jid}/audio", headers=web(key))
    assert a.status_code == 200 and a.content[:4] == b"RIFF" and a.headers["access-control-allow-origin"] == WEB
    # mẫu giọng tạm đã bị xóa
    data = Path(c.app.state.engine.s.data_dir)
    assert not list((data / "tmp").glob("*-ref.*"))
    # raw = dùng nguyên văn bản đọc
    with open(ref, "rb") as f:
        jid = plain.post("/bridge/tts", headers=web(key), data={"text": "BLDS", "raw": "1"},
                         files={"ref": ("ref.m4a", f)}).json()["id"]
    for _ in range(200):
        j = plain.get(f"/bridge/jobs/{jid}", headers=web(key)).json()
        if j["status"] == "done":
            break
        time.sleep(0.1)
    assert j["result"]["spoken"] == "BLDS"


def test_rejects_and_rotation(env):
    c, key = env["c"], env["key"]
    plain = TestClient(c.app, base_url="http://127.0.0.1:7860")
    r = plain.post("/bridge/tts", headers=web(key), data={"text": "x"}, files={"ref": ("r.wav", b"abc")})
    assert r.status_code == 422 and r.headers["access-control-allow-origin"] == WEB
    r = plain.post("/bridge/tts", headers=web(key), data={"text": "  "}, files={"ref": ("r.wav", b"0" * 2000)})
    assert r.status_code == 422
    # job không phải của cầu nối thì không xem được
    p = c.post("/api/projects", json={"title": "x"}).json()
    other = c.post(f"/api/projects/{p['id']}/render", json={"quality": "preview"}).json()
    assert plain.get(f"/bridge/jobs/{other['id']}", headers=web(key)).status_code == 404
    # thêm origin & đổi khóa
    info = c.put("/api/bridge/origins", json={"origins": [WEB, "https://phuc-nguyen-library.web.app", "javascript:x"]}).json()
    assert info["origins"] == [WEB, "https://phuc-nguyen-library.web.app"]
    new = c.post("/api/bridge/rotate").json()["key"]
    assert new != key
    assert plain.get("/bridge/status", headers=web(key)).status_code == 401
    assert plain.get("/bridge/status", headers=web(new)).status_code == 200


def test_normalize_preview(env):
    c, key = env["c"], env["key"]
    plain = TestClient(c.app, base_url="http://127.0.0.1:7860")
    k = c.get("/api/bridge").json()["key"]
    r = plain.post("/bridge/normalize", headers=web(k), json={"text": "Điều 5 BLDS"})
    assert r.status_code == 200 and "Bộ luật Dân sự" in r.json()["spoken"]
    r = plain.post("/bridge/normalize", headers=web(k), json={"text": "BLDS", "dictionary": []})
    assert r.json()["spoken"] == "BLDS"
    assert any(d["written"] == "BLDS" for d in plain.get("/bridge/status", headers=web(k)).json()["dictionary"])
