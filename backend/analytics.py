"""
analytics.py — วิเคราะห์ยอดขายและระบบจับคู่แนะนำเมนูพ่วง (Market Basket Recommender)
ใช้ pandas และ Standard Library ในการประมวลผลข้อมูลการขาย
"""

import json
import sqlite3
from pathlib import Path
from collections import defaultdict, Counter

import sys

def resolve_db_path():
    if getattr(sys, 'frozen', False):
        if sys.platform == "darwin":
            app_support = Path.home() / "Library" / "Application Support" / "FoodPOS"
            app_support.mkdir(parents=True, exist_ok=True)
            target = app_support / "pos.db"
            if not target.exists():
                bundle_db = None
                if hasattr(sys, '_MEIPASS'):
                    bundle_db = Path(sys._MEIPASS) / "backend" / "pos.db"
                if not bundle_db or not bundle_db.exists():
                    bundle_db = Path(sys.executable).resolve().parent.parent / "Resources" / "backend" / "pos.db"
                if not bundle_db or not bundle_db.exists():
                    bundle_db = Path(sys.executable).resolve().parent / "pos.db"
                if bundle_db and bundle_db.exists():
                    import shutil
                    shutil.copy2(bundle_db, target)
            return target
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

import datetime
import calendar

def parse_order_date(time_str):
    """แปลง 'DD/MM/YYYY HH:MM:SS' เป็น datetime object"""
    try:
        return datetime.datetime.strptime(str(time_str).strip(), "%d/%m/%Y %H:%M:%S")
    except Exception:
        return None

