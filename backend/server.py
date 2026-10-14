"""
food-pos Python Backend (Standard Library: http.server + sqlite3)
รองรับระบบร้านอาหาร Dine-in:
- จัดการ 4 โต๊ะ (โต๊ะ 1 - 4)
- รองรับการสั่งอาหารผ่าน QR / มือถือ (orderFromTable)
- สะสมยอดแต่ละโต๊ะ สั่งเพิ่มได้หลายรอบ
- แคชเชียร์ดูโต๊ะที่เปิดอยู่ (getActiveTables) และปิดบิลรับเงินทีหลัง (checkoutTable)
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

import json
import sqlite3
import datetime
import urllib.parse
import io
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
import threading

def resolve_db_path():
    if getattr(sys, 'frozen', False):
        exe_dir = Path(sys.executable).resolve().parent
    else:
        exe_dir = Path(__file__).resolve().parent
        if exe_dir.name == "backend":
            exe_dir = exe_dir.parent
    if (exe_dir / "pos.db").exists():
        return exe_dir / "pos.db"
    if (exe_dir / "backend" / "pos.db").exists():
        return exe_dir / "backend" / "pos.db"
    return exe_dir / "pos.db"

DB_PATH = resolve_db_path()

if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
    STATIC_DIR = Path(sys._MEIPASS)
else:
    STATIC_DIR = Path(__file__).resolve().parent
    if STATIC_DIR.name == "backend":
        STATIC_DIR = STATIC_DIR.parent

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # ตาราง Users
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'Staff'
            )
        """)
        
        # ตาราง Menu
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS menu (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                drive_id TEXT DEFAULT '',
                image_base64 TEXT DEFAULT ''
            )
        """)
        
        # ตาราง Orders (ขยายสถานะ: 'pending' = ยังไม่ชำระ/กำลังทาน, 'completed' = เช็กบิลแล้ว)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id TEXT PRIMARY KEY,
                time_str TEXT NOT NULL,
                table_name TEXT DEFAULT '-',
                items_json TEXT NOT NULL,
                total REAL NOT NULL,
                payment TEXT DEFAULT 'เงินสด',
                status TEXT DEFAULT 'completed',
                kitchen_status TEXT DEFAULT 'pending'
            )
        """)
        try:
            cursor.execute("ALTER TABLE orders ADD COLUMN kitchen_status TEXT DEFAULT 'pending'")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'ทานที่ร้าน'")
        except Exception:
            pass
        
        # ตารางโต๊ะอาหาร (Tables)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tables (
                table_id TEXT PRIMARY KEY,
                table_name TEXT NOT NULL,
                status TEXT DEFAULT 'available' -- available, occupied
            )
        """)
        
        # ใส่ Default User ถ้ายังไม่มี
        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 0:
            cursor.execute("INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
                           ('admin', '1234', 'Admin'))
            
        # สร้าง 4 โต๊ะตั้งต้น
        cursor.execute("SELECT COUNT(*) FROM tables")
        if cursor.fetchone()[0] == 0:
            for i in range(1, 5):
                cursor.execute("INSERT INTO tables (table_id, table_name, status) VALUES (?, ?, 'available')",
                               (f"T0{i}", f"โต๊ะ {i}"))
            
        # ใส่ Default Menu ตัวอย่างถ้ายังไม่มี
        cursor.execute("SELECT COUNT(*) FROM menu")
        if cursor.fetchone()[0] == 0:
            sample_items = [
                ('อาหารจานเดียว', 'ข้าวกะเพราหมูกรอบ + ไข่ดาว', 65.0, 1),
                ('อาหารจานเดียว', 'ข้าวผัดต้มยำกุ้ง', 70.0, 1),
                ('อาหารจานเดียว', 'ข้าวผัดคะน้าหมูกรอบ', 60.0, 1),
                ('เส้น/ก๋วยเตี๋ยว', 'ผัดไทยกุ้งสด', 75.0, 1),
                ('เส้น/ก๋วยเตี๋ยว', 'ราดหน้าหมูนุ่ม', 55.0, 1),
                ('เครื่องดื่ม', 'ชาไทยเย็น (สูตรโบราณ)', 35.0, 1),
                ('เครื่องดื่ม', 'กาแฟโบราณ (โอเลี้ยงยกล้อ)', 35.0, 1),
                ('เครื่องดื่ม', 'น้ำเก๊กฮวยเย็น', 25.0, 1),
                ('ของทานเล่น', 'เกี๊ยวทอดกรอบ', 40.0, 1),
                ('ของทานเล่น', 'ไก่ทอดสมุนไพร', 60.0, 1),
            ]
            cursor.executemany(
                "INSERT INTO menu (category, name, price, active) VALUES (?, ?, ?, ?)",
                sample_items
            )
        conn.commit()

# --- Business Logic ---

def check_login(username, password):
    u = str(username or "").strip()
    p = str(password or "")
    if not u or not p:
        return {"success": False, "message": "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน"}
        
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT username, role FROM users WHERE username = ? AND password = ?", (u, p))
        row = cur.fetchone()
        if row:
            return {"success": True, "username": row["username"], "role": row["role"]}
        return {"success": False, "message": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"}

def get_menu():
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, category, name, price, drive_id, image_base64 FROM menu WHERE active = 1")
        rows = cur.fetchall()
        result = []
        for r in rows:
            img = r["image_base64"] if r["image_base64"] else (f"https://lh3.googleusercontent.com/d/{r['drive_id']}" if r["drive_id"] else "")
            result.append({
                "id": r["id"],
                "category": r["category"],
                "name": r["name"],
                "price": float(r["price"]),
                "driveId": r["drive_id"] or "",
                "fileId": r["drive_id"] or "",
                "image": img,
                "imageUrl": img
            })
        return result

def get_all_menu_for_admin():
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, category, name, price, active, drive_id, image_base64 FROM menu")
        rows = cur.fetchall()
        result = []
        for r in rows:
            img = r["image_base64"] if r["image_base64"] else (f"https://lh3.googleusercontent.com/d/{r['drive_id']}" if r["drive_id"] else "")
            result.append({
                "id": r["id"],
                "category": r["category"],
                "name": r["name"],
                "price": float(r["price"]),
                "active": bool(r["active"]),
                "driveId": r["drive_id"] or "",
                "fileId": r["drive_id"] or "",
                "image": img,
                "imageUrl": img
            })
        return result

def add_menu_item(item):
    category = item.get("category", "ทั่วไป")
    name = item.get("name", "ไม่มีชื่อ")
    price = float(item.get("price", 0))
    drive_id = item.get("driveId", "")
    img_b64 = item.get("imageBase64", "")
    
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO menu (category, name, price, active, drive_id, image_base64) VALUES (?, ?, ?, 1, ?, ?)",
            (category, name, price, drive_id, img_b64)
        )
        conn.commit()
        return {"success": True, "id": cur.lastrowid}

def update_menu_item(item):
    item_id = item.get("id")
    category = item.get("category", "ทั่วไป")
    name = item.get("name", "ไม่มีชื่อ")
    price = float(item.get("price", 0))
    active = 1 if item.get("active", True) else 0
    drive_id = item.get("driveId", "")

    with get_db() as conn:
        cur = conn.cursor()
        if "imageBase64" in item:
            img_b64 = item.get("imageBase64") or ""
            cur.execute(
                "UPDATE menu SET category=?, name=?, price=?, active=?, drive_id=?, image_base64=? WHERE id=?",
                (category, name, price, active, drive_id, img_b64, item_id)
            )
        else:
            cur.execute(
                "UPDATE menu SET category=?, name=?, price=?, active=?, drive_id=? WHERE id=?",
                (category, name, price, active, drive_id, item_id)
            )
        conn.commit()
        if cur.rowcount > 0:
            return {"success": True}
        return {"success": False, "message": "ไม่พบเมนูนี้"}

def delete_menu_item(item_id):
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM menu WHERE id = ?", (item_id,))
        conn.commit()
        if cur.rowcount > 0:
            return {"success": True}
        return {"success": False, "message": "ไม่พบเมนูนี้"}

import socket

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# --- ระบบโต๊ะอาหาร & ออเดอร์ (Dine-in Workflow) ---

def get_tables():
    """ดึงข้อมูล 4 โต๊ะ พร้อมสถานะ ยอดเงินสะสม และ URL สั่งอาหารผ่าน QR (รองรับ Cloudflare Tunnel)"""
    local_ip = get_local_ip()
    tunnel_url = get_tunnel_url()
    base_order_url = tunnel_url if tunnel_url else f"http://{local_ip}:8000"

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT table_id, table_name, status FROM tables ORDER BY table_id ASC")
        tables = [dict(r) for r in cur.fetchall()]
        
        # คำนวณยอดเงินและรายการที่สั่งค้างอยู่สำหรับแต่ละโต๊ะ
        for t in tables:
            num = t["table_id"].replace("T0", "").replace("T", "")
            t["tableNumber"] = num
            t["orderUrl"] = f"{base_order_url}/order.html?table={num}"
            t["isPublic"] = bool(tunnel_url)
            t["tunnelUrl"] = tunnel_url or ""

            cur.execute("""
                SELECT order_id, items_json, total, time_str, order_type 
                FROM orders 
                WHERE table_name = ? AND status = 'pending'
                ORDER BY rowid ASC
            """, (t["table_name"],))
            pending_orders = cur.fetchall()
            
            total_bill = 0.0
            all_items = []
            has_takeaway = False
            for po in pending_orders:
                total_bill += float(po["total"])
                try:
                    all_items.extend(json.loads(po["items_json"]))
                except Exception:
                    pass
                try:
                    if "order_type" in po.keys() and po["order_type"] == "สั่งกลับบ้าน":
                        has_takeaway = True
                except Exception:
                    pass
            t["activeBillTotal"] = total_bill
            t["items"] = all_items
            t["orderCount"] = len(pending_orders)
            t["hasTakeaway"] = has_takeaway
            t["status"] = "occupied" if pending_orders else "available"
            
        return tables

def order_from_table(table_name, items, order_type="ทานที่ร้าน"):
    """ลูกค้าสั่งอาหารจากโต๊ะ (ผ่าน QR Code) - ยังไม่ชำระเงิน สถานะเป็น pending"""
    if not items:
        return {"success": False, "message": "ไม่มีรายการอาหารในออเดอร์"}
    if not order_type:
        order_type = "ทานที่ร้าน"
        
    now = datetime.datetime.now()
    time_str = now.strftime("%d/%m/%Y %H:%M:%S")
    order_id = "OD" + now.strftime("%y%m%d-%H%M%S") + f"-{now.microsecond // 1000:03d}"
    
    total = sum(float(it.get("price", 0)) * float(it.get("qty", 1)) for it in items)
    items_json = json.dumps(items, ensure_ascii=False)
    
    with get_db() as conn:
        cur = conn.cursor()
        # บันทึกเป็น pending สำหรับโต๊ะ และ pending สำหรับครัว พร้อมประเภทการสั่ง
        cur.execute("""
            INSERT INTO orders (order_id, time_str, table_name, items_json, total, payment, status, kitchen_status, order_type)
            VALUES (?, ?, ?, ?, ?, 'ยังไม่ชำระ', 'pending', 'pending', ?)
        """, (order_id, time_str, table_name, items_json, total, order_type))
        
        # อัปเดตสถานะโต๊ะเป็น occupied
        cur.execute("UPDATE tables SET status = 'occupied' WHERE table_name = ?", (table_name,))
        conn.commit()
        
    return {"success": True, "orderId": order_id, "time": time_str, "total": total, "table": table_name, "items": items, "orderType": order_type}

def checkout_table(table_name, payment_method="เงินสด"):
    """แคชเชียร์กดเช็กบิลโต๊ะ: รวมยอดบิล pending ทั้งหมด เปลี่ยนสถานะเป็น completed และเคลียร์โต๊ะ"""
    now = datetime.datetime.now()
    time_str = now.strftime("%d/%m/%Y %H:%M:%S")
    
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT order_id, items_json, total 
            FROM orders 
            WHERE table_name = ? AND status = 'pending'
        """, (table_name,))
        rows = cur.fetchall()
        
        if not rows:
            return {"success": False, "message": f"{table_name} ไม่มียอดค้างชำระ"}
            
        total_amount = sum(float(r["total"]) for r in rows)
        all_items = []
        order_ids = []
        for r in rows:
            order_ids.append(r["order_id"])
            try:
                all_items.extend(json.loads(r["items_json"]))
            except Exception:
                pass

        # รวมรายการอาหารที่ชื่อเดียวกันและราคาเท่ากันเพื่อแสดงสลิปใบเสร็จให้อ่านง่าย
        consolidated = {}
        for it in all_items:
            nm = it.get("name")
            pr = float(it.get("price", 0))
            k = (nm, pr)
            if k not in consolidated:
                consolidated[k] = {"name": nm, "price": pr, "qty": 0}
            consolidated[k]["qty"] += int(it.get("qty", 1))
        consolidated_items = list(consolidated.values())

        bill_no = "RCP-" + now.strftime("%y%m%d") + "-" + (order_ids[0].replace("OD", "").replace("-", "")[-4:] if order_ids else "0001")

        # อัปเดตทุกออเดอร์ของโต๊ะนี้เป็น completed
        cur.execute("""
            UPDATE orders 
            SET status = 'completed', payment = ?, time_str = ? 
            WHERE table_name = ? AND status = 'pending'
        """, (payment_method, time_str, table_name))
        
        # เคลียร์สถานะโต๊ะกลับเป็น available
        cur.execute("UPDATE tables SET status = 'available' WHERE table_name = ?", (table_name,))
        conn.commit()
        
        return {
            "success": True,
            "table": table_name,
            "totalPaid": total_amount,
            "payment": payment_method,
            "time": time_str,
            "billNo": bill_no,
            "items": consolidated_items,
            "orderIds": order_ids
        }

