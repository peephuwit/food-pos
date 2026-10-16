# Food POS - Restaurant Management & Cashier System

ระบบบริหารจัดการร้านอาหาร จุดขายหน้าร้าน (POS) ครัว (KDS) และระบบสั่งอาหารผ่านมือถือด้วย QR Code รองรับการทำงานทั้งแบบ Desktop Application และ Web Application

---

### ดาวน์โหลดโปรแกรมพร้อมใช้งาน (Quick Download)

สามารถดาวน์โหลดเวอร์ชันสำเร็จรูปไปเปิดใช้งานได้ทันที โดยไม่ต้องติดตั้ง Python หรือโปรแกรมเสริมใดๆ:

<p align="center">
  <a href="https://github.com/peephuwit/food-pos/releases/latest">
    <img src="https://img.shields.io/badge/Download-Windows_(.exe)-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows" />
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/peephuwit/food-pos/releases/latest">
    <img src="https://img.shields.io/badge/Download-macOS_(.dmg)-000000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS" />
  </a>
</p>

| ระบบปฏิบัติการ | ไฟล์ติดตั้ง | รูปแบบ |
| :--- | :--- | :--- |
| **Windows 10 / 11** | [FoodPOS for Windows](https://github.com/peephuwit/food-pos/releases/latest) | Single-file Portable (`.exe`) |
| **macOS 11+** | [FoodPOS for macOS (.dmg)](https://github.com/peephuwit/food-pos/releases/latest) | Apple Disk Image (`.dmg`) ลากเข้า Applications |
| **macOS 11+** | [FoodPOS for macOS (.zip)](https://github.com/peephuwit/food-pos/releases/latest) | Compressed Archive (`.zip`) แตกไฟล์แล้วเปิดแอพได้ทันที |


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
├── Build_EXE.bat            # สคริปต์คอมไพล์เป็น FoodPOS.exe บน Windows
├── Build_DMG.sh             # สคริปต์คอมไพล์เป็น FoodPOS.dmg บน macOS
├── Start_POS.bat            # สคริปต์รันบน Windows (โหมดพัฒนา)
├── Start_POS.command        # สคริปต์รันบน macOS (โหมดพัฒนา)
├── index.html               # หน้าหลักแคชเชียร์ (POS Dashboard)
├── order.html               # หน้าระบบลูกค้าสแกนสั่งอาหาร (Mobile Web)
├── kitchen.html             # หน้าระบบจอแสดงผลในครัว (KDS)
├── style.css                # ไฟล์ตกแต่งหน้าตา (Responsive Dark UI)
├── script.js                # ลอจิกการทำงานฝั่ง Frontend
├── api.js                   # ตัวเชื่อมต่อ API กับ Backend
├── qrcode.min.js            # ไลบรารีสร้าง QR Code ฝั่งเบราว์เซอร์
├── img/                     # โฟลเดอร์รูปภาพ เมนู และไอคอน (.ico / .icns)
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

## การสร้างแอพสำเร็จรูปสำหรับ macOS (Apple Disk Image .dmg)

โปรเจกต์นี้มีสคริปต์คอมไพล์เป็นตัวติดตั้ง `.dmg` ที่พร้อมลากเข้า `Applications` โดยรวม `cloudflared` และจัดการสิทธิ์ความปลอดภัยให้เรียบร้อย:

1. เปิด Terminal ในโฟลเดอร์โปรเจกต์
2. สั่งรันสคริปต์:
   ```bash
   ./Build_DMG.sh
   ```
3. เมื่อเสร็จสิ้น จะได้ไฟล์ตัวติดตั้งสำเร็จรูปที่:
   ```text
   dist/FoodPOS.dmg
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

## ขั้นตอนการนำขึ้น GitHub Release (How to Release)

1. เข้าไปยัง Repository บน GitHub: [peephuwit/food-pos](https://github.com/peephuwit/food-pos)
2. ไปที่แถบขวามือ คลิกที่หัวข้อ **Releases** แล้วกด **Draft a new release**
3. กำหนดข้อมูล Release:
   - **Choose a tag:** ตั้งชื่อแท็กเวอร์ชัน เช่น `v1.0.0` แล้วกด **Create new tag**
   - **Release title:** ตั้งชื่อเวอร์ชัน เช่น `FoodPOS v1.0.0 (Release)`
   - **Description:** ใส่รายละเอียดฟีเจอร์หรือการอัปเดต
4. แนบไฟล์ติดตั้งลงในช่อง **Attach binaries by dropping them here or selecting them**:
   - สำหรับ macOS: ลากไฟล์ `dist/FoodPOS.dmg` ไปวาง
   - สำหรับ Windows: ลากไฟล์ `FoodPOS.exe` หรือโฟลเดอร์ `dist/FoodPOS` ที่บีบอัดเป็น `.zip` ไปวาง
5. คลิก **Publish release** เพื่อเผยแพร่ทันที
   - ปุ่มดาวน์โหลดในหน้า README จะเชื่อมโยงไปยัง Release ล่าสุดโดยอัตโนมัติ

## ฐานข้อมูลและการสำรองข้อมูล (Database & Backup)

- ข้อมูลทั้งหมด (โต๊ะ, ออเดอร์, ประวัติการขาย, เมนูอาหาร) เก็บอยู่ในไฟล์ `pos.db` (SQLite)
- **การสำรองข้อมูล (Backup):** เพียงก๊อปปี้ไฟล์ `pos.db` เก็บไว้ที่ปลอดภัย หรือนำไปใส่แฟลชไดรฟ์
- **การกู้คืนข้อมูล (Restore):** วางไฟล์ `pos.db` กลับเข้าที่เดิม ข้อมูลทั้งหมดจะกลับมาสมบูรณ์ทันที
