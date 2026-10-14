"""
app.py — Desktop App Launcher สำหรับระบบ POS ร้านอาหาร (Food POS)
- รันผ่าน pywebview ด้วย Microsoft Edge WebView2 Engine
- ตรวจสอบและเริ่ม Backend Server (Multi-threaded Python + SQLite) อัตโนมัติ
- รองรับ icon.ico สำหรับ Taskbar และ Window Frame
"""

import sys
import os

# ป้องกัน crash ใน PyInstaller --noconsole (sys.stdout/stderr เป็น None)
class _NullWriter:
    def write(self, *args, **kwargs): pass
    def flush(self, *args, **kwargs): pass

if sys.stdout is None:
    sys.stdout = _NullWriter()
if sys.stderr is None:
    sys.stderr = _NullWriter()

import time
import datetime
import socket
import threading
from pathlib import Path

# พาธรากของโปรเจกต์ (รองรับทั้งตอนรัน python ปกติ และตอนแพ็กเป็น .exe)
if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    BUNDLE_DIR = Path(sys._MEIPASS)
    BASE_DIR = Path(sys.executable).resolve().parent
else:
    BUNDLE_DIR = Path(__file__).resolve().parent
    BASE_DIR = BUNDLE_DIR

sys.path.insert(0, str(BUNDLE_DIR))
sys.path.insert(0, str(BASE_DIR))

PORT = 8000
SERVER_URL = f"http://localhost:{PORT}"
APP_TITLE = "Food POS — ระบบจัดการร้านอาหาร & แคชเชียร์"
ICON_PATH = BUNDLE_DIR / "img" / "icon.ico"

def log_error(err):
    try:
        with open(BASE_DIR / "error.log", "a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now()}] {err}\n")
    except Exception:
        pass

def is_server_running(port=PORT):
    """ตรวจสอบว่า Backend Server รันอยู่แล้วหรือไม่ผ่าน Socket Connect"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            return s.connect_ex(('127.0.0.1', port)) == 0
    except Exception:
        return False

def start_backend():
    """สตาร์ท Backend Server ใน Thread เบื้องหลังถ้ายังไม่รัน"""
    if is_server_running(PORT):
        print(f"[*] Backend server is already running on {SERVER_URL}")
        return

    print(f"[*] Starting POS backend server on {SERVER_URL}...")
    def _run():
        try:
            from backend.server import run_server
            run_server(PORT)
        except Exception as e:
            import traceback
            log_error(f"Server crash: {traceback.format_exc()}")

    server_thread = threading.Thread(target=_run, daemon=True)
    server_thread.start()

    # รอจนกว่า Server จะพร้อมตอบสนอง (สูงสุด 5 วินาที)
    start_time = time.time()
    while time.time() - start_time < 5:
        if is_server_running(PORT):
            time.sleep(0.3)
            print("[+] Backend server is ready!")
            return
        time.sleep(0.1)
    print("[!] Server startup wait timed out, proceeding to open window.")
    log_error("Server startup wait timed out after 5 seconds.")

def main():
    # 1. สตาร์ท Backend
    start_backend()

    # 2. นำเข้า pywebview
    import webview

    # 3. สร้างหน้าต่างหลักของแอพพลิเคชัน
    window = webview.create_window(
        title=APP_TITLE,
        url=SERVER_URL,
        width=1280,
        height=820,
        min_size=(1024, 680),
        resizable=True,
        fullscreen=False,
        background_color='#0f172a',
        text_select=True,
        zoomable=True
    )

    # 4. กำหนดไอคอนถ้ามีไฟล์ icon.ico
    icon_arg = str(ICON_PATH) if ICON_PATH.exists() else None

    # 5. เปิดหน้าต่าง Desktop App
    print("[*] Launching Food POS Desktop Window...")
    try:
        webview.start(icon=icon_arg, private_mode=False)
    finally:
        try:
            from backend.tunnel import stop_tunnel
            stop_tunnel()
        except Exception:
            pass

if __name__ == "__main__":
    main()