def submit_order(order):
    """สำหรับการสั่งแบบขายหน้าร้านปกติ (จ่ายทันที)"""
    items = order.get("items", [])
    if not items:
        return {"success": False, "message": "ไม่มีรายการอาหารในออเดอร์"}
        
    now = datetime.datetime.now()
    time_str = now.strftime("%d/%m/%Y %H:%M:%S")
    order_id = "OD" + now.strftime("%y%m%d-%H%M%S") + f"-{now.microsecond // 1000:03d}"
    
    total = sum(float(it.get("price", 0)) * float(it.get("qty", 1)) for it in items)
    table_name = order.get("tableName") or "-"
    payment = order.get("payment") or "เงินสด"
    order_type = order.get("orderType") or ("สั่งกลับบ้าน" if table_name in ("กลับบ้าน", "Takeaway") else "ทานที่ร้าน")
    items_json = json.dumps(items, ensure_ascii=False)
    
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO orders (order_id, time_str, table_name, items_json, total, payment, status, kitchen_status, order_type)
            VALUES (?, ?, ?, ?, ?, ?, 'completed', 'pending', ?)
        """, (order_id, time_str, table_name, items_json, total, payment, order_type))
        conn.commit()
        
    bill_no = "RCP-" + now.strftime("%y%m%d") + "-" + order_id.replace("OD", "").replace("-", "")[-4:]
    return {
        "success": True,
        "orderId": order_id,
        "billNo": bill_no,
        "time": time_str,
        "total": total,
        "table": table_name,
        "payment": payment,
        "items": items,
        "orderType": order_type
    }

def get_kitchen_orders():
    """ดึงรายการออเดอร์สำหรับหน้าจอในครัว (KDS) เฉพาะของวันนี้ หรือโต๊ะที่ยังไม่เสร็จ"""
    now = datetime.datetime.now()
    today_str = now.strftime("%d/%m/%Y")
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT order_id, time_str, table_name, items_json, total, status, kitchen_status, order_type
            FROM orders
            WHERE (time_str LIKE ? OR status = 'pending')
              AND (kitchen_status != 'served' OR kitchen_status IS NULL)
            ORDER BY rowid ASC
        """, (f"{today_str}%",))
        rows = cur.fetchall()
        orders = []
        for r in rows:
            try:
                items = json.loads(r["items_json"])
            except Exception:
                items = []
            
            ot = "ทานที่ร้าน"
            try:
                if "order_type" in r.keys() and r["order_type"]:
                    ot = r["order_type"]
            except Exception:
                pass

            orders.append({
                "orderId": r["order_id"],
                "time": r["time_str"],
                "table": r["table_name"],
                "items": items,
                "total": float(r["total"]),
                "status": r["status"],
                "kitchenStatus": r["kitchen_status"] or "pending",
                "orderType": ot
            })
        return orders

