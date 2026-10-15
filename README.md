# Food POS - Restaurant Management & Cashier System

ระบบบริหารจัดการร้านอาหาร จุดขายหน้าร้าน (POS) ครัว (KDS) และระบบสั่งอาหารผ่านมือถือด้วย QR Code รองรับการทำงานทั้งแบบ Desktop Application และ Web Application

---

### ดาวน์โหลดโปรแกรมพร้อมใช้งาน (Quick Download)

สำหรับผู้ใช้งานบน Windows สามารถดาวน์โหลดเวอร์ชันสำเร็จรูปพร้อมเปิดใช้งานได้ทันที (ไม่ต้องติดตั้ง Python หรือโปรแกรมเสริม):

[Download FoodPOS for Windows (.exe)](https://github.com/peephuwit/food-pos/releases/latest)


---

## คุณสมบัติหลัก (Key Features)

1. **ระบบแคชเชียร์และจัดการโต๊ะ (Cashier & Table Management)**
   - ผังโต๊ะแสดงสถานะแบบเรียลไทม์ (โต๊ะว่าง / มีลูกค้า / รอเช็คบิล)
   - สั่งอาหาร ย้ายโต๊ะ รวมโต๊ะ แยกบิล
   - คำนวณส่วนลด ภาษี (VAT) และค่าบริการ (Service Charge)
   - พิมพ์ใบเสร็จและใบแจ้งหนี้รองรับเครื่องพิมพ์ความร้อน (Thermal Printer 80mm / 58mm)

2. **ระบบลูกค้าสแกนสั่งอาหารผ่านมือถือ (QR Self-Ordering)**
   - สร้าง QR Code ประจำโต๊ะอัตโนมัติ
   - ลูกค้าเปิดผ่านเบราว์เซอร์บนมือถือเพื่อเลือกเมนูและส่งออเดอร์เข้าครัวได้ทันที
   - รองรับการเชื่อมต่อผ่าน Cloudflare Quick Tunnel ให้ลูกค้าที่ใช้เน็ตมือถือ 4G/5G สแกนสั่งอาหารได้โดยไม่ต้องต่อ Wi-Fi ของร้าน

3. **ระบบจอครัว (Kitchen Display System - KDS)**
   - แสดงรายการอาหารที่ต้องปรุงแบบเรียลไทม์
   - จัดกลุ่มตามโต๊ะและเวลาที่สั่ง พร้อมตัวจับเวลา
   - ปรับสถานะอาหาร (กำลังทำ / เสร็จแล้ว / ยกเลิก) พร้อมเสียงแจ้งเตือนเมื่อมีออเดอร์ใหม่

4. **การชำระเงินด้วย PromptPay QR**
   - คำนวณยอดเงินและสร้าง PromptPay QR Code อัตโนมัติตามมาตรฐาน EMVCo
   - ลูกค้าสามารถสแกนจ่ายผ่าน Mobile Banking ได้ทันที

5. **ระบบสรุปยอดขายและการแจ้งเตือนอัตโนมัติ (Analytics & Automation)**
   - สรุปยอดขายรายวัน รายสัปดาห์ และรายเดือน
   - กราฟวิเคราะห์เมนูขายดี และช่วงเวลาที่มีลูกค้าหนาแน่น
   - ส่งออกข้อมูลเป็นรายงาน Excel (.xlsx) และ CSV
   - ระบบตั้งเวลาส่งสรุปยอดขายอัตโนมัติเข้า Discord / Line ตามเวลาปิดร้าน

---

## โครงสร้างระบบ (System Architecture)

```text
food-pos/
├── app.py                   # Desktop App Launcher (pywebview)
├── Build_EXE.bat            # สคริปต์คอมไพล์เป็น FoodPOS.exe ตัวเดียว
├── Start_POS.bat            # สคริปต์รันบน Windows (โหมดพัฒนา)
├── Start_POS.command        # สคริปต์รันบน macOS
├── index.html               # หน้าหลักแคชเชียร์ (POS Dashboard)
├── order.html               # หน้าระบบลูกค้าสแกนสั่งอาหาร (Mobile Web)
├── kitchen.html             # หน้าระบบจอแสดงผลในครัว (KDS)
├── style.css                # ไฟล์ตกแต่งหน้าตา (Responsive Dark UI)
├── script.js                # ลอจิกการทำงานฝั่ง Frontend
├── api.js                   # ตัวเชื่อมต่อ API กับ Backend
├── qrcode.min.js            # ไลบรารีสร้าง QR Code ฝั่งเบราว์เซอร์
└── backend/
    ├── server.py            # HTTP & REST API Server (Python Multi-threaded)
    ├── pos.db               # ฐานข้อมูล SQLite (เมนู, โต๊ะ, ยอดขาย)
    ├── analytics.py         # คำนวณสถิติและส่งออกไฟล์ Excel/CSV
    ├── notifier.py          # ระบบส่งข้อความแจ้งเตือน Discord Webhook
    ├── scheduler.py         # Background Worker ส่งรายงานตามเวลา
    └── tunnel.py            # ควบคุม Cloudflare Tunnel (cloudflared)
```

---

## ความต้องการของระบบ (Requirements)

- **ระบบปฏิบัติการ:** Windows 10/11 หรือ macOS 11+
- **Python:** เวอร์ชัน 3.10 หรือใหม่กว่า (สำหรับการรันจากโค้ดต้นฉบับ)
- **Web Browser Engine:**
  - Windows: Microsoft Edge WebView2 (มีติดตั้งมาพร้อมกับ Windows 10/11 อยู่แล้ว)
  - macOS: WebKit (มีมาพร้อมกับระบบ macOS อยู่แล้ว)

---

## วิธีติดตั้งและเริ่มใช้งาน (Getting Started)

### 1. ติดตั้งไลบรารีที่จำเป็น
เปิด Terminal / PowerShell ในโฟลเดอร์โปรเจกต์ แล้วติดตั้งแพ็กเกจด้วยคำสั่ง:

```bash
pip install pywebview pandas openpyxl matplotlib
```

### 2. วิธีรันโปรแกรม

#### บน Windows:
- **วิธีที่ 1 (ผ่านไฟล์ .bat):** ดับเบิ้ลคลิกไฟล์ `Start_POS.bat`
- **วิธีที่ 2 (ผ่าน Command Line):**
  ```bash
  python app.py
  ```

#### บน macOS:
- **วิธีที่ 1 (ผ่านไฟล์ .command):** ดับเบิ้ลคลิกไฟล์ `Start_POS.command`
- **วิธีที่ 2 (ผ่าน Terminal):**
  ```bash
  python3 app.py
  ```

---

## การสร้างแอพสำเร็จรูปสำหรับ Windows (Standalone .exe)

โปรเจกต์นี้รองรับการรวมไฟล์ทั้งหมดเป็นไฟล์โปรแกรมพกพา (Portable Single-file Executable) โดยไม่ต้องติดตั้ง Python บนเครื่องแคชเชียร์:

1. ดับเบิ้ลคลิกไฟล์ `Build_EXE.bat`
2. รอจนกว่ากระบวนการคอมไพล์จะเสร็จสมบูรณ์
3. ผลลัพธ์จะอยู่ที่โฟลเดอร์ `dist/FoodPOS/` ซึ่งประกอบด้วย 3 ไฟล์หลัก:
   ```text
   dist/FoodPOS/
   ├── FoodPOS.exe        # ตัวโปรแกรมหลัก ดับเบิ้ลคลิกใช้งานได้ทันที
   ├── pos.db             # ไฟล์ฐานข้อมูล SQLite
   └── cloudflared.exe    # ไบนารีเชื่อมต่อระบบสั่งอาหาร 4G/5G
   ```

---

## การแจกจ่ายโปรแกรมผ่าน GitHub Releases (Distribution Guide)

เพื่อความเป็นมืออาชีพและป้องกันไม่ให้ขนาด Repository บวมจากไฟล์ไบนารีขนาดใหญ่ ให้แจกจ่ายตัวโปรแกรมผ่านระบบ **GitHub Releases** แทนการคอมมิตไฟล์ `.exe` ขึ้น Git:

1. บีบอัดโฟลเดอร์ `dist/FoodPOS/` ให้เป็นไฟล์ ZIP (เช่น `FoodPOS-Windows.zip`)
2. เปิดหน้า Repository บน GitHub แล้วคลิกที่แท็บ **Releases** (อยู่ทางขวามือของหน้าจอ)
3. คลิกปุ่ม **Draft a new release**
4. กำหนดชื่อ Tag เช่น `v1.0.0` และพิมพ์รายละเอียดการอัปเดต (Release Notes)
5. ลากไฟล์ `FoodPOS-Windows.zip` หรือ `FoodPOS.exe` มาวางในช่อง **Attach binaries by dropping them here or selecting them**
6. คลิก **Publish release**
7. ผู้ใช้งานจะสามารถคลิกดาวน์โหลดเวอร์ชันล่าสุดได้ทันทีจากลิงก์:
   ```text
   https://github.com/peephuwit/food-pos/releases/latest
   ```

---

## ฐานข้อมูลและการสำรองข้อมูล (Database & Backup)

- ข้อมูลทั้งหมด (โต๊ะ, ออเดอร์, ประวัติการขาย, เมนูอาหาร) เก็บอยู่ในไฟล์ `pos.db` (SQLite)
- **การสำรองข้อมูล (Backup):** เพียงก๊อปปี้ไฟล์ `pos.db` เก็บไว้ที่ปลอดภัย หรือนำไปใส่แฟลชไดรฟ์
- **การกู้คืนข้อมูล (Restore):** วางไฟล์ `pos.db` กลับเข้าที่เดิม ข้อมูลทั้งหมดจะกลับมาสมบูรณ์ทันที
