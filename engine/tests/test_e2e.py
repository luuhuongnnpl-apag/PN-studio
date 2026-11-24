"""Kiểm thử end-to-end PNS Engine (A02–A09). Chạy: python -m pytest -q engine/tests"""
from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from pns_engine import media  # noqa: E402
from pns_engine.app import create_app  # noqa: E402
from pns_engine.config import Settings  # noqa: E402

BASE = "http://127.0.0.1:7860"


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    d = tmp_path_factory.mktemp("pns")
    app = create_app(Settings(data_dir=d / "data", tts_test_mode=True))
    c = TestClient(app, base_url=BASE)
    c.headers["X-PNS-Token"] = app.state.token
    fx = d / "fx"
    fx.mkdir()
    # PDF 3 trang: 2 trang 16:9 và 1 trang A4 dọc để kiểm tra giữ tỷ lệ
    pages = []
    for i, size in enumerate([(1600, 900), (595, 842), (1600, 900)], 1):
        im = Image.new("RGB", size, "white")
        dr = ImageDraw.Draw(im)
        dr.rectangle([5, 5, size[0] - 5, size[1] - 5], outline="navy", width=8)
        dr.text((40, 40), f"SLIDE {i}", fill="black")
        pages.append(im)
    pdf = fx / "thua-ke.pdf"
    pages[0].save(pdf, "PDF", save_all=True, append_images=pages[1:])
    ff = media.ffmpeg()
    for name, secs in (("rec1.m4a", 3), ("rec3.wav", 2), ("voice.wav", 6)):
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency=330:duration={secs}",
                        str(fx / name)], check=True)
    return {"c": c, "app": app, "fx": fx, "data": d / "data"}