def update_kitchen_status(order_id, status="served"):
    """อัปเดตสถานะออเดอร์ในครัว เช่น 'cooking', 'served' (เสิร์ฟแล้ว)"""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE orders SET kitchen_status = ? WHERE order_id = ?", (status, order_id))
        conn.commit()
        return {"success": True, "orderId": order_id, "status": status}

def get_orders_by_date(date_str=None):
    if date_str and len(date_str) == 10:
        parts = date_str.split("-")
        search_day = f"{parts[2]}/{parts[1]}/{parts[0]}"
    else:
        search_day = datetime.datetime.now().strftime("%d/%m/%Y")
        
    with get_db() as conn:
        cur = conn.cursor()
        # ดึงเฉพาะรายการที่ชำระเงินแล้วมาแสดง
        cur.execute("""
            SELECT * FROM orders 
            WHERE time_str LIKE ? AND (status = 'completed' OR status = 'สำเร็จ')
            ORDER BY SUBSTR(time_str, 7, 4) DESC, SUBSTR(time_str, 4, 2) DESC, SUBSTR(time_str, 1, 2) DESC, SUBSTR(time_str, 12, 8) DESC, rowid DESC
        """, (f"{search_day}%",))
        rows = cur.fetchall()
        orders = []
        total_sales = 0.0
        for r in rows:
            total_sales += float(r["total"])
            try:
                items = json.loads(r["items_json"])
            except Exception:
                items = []
            orders.append({
                "orderId": r["order_id"],
                "time": r["time_str"],
                "table": r["table_name"],
                "items": items,
                "total": float(r["total"]),
                "payment": r["payment"],
                "status": "สำเร็จ"
            })
        return {"orders": orders, "count": len(orders), "totalSales": total_sales}

