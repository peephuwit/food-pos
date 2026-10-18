@echo off
chcp 65001 >nul
title Food POS
cd /d "%~dp0"

echo ==========================================
echo   กำลังเริ่มระบบ Food POS...
echo ==========================================

REM 1. ตรวจสอบ Virtual Environment ในโฟลเดอร์โปรเจกต์
if exist ".venv\Scripts\pythonw.exe" (
    start "" ".venv\Scripts\pythonw.exe" app.py
    exit /b 0
)
if exist ".venv\Scripts\python.exe" (
    start "" ".venv\Scripts\python.exe" app.py
    exit /b 0
)
if exist "venv\Scripts\pythonw.exe" (
    start "" "venv\Scripts\pythonw.exe" app.py
    exit /b 0
)
if exist "venv\Scripts\python.exe" (
    start "" "venv\Scripts\python.exe" app.py
    exit /b 0
)

REM 2. ตรวจสอบ Python ในระบบ (pythonw หรือ python)
where pythonw >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "" pythonw app.py
    exit /b 0
)

where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    start "" python app.py
    exit /b 0
)

REM 3. ถ้าไม่มี Python ให้ตรวจสอบตัวรันสำเร็จรูป FoodPOS.exe
if exist "dist\FoodPOS\FoodPOS.exe" (
    start "" "dist\FoodPOS\FoodPOS.exe"
    exit /b 0
)

echo.
echo [ข้อผิดพลาด] ไม่พบ Python หรือไฟล์โปรแกรม FoodPOS.exe ในเครื่อง
echo กรุณาติดตั้ง Python 3 หรือรัน Build_EXE.bat เพื่อสร้างไฟล์โปรแกรม
echo.
pause
exit /b 1