def wait(c, job, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = c.get(f"/api/jobs/{job['id']}").json()
        if j["status"] in ("done", "failed", "cancelled"):
            return j
        time.sleep(0.2)
    raise AssertionError("job timeout")


def upload(c, path: Path, name: str | None = None):
    with open(path, "rb") as f:
        return c.post("/api/assets", files={"file": (name or path.name, f)})


def video_info(path: Path) -> str:
    return subprocess.run([media.ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True).stderr.decode()


# ---------------- A09 bảo mật ----------------
def test_security_guards(env):
    app = env["app"]
    raw = TestClient(app, base_url=BASE)
    assert raw.get("/api/health").status_code == 401                      # thiếu token
    assert raw.get("/api/health", headers={"X-PNS-Token": "sai"}).status_code == 401
    evil = TestClient(app, base_url="http://evil.example:7860")
    assert evil.get("/", headers={"X-PNS-Token": app.state.token}).status_code == 403   # DNS rebinding
    c = env["c"]
    r = c.post("/api/projects", json={"title": "x"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403                                           # origin lạ
    # cookie phiên chỉ đủ cho GET, ghi phải có header
    page = raw.get("/")
    assert page.status_code == 200 and app.state.token in page.text
    assert raw.post("/api/projects", json={"title": "x"}).status_code == 401
    assert "access-control-allow-origin" not in {k.lower() for k in c.get("/api/health").headers}


def test_upload_validation(env):
    c, fx = env["c"], env["fx"]
    fake = fx / "fake.pdf"
    fake.write_text("not a pdf")
    assert upload(c, fake).status_code == 422
    exe = fx / "x.exe"
    exe.write_bytes(b"MZ....")
    assert upload(c, exe).status_code == 422
    bad_audio = fx / "bad.wav"
    bad_audio.write_bytes(b"RIFF0000garbage")
    assert upload(c, bad_audio).status_code == 422
    r = upload(c, fx / "thua-ke.pdf", "../../../evil.pdf")              # tên file traversal
    assert r.status_code == 200
    a = r.json()
    assert a["name"] == "evil.pdf" and a["meta"]["pages"] == 3
    assert (env["data"] / "assets" / a["id"] / "file.pdf").exists()
    assert c.get("/api/assets/..%2F..%2Fpns.sqlite3/file").status_code == 404


# ---------------- A02 PDF, A03 kịch bản, A04 giọng thật, A05/A06 clone, A07 video, A08 sửa cảnh ----------------
def test_full_lecture_pipeline(env):
    c, fx, data = env["c"], env["fx"], env["data"]
    pdf = upload(c, fx / "thua-ke.pdf").json()
    p = c.post("/api/projects", json={"title": "Luật dân sự – Thừa kế", "course": {"course": "Luật dân sự"}}).json()
    j = wait(c, c.post(f"/api/projects/{p['id']}/import-slides", json={"assetId": pdf["id"]}).json())
    assert j["status"] == "done", j
    p = c.get(f"/api/projects/{p['id']}").json()
    assert [s["sourcePage"] for s in p["scenes"]] == [1, 2, 3]
    # giữ tỷ lệ: trang dọc A4 vừa khung 1080 chiều cao
    portrait = [a for a in c.get("/api/assets?kind=slide").json() if a["meta"]["page"] == 2][0]
    assert portrait["meta"]["height"] == 1080 and abs(portrait["meta"]["width"] / 1080 - 595 / 842) < 0.01
    assert c.get(f"/api/assets/{portrait['id']}/thumb").status_code == 200

    # A03: sửa kịch bản, đổi thứ tự, lưu có revision; xung đột revision bị từ chối
    sc = p["scenes"]
    sc[0].update(title="Di sản", scriptOriginal="Chào các em. Theo Điều 612 BLDS 2015, di sản gồm tài sản riêng.",
                 audioMode="recorded")
    sc[1].update(title="Người thừa kế", audioMode="tts", sourceNotes="Điều 613 BLDS 2015",
                 scriptOriginal="Người thừa kế là cá nhân phải còn sống vào thời điểm mở thừa kế. Câu thứ hai.")
    sc[2].update(title="Kết luận", audioMode="recorded", scriptOriginal="Tóm lại, cần xác định di sản trước.")
    rev = p["revision"]
    p2 = c.put(f"/api/projects/{p['id']}", json={**p, "scenes": sc}).json()
    assert p2["revision"] == rev + 1
    assert "sáu trăm mười hai" in p2["scenes"][0]["spokenText"] and "Bộ luật Dân sự" in p2["scenes"][0]["spokenText"]
    assert c.put(f"/api/projects/{p['id']}", json={**p, "revision": rev}).status_code == 409

    # A04: giọng thật M4A/WAV gắn đúng cảnh
    rec1 = upload(c, fx / "rec1.m4a").json()
    rec3 = upload(c, fx / "rec3.wav").json()
    assert 2900 < rec1["meta"]["durationMs"] < 3200
    c.post(f"/api/projects/{p['id']}/scenes/{sc[0]['id']}/audio", json={"assetId": rec1["id"]})
    p3 = c.post(f"/api/projects/{p['id']}/scenes/{sc[2]['id']}/audio", json={"assetId": rec3["id"]}).json()
    assert p3["scenes"][0]["audioAssetId"] == rec1["id"] and p3["scenes"][2]["audioAssetId"] == rec3["id"]

    # A05: giọng AI cần xác nhận quyền; (chế độ kiểm thử dùng bộ sinh sóng sin, KHÔNG phải model thật)
    with open(fx / "voice.wav", "rb") as f:
        assert c.post("/api/voices", files={"file": ("v.wav", f)}, data={"name": "GV"}).status_code == 422
    with open(fx / "voice.wav", "rb") as f:
        v = c.post("/api/voices", files={"file": ("v.wav", f)},
                   data={"name": "Giọng GV", "owner": "Chủ sở hữu", "consent": "yes"}).json()
    assert v["consent"]["owner"] == "Chủ sở hữu"
    sc = p3["scenes"]
    sc[1]["voiceId"] = v["id"]
    p4 = c.put(f"/api/projects/{p['id']}", json={**p3, "scenes": sc}).json()
    assert p4["scenes"][1]["audioStale"] is True
    j = wait(c, c.post(f"/api/projects/{p['id']}/scenes/{sc[1]['id']}/tts").json())
    assert j["status"] == "done", j
    p5 = c.get(f"/api/projects/{p['id']}").json()
    assert p5["scenes"][1]["audioStale"] is False and p5["scenes"][1]["audioAssetId"]

    # A07: render 720p xem trước rồi 1080p
    j = wait(c, c.post(f"/api/projects/{p['id']}/render", json={"quality": "preview"}).json(), 300)
    assert j["status"] == "done", j
    j = wait(c, c.post(f"/api/projects/{p['id']}/render", json={"quality": "final"}).json(), 300)
    assert j["status"] == "done", j
    rec = j["result"]
    d = data / "renders" / p["id"] / rec["id"]
    info = video_info(d / "lecture.mp4")
    assert "h264" in info and "aac" in info and "1920x1080" in info
    expected = sum(t["durationMs"] for t in rec["timeline"])
    assert abs(rec["durationMs"] - expected) < 400
    srt = (d / "lecture.srt").read_text(encoding="utf-8")
    stamps = re.findall(r"(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})", srt)
    assert stamps
    for st in stamps:
        a = ((int(st[0]) * 60 + int(st[1])) * 60 + int(st[2])) * 1000 + int(st[3])
        b = ((int(st[4]) * 60 + int(st[5])) * 60 + int(st[6])) * 1000 + int(st[7])
        assert 0 <= a < b <= rec["durationMs"]
    assert "Điều 612" in srt                                              # phụ đề giữ văn bản gốc
    assert rec["aiNarration"] is True
    assert c.get(f"/api/projects/{p['id']}/renders/{rec['id']}/lecture.mp4",
                 headers={"Range": "bytes=0-99"}).status_code == 206   # tua video được

    # A08: đổi lời cảnh 2 → chỉ cảnh 2 mất hiệu lực
    tts_before = set((data / "cache" / "tts").glob("*.wav"))
    sc = p5["scenes"]
    sc[1]["scriptOriginal"] = "Người thừa kế là cá nhân phải còn sống vào thời điểm mở thừa kế. Câu đã sửa."
    p6 = c.put(f"/api/projects/{p['id']}", json={**p5, "scenes": sc}).json()
    assert [s["audioStale"] for s in p6["scenes"]] == [False, True, False]
    j = wait(c, c.post(f"/api/projects/{p['id']}/render", json={"quality": "final"}).json(), 300)
    assert j["status"] == "done", j
    assert j["result"]["clipsReused"] == 2
    tts_after = set((data / "cache" / "tts").glob("*.wav"))
    assert len(tts_after - tts_before) == 1                               # chỉ sinh lại 1 đoạn mới
    srt2 = (data / "renders" / p["id"] / j["result"]["id"] / "lecture.srt").read_text(encoding="utf-8")
    assert "Câu đã sửa." in srt2 and "Câu thứ hai." not in srt2

    # Xuất bản có duyệt: bản preview không được duyệt; gói chỉ tạo khi đã duyệt
    previews = [r for r in c.get(f"/api/projects/{p['id']}/renders").json() if r["quality"] == "preview"]
    assert c.post(f"/api/projects/{p['id']}/renders/{previews[0]['id']}/approval",
                  json={"approved": True}).status_code == 422
    rid = j["result"]["id"]
    assert c.post(f"/api/projects/{p['id']}/renders/{rid}/package").status_code == 422
    c.post(f"/api/projects/{p['id']}/renders/{rid}/approval", json={"approved": True, "approver": "GV"})
    pkg = c.post(f"/api/projects/{p['id']}/renders/{rid}/package")
    z = zipfile.ZipFile(io.BytesIO(pkg.content))
    assert set(z.namelist()) == {"lecture.mp4", "lecture.srt", "publication.json"}
    pub = json.loads(z.read("publication.json"))
    assert pub["aiNarration"] is True and pub["approvedBy"] == "GV" and pub["sources"]

    # A03: sao lưu / khôi phục không mất dữ liệu, không chứa mẫu giọng
    exp = c.get(f"/api/projects/{p['id']}/export")
    names = zipfile.ZipFile(io.BytesIO(exp.content)).namelist()
    assert "manifest.json" in names and not any("voices" in n for n in names)
    imp = c.post("/api/projects/import", files={"file": ("b.pnsproj", exp.content)}).json()
    assert "scenes" in imp, imp
    assert [s["scriptOriginal"] for s in imp["scenes"]] == [s["scriptOriginal"] for s in p6["scenes"]]
    assert imp["scenes"][0]["audioAssetId"] and imp["scenes"][1]["audioStale"] is False

    # Nhân bản, lưu trữ, xóa có xác nhận
    dup = c.post(f"/api/projects/{p['id']}/duplicate").json()
    assert len(dup["scenes"]) == 3 and dup["id"] != p["id"]
    assert c.delete(f"/api/projects/{dup['id']}").status_code == 400
    assert c.delete(f"/api/projects/{dup['id']}?confirm={dup['id']}").status_code == 200
    # Tài sản đang dùng không xóa được
    assert c.delete(f"/api/assets/{rec1['id']}").status_code == 409


def test_import_rejects_traversal(env):
    c = env["c"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("manifest.json", json.dumps({
            "format": "pns-project", "schemaVersion": 1,
            "project": {"title": "evil", "scenes": [{"title": "a", "slideAssetId": "as_0000000000000000"}]},
            "assets": [{"id": "as_0000000000000000", "file": "../../../pwn.txt", "kind": "image"}]}))
        z.writestr("../../../pwn.txt", "x")
    r = c.post("/api/projects/import", files={"file": ("e.pnsproj", buf.getvalue())})
    assert r.status_code == 200 and r.json()["scenes"][0]["slideAssetId"] is None
    assert not (env["data"].parent / "pwn.txt").exists()


def test_tts_unavailable_reports_error(tmp_path, env):
    """A06: không có model → báo lỗi thật, không giả thành công; giọng thật vẫn render được."""
    app = create_app(Settings(data_dir=tmp_path / "d", tts_test_mode=False))
    c = TestClient(app, base_url=BASE)
    c.headers["X-PNS-Token"] = app.state.token
    eng = app.state.engine
    if eng.tts.installed():
        pytest.skip("Máy này đã cài vieneu")
    p = c.post("/api/projects", json={"title": "t", "scenes": [{"title": "A", "audioMode": "tts",
                                                                 "scriptOriginal": "Xin chào."}]}).json()
    r = c.post(f"/api/projects/{p['id']}/scenes/{p['scenes'][0]['id']}/tts")
    assert r.status_code == 422 and "VieNeu" in r.json()["error"]
    j = wait(c, c.post(f"/api/projects/{p['id']}/render", json={"quality": "preview"}).json())
    assert j["status"] == "failed" and j["error"]
    # Chuyển sang giọng thật (thu âm) thì render thành công
    with open(env["fx"] / "rec3.wav", "rb") as f:
        a = c.post("/api/assets", files={"file": ("r.wav", f)}).json()
    sc = p["scenes"]
    sc[0]["audioMode"] = "recorded"
    c.put(f"/api/projects/{p['id']}", json={**p, "scenes": sc})
    c.post(f"/api/projects/{p['id']}/scenes/{sc[0]['id']}/audio", json={"assetId": a["id"]})
    j = wait(c, c.post(f"/api/projects/{p['id']}/render", json={"quality": "preview"}).json())
    assert j["status"] == "done", j


def test_cancel_job(env):
    c = env["c"]
    scenes = [{"title": f"C{i}", "silentDurationMs": 60000} for i in range(6)]
    p = c.post("/api/projects", json={"title": "dai", "scenes": scenes}).json()
    job = c.post(f"/api/projects/{p['id']}/render", json={"quality": "final"}).json()
    time.sleep(1.0)
    assert c.post(f"/api/jobs/{job['id']}/cancel").json()["cancelled"] is True
    assert wait(c, job)["status"] == "cancelled"


def test_pptx_conversion(env):
    if not media.soffice_path():
        pytest.skip("Không có LibreOffice")
    pptx = pytest.importorskip("pptx")
    prs = pptx.Presentation()
    for i in range(2):
        s = prs.slides.add_slide(prs.slide_layouts[1])
        s.shapes.title.text = f"Slide PPTX {i + 1}"
    path = env["fx"] / "deck.pptx"
    prs.save(path)
    c = env["c"]
    a = upload(c, path).json()
    assert a["kind"] == "presentation"
    p = c.post("/api/projects", json={"title": "pptx"}).json()
    j = wait(c, c.post(f"/api/projects/{p['id']}/import-slides", json={"assetId": a["id"]}).json(), 240)
    assert j["status"] == "done", j
    assert j["result"]["pages"] == 2