def clear_order_history():
    """ล้างประวัติการขายช่วงทดสอบระบบ (Orders ทั้งหมด) และรีเซ็ตสถานะโต๊ะเป็นว่าง"""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM orders")
        cur.execute("UPDATE tables SET status = 'available'")
        conn.commit()
    return {"success": True, "message": "ล้างประวัติการขายทดสอบเรียบร้อยแล้ว"}

try:
    from backend.analytics import get_sales_overview, get_menu_recommendations, seed_sample_orders_if_needed
    from backend.notifier import send_summary_by_type, get_setting, save_setting
    from backend.scheduler import start_background_scheduler
    from backend.tunnel import get_tunnel_url, start_tunnel
except ModuleNotFoundError:
    from analytics import get_sales_overview, get_menu_recommendations, seed_sample_orders_if_needed
    from notifier import send_summary_by_type, get_setting, save_setting
    from scheduler import start_background_scheduler
    from tunnel import get_tunnel_url, start_tunnel

def get_discord_settings():
    return {
        "webhookUrl": get_setting("discord_webhook_url", ""),
        "webhookDaily": get_setting("discord_webhook_daily", ""),
        "webhookWeekly": get_setting("discord_webhook_weekly", ""),
        "webhookMonthly": get_setting("discord_webhook_monthly", ""),
        "webhookYearly": get_setting("discord_webhook_yearly", "")
    }

