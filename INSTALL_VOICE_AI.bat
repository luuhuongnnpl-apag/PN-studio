@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Hay chay START_PNS.bat mot lan truoc.
  pause & exit /b 1
)
echo Cai giong AI VieNeu-TTS (Apache-2.0, chay CPU, khong can API tra phi).
echo Lan dau can Internet; trong so model (~vai tram MB) tai khi sinh giong lan dau.
".venv\Scripts\python.exe" -m pip install -r engine\requirements-voice.txt
if errorlevel 1 (
  echo [LOI] Cai VieNeu-TTS that bai. Giong thu am that van dung binh thuong.
  pause & exit /b 1
)
".venv\Scripts\python.exe" -c "import vieneu, importlib.metadata as m; print('VieNeu', m.version('vieneu'), 'OK')"
echo Xong. Dong cua so Engine dang chay (neu co) roi mo lai START_PNS.bat.
pause
