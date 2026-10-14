"""
seed_history.py — เสกข้อมูลบิลขายจำลองตั้งแต่ 1 ม.ค. 2025 ถึง 12 ต.ค. 2026 (ไม่เกิน 40 บิลต่อวัน)
"""

import sqlite3
import datetime
import random
import json
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "pos.db"

def seed():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # ดึงเมนูทั้งหมดที่มีอยู่ในฐานข้อมูล
    cur.execute("SELECT id, name, price, category FROM menu WHERE active = 1")
    menu_rows = cur.fetchall()
    if not menu_rows:
        print("No menu items found")
        return

    menus = [{"id": r[0], "name": r[1], "price": float(r[2]), "category": r[3]} for r in menu_rows]
    tables = ["โต๊ะ 1", "โต๊ะ 2", "โต๊ะ 3", "โต๊ะ 4", "กลับบ้าน"]
    payments = ["เงินสด", "โอนเงิน"]

    # ช่วงวันที่: 2026-10-13 ถึง 2026-12-31 (เติมต่อจนถึงสิ้นปี)
    start_date = datetime.date(2026, 10, 13)
    end_date = datetime.date(2026, 12, 31)
    delta = (end_date - start_date).days

    print(f"กำลังเสกข้อมูลบิลจำลองตั้งแต่วันที่ {start_date} ถึง {end_date} (รวม {delta + 1} วัน)...")

    # หา counter ล่าสุดจากในฐานข้อมูล
    cur.execute("SELECT COUNT(*) FROM orders")
    current_count = cur.fetchone()[0]
    order_counter = current_count + 1000
    order_rows = []

    for i in range(delta + 1):
        curr_date = start_date + datetime.timedelta(days=i)
        is_weekend = curr_date.weekday() in (5, 6)
        bills_count = random.randint(18, 38) if is_weekend else random.randint(10, 28)

        # สุ่มเวลาช่วงเปิดร้าน 10:00 - 21:30 น. และเรียงตามลำดับเวลาในแต่ละวัน
        day_times = []
        for _ in range(bills_count):
            h = random.randint(10, 21)
            m = random.randint(0, 59)
            s = random.randint(0, 59)
            day_times.append((h, m, s))
        day_times.sort()

        for (hour, minute, second) in day_times:
            order_counter += 1
            time_str = f"{curr_date.day:02d}/{curr_date.month:02d}/{curr_date.year:04d} {hour:02d}:{minute:02d}:{second:02d}"

            table = random.choice(tables)
            payment = random.choices(payments, weights=[45, 55])[0]

            items_in_bill = []
            num_items = random.choices([1, 2, 3, 4], weights=[35, 40, 18, 7])[0]
            selected_menus = random.sample(menus, min(num_items, len(menus)))

            total_bill = 0.0
            for m in selected_menus:
                qty = random.choices([1, 2, 3], weights=[75, 20, 5])[0]
                price = m["price"]
                items_in_bill.append({
                    "id": m["id"],
                    "name": m["name"],
                    "price": price,
                    "qty": qty
                })
                total_bill += price * qty

            date_tag = curr_date.strftime("%Y%m%d")
            order_id = f"ORD-{date_tag}-{order_counter:06d}"
            order_rows.append((
                order_id,
                time_str,
                table,
                json.dumps(items_in_bill, ensure_ascii=False),
                total_bill,
                payment,
                "completed"
            ))

    # ใส่ข้อมูลลงตาราง orders
    cur.executemany("""
        INSERT OR REPLACE INTO orders (order_id, time_str, table_name, items_json, total, payment, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, order_rows)
    conn.commit()

    cur.execute("SELECT COUNT(*), SUM(total) FROM orders WHERE status = 'completed' OR status = 'สำเร็จ'")
    row = cur.fetchone()
    print("=" * 50)
    print("เสกข้อมูลทิพย์สำเร็จเรียบร้อยแล้ว!")
    print(f"จำนวนบิลทั้งหมดในระบบ: {row[0]:,} บิล")
    print(f"ยอดขายรวมสะสมทั้งหมด: ฿{row[1]:,.2f}")
    print("=" * 50)
    conn.close()

if __name__ == "__main__":
    seed()
