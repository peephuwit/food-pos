"""
notifier.py — ระบบส่งการ์ดสรุปยอดขายประจำวัน สัปดาห์ และเดือน (Discord Webhook Automation)
- สรุปรายวัน (Daily Summary)
- สรุปรายสัปดาห์ (Weekly Summary: จันทร์ - อาทิตย์)
- สรุปรายเดือน (Monthly Summary)
- แสดงอันดับยอดขายครบทุกเมนูในร้าน
"""

import json
import urllib.request
import urllib.error
import datetime
import calendar
import sqlite3
from pathlib import Path

import sys

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

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_setting(key, default=""):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
            cur.execute("SELECT value FROM settings WHERE key = ?", (key,))
            row = cur.fetchone()
            return row["value"] if row else default
    except Exception:
        return default

def save_setting(key, value):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
            cur.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))
            conn.commit()
        return True
    except Exception:
        return False

def format_menu_ranking_lines(items):
    """ฟอร์แมตอันดับทุกเมนูในร้านเป็นบรรทัดข้อความสำหรับ Discord Embed"""
    if not items:
        return "ไม่มีข้อมูลเมนู"

    lines = []
    for idx, it in enumerate(items):
        name = it.get("name", "-")
        qty = it.get("qty", 0)
        rev = it.get("revenue", 0.0)
        if qty > 0:
            lines.append(f"`#{idx+1:02d}` **{name}** — {qty} จาน (฿{rev:,.2f})")
        else:
            lines.append(f"`#{idx+1:02d}` {name} — *ยังไม่มีออเดอร์* (0 จาน)")

    # Discord Embed field limit คือ 1024 ตัวอักษร
    result = "\n".join(lines)
    if len(result) > 1000:
        return result[:990] + "\n..."
    return result