def save_discord_settings(settings):
    if isinstance(settings, dict):
        if "webhookDaily" in settings:
            save_setting("discord_webhook_daily", str(settings.get("webhookDaily") or "").strip())
        if "webhookWeekly" in settings:
            save_setting("discord_webhook_weekly", str(settings.get("webhookWeekly") or "").strip())
        if "webhookMonthly" in settings:
            save_setting("discord_webhook_monthly", str(settings.get("webhookMonthly") or "").strip())
        if "webhookYearly" in settings:
            save_setting("discord_webhook_yearly", str(settings.get("webhookYearly") or "").strip())
        if "webhookUrl" in settings:
            save_setting("discord_webhook_url", str(settings.get("webhookUrl") or "").strip())
    else:
        save_setting("discord_webhook_url", str(settings or "").strip())
    return {"success": True, "message": "บันทึกการตั้งค่า Discord Webhook แต่ละห้องเรียบร้อยแล้ว"}

def trigger_discord_summary(report_type="daily", custom_date=None, custom_month=None, custom_year=None):
    return send_summary_by_type(report_type=report_type, custom_date=custom_date, custom_month=custom_month, custom_year=custom_year)

def open_browser(url):
    import webbrowser
    url_str = str(url).strip()
    if url_str.startswith(('http://', 'https://')):
        webbrowser.open(url_str)
    elif url_str.startswith(('order.html', 'kitchen.html', 'index.html', '/')):
        webbrowser.open(f"http://localhost:8000/{url_str.lstrip('/')}")
    return {"success": True}

