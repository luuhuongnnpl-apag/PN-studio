@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Phuc Nguyen Studio Engine
cd /d "%~dp0"

rem ---- File .bat phai nam canh thu muc engine; tu tim neu dat o thu muc cha ----
if not exist "engine\run.py" if exist "phuc-nguyen-studio\engine\run.py" cd /d "%~dp0phuc-nguyen-studio"
if not exist "engine\run.py" (
  echo [LOI] Khong thay thu muc engine canh START_PNS.bat.
  echo Hay dat START_PNS.bat vao thu muc ma nguon PNS - noi co hai thu muc engine va web - roi chay lai.
  echo Thu muc hien tai: %CD%
  pause
  exit /b 1
)

rem ---- Da co moi truong rieng va pip con tot thi dung luon; hong thi tao lai ----
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -m pip --version >nul 2>&1
  if errorlevel 1 (
    echo Moi truong Python cu bi hong, dang xoa de tao lai...
    rmdir /s /q ".venv"
  ) else (
    goto install
  )
)

rem ---- Tim Python 3.11 - 3.13 (uu tien 3.12) ----
set "PY="
for %%V in (3.12 3.11 3.13) do (
  if not defined PY (
    py -%%V -c "import sys" >nul 2>&1 && set "PY=py -%%V"
  )
)
if not defined PY (
  python -c "import sys; sys.exit(0 if (3,11)<=sys.version_info[:2]<=(3,13) else 1)" >nul 2>&1 && set "PY=python"
)
for %%D in ("%LOCALAPPDATA%\Programs\Python\Python312" "%LOCALAPPDATA%\Programs\Python\Python311" "%ProgramFiles%\Python312" "%ProgramFiles%\Python311") do (
  if not defined PY if exist "%%~D\python.exe" set "PY="%%~D\python.exe""
)
if defined PY goto mkvenv

echo [!] Chua tim thay Python 3.11, 3.12 hoac 3.13 tren may.
py -0p 2>nul
echo.
where winget >nul 2>&1
if errorlevel 1 goto manual
choice /c YN /m "Cai tu dong Python 3.12 cho tai khoan nay bang winget"
if errorlevel 2 goto manual
winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
  set "PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
  goto mkvenv
)
echo [LOI] Cai Python tu dong khong thanh cong.

:manual
echo Cai thu cong: https://www.python.org/downloads/windows/ - chon ban 3.12.x "Windows installer 64-bit",
echo tick "Add python.exe to PATH", cai xong dong cua so nay va chay lai START_PNS.bat.
pause
exit /b 1

:mkvenv
echo Dang tao moi truong Python rieng cho PNS...
%PY% -m venv .venv
if errorlevel 1 goto fail
".venv\Scripts\python.exe" -m pip --version >nul 2>&1 || ".venv\Scripts\python.exe" -m ensurepip --upgrade

:install
rem ---- Cai/cap nhat thu vien khi requirements thay doi ----
fc /b "engine\requirements.txt" ".venv\pns-req.txt" >nul 2>&1
if errorlevel 1 (
  echo Dang cai thu vien PNS - lan dau can Internet, khoang 2-5 phut...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r engine\requirements.txt
  if errorlevel 1 goto fail
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
