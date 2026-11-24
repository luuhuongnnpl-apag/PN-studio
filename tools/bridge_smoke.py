# Kiểm thử đầu-cuối: bản web (chế độ trình duyệt) sinh giọng AI qua PNS Engine trên máy.
# Chuẩn bị: Engine thử nghiệm  PNS_DATA=/tmp/pnsbr PNS_TEST_TTS=1 PNS_PORT=7861 PNS_WEB_ORIGINS=http://127.0.0.2:8099 python engine/run.py --no-browser
#           Web tĩnh          python -m http.server --bind 127.0.0.2 8099 -d <thư mục chứa PN-studio>
#           Mẫu giọng         /tmp/uifx/voice.wav (≥ 3 giây)
import asyncio, re, urllib.request
from playwright.async_api import async_playwright
ENG = "http://127.0.0.1:7861"; WEB = "http://127.0.0.2:8099/PN-studio/web/"; S = "/tmp/shots"

def engine_key():
    html = urllib.request.urlopen(ENG + "/").read().decode()
    tok = re.search(r'name="pns-token" content="([^"]+)"', html).group(1)
    req = urllib.request.Request(ENG + "/api/bridge", headers={"X-PNS-Token": tok})
    import json; return json.loads(urllib.request.urlopen(req).read())["key"]

async def main():
    key = engine_key(); errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        cx = await b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        pg = await cx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("response", lambda r: r.status >= 400 and errs.append(f"{r.status} {r.url}")); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        await pg.goto(WEB + f"#/settings?bridge={key}&engine={ENG}"); await pg.wait_for_timeout(1500)
        assert "bridge=" not in pg.url, "khóa phải được xóa khỏi URL"
        await pg.wait_for_selector("text=Đã kết nối PNS Engine", timeout=10000)
        await pg.screenshot(path=f"{S}/br-settings.png", full_page=True)
        # Voice Studio: thêm mẫu, sinh câu thử
        await pg.goto(WEB + "#/voice"); await pg.wait_for_timeout(1000)
        await pg.set_input_files("input[type=file][accept^='.wav']", "/tmp/uifx/voice.wav")
        await pg.fill("input[placeholder='Họ tên người sở hữu giọng']", "Giảng viên A")
        await pg.check("label.check input[type=checkbox]")
        await pg.click("button:text-is('Lưu mẫu giọng')"); await pg.wait_for_selector("button:text-is('Sinh câu thử')", timeout=10000)
        await pg.click("button:text-is('Sinh câu thử')")
        await pg.wait_for_selector("text=Văn bản đã đọc", timeout=30000)
        await pg.screenshot(path=f"{S}/br-voice.png", full_page=True)
        # Dự án 2 cảnh giọng AI → kết xuất 1080p (tự sinh giọng qua Engine)
        res = await pg.evaluate("""async()=>{const A=await import(new URL('js/api.js',location.href).href);
          const v=(await A.get('api/voices')).voices[0];
          let p=await A.post('api/projects',{title:'Thừa kế – giọng AI qua Engine',scenes:[
            {title:'Di sản',scriptOriginal:'Theo Điều 612 BLDS năm 2015, di sản gồm tài sản riêng của người chết.',audioMode:'tts',voiceId:v.id},
            {title:'Người thừa kế',scriptOriginal:'Người thừa kế phải còn sống vào thời điểm mở thừa kế.',audioMode:'tts',voiceId:v.id}]});
          const stale1=p.scenes.map(s=>s.audioStale);
          const j=await A.waitJob(await A.post(`api/projects/${p.id}/render`,{quality:'preview'}));
          p=await A.get('api/projects/'+p.id);
          const r=(await A.get(`api/projects/${p.id}/renders`))[0];
          // đổi lời giảng cảnh 2 → chỉ cảnh 2 cũ
          p.scenes[1].scriptOriginal+=' Đây là câu bổ sung.'; p=await A.put('api/projects/'+p.id,p);
          return {stale1, job:j.status+' '+(j.error||''), ai:r.aiNarration, spoken:p.scenes[0].spokenText, stale2:p.scenes.map(s=>s.audioStale), pid:p.id}}""")
        print(res)
        assert res["stale1"] == [True, True] and res["job"].startswith("done") and res["ai"] is True
        assert "Bộ luật Dân sự" in res["spoken"] and res["stale2"] == [False, True]
        await pg.goto(WEB + f"#/lecture/{res['pid']}"); await pg.wait_for_timeout(1500)
        await pg.click(".scene >> nth=1"); await pg.wait_for_timeout(500)
        await pg.screenshot(path=f"{S}/br-lecture.png", full_page=True)
        await pg.click("button:text-is('Tạo giọng AI cảnh này')"); await pg.wait_for_timeout(4000)
        st = await pg.evaluate("""async(pid)=>{const A=await import(new URL('js/api.js',location.href).href);return (await A.get('api/projects/'+pid)).scenes.map(s=>s.audioStale)}""", res["pid"])
        assert st == [False, False], st
        print("ERRORS:", errs)
        await b.close()
asyncio.run(main())