def get_sales_overview(period="all", custom_date=None, custom_month=None, start_date=None, end_date=None, custom_year=None):
    """
    สรุปภาพรวมยอดขายตามช่วงเวลา:
    - 'today' : ยอดขายวันนี้
    - 'this_week' : ยอดขายสัปดาห์นี้ (วันจันทร์ที่ผ่านมา ถึง วันอาทิตย์/ปัจจุบัน)
    - 'date'  : ยอดขายระบุวันที่ (custom_date: 'YYYY-MM-DD')
    - 'custom_month': ยอดขายระบุเดือน (custom_month: 'YYYY-MM')
    - 'this_year' : ยอดขายปีนี้ (1 ม.ค. ถึง 31 ธ.ค.)
    - 'custom_year' : ยอดขายระบุปี (custom_year: 'YYYY')
    - 'range' : ยอดขายระบุช่วงวันที่ (start_date ถึง end_date: 'YYYY-MM-DD')
    - 'all'   : ยอดขายสะสมทั้งหมด
    """
    now = datetime.datetime.now()
    
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT total, payment, items_json, time_str FROM orders WHERE status = 'completed' OR status = 'สำเร็จ'")
        rows = cur.fetchall()
        cur.execute("SELECT name, price, category FROM menu WHERE active = 1")
        all_menu_rows = cur.fetchall()
        all_menu_items = {r["name"]: {"price": float(r["price"]), "category": r["category"]} for r in all_menu_rows}

    if not rows:
        menu_rankings = [
            {"name": name, "qty": 0, "revenue": 0.0, "category": info["category"]}
            for name, info in all_menu_items.items()
        ]
        return {
            "period": period,
            "totalRevenue": 0,
            "cashRevenue": 0,
            "transferRevenue": 0,
            "totalBills": 0,
            "topMenuItems": menu_rankings,
            "paymentMethods": {},
            "paymentRevenue": {},
            "hourlySales": {},
            "weeklyBreakdown": [],
            "monthlyBreakdown": []
        }

    # หาวันจันทร์ของสัปดาห์นี้สำหรับ 'this_week'
    monday_this_week = now.date() - datetime.timedelta(days=now.weekday())

    # กำหนด target year และ target month
    target_year_str = str(custom_year) if (period == "custom_year" and custom_year) else (str(now.year) if period == "this_year" else None)
    target_month_str = custom_month if (period == "custom_month" and custom_month) else (now.strftime("%Y-%m") if period in ("this_week", "this_month") else None)
    
    filtered_rows = []
    month_rows = []
    year_rows = []

    for r in rows:
        order_dt = parse_order_date(r["time_str"])
        if not order_dt:
            if period == "all":
                filtered_rows.append(r)
            continue

        order_date = order_dt.date()
        order_date_str = order_dt.strftime("%Y-%m-%d")
        order_month_str = order_dt.strftime("%Y-%m")
        order_year_str = str(order_dt.year)

        if target_month_str and order_month_str == target_month_str:
            month_rows.append((order_dt, r))

        if target_year_str and order_year_str == target_year_str:
            year_rows.append((order_dt, r))

        diff_days = (now.date() - order_date).days
        if period == "today" and diff_days == 0:
            filtered_rows.append(r)
        elif period == "this_week" and order_date >= monday_this_week and order_date <= (monday_this_week + datetime.timedelta(days=6)):
            filtered_rows.append(r)
        elif period == "this_month" and order_month_str == now.strftime("%Y-%m"):
            filtered_rows.append(r)
        elif period == "date" and custom_date:
            if order_date_str == custom_date:
                filtered_rows.append(r)
        elif period == "custom_month" and custom_month:
            if order_month_str == custom_month:
                filtered_rows.append(r)
        elif period == "this_year":
            if order_year_str == str(now.year):
                filtered_rows.append(r)
        elif period == "custom_year" and custom_year:
            if order_year_str == str(custom_year):
                filtered_rows.append(r)
        elif period == "range" and start_date and end_date:
            if start_date <= order_date_str <= end_date:
                filtered_rows.append(r)
        elif period == "all":
            filtered_rows.append(r)

    total_revenue = 0.0
    cash_revenue = 0.0
    transfer_revenue = 0.0
    total_bills = len(filtered_rows)
    item_counter = Counter()
    item_revenue = defaultdict(float)
    payment_counter = Counter()
    payment_revenue = defaultdict(float)
    hourly_counter = Counter()

    for r in filtered_rows:
        tot = float(r["total"])
        pay = (r["payment"] or "เงินสด").strip()
        total_revenue += tot
        payment_counter[pay] += 1
        payment_revenue[pay] += tot

        if pay == "เงินสด":
            cash_revenue += tot
        else:
            transfer_revenue += tot

        # วิเคราะห์ช่วงเวลา (ชั่วโมงที่ขาย)
        time_str = r["time_str"]
        try:
            hour = time_str.split(" ")[1].split(":")[0] + ":00"
            hourly_counter[hour] += tot
        except Exception:
            pass

        try:
            items = json.loads(r["items_json"])
            for it in items:
                name = it.get("name")
                qty = int(it.get("qty", 1))
                price = float(it.get("price", 0))
                item_counter[name] += qty
                item_revenue[name] += price * qty
        except Exception:
            pass

    # จัดอันดับทุกเมนูในร้าน (ทั้งที่มีการสั่งซื้อและที่ยังขายไม่ได้ 0 จาน)
    all_ranked_names = set(all_menu_items.keys()).union(set(item_counter.keys()))
    top_items = []
    for name in all_ranked_names:
        qty = item_counter.get(name, 0)
        rev = item_revenue.get(name, 0.0)
        cat = all_menu_items.get(name, {}).get("category", "")
        top_items.append({"name": name, "qty": qty, "revenue": rev, "category": cat})

    # เรียงลำดับจากยอดขาย (จำนวนจานมากสุดไปน้อยสุด, ถ้ายอดจานเท่ากันดูยอดเงิน)
    top_items.sort(key=lambda x: (x["qty"], x["revenue"]), reverse=True)

    # คำนวณ Weekly Breakdown (แบ่งสัปดาห์ จันทร์-อาทิตย์ ตัดตามขอบเดือน) สำหรับเดือนเป้าหมาย
    weekly_breakdown = []
    if target_month_str:
        try:
            t_year, t_month = map(int, target_month_str.split("-"))
            num_days = calendar.monthrange(t_year, t_month)[1]
            curr_start = 1
            w_idx = 1
            for day in range(1, num_days + 1):
                dt = datetime.date(t_year, t_month, day)
                # วันอาทิตย์ (weekday == 6) หรือ วันสุดท้ายของเดือน ให้ตัดรอบสัปดาห์
                if dt.weekday() == 6 or day == num_days:
                    s_str = f"{t_year:04d}-{t_month:02d}-{curr_start:02d}"
                    e_str = f"{t_year:04d}-{t_month:02d}-{day:02d}"
                    
                    w_rev = 0.0
                    w_cash = 0.0
                    w_transfer = 0.0
                    w_bills = 0

                    for o_dt, o_row in month_rows:
                        o_d_str = o_dt.strftime("%Y-%m-%d")
                        if s_str <= o_d_str <= e_str:
                            t_val = float(o_row["total"])
                            w_rev += t_val
                            w_bills += 1
                            if (o_row["payment"] or "").strip() == "เงินสด":
                                w_cash += t_val
                            else:
                                w_transfer += t_val

                    # ตรวจสอบว่าเป็นสัปดาห์ปัจจุบันหรือไม่
                    is_current = (s_str <= now.strftime("%Y-%m-%d") <= e_str)

                    weekly_breakdown.append({
                        "weekNumber": w_idx,
                        "startDate": s_str,
                        "endDate": e_str,
                        "startDay": curr_start,
                        "endDay": day,
                        "daysCount": day - curr_start + 1,
                        "totalRevenue": w_rev,
                        "cashRevenue": w_cash,
                        "transferRevenue": w_transfer,
                        "billsCount": w_bills,
                        "isCurrent": is_current
                    })
                    w_idx += 1
                    curr_start = day + 1
        except Exception:
            pass

    # คำนวณ Monthly Breakdown (12 เดือนของปีเป้าหมาย)
    monthly_breakdown = []
    thai_month_names = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    if target_year_str:
        try:
            t_year = int(target_year_str)
            for m_num in range(1, 13):
                m_str = f"{t_year:04d}-{m_num:02d}"
                m_rev = 0.0
                m_cash = 0.0
                m_transfer = 0.0
                m_bills = 0

                for o_dt, o_row in year_rows:
                    if o_dt.strftime("%Y-%m") == m_str:
                        t_val = float(o_row["total"])
                        m_rev += t_val
                        m_bills += 1
                        if (o_row["payment"] or "").strip() == "เงินสด":
                            m_cash += t_val
                        else:
                            m_transfer += t_val

                is_current = (m_str == now.strftime("%Y-%m"))
                monthly_breakdown.append({
                    "month": m_str,
                    "monthNumber": m_num,
                    "monthName": thai_month_names[m_num - 1],
                    "totalRevenue": m_rev,
                    "cashRevenue": m_cash,
                    "transferRevenue": m_transfer,
                    "billsCount": m_bills,
                    "isCurrent": is_current
                })
        except Exception:
            pass

    # รายชื่อปีทั้งหมดที่มีในระบบ
    all_years = sorted(list({parse_order_date(r["time_str"]).year for r in rows if parse_order_date(r["time_str"])}), reverse=True)
    if now.year not in all_years:
        all_years.insert(0, now.year)

    return {
        "period": period,
        "targetMonth": target_month_str,
        "targetYear": target_year_str,
        "availableYears": all_years,
        "totalRevenue": total_revenue,
        "cashRevenue": cash_revenue,
        "transferRevenue": transfer_revenue,
        "totalBills": total_bills,
        "topMenuItems": top_items,
        "paymentMethods": dict(payment_counter),
        "paymentRevenue": dict(payment_revenue),
        "hourlySales": dict(hourly_counter),
        "weeklyBreakdown": weekly_breakdown,
        "monthlyBreakdown": monthly_breakdown
    }

