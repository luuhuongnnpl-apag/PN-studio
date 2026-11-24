# Kiểm thử đầu-cuối Học liệu điện tử: soạn → xem thử → gói SCORM 1.2 chạy trong LMS giả lập (ghi nhận trạng thái, điểm).
# Engine:   PNS_UI=http://127.0.0.1:7861/ (mặc định) · Trình duyệt: PNS_UI=http://127.0.0.2:8099/PN-studio/web/
# Cần: /tmp/uifx/{a.m4a,b.wav,slides.pdf}; thư mục /tmp/srv được phục vụ ở http://127.0.0.2:8099 (để chạy gói SCORM giải nén).
import asyncio, os, shutil, zipfile, json
from playwright.async_api import async_playwright
B = os.environ.get("PNS_UI", "http://127.0.0.1:7861/"); S = "/tmp/shots"; OUT = "/tmp/srv/scormtest"

HARNESS = """<!doctype html><meta charset=utf-8><title>LMS giả lập</title>
<script>window.calls=[];var D={};window.API={LMSInitialize:function(){calls.push(['init']);return 'true'},
LMSGetValue:function(k){return D[k]||''},LMSSetValue:function(k,v){D[k]=v;calls.push(['set',k,v]);return 'true'},
LMSCommit:function(){calls.push(['commit']);return 'true'},LMSFinish:function(){calls.push(['finish']);return 'true'},
LMSGetLastError:function(){return '0'},LMSGetErrorString:function(){return ''},LMSGetDiagnostic:function(){return ''}};window.D=D;</script>
<iframe id=f src="pkg/index.html" style="width:1400px;height:860px;border:0"></iframe>"""

