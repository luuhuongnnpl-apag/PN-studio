@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Hay chay START_PNS.bat mot lan truoc.
  pause & exit /b 1
)
echo Cai giong AI VieNeu-TTS (Apache-2.0, chay CPU, khong can API tra phi).
echo Lan dau can Internet: cai thu vien, sau do tai trong so model (vai tram MB) tu huggingface.co.
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r engine\requirements-voice.txt
if errorlevel 1 (
  echo [LOI] Cai VieNeu-TTS that bai. Giong thu am that van dung binh thuong.
  pause & exit /b 1
)
echo.
echo Dang tai model va chay thu mot cau (1-5 phut lan dau)...
".venv\Scripts\python.exe" engine\warmup_voice.py v3turbo
if errorlevel 1 (
  echo [!] Thu vien da cai nhung chua tai/chay duoc model. Kiem tra Internet roi chay lai file nay.
  pause & exit /b 1
)
echo.
echo Xong. Dong cua so Engine dang chay (neu co) roi mo lai START_PNS.bat.
echo Engine se tu nap san giong AI khi khoi dong de lan sinh dau tien nhanh hon.
pause
