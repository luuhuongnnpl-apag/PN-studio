# Kiểm thử chế độ trình duyệt (không Engine): phục vụ repo tĩnh dưới /PN-studio/ trên 127.0.0.2:8099 rồi chạy file này.
import asyncio, subprocess
from pathlib import Path
from playwright.async_api import async_playwright
B = "http://127.0.0.2:8099/PN-studio/web/"
S = Path("/tmp/shots"); fx = Path("/tmp/uitest/fx")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        pg = await ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        try:
            await pg.goto(B); await pg.wait_for_selector(".hero")
            await pg.wait_for_selector("text=Chế độ trình duyệt", timeout=15000)
            await pg.screenshot(path=S / "b01-home.png")
            await pg.goto(B + "#/media"); await pg.wait_for_selector(".drop")
            await pg.set_input_files(".drop input[type=file]", [str(fx / "thua-ke.pdf"), str(fx / "thu-am-canh1.m4a")])
            await pg.wait_for_function("document.querySelectorAll('.asset').length >= 2", timeout=60000)
            await pg.wait_for_timeout(800); await pg.screenshot(path=S / "b02-media.png")
            await pg.goto(B + "#/projects?new"); await pg.wait_for_selector("dialog")
            await pg.fill("dialog input >> nth=0", "Thừa kế – chế độ trình duyệt")
            await pg.click("dialog button:text-is('Tạo dự án')"); await pg.wait_for_selector(".editor")
            await pg.click("text=Nhập PDF/PPTX"); await pg.wait_for_selector("dialog .asset")
            await pg.click("dialog .asset >> nth=0"); await pg.click("dialog button:text-is('Chọn')")
            await pg.wait_for_function("document.querySelectorAll('.scene').length === 3", timeout=60000)
            await pg.click(".scene >> nth=0")
            await pg.fill(".ed-bottom textarea", "Chào các em. Theo Điều 612 BLDS 2015, di sản bao gồm tài sản riêng của người chết.")
            await pg.click(".seg >> text=Giọng thật")
            await pg.click("text=Chọn từ thư viện"); await pg.wait_for_selector("dialog .asset")
            await pg.click("dialog .asset >> nth=0"); await pg.click("dialog button:text-is('Chọn')")
            await pg.wait_for_selector("text=Đã gắn bản thu", timeout=20000)
            await pg.click(".scene >> nth=1"); await pg.fill(".ed-bottom textarea", "Cảnh không lời có phụ đề.")
            await pg.wait_for_timeout(2000); await pg.screenshot(path=S / "b03-lecture.png")
            await pg.click("text=Kết xuất video →"); await pg.wait_for_selector(".timeline")
            t0 = asyncio.get_event_loop().time()
            await pg.click("text=Kết xuất 1080p")
            await pg.wait_for_selector("video", timeout=600000)
            print("render seconds", round(asyncio.get_event_loop().time() - t0, 1))
            await pg.wait_for_timeout(2500)
            ok = await pg.evaluate("(async()=>{const v=document.querySelector('video');await new Promise(r=>v.readyState>=1?r():v.onloadedmetadata=r);return [v.duration,v.videoWidth,v.videoHeight]})()")
            print("video", ok)
            await pg.screenshot(path=S / "b04-video.png", full_page=True)
            await pg.goto(B + "#/publish"); await pg.wait_for_selector("text=Duyệt bản này")
            await pg.click("text=Duyệt bản này"); await pg.fill("dialog input", "GV"); await pg.click("dialog button:text-is('Duyệt')")
            async with pg.expect_download() as dl:
                await pg.click("button:has-text('Tải gói phát hành')")
            await (await dl.value).save_as("/tmp/uitest/bpkg.zip")
            await pg.goto(B + "#/projects"); await pg.wait_for_selector(".pcard")
            async with pg.expect_download() as dl:
                await pg.click(".pcard >> nth=0 >> button:has-text('Sao lưu')")
            await (await dl.value).save_as("/tmp/uitest/browser.pnsproj")
            await pg.goto(B + "#/settings"); await pg.wait_for_selector("text=Năng lực theo chế độ"); await pg.screenshot(path=S / "b05-settings.png")
            await pg.goto(B + "#/voice"); await pg.wait_for_timeout(800); await pg.screenshot(path=S / "b06-voice.png")
        except Exception as e:
            print("FAIL", str(e)[:1200]); await pg.screenshot(path=S / "bfail.png")
        print("errors", errs); await b.close()
asyncio.run(main())
