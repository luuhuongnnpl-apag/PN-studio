# Kiểm thử giao diện end-to-end bằng Playwright + Chrome (máy phát triển).
# Chạy Engine ở chế độ kiểm thử: PNS_DATA=/tmp/pnsui PNS_TEST_TTS=1 PNS_PORT=7861 python engine/run.py --no-browser
# rồi: python tools/ui_smoke.py  (ảnh chụp lưu ở /tmp/shots). PNS_TEST_TTS=1 dùng sóng sin, KHÔNG phải giọng AI thật.
import asyncio, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

B = "http://127.0.0.1:7861"
S = Path("/tmp/shots")
fx = Path("/tmp/uitest/fx"); fx.mkdir(exist_ok=True)
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 54)
pages = []
for i, (title, size) in enumerate([("Chương 3. Thừa kế – Di sản", (1600, 900)), ("Người thừa kế (Điều 613)", (595, 842)), ("Thời điểm mở thừa kế", (1600, 900))], 1):
    im = Image.new("RGB", size, "white"); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, size[0], 90], fill="#102c43"); d.text((30, 15), f"Trang {i}", fill="white", font=font)
    d.text((40, 200), title, fill="#102c43", font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34 if size[0] < 1000 else 60))
    pages.append(im)
pages[0].save(fx / "thua-ke.pdf", "PDF", save_all=True, append_images=pages[1:])
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=4", str(fx / "thu-am-canh1.m4a")], check=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=200:duration=6", str(fx / "mau-giong.wav")], check=True)

