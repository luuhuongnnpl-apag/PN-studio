@echo off
chcp 65001 >nul
setlocal
title Phuc Nguyen Studio Engine
cd /d "%~dp0"

rem ---- Tim Python 3.11/3.12 (khuyen nghi 3.11) ----
set "PY="
py -3.11 -c "import sys" >nul 2>&1 && set "PY=py -3.11"
if not defined PY py -3.12 -c "import sys" >nul 2>&1 && set "PY=py -3.12"
if not defined PY (
  echo [LOI] Chua co Python 3.11 hoac 3.12.
  echo Tai tai https://www.python.org/downloads/windows/ - khi cai, tick "Add python.exe to PATH".
  pause & exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Dang tao moi truong Python rieng cho PNS...
  %PY% -m venv .venv || goto fail
)

rem ---- Cai/cap nhat thu vien khi requirements thay doi ----
fc /b "engine\requirements.txt" ".venv\pns-req.txt" >nul 2>&1
if errorlevel 1 (
  echo Dang cai thu vien PNS - lan dau can Internet, khoang 2-5 phut...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r engine\requirements.txt || goto fail
  copy /y "engine\requirements.txt" ".venv\pns-req.txt" >nul
)

".venv\Scripts\python.exe" engine\run.py %*
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo [LOI] PNS Engine khong khoi dong duoc. Xem thong bao phia tren
echo va file log trong %%LOCALAPPDATA%%\PhucNguyenStudio\logs\engine.log
pause
exit /b 1
