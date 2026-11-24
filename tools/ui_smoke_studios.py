# Kiểm thử giao diện 5 studio mở rộng (Image, Audio, Content, Podcast, Interactive) bằng Playwright + Chrome.
# Chuẩn bị: mkdir -p /tmp/uifx /tmp/shots; tạo a.m4a, b.wav (ffmpeg sine) và pic.png (ffmpeg testsrc) trong /tmp/uifx.
# Engine: PNS_UI=http://127.0.0.1:7861/ (mặc định). Chế độ trình duyệt: PNS_UI=http://127.0.0.2:8099/PN-studio/web/ (xem browser_mode_smoke.py).
# Chạy Engine: PNS_DATA=/tmp/pnsui PNS_TEST_TTS=1 PNS_PORT=7861 python engine/run.py --no-browser
# rồi: python tools/ui_smoke_studios.py  (dữ liệu trống; ảnh chụp ở /tmp/shots; in ERRORS: [] khi không có lỗi console)
import asyncio, sys
from playwright.async_api import async_playwright
import os
B=os.environ.get("PNS_UI","http://127.0.0.1:7861/"); S="/tmp/shots"
async def main():
    errors=[]
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
        cx=await b.new_context(viewport={"width":1440,"height":900},accept_downloads=True)
        pg=await cx.new_page()
        pg.on("console",lambda m: m.type=="error" and errors.append(m.text))
        pg.on("pageerror",lambda e: errors.append(str(e)))
        await pg.goto(B+""); await pg.wait_for_timeout(800)
        # tải fixture qua API trong trang
        async def up(path):
            await pg.goto(B+"#/media"); await pg.wait_for_timeout(500)
            await pg.set_input_files(".drop input[type=file]", path); await pg.wait_for_timeout(1500)
        for f in ("/tmp/uifx/a.m4a","/tmp/uifx/b.wav","/tmp/uifx/pic.png"): await up(f)
        # ---- Image
        await pg.goto(B+"#/image"); await pg.wait_for_timeout(600)
        await pg.click("text=Chọn ảnh/slide"); await pg.wait_for_timeout(500)
        await pg.click("dialog .asset >> nth=0"); await pg.click("dialog button:text-is('Chọn')")
        await pg.wait_for_timeout(800)
        await pg.select_option("select[aria-label='Tỷ lệ']","1:1")
        await pg.mouse.move(500,400); 
        await pg.screenshot(path=f"{S}/image-crop.png")
        await pg.click("text=Tạo ảnh mới"); await pg.wait_for_timeout(1500)
        assert await pg.is_visible("text=Đã lưu vào Thư viện media"), "image transform"
        await pg.click("text=Ảnh bìa bài giảng")
        await pg.fill("input[placeholder^='VD: Chương 3']","Chương 3. Thừa kế theo pháp luật")
        await pg.fill("input[placeholder='Giảng viên']","Giảng viên A")
        await pg.click("button:text-is('Tạo ảnh bìa')"); await pg.wait_for_selector("text=Đã lưu vào Thư viện media", timeout=20000); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f"{S}/image-cover.png", full_page=True)
        # ---- Audio
        await pg.goto(B+"#/audio"); await pg.wait_for_timeout(600)
        for i in range(2):
            await pg.click("text=+ Thêm từ thư viện"); await pg.wait_for_timeout(500)
            await pg.click(f"dialog .asset >> nth={i}"); await pg.click("dialog button:text-is('Chọn')"); await pg.wait_for_timeout(700)
        await pg.click(".wave >> nth=0", position={"x":60,"y":40}); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f"{S}/audio.png", full_page=True)
        await pg.click("text=Xuất âm thanh"); await pg.wait_for_selector(".notice.ok", timeout=120000)
        # ---- Content: tạo dự án trước
        r=await pg.evaluate("""async()=>{const A=await import(new URL('js/api.js',location.href).href);
          return (await A.post('api/projects',{title:'Thừa kế UI',scenes:[{title:'A'},{title:'B'}]})).id}""")
        pid=r
        await pg.goto(B+f"#/content/{pid}"); await pg.wait_for_timeout(800)
        await pg.fill("textarea[aria-label='Kịch bản']","## Cảnh 1: Di sản\nTheo Điều 612 BLDS 2015, di sản gồm...\nNguồn: Điều 612 BLDS 2015\n\n## Cảnh 2: Người thừa kế\nĐiều 613 quy định...\n[Cần kiểm chứng]")
        await pg.click("text=Xem trước"); await pg.wait_for_timeout(500)
        await pg.click("text=Áp dụng vào dự án"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=f"{S}/content.png", full_page=True)
        assert await pg.is_visible("text=Chưa có trong ghi chú căn cứ") or await pg.is_visible("text=chưa ghi nguồn"), "content check"
        # gắn âm thanh cho 2 cảnh qua API rồi podcast
        await pg.evaluate("""async(pid)=>{const A=await import(new URL('js/api.js',location.href).href);
          const a=await A.get('api/assets?kind=audio'); let p=await A.get('api/projects/'+pid);
          p.scenes.forEach(s=>s.audioMode='recorded'); p=await A.put('api/projects/'+pid,p);
          for (const [i,s] of p.scenes.entries()) await A.post(`api/projects/${pid}/scenes/${s.id}/audio`,{assetId:a[i].id});}""", pid)
        await pg.goto(B+f"#/podcast/{pid}"); await pg.wait_for_timeout(800)
        await pg.screenshot(path=f'{S}/podcast0.png', full_page=True); await pg.click("button:text-is('Dựng tập podcast')"); await pg.wait_for_timeout(5000); await pg.screenshot(path=f'{S}/podcast1.png', full_page=True); await pg.wait_for_selector("audio[src*='/podcasts/']", state='attached', timeout=60000)
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f"{S}/podcast.png", full_page=True)
        # render final + interactive
        st=await pg.evaluate("""async(pid)=>{const A=await import(new URL('js/api.js',location.href).href);
          const j=await A.post(`api/projects/${pid}/render`,{quality:'final'}); const x=await A.waitJob(j); return x.status+' '+(x.error||'')}""", pid)
        assert st.startswith("done"), st
        await pg.goto(B+f"#/interactive/{pid}"); await pg.wait_for_timeout(1000)
        await pg.click("text=+ Thêm câu hỏi tại thời điểm này")
        await pg.fill(".st-item textarea >> nth=0","Di sản gồm những gì?")
        await pg.fill(".st-item input[type=text] >> nth=0","Tài sản riêng"); await pg.fill(".st-item input[type=text] >> nth=1","Nợ")
        await pg.check(".st-item input[type=radio] >> nth=0")
        await pg.fill(".st-item input[type=number]","1")
        await pg.click("button:text-is('Lưu')"); await pg.wait_for_timeout(800)
        async with cx.expect_page() as np:
            await pg.click("text=Xem thử như người học")
        prev=await np.value; prev.on("pageerror",lambda e: errors.append("preview:"+str(e)))
        await prev.wait_for_load_state(); await prev.evaluate("document.getElementById('v').muted=true; document.getElementById('v').play()")
        await prev.wait_for_selector("#ov:not([hidden])", timeout=15000)
        await prev.click(".opt >> nth=1"); await prev.wait_for_timeout(300)
        await prev.screenshot(path=f"{S}/interactive-preview.png")
        await pg.screenshot(path=f"{S}/interactive.png", full_page=True)
        await pg.goto(B+"#/dashboard"); await pg.wait_for_timeout(800)
        await pg.screenshot(path=f"{S}/dashboard.png")
        print("ERRORS:",errors)
        await b.close()
asyncio.run(main())