PG={}
async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = PG['p'] = await (await b.new_context(viewport={"width": 1440, "height": 900}, bypass_csp=True, accept_downloads=True)).new_page()
        pg.on("console", lambda m: m.type in ("error",) and errors.append(m.text))
        pg.on("pageerror", lambda e: errors.append(str(e)))
        try:
            await pg.goto(B + "/"); await pg.wait_for_selector(".hero")
            await pg.screenshot(path=S / "01-home.png", full_page=True)
            await pg.goto(B + "/#/dashboard"); await pg.wait_for_selector(".kpi")
            await pg.screenshot(path=S / "02-dashboard.png")
            # Media: upload PDF + audio
            await pg.goto(B + "/#/media"); await pg.wait_for_selector(".drop")
            await pg.set_input_files(".drop input[type=file]", [str(fx / "thua-ke.pdf"), str(fx / "thu-am-canh1.m4a")])
            await pg.wait_for_function("document.querySelectorAll('.asset').length >= 2", timeout=30000)
            await pg.click(".asset >> nth=0"); await pg.wait_for_timeout(600)
            await pg.screenshot(path=S / "03-media.png")
            # Voice: add sample
            await pg.goto(B + "/#/voice"); await pg.wait_for_selector("text=Thêm mẫu giọng")
            await pg.set_input_files("input[type=file][accept*='.wav']", str(fx / "mau-giong.wav"))
            await pg.fill("input[placeholder='Họ tên người sở hữu giọng']", "Lưu Thị Thu Hương")
            await pg.check(".check input[type=checkbox]")
            await pg.click("text=Lưu mẫu giọng"); await pg.wait_for_selector(".badge.warn", timeout=20000)
            await pg.click("text=Sinh câu thử"); await pg.wait_for_selector("text=RTF", timeout=60000)
            await pg.screenshot(path=S / "04-voice.png", full_page=True)
            await pg.click("button[role=tab]:has-text('Từ điển đọc')"); await pg.wait_for_selector("h2:has-text('Xem trước')"); await pg.wait_for_timeout(500)
            await pg.screenshot(path=S / "05-dictionary.png")
            # Project
            await pg.goto(B + "/#/projects?new"); await pg.wait_for_selector("dialog")
            await pg.fill("dialog input >> nth=0", "Luật dân sự – Thừa kế – Bài 1")
            await pg.fill("dialog input >> nth=1", "Luật dân sự 2")
            await pg.click("dialog button:text-is('Tạo dự án')"); await pg.wait_for_selector(".editor")
            # Import slides
            await pg.click("text=Nhập PDF/PPTX"); await pg.wait_for_selector("dialog .asset")
            await pg.click("dialog .asset >> nth=0"); await pg.click("dialog button:text-is('Chọn')")
            await pg.wait_for_function("document.querySelectorAll('.scene').length === 3", timeout=30000)
            # scene 1: script + recorded audio
            await pg.click(".scene >> nth=0")
            await pg.fill(".ed-props input[type=text] >> nth=0", "Di sản")
            await pg.fill(".ed-bottom textarea", "Chào các em. Khi giải quyết tình huống thừa kế, trước hết cần xác định di sản. Theo Điều 612 BLDS 2015, di sản bao gồm tài sản riêng của người chết.")
            await pg.click(".seg >> text=Giọng thật")
            await pg.click("text=Chọn từ thư viện"); await pg.wait_for_selector("dialog .asset")
            await pg.click("dialog .asset >> nth=0"); await pg.click("dialog button:text-is('Chọn')")
            await pg.wait_for_selector("text=Đã gắn bản thu", timeout=20000)
            # scene 2: AI voice
            await pg.click(".scene >> nth=1")
            await pg.fill(".ed-bottom textarea", "Người thừa kế là cá nhân phải còn sống vào thời điểm mở thừa kế. Đây là điều kiện quan trọng.")
            await pg.click(".seg >> text=Giọng AI"); await pg.wait_for_timeout(300)
            await pg.select_option(".ed-props select[aria-label='Giọng AI']", index=1)
            await pg.click("text=Tạo giọng AI cảnh này"); await pg.wait_for_selector("text=Giọng AI sẵn sàng", timeout=60000)
            # scene 3: silent; test undo
            await pg.click(".scene >> nth=2")
            await pg.fill(".ed-bottom textarea", "Tóm lại, thời điểm mở thừa kế là thời điểm người có tài sản chết.")
            await pg.click(".ed-props"); await pg.wait_for_timeout(900)
            await pg.click(".scene >> nth=2"); await pg.click("text=Xóa cảnh"); await pg.click("dialog button:text-is('Xóa')")
            assert await pg.locator(".scene").count() == 2
            await pg.click("[aria-label='Hoàn tác (Ctrl+Z)']")
            assert await pg.locator(".scene").count() == 3, "undo failed"
            await pg.wait_for_selector("text=Đã lưu", timeout=10000)
            await pg.click(".scene >> nth=1")
            await pg.screenshot(path=S / "06-lecture.png")
            await pg.click("button[role=tab]:has-text('Văn bản đọc')"); await pg.click(".scene >> nth=0"); await pg.wait_for_timeout(300)
            await pg.screenshot(path=S / "07-spoken.png")
            await pg.click("button[role=tab]:has-text('Phụ đề')"); await pg.click("text=Chuyển sang sửa tay"); await pg.wait_for_selector(".ed-bottom table")
            await pg.screenshot(path=S / "08-captions.png")
            # Video studio
            await pg.click("text=Kết xuất video →"); await pg.wait_for_selector(".timeline")
            await pg.click("text=Kết xuất 1080p")
            await pg.wait_for_selector("video", timeout=180000); await pg.wait_for_timeout(1500)
            await pg.screenshot(path=S / "09-video.png", full_page=True)
            # Publish
            await pg.goto(B + "/#/publish"); await pg.wait_for_selector("text=Duyệt bản này")
            await pg.click("text=Duyệt bản này"); await pg.fill("dialog input", "TS. Lưu Thị Thu Hương"); await pg.click("dialog button:text-is('Duyệt')")
            await pg.wait_for_selector("text=Tải gói phát hành")
            async with pg.expect_download() as dl:
                await pg.click("button:has-text('Tải gói phát hành')")
            d = await dl.value; await d.save_as("/tmp/uitest/package.zip")
            await pg.screenshot(path=S / "10-publish.png", full_page=True)
            await pg.goto(B + "/#/settings"); await pg.wait_for_selector("text=PNS Engine")
            await pg.screenshot(path=S / "11-settings.png")
            await pg.goto(B + "/#/avatar"); await pg.wait_for_selector("text=Chưa khả dụng")
            await pg.screenshot(path=S / "12-unavailable.png")
            await pg.goto(B + "/#/projects"); await pg.wait_for_selector(".pcard")
            await pg.screenshot(path=S / "13-projects.png")
            await pg.goto(B + "/#/dashboard"); await pg.wait_for_selector(".kpi"); await pg.wait_for_timeout(500)
            await pg.screenshot(path=S / "14-dashboard-after.png")
            # Mobile
            m = await b.new_page(viewport={"width": 390, "height": 844})
            await m.goto(B + "/"); await m.wait_for_selector(".hero"); await m.screenshot(path=S / "15-mobile.png")
        except Exception as ex:
            print('FAIL:', str(ex)[:1500]); await pg.screenshot(path='/tmp/shots/fail.png')
        await b.close()
    print("ERRORS:", errors)

async def run():
    try:
        await main()
    except Exception as e:
        print("FAIL:", str(e)[:1500])
        try: await PG['p'].screenshot(path="/tmp/shots/fail.png")
        except Exception: pass
asyncio.run(run())