async def main():
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        cx = await b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        pg = await cx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        await pg.goto(B); await pg.wait_for_timeout(1200)
        for f in ("/tmp/uifx/a.m4a", "/tmp/uifx/b.wav", "/tmp/uifx/slides.pdf"):
            await pg.goto(B + "#/media"); await pg.wait_for_timeout(400)
            await pg.set_input_files(".drop input[type=file]", f); await pg.wait_for_timeout(1500)
        info = await pg.evaluate("""async()=>{const A=await import(new URL('js/api.js',location.href).href);
          const au=await A.get('api/assets?kind=audio'); const out=[];
          for (const [i,t] of ['Di sản thừa kế','Người thừa kế'].entries()){
            let p=await A.post('api/projects',{title:t,scenes:[{title:t+' – mở đầu',scriptOriginal:'Theo Điều '+(612+i)+' BLDS 2015 ...',sourceNotes:'Điều '+(612+i)+' Bộ luật Dân sự 2015',audioMode:'recorded'}]});
            await A.post(`api/projects/${p.id}/scenes/${p.scenes[0].id}/audio`,{assetId:au[i].id});
            const j=await A.waitJob(await A.post(`api/projects/${p.id}/render`,{quality:'final'}));
            if(j.status!=='done') throw new Error(j.error);
            await A.post(`api/projects/${p.id}/renders/${j.result.id}/approval`,{approved:true,approver:'GV'});
            await A.put(`api/projects/${p.id}/interactive`,{renderId:j.result.id,questions:[{atMs:1000,text:'Di sản gồm?',options:['Tài sản riêng','Nợ'],correct:0,explain:'Điều 612'}]});
            out.push(p.id);}
          return out}""")
        await pg.goto(B + "#/elearning"); await pg.wait_for_timeout(800)
        await pg.click("text=+ Tạo học liệu mới"); await pg.fill("dialog input", "Thừa kế theo pháp luật"); await pg.click("dialog button:text-is('Lưu')")
        await pg.wait_for_selector("text=Thông tin chung", timeout=10000)
        await pg.fill("textarea[placeholder^='Mỗi dòng một mục tiêu']", "Xác định di sản\nXác định người thừa kế")
        await pg.click("text=+ Thêm bài"); await pg.wait_for_timeout(700); await pg.click("text=+ Thêm bài"); await pg.wait_for_timeout(700)
        await pg.click("button:text-is('+ Tài liệu') >> nth=0"); await pg.click("dialog .asset >> nth=0"); await pg.click("dialog button:text-is('Chọn')"); await pg.wait_for_timeout(600)
        await pg.click("text=Nhập nhanh nhiều câu từ văn bản")
        await pg.fill("details textarea", "Câu 1. Di sản gồm?\n*A. Tài sản riêng của người chết\nB. Chỉ nợ\nGiải thích: Điều 612\nCâu 2. Thời điểm mở thừa kế?\nA. Ngày lập di chúc\nB. Lúc người có tài sản chết\nĐáp án: B\nCâu 3. Người thừa kế là cá nhân phải?\nA. Còn sống vào thời điểm mở thừa kế *\nB. Đủ 18 tuổi")
        await pg.click("text=Thêm vào bài kiểm tra"); await pg.wait_for_timeout(400)
        await pg.get_by_role('button', name='Lưu', exact=False).first.click(); await pg.wait_for_timeout(1000)
        await pg.click("button:text-is('Kiểm tra')"); await pg.wait_for_selector("text=2 bài", timeout=20000)
        await pg.screenshot(path=f"{S}/el-editor.png", full_page=True)
        async with cx.expect_page() as np:
            await pg.click("text=Xem thử như người học")
        pv = await np.value; pv.on("pageerror", lambda e: errs.append("preview:" + str(e)))
        await pv.wait_for_load_state(); await pv.wait_for_timeout(800)
        await pv.click("text=Bắt đầu học"); await pv.wait_for_timeout(500)
        await pv.evaluate("document.querySelector('video').muted=true;document.querySelector('video').play()")
        await pv.wait_for_selector(".ov:not([hidden])", timeout=15000); await pv.click(".opt >> nth=0"); await pv.wait_for_timeout(300)
        await pv.screenshot(path=f"{S}/el-preview.png")
        await pv.close()
        async with pg.expect_download(timeout=120000) as dl:
            await pg.click("text=Tải gói SCORM 1.2")
        d = await dl.value; zp = "/tmp/scorm.zip"; await d.save_as(zp)
        async with pg.expect_download(timeout=120000) as dl2:
            await pg.click("text=Tải gói web (HTML)")
        await (await dl2.value).save_as("/tmp/web.zip")
        z = zipfile.ZipFile(zp); names = z.namelist()
        assert {"imsmanifest.xml", "index.html", "pns-lesson.js", "media/bai-01.mp4", "media/bai-02.vtt"} <= set(names), names
        assert any(n.startswith("files/bai-01/") for n in names) and "imsmanifest.xml" not in zipfile.ZipFile("/tmp/web.zip").namelist()
        man = z.read("imsmanifest.xml").decode(); assert "<adlcp:masteryscore>70</adlcp:masteryscore>" in man and 'href="media/bai-01.mp4"' in man
        shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT + "/pkg"); z.extractall(OUT + "/pkg")
        open(OUT + "/index.html", "w").write(HARNESS)
        lms = await cx.new_page(); lms.on("pageerror", lambda e: errs.append("lms:" + str(e)))
        await lms.goto("http://127.0.0.2:8099/scormtest/index.html"); await lms.wait_for_timeout(1200)
        fr = lms.frame_locator("#f")
        await fr.locator("text=Bắt đầu học").click(); await lms.wait_for_timeout(400)
        for k in range(2):
            frame = lms.frames[1]
            await frame.evaluate("document.querySelector('video').muted=true;document.querySelector('video').play()")
            await fr.locator(".ov:not([hidden]) .opt >> nth=1").click(timeout=15000)   # trả lời sai vẫn tính đã trả lời
            await fr.locator("text=Tiếp tục xem").click()
            await frame.wait_for_function("document.querySelector('video').ended", timeout=20000); await lms.wait_for_timeout(600)
            await fr.locator("button:has-text('Bài tiếp theo'), button:has-text('Làm bài kiểm tra')").first.click(); await lms.wait_for_timeout(500)
        st = await lms.evaluate("D['cmi.core.lesson_status']")
        assert st == "incomplete", st
        frame = lms.frames[1]
        for i, ans in enumerate([0, 1, 0]):
            await frame.locator(f"fieldset >> nth={i} >> input[type=radio] >> nth={ans}").check()
        await fr.locator("button:text-is('Nộp bài')").click(); await lms.wait_for_timeout(800)
        await lms.screenshot(path=f"{S}/el-lms.png")
        res = await lms.evaluate("({s:D['cmi.core.lesson_status'],r:D['cmi.core.score.raw'],sd:D['cmi.suspend_data'].length,init:calls[0][0]})")
        print("LMS:", res)
        assert res["s"] == "passed" and res["r"] == "100" and res["init"] == "init"
        await lms.reload(); await lms.wait_for_timeout(1000)   # vào lại: LMS trả suspend_data → tiến độ giữ nguyên
        print("ERRORS:", errs)
        await b.close()
asyncio.run(main())