def get_menu_recommendations(current_item_names):
    """
    Market Basket Analysis (Co-occurrence Recommender):
    คำนวณว่าเมนูที่อยู่ในตะกร้าตอนนี้ (current_item_names)
    ในอดีตลูกค้าคนอื่นมักจะสั่งเมนูอะไรคู่กันมากที่สุด
    """
    if not current_item_names:
        return []

    target_set = set(current_item_names)

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT items_json FROM orders WHERE status = 'completed'")
        rows = cur.fetchall()

    co_occurrence = Counter()

    for r in rows:
        try:
            items = json.loads(r["items_json"])
            basket_item_names = {it.get("name") for it in items if it.get("name")}
            
            # ถ้าในบิลนี้มีเมนูใดเมนูหนึ่งที่ตรงกับของในตะกร้าปัจจุบัน
            if basket_item_names.intersection(target_set):
                # นับเมนูอื่นๆ ในบิลนั้นที่ไม่ใช่เมนูที่เลือกไปแล้ว
                for other_name in basket_item_names - target_set:
                    co_occurrence[other_name] += 1
        except Exception:
            pass

    # ดึงข้อมูลเมนูจริง (ราคา, id, รูป) ของเมนูที่แนะนำ
    recommendations = []
    with get_db() as conn:
        cur = conn.cursor()
        for item_name, count in co_occurrence.most_common(3):
            cur.execute("SELECT id, name, category, price FROM menu WHERE name = ? AND active = 1", (item_name,))
            row = cur.fetchone()
            if row:
                recommendations.append({
                    "id": row["id"],
                    "name": row["name"],
                    "category": row["category"],
                    "price": float(row["price"]),
                    "pairScore": count
                })

    return recommendations

