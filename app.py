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
SERVER_URL = f"http://127.0.0.1:{PORT}"
APP_TITLE = "Food POS — ระบบจัดการร้านอาหาร & แคชเชียร์"
ICON_PATH = BUNDLE_DIR / "img" / ("icon.icns" if sys.platform == "darwin" and (BUNDLE_DIR / "img" / "icon.icns").exists() else "icon.ico")

try:
    import backend.server
except ImportError:
    pass

def log_error(err):
    try:
        if getattr(sys, 'frozen', False) and sys.platform == "darwin":
            log_dir = Path.home() / "Library" / "Logs" / "FoodPOS"
        else:
            log_dir = BASE_DIR
        log_dir.mkdir(parents=True, exist_ok=True)
        with open(log_dir / "error.log", "a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now()}] {err}\n")
    except Exception:
        pass

def is_server_running(port=PORT):
    """ตรวจสอบว่า Backend Server รันและตอบสนอง HTTP สำเร็จหรือไม่"""
    try:
        import urllib.request
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1.0) as r:
            return r.status == 200
    except Exception:
        return False

def free_port_if_stuck(port=PORT):
    """เคลียร์ process ซอมบี้ที่ค้างบน port ถ้า server ไม่ตอบสนอง HTTP"""
    try:
        if sys.platform != 'win32':
            import subprocess
            out = subprocess.check_output(['lsof', '-ti', f':{port}'], text=True).strip()
            for pid_str in out.split():
                if pid_str and int(pid_str) != os.getpid():
                    os.kill(int(pid_str), 9)
    except Exception:
        pass

def start_backend():
    """สตาร์ท Backend Server ใน Thread เบื้องหลังถ้ายังไม่รัน"""
    if is_server_running(PORT):
        print(f"[*] Backend server is already running on {SERVER_URL}")
        return

    # ถ้าพอร์ตถูกกุมไว้แต่ไม่ตอบสนอง HTTP ให้เคลียร์ process ซอมบี้ก่อน
    free_port_if_stuck(PORT)

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

    # รอจนกว่า Server จะพร้อมตอบสนอง (สูงสุด 12 วินาที)
    start_time = time.time()
    while time.time() - start_time < 12:
        if is_server_running(PORT):
            time.sleep(0.3)
            print("[+] Backend server is ready!")
            return
        time.sleep(0.1)
    print("[!] Server startup wait timed out, proceeding to open window.")
    log_error("Server startup wait timed out after 12 seconds.")

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
        background_color='#ffffff',
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
