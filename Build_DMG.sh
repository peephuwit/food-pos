#!/usr/bin/env bash
set -e

# ========================================================
#   Build_DMG.sh — สร้างตัวติดตั้ง macOS (.app & .dmg)
# ========================================================

echo "========================================================"
echo "  กำลังสร้างโปรแกรม FoodPOS.app สำหรับ macOS..."
echo "========================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. ค้นหา Python / Virtualenv
if [ -f ".venv/bin/python" ]; then
    PYTHON=".venv/bin/python"
    PYINSTALLER=".venv/bin/pyinstaller"
else
    PYTHON="python3"
    PYINSTALLER="pyinstaller"
fi

# ตรวจสอบ PyInstaller
if ! command -v "$PYINSTALLER" >/dev/null 2>&1 && [ ! -f "$PYINSTALLER" ]; then
    echo "[!] PyInstaller not found. Installing via uv / pip..."
    if command -v uv >/dev/null 2>&1; then
        uv pip install pyinstaller
    else
        $PYTHON -m pip install pyinstaller
    fi
fi

# 2. สร้าง icon.icns ถ้ายังไม่มี
if [ ! -f "img/icon.icns" ] && [ -f "img/icon.ico" ]; then
    echo "[*] กำลังแปลง icon.ico เป็น icon.icns..."
    $PYTHON -c "
import os, subprocess
from PIL import Image
ico = Image.open('img/icon.ico')
iconset = 'img/icon.iconset'
os.makedirs(iconset, exist_ok=True)
for s in [16, 32, 64, 128, 256, 512]:
    ico.resize((s, s), Image.Resampling.LANCZOS).save(f'{iconset}/icon_{s}x{s}.png')
    if s * 2 <= 1024:
        ico.resize((s * 2, s * 2), Image.Resampling.LANCZOS).save(f'{iconset}/icon_{s}x{s}@2x.png')
subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', 'img/icon.icns'], check=True)
import shutil
shutil.rmtree(iconset)
"
fi

# 3. เตรียม cloudflared binary
CLOUDFLARED_BIN=""
if command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED_BIN="$(command -v cloudflared)"
elif [ -f "/opt/homebrew/bin/cloudflared" ]; then
    CLOUDFLARED_BIN="/opt/homebrew/bin/cloudflared"
elif [ -f "/usr/local/bin/cloudflared" ]; then
    CLOUDFLARED_BIN="/usr/local/bin/cloudflared"
elif [ -f "cloudflared" ]; then
    CLOUDFLARED_BIN="$(pwd)/cloudflared"
fi

CLOUDFLARED_ARG=""
if [ -n "$CLOUDFLARED_BIN" ] && [ -f "$CLOUDFLARED_BIN" ]; then
    echo "[*] พ่วง cloudflared binary ($CLOUDFLARED_BIN) เข้าในตัวแอพ"
    CLOUDFLARED_ARG="--add-binary $CLOUDFLARED_BIN:."
fi

# 4. ล้าง build เก่า
rm -rf build dist/FoodPOS dist/FoodPOS.app dist/FoodPOS.dmg dist/dmg_staging

# 5. สั่ง PyInstaller สร้าง FoodPOS.app
echo "[*] กำลังคอมไพล์ด้วย PyInstaller..."
"$PYINSTALLER" --noconfirm --clean --windowed \
    --name "FoodPOS" \
    --icon "img/icon.icns" \
    --osx-bundle-identifier "com.foodpos.app" \
    --add-data "index.html:." \
    --add-data "order.html:." \
    --add-data "kitchen.html:." \
    --add-data "style.css:." \
    --add-data "script.js:." \
    --add-data "api.js:." \
    --add-data "qrcode.min.js:." \
    --add-data "img:img" \
    --add-data "backend/pos.db:backend" \
    $CLOUDFLARED_ARG \
    app.py

# 6. ตรวจสอบว่า FoodPOS.app ถูกสร้างสำเร็จหรือไม่
if [ ! -d "dist/FoodPOS.app" ]; then
    echo "[X] สร้าง FoodPOS.app ไม่สำเร็จ"
    exit 1
fi

# Ad-hoc sign app bundle
echo "[*] Ad-hoc codesigning FoodPOS.app..."
codesign --force --deep --sign - "dist/FoodPOS.app" 2>/dev/null || true

# 7. จัดเตรียมโฟลเดอร์สำหรับสร้าง DMG (พร้อม Drag-to-Applications)
echo "[*] กำลังสร้างไฟล์ DMG ด้วย hdiutil..."
mkdir -p dist/dmg_staging
cp -R "dist/FoodPOS.app" dist/dmg_staging/
ln -s /Applications dist/dmg_staging/Applications

# สร้าง DMG
hdiutil create -volname "FoodPOS" \
    -srcfolder dist/dmg_staging \
    -ov -format UDZO \
    "dist/FoodPOS.dmg"

# สร้าง ZIP สำหรับผู้ที่ต้องการดาวน์โหลดแบบ .zip
echo "[*] กำลังสร้างไฟล์ ZIP สำหรับ macOS..."
ditto -c -k --sequesterRsrc --keepParent dist/FoodPOS.app dist/FoodPOS-macOS.zip
cp dist/FoodPOS-macOS.zip dist/FoodPOS.zip

# ล้าง staging folder และโฟลเดอร์ build ชั่วคราว
rm -rf dist/dmg_staging dist/FoodPOS

echo ""
echo "========================================================"
echo "  [สำเร็จ] สร้างไฟล์ DMG และ ZIP เรียบร้อยแล้ว!"
echo "  ไฟล์พร้อมนำไปอัปโหลดขึ้น GitHub Release:"
echo "  -> $(pwd)/dist/FoodPOS.dmg"
echo "  -> $(pwd)/dist/FoodPOS-macOS.zip"
ls -lh dist/FoodPOS.dmg dist/FoodPOS-macOS.zip
echo "========================================================"