def seed_sample_orders_if_needed():
    """สร้างประวัติการขายจำลอง 30 บิล เพื่อให้ระบบ Recommender มีสถิติเรียนรู้ทันที"""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM orders WHERE status = 'completed'")
        count = cur.fetchone()[0]
        
        # ถ้ายังมีประวัติการขายน้อยกว่า 10 บิล ให้ seed ข้อมูลตัวอย่าง
        if count < 10:
            import datetime
            import random
            
            menu_samples = [
                {"name": "ข้าวกะเพราหมูกรอบ + ไข่ดาว", "price": 65.0},
                {"name": "ข้าวผัดต้มยำกุ้ง", "price": 70.0},
                {"name": "ผัดไทยกุ้งสด", "price": 75.0},
                {"name": "ชาไทยเย็น (สูตรโบราณ)", "price": 35.0},
                {"name": "กาแฟโบราณ (โอเลี้ยงยกล้อ)", "price": 35.0},
                {"name": "น้ำเก๊กฮวยเย็น", "price": 25.0},
                {"name": "เกี๊ยวทอดกรอบ", "price": 40.0},
                {"name": "ไก่ทอดสมุนไพร", "price": 60.0},
            ]
            
            # กำหนดคู่เมนูที่คนมักสั่งคู่กัน (High correlation patterns)
            patterns = [
                [menu_samples[0], menu_samples[3]], # กะเพรา + ชาไทย
                [menu_samples[0], menu_samples[6]], # กะเพรา + เกี๊ยวทอด
                [menu_samples[0], menu_samples[3], menu_samples[6]], # กะเพรา + ชาไทย + เกี๊ยวทอด
                [menu_samples[2], menu_samples[5]], # ผัดไทย + เก๊กฮวย
                [menu_samples[1], menu_samples[7]], # ข้าวผัดต้มยำ + ไก่ทอด
                [menu_samples[2], menu_samples[3]], # ผัดไทย + ชาไทย
            ]
            
            now = datetime.datetime.now()
            for i in range(25):
                basket = random.choice(patterns)
                order_time = (now - datetime.timedelta(hours=random.randint(1, 48))).strftime("%d/%m/%Y %H:%M:%S")
                order_id = f"SEED{i+1:04d}"
                items_data = [{"id": 0, "name": it["name"], "price": it["price"], "qty": 1} for it in basket]
                total = sum(it["price"] for it in items_data)
                pay = random.choice(["เงินสด", "โอนเงิน"])
                table = f"โต๊ะ {random.randint(1, 4)}"
                
                cur.execute("""
                    INSERT OR IGNORE INTO orders (order_id, time_str, table_name, items_json, total, payment, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'completed')
                """, (order_id, order_time, table, json.dumps(items_data, ensure_ascii=False), total, pay))
                
            conn.commit()

if __name__ == "__main__":
    seed_sample_orders_if_needed()
    print("Sales Overview:", get_sales_overview())
    print("Recommendations for ['ข้าวกะเพราหมูกรอบ + ไข่ดาว']:", get_menu_recommendations(["ข้าวกะเพราหมูกรอบ + ไข่ดาว"]))
