"""
tunnel.py — Cloudflare Tunnel Manager สำหรับระบบ Food POS
- สตาร์ท cloudflared.exe แบบ Quick Tunnel อัตโนมัติในเบื้องหลัง
- สกัด Public HTTPS URL (เช่น https://xxxx.trycloudflare.com)
- สั่งปิด Tunnel อัตโนมัติเมื่อปิดโปรแกรม
"""

import os
import sys
import subprocess
import threading
import time
import re
import shutil
import atexit
from pathlib import Path

def resolve_cloudflared_bin():
    if getattr(sys, 'frozen', False):
        exe_dir = Path(sys.executable).resolve().parent
    else:
        exe_dir = Path(__file__).resolve().parent
        if exe_dir.name == "backend":
            exe_dir = exe_dir.parent

    if sys.platform == "win32":
        if (exe_dir / "cloudflared.exe").exists():
            return exe_dir / "cloudflared.exe"
        if (exe_dir / "backend" / "cloudflared.exe").exists():
            return exe_dir / "backend" / "cloudflared.exe"
        return exe_dir / "cloudflared.exe"
    else:
        if getattr(sys, 'frozen', False):
            if hasattr(sys, '_MEIPASS'):
                bundle_bin = Path(sys._MEIPASS) / "cloudflared"
                if bundle_bin.exists():
                    return bundle_bin
            mac_frameworks_bin = Path(sys.executable).resolve().parent.parent / "Frameworks" / "cloudflared"
            if mac_frameworks_bin.exists():
                return mac_frameworks_bin
        if (exe_dir / "cloudflared").exists():
            return exe_dir / "cloudflared"
        found_bin = shutil.which("cloudflared")
        if found_bin:
            return Path(found_bin)
        for p in ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"]:
            if Path(p).exists():
                return Path(p)
        return exe_dir / "cloudflared"

CLOUDFLARED_BIN = resolve_cloudflared_bin()

CURRENT_TUNNEL_URL = None
_tunnel_proc = None
_tunnel_lock = threading.Lock()

def kill_orphaned_cloudflared():
    try:
        if sys.platform != 'win32':
            subprocess.run(['pkill', '-f', 'cloudflared tunnel'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(0.2)
        else:
            subprocess.run(['taskkill', '/F', '/IM', 'cloudflared.exe'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def _tunnel_worker():
    global CURRENT_TUNNEL_URL, _tunnel_proc
    if not CLOUDFLARED_BIN.exists():
        print(f"[Tunnel] cloudflared binary not found at {CLOUDFLARED_BIN}")
        return

    # เคลียร์โปรเซส cloudflared เก่าที่อาจตกค้างจากการปิดโปรแกรมครั้งก่อน
    kill_orphaned_cloudflared()

    cmd = [
        str(CLOUDFLARED_BIN),
        "tunnel",
        "--protocol", "http2",
        "--url", "http://127.0.0.1:8000",
        "--no-autoupdate"
    ]

    try:
        # กำหนด startupinfo บน Windows เพื่อซ่อนหน้าต่าง cmd ของ cloudflared
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = 0  # SW_HIDE

        _tunnel_proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            startupinfo=startupinfo
        )
        print("[Tunnel] Starting Cloudflare Tunnel process...")

        # อ่าน stderr เพื่อหา URL ของ trycloudflare.com
        url_found = False
        start_time = time.time()
        while time.time() - start_time < 25 and _tunnel_proc.poll() is None:
            line = _tunnel_proc.stderr.readline()
            if not line:
                time.sleep(0.1)
                continue

            match = re.search(r'https://[a-zA-Z0-9-]+\.trycloudflare\.com', line)
            if match:
                CURRENT_TUNNEL_URL = match.group(0)
                url_found = True
                print("=" * 60)
                print(f"[Tunnel] Public Cloudflare HTTPS URL Ready!")
                print(f"[Tunnel] Online URL: {CURRENT_TUNNEL_URL}")
                print(f"[Tunnel] Customers on 4G/5G can scan QR to order now!")
                print("=" * 60)
                break

        if not url_found:
            print("[Tunnel] Warning: Could not find trycloudflare URL within timeout.")

        # รัน loop ต่อไปเพื่อเคลียร์ stderr buffer ป้องกัน process ค้าง
        while _tunnel_proc and _tunnel_proc.poll() is None:
            _tunnel_proc.stderr.readline()
            time.sleep(1)

    except Exception as e:
        print(f"[Tunnel Error] {e}")

def start_tunnel():
    """เริ่มรัน Cloudflare Tunnel ใน Background Thread"""
    global _tunnel_proc
    with _tunnel_lock:
        if _tunnel_proc and _tunnel_proc.poll() is None:
            return CURRENT_TUNNEL_URL
        t = threading.Thread(target=_tunnel_worker, daemon=True)
        t.start()
        # รอให้ URL พร้อม (สูงสุด 8 วินาที)
        start = time.time()
        while time.time() - start < 8:
            if CURRENT_TUNNEL_URL:
                return CURRENT_TUNNEL_URL
            time.sleep(0.3)
        return CURRENT_TUNNEL_URL

def get_tunnel_url():
    """ดึง URL ปัจจุบันของ Tunnel (ถ้ามี)"""
    return CURRENT_TUNNEL_URL

def stop_tunnel():
    """หยุดการทำงานของ Cloudflare Tunnel"""
    global _tunnel_proc, CURRENT_TUNNEL_URL
    with _tunnel_lock:
        if _tunnel_proc and _tunnel_proc.poll() is None:
            try:
                _tunnel_proc.terminate()
                _tunnel_proc.wait(timeout=2)
            except Exception:
                try:
                    _tunnel_proc.kill()
                except Exception:
                    pass
            _tunnel_proc = None
            CURRENT_TUNNEL_URL = None
            print("[Tunnel] Cloudflare Tunnel stopped.")

atexit.register(stop_tunnel)
