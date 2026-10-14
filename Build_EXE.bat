@echo off
chcp 65001 >nul
echo ========================================================
echo   กำลังสร้างโปรแกรม FoodPOS.exe (Single-file Portable)...
echo ========================================================
echo.

if exist "build" rmdir /s /q "build"
if exist "dist\FoodPOS" rmdir /s /q "dist\FoodPOS"

python -m PyInstaller --noconsole --name "FoodPOS" --icon "img/icon.ico" --onefile ^
  --add-data "index.html;." ^
  --add-data "order.html;." ^
  --add-data "kitchen.html;." ^
  --add-data "style.css;." ^
  --add-data "script.js;." ^
  --add-data "api.js;." ^
  --add-data "qrcode.min.js;." ^
  --add-data "img;img" ^
  --clean app.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ผิดพลาด] การสร้างไฟล์ .exe ไม่สำเร็จ
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo กำลังจัดเตรียมโฟลเดอร์ FoodPOS สำเร็จรูป...
if not exist "dist\FoodPOS" mkdir "dist\FoodPOS"
move /y "dist\FoodPOS.exe" "dist\FoodPOS\" >nul
copy /y "backend\pos.db" "dist\FoodPOS\" >nul
if exist "backend\cloudflared.exe" copy /y "backend\cloudflared.exe" "dist\FoodPOS\" >nul

echo.
echo ========================================================
echo   [สำเร็จ] สร้างโปรแกรม FoodPOS เรียบร้อยแล้ว!
echo   โฟลเดอร์: dist\FoodPOS\
echo    - FoodPOS.exe
echo    - pos.db
echo    - cloudflared.exe
echo ========================================================
echo.
pause