ACTIONS = {
    "checkLogin": check_login,
    "getMenu": get_menu,
    "getAllMenuForAdmin": get_all_menu_for_admin,
    "addMenuItem": add_menu_item,
    "updateMenuItem": update_menu_item,
    "deleteMenuItem": delete_menu_item,
    "submitOrder": submit_order,
    "getOrdersByDate": get_orders_by_date,
    # --- ฟังก์ชันโต๊ะอาหาร ---
    "getTables": get_tables,
    "orderFromTable": order_from_table,
    "checkoutTable": checkout_table,
    # --- ฟังก์ชัน Analytics & Recommender ---
    "getSalesOverview": get_sales_overview,
    "getRecommendations": get_menu_recommendations,
    "clearOrderHistory": clear_order_history,
    # --- ฟังก์ชัน Discord Automation ---
    "getDiscordSettings": get_discord_settings,
    "saveDiscordSettings": save_discord_settings,
    "triggerDiscordSummary": trigger_discord_summary,
    # --- ฟังก์ชันครัว (Kitchen KDS) ---
    "getKitchenOrders": get_kitchen_orders,
    "updateKitchenStatus": update_kitchen_status,
    # --- เปิดเบราว์เซอร์ภายนอกสำหรับ Desktop App ---
    "openBrowser": open_browser,
    # --- ตรวจสอบสถานะ Cloudflare Tunnel ---
    "getTunnelUrl": lambda: {"url": get_tunnel_url()}
}

def generate_excel_backup():
    import pandas as pd
    with get_db() as conn:
        df_orders = pd.read_sql_query(
            "SELECT order_id AS [เลขที่บิล], time_str AS [วันที่-เวลา], table_name AS [โต๊ะ/ลูกค้า], "
            "COALESCE(order_type, 'ทานที่ร้าน') AS [ประเภท], "
            "items_json AS [รายการอาหาร], total AS [ยอดรวม (บาท)], payment AS [วิธีชำระเงิน], "
            "CASE WHEN status = 'completed' THEN 'เช็กบิลแล้ว' ELSE 'ค้างชำระ' END AS [สถานะบิล], "
            "kitchen_status AS [สถานะครัว] FROM orders ORDER BY time_str DESC",
            conn
        )
        df_menu = pd.read_sql_query(
            "SELECT id AS [รหัสเมนู], category AS [หมวดหมู่], name AS [ชื่อเมนู], price AS [ราคา (บาท)], "
            "CASE WHEN active = 1 THEN 'เปิดขาย' ELSE 'ปิดขาย' END AS [สถานะ] FROM menu ORDER BY category, id",
            conn
        )
        df_tables = pd.read_sql_query(
            "SELECT table_id AS [รหัสโต๊ะ], table_name AS [ชื่อโต๊ะ], "
            "CASE WHEN status = 'available' THEN 'ว่าง' ELSE 'มีลูกค้านั่ง' END AS [สถานะ] FROM tables ORDER BY table_id",
            conn
        )

        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine='openpyxl') as writer:
            df_orders.to_excel(writer, sheet_name='บิลการขาย', index=False)
            df_menu.to_excel(writer, sheet_name='เมนูและราคา', index=False)
            df_tables.to_excel(writer, sheet_name='โต๊ะอาหาร', index=False)

        return buf.getvalue()

class POSHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/backup-database", "/backup-excel"):
            try:
                content = generate_excel_backup()
                now_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f"pos_backup_{now_str}.xlsx"
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(content)
                return
            except Exception as e:
                self.send_error(500, f"Export Excel Error: {str(e)}")
                return
        super().do_GET()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        try:
            req = json.loads(body)
            action = req.get("action")
            args = req.get("args", [])
            fn = ACTIONS.get(action)
            if not fn:
                response = {"error": f"ไม่รู้จัก action: {action}"}
            else:
                result = fn(*args) if isinstance(args, list) else fn(args)
                response = {"result": result}
        except Exception as e:
            response = {"error": str(e)}

        res_bytes = json.dumps(response, ensure_ascii=False).encode('utf-8')
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(res_bytes)))
            self.end_headers()
            self.wfile.write(res_bytes)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

def run_server(port=8000):
    init_db()
    seed_sample_orders_if_needed()
    start_background_scheduler()
    # สตาร์ท Cloudflare Tunnel อัตโนมัติในเบื้องหลัง เพื่อให้มือถือ 4G/5G สแกนได้ทันที
    threading.Thread(target=start_tunnel, daemon=True).start()
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, POSHandler)
    local_ip = get_local_ip()
    print("=" * 55)
    print("Food POS Dine-in Backend is running (Multi-threaded)!")
    print(f"Open URL: http://localhost:{port}")
    print(f"Table QR Ordering: http://{local_ip}:{port}/order.html?table=1")
    print(f"Database: {DB_PATH}")
    print("=" * 55)
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()
