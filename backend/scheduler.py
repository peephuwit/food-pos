"""
scheduler.py — ระบบ Background Worker ตรวจสอบเวลาอัตโนมัติ (Automated Daily/Weekly/Monthly Trigger)
- ทำงานใน Background Thread คู่กับ server.py
- ตรวจสอบทุกนาที: เมื่อถึงเวลา 23:00 น. จะยิงรายงานอัตโนมัติ
- ป้องกันการยิงซ้ำในวันเดียวกันด้วย last_trigger_date
"""

import time
import datetime
import calendar
import threading

try:
    from backend.notifier import (
        get_setting, save_setting, send_discord_payload, get_webhook_url_for_type,
        build_daily_embed, build_weekly_embed, build_monthly_embed, build_yearly_embed
    )
except ModuleNotFoundError:
    from notifier import (
        get_setting, save_setting, send_discord_payload, get_webhook_url_for_type,
        build_daily_embed, build_weekly_embed, build_monthly_embed, build_yearly_embed
    )

def check_and_run_automation():
    """ตรวจสอบเวลาปัจจุบันและส่งรายงานสรุปอัตโนมัติแยกตามห้อง (Daily, Weekly, Monthly, Yearly)"""
    now = datetime.datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    yesterday = now - datetime.timedelta(days=1)
    yesterday_str = yesterday.strftime("%Y-%m-%d")

    last_sent = get_setting("last_automated_report_date")

    # 1. ถึงเวลา 23:00 น. เป็นต้นไปของวันนี้ และยังไม่ได้ส่งรายงานของวันนี้
    if now.hour >= 23:
        target_date = today_str
        target_dt = now
    # 2. เครื่องหลับ/ปิดข้ามคืน แล้วตื่นขึ้นมาหลังเที่ยงคืน (เมื่อวานยังไม่ได้ส่ง) -> ชดเชยการส่งยอดของเมื่อวานทันที
    elif last_sent != yesterday_str and last_sent != today_str:
        target_date = yesterday_str
        target_dt = yesterday
    else:
        return

    if last_sent == target_date:
        return

    dispatched = False

    # 1. รายงานประจำวัน (ส่งทุกคืน 23:00 น. ไปยังห้องรายวัน)
    daily_url = get_webhook_url_for_type("daily")
    if daily_url:
        res = send_discord_payload(daily_url, [build_daily_embed(target_date)])
        if res.get("success"):
            dispatched = True

    # 2. รายงานประจำสัปดาห์ (ส่งทุกคืนวันอาทิตย์: weekday == 6 ไปยังห้องรายสัปดาห์)
    if target_dt.weekday() == 6:
        weekly_url = get_webhook_url_for_type("weekly")
        if weekly_url:
            res = send_discord_payload(weekly_url, [build_weekly_embed()])
            if res.get("success"):
                dispatched = True

    # 3. รายงานประจำเดือน (ส่งในคืนวันสุดท้ายของเดือน ไปยังห้องรายเดือน)
    last_day_of_month = calendar.monthrange(target_dt.year, target_dt.month)[1]
    if target_dt.day == last_day_of_month:
        monthly_url = get_webhook_url_for_type("monthly")
        if monthly_url:
            res = send_discord_payload(monthly_url, [build_monthly_embed(target_dt.strftime("%Y-%m"))])
            if res.get("success"):
                dispatched = True

    # 4. รายงานประจำปี (ส่งในคืนวันสิ้นปี 31 ธันวาคม ไปยังห้องรายปี)
    if target_dt.month == 12 and target_dt.day == 31:
        yearly_url = get_webhook_url_for_type("yearly")
        if yearly_url:
            res = send_discord_payload(yearly_url, [build_yearly_embed(str(target_dt.year))])
            if res.get("success"):
                dispatched = True

    if dispatched:
        save_setting("last_automated_report_date", target_date)
        print(f"[Automation] Dispatched reports to Discord channels for {target_date}")

def _scheduler_loop():
    while True:
        try:
            check_and_run_automation()
        except Exception as e:
            print(f"[Scheduler Error] {e}")
        time.sleep(30)  # ตรวจสอบทุกๆ 30 วินาที

def start_background_scheduler():
    """เริ่มรัน Background Thread ทำงานอัตโนมัติ"""
    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()
    print("[Scheduler] Daily Automation Worker started (Target: 23:00 every night)")