def send_discord_payload(webhook_url, embeds):
    """ยิง HTTP POST ไปยัง Discord Webhook"""
    if not webhook_url or not webhook_url.strip().startswith("https://discord.com/api/webhooks/"):
        return {
            "success": False,
            "message": "กรุณาระบุ Discord Webhook URL ให้ถูกต้อง (ขึ้นต้นด้วย https://discord.com/api/webhooks/...)"
        }

    payload = {
        "username": "Food POS Summary Bot",
        "avatar_url": "https://cdn-icons-png.flaticon.com/512/2771/2771401.png",
        "embeds": embeds
    }

    req = urllib.request.Request(
        webhook_url.strip(),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "FoodPOS-Bot/1.0"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            if resp.status in (200, 204):
                save_setting("discord_webhook_url", webhook_url.strip())
                return {"success": True, "message": "ส่งการ์ดรายงานเข้า Discord เรียบร้อยแล้ว"}
            else:
                return {"success": False, "message": f"Discord ตอบกลับสถานะ {resp.status}"}
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        return {"success": False, "message": f"HTTP Error {e.code}: {err_msg}"}
    except Exception as e:
        return {"success": False, "message": f"เชื่อมต่อ Discord ไม่สำเร็จ: {str(e)}"}

def build_daily_embed(custom_date=None):
    """สร้าง Discord Embed สรุปยอดขายประจำวัน พร้อมอันดับครบทุกเมนู"""
    try:
        from backend.analytics import get_sales_overview
    except ModuleNotFoundError:
        from analytics import get_sales_overview

    now = datetime.datetime.now()
    report_date = custom_date or now.strftime("%Y-%m-%d")
    period = "date" if custom_date else "today"
    data = get_sales_overview(period=period, custom_date=custom_date)

    total_rev = data.get("totalRevenue", 0.0)
    cash_rev = data.get("cashRevenue", 0.0)
    transfer_rev = data.get("transferRevenue", 0.0)
    total_bills = data.get("totalBills", 0)
    avg_ticket = (total_rev / total_bills) if total_bills else 0.0
    menu_text = format_menu_ranking_lines(data.get("topMenuItems", []))

    embed = {
        "title": f"รายงานสรุปยอดขายประจำวัน — {report_date}",
        "description": f"ปิดกะและสรุปผลประจำวัน ณ เวลา **{now.strftime('%H:%M:%S')} น.**",
        "color": 16744245,  # สีส้ม 0xff6b35
        "fields": [
            {
                "name": "ยอดขายรวมทั้งสิ้น",
                "value": f"### ฿{total_rev:,.2f}",
                "inline": False
            },
            {
                "name": "ยอดเงินสด (Cash)",
                "value": f"฿{cash_rev:,.2f}",
                "inline": True
            },
            {
                "name": "ยอดโอน / QR",
                "value": f"฿{transfer_rev:,.2f}",
                "inline": True
            },
            {
                "name": "จำนวนบิล / เฉลี่ยต่อบิล",
                "value": f"{total_bills} บิล (เฉลี่ย ฿{avg_ticket:,.2f})",
                "inline": True
            },
            {
                "name": f"อันดับยอดขายทุกเมนูในร้าน ({len(data.get('topMenuItems', []))} เมนู)",
                "value": menu_text,
                "inline": False
            }
        ],
        "footer": {
            "text": "Food POS Suite • Daily Summary Automation"
        },
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
    }
    return embed

def build_weekly_embed(start_date=None, end_date=None):
    """สร้าง Discord Embed สรุปยอดขายประจำสัปดาห์ (จันทร์ - อาทิตย์) พร้อมอันดับครบทุกเมนู"""
    try:
        from backend.analytics import get_sales_overview
    except ModuleNotFoundError:
        from analytics import get_sales_overview

    now = datetime.datetime.now()
    if not start_date or not end_date:
        monday = now.date() - datetime.timedelta(days=now.weekday())
        sunday = monday + datetime.timedelta(days=6)
        start_date = monday.strftime("%Y-%m-%d")
        end_date = sunday.strftime("%Y-%m-%d")

    data = get_sales_overview(period="range", start_date=start_date, end_date=end_date)

    total_rev = data.get("totalRevenue", 0.0)
    cash_rev = data.get("cashRevenue", 0.0)
    transfer_rev = data.get("transferRevenue", 0.0)
    total_bills = data.get("totalBills", 0)
    avg_ticket = (total_rev / total_bills) if total_bills else 0.0
    menu_text = format_menu_ranking_lines(data.get("topMenuItems", []))

    embed = {
        "title": f"รายงานสรุปยอดขายประจำสัปดาห์ (Weekly Summary)",
        "description": f"รอบสัปดาห์: **{start_date} ถึง {end_date}**\nสรุปผล ณ เวลา **{now.strftime('%H:%M:%S')} น.**",
        "color": 3901910,  # สีน้ำเงิน/ม่วง 0x3b82f6
        "fields": [
            {
                "name": "ยอดขายรวมทั้งสัปดาห์",
                "value": f"### ฿{total_rev:,.2f}",
                "inline": False
            },
            {
                "name": "ยอดเงินสด (Cash)",
                "value": f"฿{cash_rev:,.2f}",
                "inline": True
            },
            {
                "name": "ยอดโอน / QR",
                "value": f"฿{transfer_rev:,.2f}",
                "inline": True
            },
            {
                "name": "จำนวนบิล / เฉลี่ยต่อบิล",
                "value": f"{total_bills} บิล (เฉลี่ย ฿{avg_ticket:,.2f})",
                "inline": True
            },
            {
                "name": f"อันดับยอดขายทุกเมนูในรอบสัปดาห์ ({len(data.get('topMenuItems', []))} เมนู)",
                "value": menu_text,
                "inline": False
            }
        ],
        "footer": {
            "text": "Food POS Suite • Weekly Summary Automation"
        },
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
    }
    return embed

def build_monthly_embed(target_month=None):
    """สร้าง Discord Embed สรุปยอดขายประจำเดือน พร้อมการแตกแจงรายสัปดาห์และอันดับเมนู"""
    try:
        from backend.analytics import get_sales_overview
    except ModuleNotFoundError:
        from analytics import get_sales_overview

    now = datetime.datetime.now()
    month_str = target_month or now.strftime("%Y-%m")
    data = get_sales_overview(period="custom_month", custom_month=month_str)

    total_rev = data.get("totalRevenue", 0.0)
    cash_rev = data.get("cashRevenue", 0.0)
    transfer_rev = data.get("transferRevenue", 0.0)
    total_bills = data.get("totalBills", 0)
    avg_ticket = (total_rev / total_bills) if total_bills else 0.0

    # สร้างข้อความสรุปแต่ละสัปดาห์ในเดือนนั้น
    week_breakdown = data.get("weeklyBreakdown", [])
    week_lines = []
    for w in week_breakdown:
        week_lines.append(f"• **สัปดาห์ที่ {w['weekNumber']}** ({w['startDate']} ถึง {w['endDate']}): **฿{w['totalRevenue']:,.2f}** ({w['billsCount']} บิล)")
    weeks_text = "\n".join(week_lines) if week_lines else "ไม่มีข้อมูลสัปดาห์"

    menu_text = format_menu_ranking_lines(data.get("topMenuItems", []))

    embed = {
        "title": f"รายงานสรุปยอดขายประจำเดือน (Monthly Summary) — {month_str}",
        "description": f"สรุปผลประกอบการสิ้นเดือน ณ เวลา **{now.strftime('%H:%M:%S')} น.**",
        "color": 1098489,  # สีเขียวเข้ม 0x10b981
        "fields": [
            {
                "name": "ยอดขายรวมทั้งเดือน",
                "value": f"### ฿{total_rev:,.2f}",
                "inline": False
            },
            {
                "name": "ยอดเงินสด (Cash)",
                "value": f"฿{cash_rev:,.2f}",
                "inline": True
            },
            {
                "name": "ยอดโอน / QR",
                "value": f"฿{transfer_rev:,.2f}",
                "inline": True
            },
            {
                "name": "จำนวนบิล / เฉลี่ยต่อบิล",
                "value": f"{total_bills} บิล (เฉลี่ย ฿{avg_ticket:,.2f})",
                "inline": True
            },
            {
                "name": "สรุปยอดแยกตามสัปดาห์ในเดือนนี้",
                "value": weeks_text,
                "inline": False
            },
            {
                "name": f"อันดับยอดขายทุกเมนูในรอบเดือน ({len(data.get('topMenuItems', []))} เมนู)",
                "value": menu_text,
                "inline": False
            }
        ],
        "footer": {
            "text": "Food POS Suite • Monthly Summary Automation"
        },
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
    }
    return embed

def build_yearly_embed(custom_year=None):
    """สร้าง Discord Embed สรุปยอดขายประจำปี พร้อมการแตกแจง 12 เดือนและอันดับเมนูครบทุกเมนู"""
    try:
        from backend.analytics import get_sales_overview
    except ModuleNotFoundError:
        from analytics import get_sales_overview

    now = datetime.datetime.now()
    year_str = str(custom_year or now.year)
    data = get_sales_overview(period="custom_year", custom_year=year_str)

    total_rev = data.get("totalRevenue", 0.0)
    cash_rev = data.get("cashRevenue", 0.0)
    transfer_rev = data.get("transferRevenue", 0.0)
    total_bills = data.get("totalBills", 0)
    avg_ticket = (total_rev / total_bills) if total_bills else 0.0

    month_breakdown = data.get("monthlyBreakdown", [])
    month_lines = []
    for m in month_breakdown:
        if m["billsCount"] > 0 or m["totalRevenue"] > 0:
            month_lines.append(f"• **{m['monthName']}** ({m['month']}): **฿{m['totalRevenue']:,.2f}** ({m['billsCount']} บิล)")
    months_text = "\n".join(month_lines) if month_lines else "ยังไม่มีข้อมูลยอดขายในรอบปีนี้"

    menu_text = format_menu_ranking_lines(data.get("topMenuItems", []))

    embed = {
        "title": f"รายงานสรุปผลประกอบการประจำปี (Yearly Summary) — ปี {year_str}",
        "description": f"สรุปภาพรวมรายปี ณ วันที่ **{now.strftime('%d/%m/%Y %H:%M:%S')} น.**",
        "color": 16766720,  # สีทอง 0xffd700
        "fields": [
            {
                "name": "ยอดขายรวมทั้งปี",
                "value": f"### ฿{total_rev:,.2f}",
                "inline": False
            },
            {
                "name": "ยอดเงินสด (Cash)",
                "value": f"฿{cash_rev:,.2f}",
                "inline": True
            },
            {
                "name": "ยอดโอน / QR",
                "value": f"฿{transfer_rev:,.2f}",
                "inline": True
            },
            {
                "name": "จำนวนบิล / เฉลี่ยต่อบิล",
                "value": f"{total_bills} บิล (เฉลี่ย ฿{avg_ticket:,.2f})",
                "inline": True
            },
            {
                "name": "สรุปยอดขายแยกตามรายเดือน (12 เดือน)",
                "value": months_text,
                "inline": False
            },
            {
                "name": f"อันดับยอดขายทุกเมนูในรอบปี ({len(data.get('topMenuItems', []))} เมนู)",
                "value": menu_text,
                "inline": False
            }
        ],
        "footer": {
            "text": "Food POS Suite • Yearly Summary Automation"
        },
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
    }
    return embed

def get_webhook_url_for_type(report_type):
    """ดึง Webhook URL สำหรับประเภทรายงานแต่ละห้อง (daily, weekly, monthly, yearly) หรือ fallback ไปที่ URL กลาง"""
    key_map = {
        "daily": "discord_webhook_daily",
        "weekly": "discord_webhook_weekly",
        "monthly": "discord_webhook_monthly",
        "yearly": "discord_webhook_yearly"
    }
    specific_key = key_map.get(report_type)
    if specific_key:
        val = get_setting(specific_key, "").strip()
        if val:
            return val
    return get_setting("discord_webhook_url", "").strip()

def send_summary_by_type(report_type="daily", webhook_url=None, custom_date=None, custom_month=None, custom_year=None):
    """ฟังก์ชันยิงส่งรายงานตามประเภท: 'daily', 'weekly', 'monthly', 'yearly', หรือ 'test' แยกห้องอัตโนมัติ"""
    url = webhook_url or get_webhook_url_for_type(report_type)

    if report_type == "test":
        # ถ้าไม่ได้เจาะจง webhook_url มา ให้ทดสอบทุกห้องที่มีการตั้งค่าไว้
        test_targets = []
        if webhook_url:
            test_targets.append(("ห้องเป้าหมาย", webhook_url))
        else:
            for typ, label in [("daily", "ห้องรายวัน"), ("weekly", "ห้องรายสัปดาห์"), ("monthly", "ห้องรายเดือน"), ("yearly", "ห้องรายปี")]:
                u = get_setting(f"discord_webhook_{typ}", "").strip()
                if u:
                    test_targets.append((label, u))
            if not test_targets:
                default_u = get_setting("discord_webhook_url", "").strip()
                if default_u:
                    test_targets.append(("ห้องหลัก (Default)", default_u))

        if not test_targets:
            return {"success": False, "message": "ยังไม่ได้ตั้งค่า Webhook URL ในห้องใดเลย"}

        success_count = 0
        for label, u in test_targets:
            res = send_discord_payload(u, [{
                "title": f"🔔 ทดสอบการเชื่อมต่อ: {label}",
                "description": f"ระบบ Food POS สามารถส่งข้อความมายังห้อง **{label}** ได้อย่างถูกต้องสมบูรณ์แล้ว!",
                "color": 3901910,
                "footer": {"text": "Food POS Suite • Webhook Connection Test"},
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
            }])
            if res.get("success"):
                success_count += 1

        return {
            "success": success_count > 0,
            "message": f"ทดสอบการส่งสำเร็จ {success_count}/{len(test_targets)} ห้องแชท"
        }

    if not url:
        type_names = {"daily": "รายวัน", "weekly": "รายสัปดาห์", "monthly": "รายเดือน", "yearly": "รายปี"}
        name = type_names.get(report_type, report_type)
        return {"success": False, "message": f"ยังไม่ได้ตั้งค่า Discord Webhook URL สำหรับห้อง{name}"}

    embeds = []
    if report_type == "daily":
        embeds.append(build_daily_embed(custom_date))
    elif report_type == "weekly":
        embeds.append(build_weekly_embed())
    elif report_type == "monthly":
        embeds.append(build_monthly_embed(custom_month))
    elif report_type == "yearly":
        embeds.append(build_yearly_embed(custom_year))

    return send_discord_payload(url, embeds)

