"""Kiểm thử các studio mở rộng: Image, Audio, Content, Podcast, Interactive."""
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
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from pns_engine import media, studios  # noqa: E402
from pns_engine.app import create_app  # noqa: E402
from pns_engine.config import Settings  # noqa: E402

BASE = "http://127.0.0.1:7860"


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    d = tmp_path_factory.mktemp("pnsst")
    app = create_app(Settings(data_dir=d / "data", tts_test_mode=True))
    c = TestClient(app, base_url=BASE)
    c.headers["X-PNS-Token"] = app.state.token
    fx = d / "fx"
    fx.mkdir()
    im = Image.new("RGB", (1200, 800), "white")
    for x in range(0, 1200, 100):
        im.paste((x // 5, 80, 160), (x, 0, x + 50, 800))
    im.save(fx / "anh.jpg", "JPEG")
    ff = media.ffmpeg()
    for name, secs, freq in (("a.wav", 3, 330), ("b.m4a", 2, 440), ("intro.wav", 1, 550)):
        subprocess.run([ff, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={secs}",
                        str(fx / name)], check=True)
    pages = [Image.new("RGB", (1600, 900), "white") for _ in range(2)]
    pages[0].save(fx / "s.pdf", "PDF", save_all=True, append_images=pages[1:])
    return {"c": c, "fx": fx, "data": d / "data"}


def up(c, path: Path):
    with open(path, "rb") as f:
        r = c.post("/api/assets", files={"file": (path.name, f)})
    assert r.status_code == 200, r.text
    return r.json()


def wait(c, job, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = c.get(f"/api/jobs/{job['id']}").json()
        if j["status"] in ("done", "failed", "cancelled"):
            return j
        time.sleep(0.2)
    raise AssertionError("job timeout")


# ---------------- Image Studio ----------------
def test_crop_box_stays_inside():
    assert studios.crop_box(1200, 800, "1:1", 0.5, 0.5, 1) == (200, 0, 1000, 800)
    assert studios.crop_box(1200, 800, "16:9", 0, 0, 1) == (0, 0, 1200, 675)   # cy=0: bám mép trên, không vượt ảnh
    x0, y0, x1, y1 = studios.crop_box(1200, 800, "9:16", 1, 1, 2)
    assert x1 <= 1200 and y1 <= 800 and abs((x1 - x0) / (y1 - y0) - 9 / 16) < 0.01


def test_image_transform_and_cover(env):
    c, fx = env["c"], env["fx"]
    src = up(c, fx / "anh.jpg")
    c.patch(f"/api/assets/{src['id']}", json={"rights": "Ảnh tự chụp"})
    r = c.post("/api/image/transform", json={"assetId": src["id"], "aspect": "1:1", "width": 512, "format": "jpg"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["meta"]["width"], out["meta"]["height"]) == (512, 512) and out["mime"] == "image/jpeg"
    assert out["meta"]["derivedFrom"] == src["id"] and out["meta"]["rights"] == "Ảnh tự chụp"
    img = c.get(f"/api/assets/{out['id']}/file")
    assert Image.open(io.BytesIO(img.content)).size == (512, 512)
    r = c.post("/api/image/transform", json={"assetId": src["id"], "rotate": 90})
    assert (r.json()["meta"]["width"], r.json()["meta"]["height"]) == (800, 1200)
    assert c.post("/api/image/transform", json={"assetId": "as_0000000000000000"}).status_code == 422

    for tpl, size, wh in (("navy", "16:9", (1920, 1080)), ("light", "1:1", (1080, 1080)), ("photo", "9:16", (1080, 1920))):
        r = c.post("/api/image/cover", json={"title": "Chương 3. Thừa kế theo pháp luật – di sản và người thừa kế",
                                             "eyebrow": "Luật dân sự", "subtitle": "Điều 612–613 BLDS 2015",
                                             "author": "ThS. Giảng viên", "org": "Khoa Luật", "template": tpl,
                                             "size": size, "bgAssetId": src["id"]})
        assert r.status_code == 200, r.text
        assert (r.json()["meta"]["width"], r.json()["meta"]["height"]) == wh
    assert c.post("/api/image/cover", json={"title": ""}).status_code == 422
    assert c.post("/api/image/cover", json={"title": "x", "template": "photo"}).status_code == 422


# ---------------- Audio Studio ----------------
def test_audio_peaks_and_edit(env):
    c, fx = env["c"], env["fx"]
    a, b = up(c, fx / "a.wav"), up(c, fx / "b.m4a")
    pk = c.get(f"/api/assets/{a['id']}/peaks?n=200").json()
    assert len(pk["peaks"]) == 200 and max(pk["peaks"]) > 0.1 and 2900 < pk["durationMs"] < 3100
    job = c.post("/api/audio/edit", json={"name": "Ghép thử", "gapMs": 500, "segments": [
        {"assetId": a["id"], "startMs": 500, "endMs": 2500, "fadeInMs": 200, "fadeOutMs": 300, "gainDb": -3},
        {"assetId": b["id"], "fadeInMs": 100}]}).json()
    j = wait(c, job)
    assert j["status"] == "done", j
    res = c.get("/api/assets?kind=audio").json()
    out = next(x for x in res if x["id"] == j["result"]["assetId"])
    # 2,0 s + 0,5 s khoảng lặng + 2,0 s
    assert 4350 < out["meta"]["durationMs"] < 4650, out["meta"]
    assert out["meta"]["edited"] and len(out["meta"]["segments"]) == 2 and out["name"] == "Ghép thử.wav"
    bad = c.post("/api/audio/edit", json={"segments": [{"assetId": a["id"], "startMs": 2000, "endMs": 1000}]})
    assert bad.status_code == 422
    assert c.post("/api/audio/edit", json={"segments": []}).status_code == 422


# ---------------- Content Studio ----------------
SCRIPT = """Kịch bản bài giảng

## Cảnh 1: Khái niệm di sản
Chào các em. Theo **Điều 612** BLDS 2015, di sản gồm tài sản riêng của người chết.
Nguồn: Điều 612 Bộ luật Dân sự 2015 (Luật 91/2015/QH13)

**Slide 2 – Người thừa kế**
Người thừa kế phải còn sống vào thời điểm mở thừa kế (Điều 613).
[Cần kiểm chứng]

Cảnh 3: Kết luận
Tóm lại, xác định di sản là bước đầu tiên.
"""


def test_parse_script_formats():
    sc = studios.parse_script(SCRIPT)
    assert [s["title"] for s in sc] == ["Khái niệm di sản", "Người thừa kế", "Kết luận"]   # bỏ phần mở đầu
    s1, s2, s3 = sc
    assert "**" not in s1["scriptOriginal"] and "Điều 612" in s1["scriptOriginal"]
    assert s1["sourceNotes"].startswith("Điều 612") and s2["needsVerification"] and not s3["needsVerification"]
    flat = studios.parse_script("Đoạn một.\n---\nĐoạn hai.\nCăn cứ: Điều 1")
    assert [x["scriptOriginal"] for x in flat] == ["Đoạn một.", "Đoạn hai."] and flat[1]["sourceNotes"] == "Điều 1"
    md = studios.parse_script("# Bài 1\nMở đầu\n## Ý một\nA\n## Ý hai\nB")
    assert [(x["title"], x["scriptOriginal"]) for x in md] == [("Bài 1", "Mở đầu"), ("Ý một", "A"), ("Ý hai", "B")]


def test_content_apply_check_export_roundtrip(env):
    c, fx = env["c"], env["fx"]
    pdf = up(c, fx / "s.pdf")
    p = c.post("/api/projects", json={"title": "Thừa kế"}).json()
    assert wait(c, c.post(f"/api/projects/{p['id']}/import-slides", json={"assetId": pdf["id"]}).json())["status"] == "done"
    p = c.get(f"/api/projects/{p['id']}").json()
    slides = [s["slideAssetId"] for s in p["scenes"]]
    text = SCRIPT.split("\n", 2)[2]
    r = c.post(f"/api/projects/{p['id']}/content/apply", json={"text": text, "revision": p["revision"]})
    assert r.status_code == 200, r.text
    q = r.json()
    assert len(q["scenes"]) == 3 and [s["slideAssetId"] for s in q["scenes"][:2]] == slides   # giữ slide
    assert q["scenes"][0]["title"] == "Khái niệm di sản" and q["scenes"][2]["slideAssetId"] is None
    assert c.post(f"/api/projects/{p['id']}/content/apply", json={"text": text, "revision": p["revision"]}).status_code == 409
    chk = c.get(f"/api/projects/{p['id']}/content/check").json()
    rows = {r["index"]: r for r in chk["scenes"]}
    assert rows[1]["issues"] == [] and rows[1]["articles"] == ["612"] and rows[1]["documents"] == []
    assert any("chưa ghi nguồn" in x for x in rows[2]["issues"]) and any("kiểm chứng" in x for x in rows[2]["issues"])
    assert chk["estMs"] > 0 and chk["issueCount"] >= 2
    md = c.get(f"/api/projects/{p['id']}/script.md")
    assert md.status_code == 200 and "attachment" in md.headers["content-disposition"]
    again = studios.parse_script(md.text)
    assert [x["title"] for x in again] == ["Khái niệm di sản", "Người thừa kế", "Kết luận"]
    assert again[1]["needsVerification"] and again[0]["sourceNotes"] == q["scenes"][0]["sourceNotes"]
    r = c.post(f"/api/projects/{p['id']}/content/apply", json={"text": "Cảnh 9: Phụ lục\nNội dung thêm.", "mode": "append"})
    assert len(r.json()["scenes"]) == 4


# ---------------- Podcast + Interactive ----------------
def test_podcast_and_interactive(env):
    c, fx, data = env["c"], env["fx"], env["data"]
    a, b, intro = up(c, fx / "a.wav"), up(c, fx / "b.m4a"), up(c, fx / "intro.wav")
    cover = up(c, fx / "anh.jpg")
    p = c.post("/api/projects", json={"title": "Podcast thừa kế", "scenes": [
        {"title": "Mở bài", "scriptOriginal": "Xin chào.", "audioMode": "recorded"},
        {"title": "Không âm thanh", "scriptOriginal": "x"},
        {"title": "Phần chính", "scriptOriginal": "Nội dung.", "audioMode": "recorded"}]}).json()
    s = p["scenes"]
    c.post(f"/api/projects/{p['id']}/scenes/{s[0]['id']}/audio", json={"assetId": a["id"]})
    c.post(f"/api/projects/{p['id']}/scenes/{s[2]['id']}/audio", json={"assetId": b["id"]})
    assert c.put(f"/api/projects/{p['id']}/podcast", json={"coverAssetId": "as_0000000000000000"}).status_code == 422
    cfg = c.put(f"/api/projects/{p['id']}/podcast", json={
        "title": "Tập 1: Thừa kế", "author": "Giảng viên", "introAssetId": intro["id"], "coverAssetId": cover["id"],
        "gapMs": 500, "chapters": True, "audioBaseUrl": "http://khong-an-toan"}).json()
    assert cfg["audioBaseUrl"] == "" and cfg["title"] == "Tập 1: Thừa kế"
    assert c.get(f"/api/assets/{cover['id']}/usage").json()["projects"] == [p["id"]]   # ảnh bìa đang dùng
    j = wait(c, c.post(f"/api/projects/{p['id']}/podcast/build").json())
    assert j["status"] == "done", j
    ep = j["result"]
    # 1 + 0,5 + 3 + 0,5 + 2 = 7 s
    assert 6700 < ep["durationMs"] < 7300 and ep["skippedScenes"] == ["Không âm thanh"]
    assert [x["title"] for x in ep["chapters"]] == ["Mở đầu", "Mở bài", "Phần chính"]
    f = c.get(f"/api/projects/{p['id']}/podcasts/{ep['id']}/{ep['file']}")
    assert f.status_code == 200 and len(f.content) == ep["sizeBytes"]
    info = subprocess.run([media.ffmpeg(), "-hide_banner", "-i",
                           str(data / "podcasts" / p["id"] / ep["id"] / ep["file"])], capture_output=True).stderr.decode()
    assert "Chapter #0" in info and "Tập 1" in info
    assert c.post(f"/api/projects/{p['id']}/podcasts/{ep['id']}/package").status_code == 422   # chưa duyệt
    c.post(f"/api/projects/{p['id']}/podcasts/{ep['id']}/approval", json={"approved": True, "approver": "GV"})
    z = zipfile.ZipFile(io.BytesIO(c.post(f"/api/projects/{p['id']}/podcasts/{ep['id']}/package").content))
    assert {"episode.json", "rss-item.xml", "cover.jpg", "chapters.json", ep["file"]} <= set(z.namelist())
    assert "DIA_CHI_FILE_AUDIO" in z.read("rss-item.xml").decode()
    assert c.get(f"/api/projects/{p['id']}/podcasts/{ep['id']}/..%2Fepisode.json").status_code == 404

    # Interactive: cần bản kết xuất đã duyệt
    rj = wait(c, c.post(f"/api/projects/{p['id']}/render", json={"quality": "final"}).json(), 300)
    assert rj["status"] == "done", rj
    rid = rj["result"]["id"]
    qs = [{"atMs": 2000, "text": "Di sản gồm những gì?", "options": ["Tài sản riêng", "Nợ"], "correct": 0,
           "explain": "Điều 612 BLDS 2015."}]
    assert c.put(f"/api/projects/{p['id']}/interactive", json={"renderId": rid, "questions": [
        {"atMs": 1, "text": "x", "options": ["a"], "correct": 0}]}).status_code == 422
    assert c.put(f"/api/projects/{p['id']}/interactive", json={"renderId": rid, "questions": [
        {"atMs": 1, "text": "x", "options": ["a", "b"]}]}).status_code == 422
    saved = c.put(f"/api/projects/{p['id']}/interactive", json={"renderId": rid, "questions": qs,
                                                                "requireCorrect": True}).json()
    assert re.fullmatch(r"q[0-9a-f]{8}", saved["questions"][0]["id"])
    pv = c.get(f"/api/projects/{p['id']}/interactive/preview")
    assert pv.status_code == 200 and "Di sản gồm" in pv.text and "</script><" not in pv.text.split("var D =")[1][:400]
    assert "script-src 'unsafe-inline'" in pv.headers["content-security-policy"]
    assert c.post(f"/api/projects/{p['id']}/interactive/package").status_code == 422      # chưa duyệt
    c.post(f"/api/projects/{p['id']}/renders/{rid}/approval", json={"approved": True})
    z = zipfile.ZipFile(io.BytesIO(c.post(f"/api/projects/{p['id']}/interactive/package").content))
    assert {"index.html", "lecture.mp4", "lecture.vtt", "interactive.json"} <= set(z.namelist())
    html = z.read("index.html").decode()
    assert 'src="lecture.mp4"' in html and '"requireCorrect": true' in html
    # chống chèn mã qua nội dung câu hỏi
    c.put(f"/api/projects/{p['id']}/interactive", json={"renderId": rid, "questions": [
        {**qs[0], "text": "</script><script>alert(1)</script>"}]})
    assert "<script>alert" not in c.get(f"/api/projects/{p['id']}/interactive/preview").text

    # Xóa dự án dọn cấu hình và tập podcast
    assert c.delete(f"/api/projects/{p['id']}?confirm={p['id']}").status_code == 200
    assert not (data / "podcasts" / p["id"]).exists()
    assert c.get(f"/api/assets/{cover['id']}/usage").json()["projects"] == []


def test_content_check_flags_missing_document(env):
    c = env["c"]
    p = c.post("/api/projects", json={"title": "Kiểm tra căn cứ", "scenes": [
        {"title": "A", "scriptOriginal": "Theo Điều 5 và Điều 12 Nghị định 102/2024/NĐ-CP, ...",
         "sourceNotes": "Điều 5 Nghị định 102/2024/NĐ-CP"}]}).json()
    row = c.get(f"/api/projects/{p['id']}/content/check").json()["scenes"][0]
    assert row["documents"] == ["102/2024/NĐ-CP"] and row["articles"] == ["5", "12"]
    assert row["issues"] == ["Chưa có trong ghi chú căn cứ: Điều 12"]
