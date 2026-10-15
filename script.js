/* ระบบ POS ร้านค้า — เชื่อมต่อ Google Apps Script ผ่าน api.js */

var VAT_RATE = 0.07;   /* ราคาเมนูรวมภาษีแล้ว จึงถอด VAT ออกจากยอด ไม่ใช่บวกเพิ่ม */

/* ---------- ยูทิลิตี้ ---------- */
function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function baht(n, digits) {
  var v = Number(n || 0);
  /* ราคาที่มีเศษสตางค์ต้องเห็นทศนิยม ไม่งั้น 80.50 จะถูกปัดเป็น 81 */
  var d = digits == null ? (v % 1 === 0 ? 0 : 2) : digits;
  return '฿' + v.toLocaleString('th-TH', {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
}

var toastTimer = null;
function toast(msg, kind) {
  var el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (kind === 'err' ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
}

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

document.querySelectorAll('[data-close]').forEach(function (b) {
  b.addEventListener('click', function () { closeModal(b.dataset.close); });
});
document.querySelectorAll('.scrim').forEach(function (s) {
  s.addEventListener('click', function (e) { if (e.target === s) s.classList.remove('open'); });
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.scrim.open').forEach(function (s) { s.classList.remove('open'); });
  setNav(false);
});

/* ---------- ลิ้นชักเมนูบนจอแคบ ---------- */
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('nav-toggle').setAttribute('aria-expanded', String(open));
}
$('nav-toggle').addEventListener('click', function () {
  setNav(!document.body.classList.contains('nav-open'));
});
$('nav-scrim').addEventListener('click', function () { setNav(false); });

/* addEventListener บน MediaQueryList เพิ่งรองรับใน Safari 14 เครื่องเก่าที่ใช้เป็นแคชเชียร์
   จะโยน TypeError ตรงนี้แล้วสคริปต์ทั้งไฟล์หยุดทำงาน — ปุ่มเข้าสู่ระบบจะกดไม่ได้เลย */
var WIDE = matchMedia('(min-width: 901px)');
var onWide = function (e) { if (e.matches) setNav(false); };
if (WIDE.addEventListener) WIDE.addEventListener('change', onWide);
else if (WIDE.addListener) WIDE.addListener(onWide);

/* ---------- สถานะของแอป ---------- */
var HAS_BACKEND = API.isReady();
var ME = null;
var MENU = [];
var ORDERS = [];
var CART = [];
var CATEGORY = 'all';
var PAYMENT = 'เงินสด';
var PENDING_IMAGE = null;   /* รูปที่เพิ่งเลือกแต่ยังไม่ได้บันทึก */
var CLEAR_IMAGE = false;    /* กดเอารูปเดิมออกโดยไม่ได้เลือกรูปใหม่ */
var LOADING_MENU = false;
var LOADING_ORDERS = false;
var ORDERS_DATE = '';       /* วันที่ของบิลที่กำลังดูอยู่ รูปแบบ yyyy-MM-dd */

var TAB_TITLE = { pos: 'ขายหน้าร้าน', tables: 'จัดการ 4 โต๊ะ (Dine-in)', analytics: 'สถิติยอดขาย & AI Insights', orders: 'ประวัติการขาย', menu: 'เมนูและราคา' };
var SEARCH_HINT = { orders: 'ค้นหาเลขที่บิล / โต๊ะ' };

var NO_PIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 16-5-5L5 20"/></svg>';

function spinnerBox(text) {
  return '<div class="loading"><span class="spinner"></span>' + esc(text) + '</div>';
}

/* ---------- วันที่ (รูปแบบ yyyy-MM-dd แบบเวลาท้องถิ่น ห้ามใช้ toISOString เพราะเป็น UTC) ---------- */
function ymd(d) {
  return d.getFullYear()
    + '-' + ('0' + (d.getMonth() + 1)).slice(-2)
    + '-' + ('0' + d.getDate()).slice(-2);
}

function parseYmd(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function shiftYmd(s, days) {
  var d = parseYmd(s);
  /* ยังไม่เคยโหลดบิลเลย ORDERS_DATE จะเป็นค่าว่างแล้วได้ 'NaN-aN-aN' ออกมา */
  if (isNaN(d.getTime())) d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}

/* บิลถูกกรองมาทีละวันอยู่แล้ว คอลัมน์เวลาจึงไม่ต้องซ้ำวันที่ให้กินความกว้าง */
function clockOf(s) {
  var m = /(\d{1,2}:\d{2})/.exec(String(s == null ? '' : s));
  return m ? m[1] : String(s == null ? '' : s);
}

function thaiDate(s) {
  return parseYmd(s).toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// ขอรูปขนาด w400 จาก Drive แทนไฟล์เต็ม รูปเมนูในตารางกว้างไม่ถึง 400px อยู่แล้ว
function imgUrl(fileId) {
  return fileId ? 'https://lh3.googleusercontent.com/d/' + fileId + '=w400' : '';
}

/* referrerpolicy สำคัญมาก: ถ้าเบราว์เซอร์ส่ง Referer ไป lh3.googleusercontent.com
   Google จะตอบ 429 text/html แทบทุกครั้ง แล้วโดน ORB บล็อก รูปจะไม่ขึ้นเลย */
function picTag(src, alt, fileId) {
  if (!src) return NO_PIC;
  return '<img src="' + esc(src) + '" alt="' + esc(alt || '') + '" loading="lazy" referrerpolicy="no-referrer"'
    + (fileId ? ' data-drive-id="' + esc(fileId) + '"' : '') + '>';
}

/* รูปที่โหลดไม่ผ่านจริง ๆ ให้ลองอีกทางหนึ่ง แล้วถ้ายังไม่ได้ค่อยวางไอคอนแทน
   จะได้ไม่เหลือไอคอนรูปแตกค้างอยู่ในการ์ด/ตาราง */
document.addEventListener('error', function (e) {
  var el = e.target;
  if (!el || el.tagName !== 'IMG') return;
  var id = el.dataset.driveId;
  if (!id) return;

  var step = Number(el.dataset.picStep || 0);
  el.dataset.picStep = step + 1;

  if (step === 0) {
    el.src = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w400';
  } else if (step === 1) {
    /* 429 เป็นการจำกัดชั่วคราว รอสักครู่แล้วขอใหม่พร้อม cache-buster มักได้รูปกลับมา */
    setTimeout(function () {
      el.src = imgUrl(id) + '?r=' + Date.now();
    }, 1200);
  } else if (el.parentNode) {
    el.parentNode.innerHTML = NO_PIC;
  }
}, true);

/* ---------- เข้าสู่ระบบ / ออกจากระบบ ---------- */
var SESSION_KEY = 'pos.session';

function saveSession() {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(ME)); } catch (e) { }
}

function loadSession() {
  try {
    var raw = localStorage.getItem(SESSION_KEY);
    var s = raw ? JSON.parse(raw) : null;
    return s && s.username ? s : null;
  } catch (e) { return null; }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { }
}

$('login-password-toggle').addEventListener('click', function () {
  var input = $('login-password');
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  this.setAttribute('aria-pressed', show ? 'true' : 'false');
  this.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
  input.focus();
});

/* เซิร์ฟเวอร์ตอบช้าเป็นวินาที ถ้าปุ่มแค่กดไม่ได้เฉย ๆ ผู้ใช้จะไม่รู้ว่ากดติดแล้วหรือยัง */
function setLoginBusy(busy) {
  var btn = $('login-btn');
  btn.disabled = busy;
  btn.classList.toggle('is-busy', busy);
  btn.innerHTML = busy
    ? '<span class="spinner spinner-sm"></span>กำลังเข้าสู่ระบบ…'
    : 'เข้าสู่ระบบ';
}

$('login-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var err = $('login-error');
  err.textContent = '';

  if (!HAS_BACKEND) {
    err.textContent = 'ยังไม่ได้ตั้งค่า API_URL ใน api.js — ใส่ URL ของ Web App ก่อนถึงจะเข้าระบบได้';
    return;
  }

  setLoginBusy(true);
  API.checkLogin($('login-username').value.trim(), $('login-password').value)
    .then(function (res) {
      setLoginBusy(false);
      if (!res || !res.success) {
        err.textContent = (res && res.message) || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
        return;
      }
      ME = { username: res.username, role: res.role };
      saveSession();
      enterApp();
    })
    .catch(function (e2) {
      setLoginBusy(false);
      err.textContent = 'ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ: ' + (e2 && e2.message ? e2.message : e2);
    });
});

function enterApp(silent) {
  document.body.classList.remove('guest');
  $('me-name').textContent = ME.username;
  $('me-role').textContent = String(ME.role || '').toLowerCase() === 'admin' ? 'ผู้ดูแลระบบ' : 'พนักงาน';
  $('me-initial').textContent = String(ME.username || '?').charAt(0);

  $('login-form').reset();
  $('login-error').textContent = '';

  if (!silent) toast('เข้าสู่ระบบสำเร็จ (' + ME.username + ')');

  /* ล็อกอินเสร็จต้องได้ขายทันที บิลย้อนหลังรอไว้โหลดตอนเปิดแท็บประวัติค่อยยิง
     จะได้ไม่ต้องรอ Apps Script อีกรอบทั้งที่ยังไม่มีใครดู */
  loadMenu();
  startTablePolling();
}

$('logout-btn').addEventListener('click', function () {
  if (TABLE_POLL_TIMER) clearInterval(TABLE_POLL_TIMER);
  clearSession();
  ME = null;
  CART = [];
  MENU = [];
  ORDERS = [];
  ORDERS_DATE = '';
  CATEGORY = 'all';
  /* เครื่องเดียวใช้หลายคน ค่าที่ค้างอยู่ต้องไม่ตกไปถึงคนถัดไป */
  setPayment('เงินสด');
  $('table-no').value = '';
  document.body.classList.add('guest');
  showTab('pos');
  renderCats();
  renderBill();
  renderGrid();
});

/* ---------- สลับหน้า ---------- */
function showTab(tab) {
  TAB = tab;
  document.querySelectorAll('.side-nav button').forEach(function (b) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  });
  ['pos', 'tables', 'analytics', 'orders', 'menu'].forEach(function (t) {
    var el = $('view-' + t);
    if (el) el.hidden = t !== tab;
  });

  /* แผงบิลมีไว้ใช้ตอนขายเท่านั้น หน้าอื่นคืนที่ให้ตาราง */
  document.body.classList.toggle('no-bill', tab !== 'pos');

  $('cats').hidden = tab !== 'pos';
  $('bar-tools').hidden = tab === 'pos';
  var searchInput = $('admin-search');
  if (searchInput && searchInput.parentElement) {
    var isOrders = (tab === 'orders');
    searchInput.parentElement.hidden = !isOrders;
    searchInput.parentElement.style.display = isOrders ? 'flex' : 'none';
  }
  $('page-title').textContent = TAB_TITLE[tab] || 'POS';
  $('add-menu-btn').hidden = tab !== 'menu';

  if (tab === 'tables') {
    loadTablesView();
  } else if (tab === 'analytics') {
    loadAnalyticsView();
  } else if (tab === 'orders') {
    $('admin-search').placeholder = SEARCH_HINT.orders || 'ค้นหาเลขที่บิล / โต๊ะ';
    $('admin-search').value = '';
    if (ORDERS_DATE) renderOrders();
    else loadOrders(ymd(new Date()));
  } else if (tab === 'menu') {
    renderMenuTable();
  }
}

/* ---------- วิเคราะห์ยอดขาย & AI Insights ---------- */
var CURRENT_ANALYTICS_PERIOD = 'all';

var CURRENT_RANGE_START = '';
var CURRENT_RANGE_END = '';
var CURRENT_WEEK_LABEL = '';
var CURRENT_CUSTOM_YEAR = '';

function loadAnalyticsView(period, customDate, customMonth, startDate, endDate, weekLabel, customYear) {
  if (period) CURRENT_ANALYTICS_PERIOD = period;
  if (customDate !== undefined) CURRENT_CUSTOM_DATE = customDate;
  if (customMonth !== undefined) CURRENT_CUSTOM_MONTH = customMonth;
  if (startDate !== undefined) CURRENT_RANGE_START = startDate;
  if (endDate !== undefined) CURRENT_RANGE_END = endDate;
  if (weekLabel !== undefined) CURRENT_WEEK_LABEL = weekLabel;
  if (customYear !== undefined) CURRENT_CUSTOM_YEAR = customYear;

  // ไฮไลต์ปุ่มที่เลือก (ถ้าเลือกแบบระบุวัน, เดือน, ปี, หรือช่วงสัปดาห์ ให้เคลียร์ปุ่มช่วงเวลาสำเร็จรูป)
  document.querySelectorAll('.analytics-filter-btn').forEach(function (btn) {
    var isCurrent = (CURRENT_ANALYTICS_PERIOD !== 'date' && CURRENT_ANALYTICS_PERIOD !== 'custom_month' && CURRENT_ANALYTICS_PERIOD !== 'custom_year' && CURRENT_ANALYTICS_PERIOD !== 'range') && (btn.dataset.period === CURRENT_ANALYTICS_PERIOD);
    btn.style.background = isCurrent ? 'var(--orange)' : 'transparent';
    btn.style.color = isCurrent ? '#fff' : 'var(--label)';
  });

  // ปรับป้ายหัวข้อยอดขายรวม
  var revLabel = $('analytics-revenue-label');
  if (revLabel) {
    if (CURRENT_ANALYTICS_PERIOD === 'today') revLabel.textContent = 'ยอดขายวันนี้';
    else if (CURRENT_ANALYTICS_PERIOD === 'this_week') revLabel.textContent = 'ยอดขายสัปดาห์นี้ (จันทร์ - อาทิตย์)';
    else if (CURRENT_ANALYTICS_PERIOD === 'this_year') revLabel.textContent = 'ยอดขายประจำปีนี้ (' + new Date().getFullYear() + ')';
    else if (CURRENT_ANALYTICS_PERIOD === 'custom_year') revLabel.textContent = 'ยอดขายประจำปี (' + CURRENT_CUSTOM_YEAR + ')';
    else if (CURRENT_ANALYTICS_PERIOD === 'date') revLabel.textContent = 'ยอดขายประจำวัน (' + CURRENT_CUSTOM_DATE + ')';
    else if (CURRENT_ANALYTICS_PERIOD === 'custom_month') revLabel.textContent = 'ยอดขายประจำเดือน (' + CURRENT_CUSTOM_MONTH + ')';
    else if (CURRENT_ANALYTICS_PERIOD === 'range') revLabel.textContent = 'ยอดขาย' + (CURRENT_WEEK_LABEL ? ' ' + CURRENT_WEEK_LABEL : '') + ' (' + CURRENT_RANGE_START + ' ถึง ' + CURRENT_RANGE_END + ')';
    else revLabel.textContent = 'ยอดขายสะสมทั้งหมด';
  }

  API.getSalesOverview(CURRENT_ANALYTICS_PERIOD, CURRENT_CUSTOM_DATE, CURRENT_CUSTOM_MONTH, CURRENT_RANGE_START, CURRENT_RANGE_END, CURRENT_CUSTOM_YEAR).then(function (data) {
    if (!data) return;

    $('analytics-revenue').textContent = baht(data.totalRevenue || 0);
    if ($('analytics-cash')) $('analytics-cash').textContent = baht(data.cashRevenue || 0);
    if ($('analytics-transfer')) $('analytics-transfer').textContent = baht(data.transferRevenue || 0);
    $('analytics-bills').textContent = (data.totalBills || 0) + ' บิล';
    var avgTicket = data.totalBills ? (data.totalRevenue / data.totalBills) : 0;
    $('analytics-avg').textContent = baht(avgTicket);

    // เติมตัวเลือกปีใน select box ถ้ายังไม่มี
    var yearSelect = $('analytics-year-select');
    if (yearSelect && data.availableYears && data.availableYears.length) {
      var currentSelectVal = yearSelect.value;
      if (yearSelect.options.length <= 1) {
        yearSelect.innerHTML = '<option value="">เลือกปี...</option>' + data.availableYears.map(function (y) {
          return '<option value="' + y + '">' + y + '</option>';
        }).join('');
        if (currentSelectVal) yearSelect.value = currentSelectVal;
      }
    }

    // เรนเดอร์การ์ดยอดขายรายสัปดาห์ (Weekly Breakdown จันทร์ - อาทิตย์)
    var weeklyPanel = $('analytics-weekly-panel');
    var weeklyCards = $('analytics-weekly-cards');
    var weeklyMonthTitle = $('analytics-weekly-month-title');

    if (weeklyPanel && weeklyCards) {
      if (data.weeklyBreakdown && data.weeklyBreakdown.length > 0) {
        weeklyPanel.style.display = 'block';
        if (weeklyMonthTitle) weeklyMonthTitle.textContent = data.targetMonth || '';

        weeklyCards.innerHTML = data.weeklyBreakdown.map(function (w) {
          var isSelected = (CURRENT_ANALYTICS_PERIOD === 'range' && CURRENT_RANGE_START === w.startDate && CURRENT_RANGE_END === w.endDate);
          var activeClass = isSelected ? ' selected' : '';
          var badgeHtml = w.isCurrent
            ? '<span style="font-size:11px; background:#dcfce7; color:#15803d; padding:2px 7px; border-radius:10px; font-weight:700; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#15803d;"></span>กำลังดำเนินอยู่</span>'
            : '<span style="font-size:11px; color:var(--muted); font-weight:500;">' + w.daysCount + ' วัน</span>';

          return '<div class="weekly-card' + activeClass + '" onclick="selectAnalyticsWeek(' + w.weekNumber + ', \'' + w.startDate + '\', \'' + w.endDate + '\')" title="คลิกเพื่อดูกรองยอดขายสัปดาห์ที่ ' + w.weekNumber + '">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">' +
              '<b class="card-title" style="font-size:14px; color:var(--ink); transition:color .18s;">สัปดาห์ที่ ' + w.weekNumber + '</b>' +
              badgeHtml +
            '</div>' +
            '<div style="font-size:12px; color:var(--muted); margin-bottom:10px;">' + w.startDate + ' ถึง ' + w.endDate + '</div>' +
            '<div style="font-size:18px; font-weight:700; color:var(--orange); margin-bottom:6px;">' + baht(w.totalRevenue) + '</div>' +
            '<div style="display:flex; justify-content:space-between; font-size:11.5px; color:#64748b; border-top:1px dashed var(--line); padding-top:6px;">' +
              '<span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:7px; height:7px; border-radius:50%; background:#10b981;"></span>' + baht(w.cashRevenue) + '</span>' +
              '<span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:7px; height:7px; border-radius:50%; background:#3b82f6;"></span>' + baht(w.transferRevenue) + '</span>' +
              '<span>' + w.billsCount + ' บิล</span>' +
            '</div>' +
          '</div>';
        }).join('');
      } else if (CURRENT_ANALYTICS_PERIOD !== 'range') {
        weeklyPanel.style.display = 'none';
      }
    }

    // เรนเดอร์การ์ดยอดขายรายเดือนประจำปี (Monthly Breakdown ประจำปี)
    var monthlyPanel = $('analytics-monthly-panel');
    var monthlyCards = $('analytics-monthly-cards');
    var monthlyYearTitle = $('analytics-monthly-year-title');

    if (monthlyPanel && monthlyCards) {
      if (data.monthlyBreakdown && data.monthlyBreakdown.length > 0) {
        monthlyPanel.style.display = 'block';
        if (monthlyYearTitle) monthlyYearTitle.textContent = data.targetYear || '';

        monthlyCards.innerHTML = data.monthlyBreakdown.map(function (m) {
          var isSelected = (CURRENT_ANALYTICS_PERIOD === 'custom_month' && CURRENT_CUSTOM_MONTH === m.month);
          var activeClass = isSelected ? ' selected' : '';
          var badgeHtml = m.isCurrent
            ? '<span style="font-size:11px; background:#dcfce7; color:#15803d; padding:2px 7px; border-radius:10px; font-weight:700; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#15803d;"></span>เดือนนี้</span>'
            : '<span style="font-size:11px; color:var(--muted); font-weight:500;">' + m.month + '</span>';

          return '<div class="monthly-card' + activeClass + '" onclick="selectAnalyticsMonth(\'' + m.month + '\')" title="คลิกเพื่อดูกรองยอดขายเดือน ' + m.monthName + '">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">' +
              '<b class="card-title" style="font-size:14px; color:var(--ink); transition:color .18s;">' + m.monthName + '</b>' +
              badgeHtml +
            '</div>' +
            '<div style="font-size:18px; font-weight:700; color:var(--orange); margin-bottom:6px;">' + baht(m.totalRevenue) + '</div>' +
            '<div style="display:flex; justify-content:space-between; font-size:11.5px; color:#64748b; border-top:1px dashed var(--line); padding-top:6px;">' +
              '<span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:7px; height:7px; border-radius:50%; background:#10b981;"></span>' + baht(m.cashRevenue) + '</span>' +
              '<span style="display:inline-flex; align-items:center; gap:4px;"><span style="width:7px; height:7px; border-radius:50%; background:#3b82f6;"></span>' + baht(m.transferRevenue) + '</span>' +
              '<span>' + m.billsCount + ' บิล</span>' +
            '</div>' +
          '</div>';
        }).join('');
      } else {
        monthlyPanel.style.display = 'none';
      }
    }

    // เรนเดอร์อันดับยอดขายทุกเมนูในร้าน
    var topContainer = $('analytics-top-items');
    var menuCountTag = $('analytics-menu-count');
    if (topContainer) {
      if (!data.topMenuItems || data.topMenuItems.length === 0) {
        topContainer.innerHTML = '<div style="text-align:center; color:var(--muted); padding:20px;">ไม่มีข้อมูลการขายในช่วงเวลานี้</div>';
        if (menuCountTag) menuCountTag.textContent = '';
      } else {
        if (menuCountTag) menuCountTag.textContent = data.topMenuItems.length + ' เมนู';
        topContainer.innerHTML = data.topMenuItems.map(function (it, idx) {
          var rankBg = idx === 0 ? '#fef3c7' : (idx === 1 ? '#e2e8f0' : (idx === 2 ? '#ffedd5' : '#f1f5f9'));
          var rankColor = idx === 0 ? '#d97706' : (idx === 1 ? '#475569' : (idx === 2 ? '#ea580c' : '#64748b'));
          var isZero = it.qty === 0;

          return '<div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--line-l); opacity:' + (isZero ? '0.6' : '1') + ';">' +
            '<div style="display:flex; align-items:center; gap:10px;">' +
              '<span style="width:26px; height:26px; border-radius:50%; background:' + rankBg + '; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; color:' + rankColor + ';">' + (idx + 1) + '</span>' +
              '<div>' +
                '<span style="font-weight:600; font-size:14px; color:var(--ink);">' + esc(it.name) + '</span>' +
                (it.category ? '<div style="font-size:11.5px; color:var(--muted);">' + esc(it.category) + '</div>' : '') +
              '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
              '<b style="color:' + (isZero ? 'var(--muted)' : 'var(--ink)') + '; font-size:14px;">' + it.qty + ' จาน</b>' +
              '<div style="font-size:12px; color:' + (isZero ? 'var(--muted)' : 'var(--orange)') + '; font-weight:' + (isZero ? '400' : '600') + ';">' + baht(it.revenue) + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    }

    // เรนเดอร์สัดส่วนช่องทางชำระเงิน พร้อมแสดงยอดเงินแยกสด/โอน
    var payContainer = $('analytics-payment');
    if (payContainer) {
      var pays = data.paymentMethods || {};
      var payRevs = data.paymentRevenue || {};
      var payKeys = Object.keys(pays);
      if (payKeys.length === 0) {
        payContainer.innerHTML = '<div style="text-align:center; color:var(--muted); padding:20px;">ไม่มีข้อมูลการชำระเงินในช่วงเวลานี้</div>';
      } else {
        payContainer.innerHTML = payKeys.map(function (k) {
          var count = pays[k];
          var rev = payRevs[k] || 0;
          var pct = data.totalBills ? Math.round((count / data.totalBills) * 100) : 0;
          var color = k === 'เงินสด' ? '#10b981' : '#3b82f6';
          return '<div style="margin-bottom:14px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; font-size:13.5px;">' +
              '<span style="display:inline-flex; align-items:center; gap:6px;">' +
                '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:' + color + ';"></span>' +
                esc(k) + ' <b>(' + baht(rev) + ')</b>' +
              '</span>' +
              '<span style="font-size:12.5px; color:var(--muted);">' + count + ' บิล (' + pct + '%)</span>' +
            '</div>' +
            '<div style="height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden;">' +
              '<div style="width:' + pct + '%; height:100%; background:' + color + '; border-radius:4px;"></div>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    }
  }).catch(function (err) {
    toast('โหลดข้อมูลสถิติไม่สำเร็จ: ' + err.message, 'err');
  });
}

// ฟังก์ชันเลือกสัปดาห์จากพาเนล Weekly Breakdown
function selectAnalyticsWeek(weekNum, startDate, endDate) {
  loadAnalyticsView('range', '', '', startDate, endDate, 'สัปดาห์ที่ ' + weekNum);
}

// ฟังก์ชันเลือกเดือนจากพาเนล Monthly Breakdown
function selectAnalyticsMonth(monthStr) {
  if ($('analytics-month-picker')) $('analytics-month-picker').value = monthStr;
  loadAnalyticsView('custom_month', '', monthStr, '', '', '', '');
}

// ผูก Event Listener ให้ปุ่มสลับช่วงเวลา
document.querySelectorAll('.analytics-filter-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    if ($('analytics-date-picker')) $('analytics-date-picker').value = '';
    if ($('analytics-month-picker')) $('analytics-month-picker').value = '';
    if ($('analytics-year-select')) $('analytics-year-select').value = '';
    loadAnalyticsView(this.dataset.period, '', '', '', '', '', '');
  });
});

// ผูก Event Listener ให้ช่องเลือกวันที่
var datePicker = $('analytics-date-picker');
if (datePicker) {
  datePicker.addEventListener('change', function () {
    if (this.value) {
      if ($('analytics-month-picker')) $('analytics-month-picker').value = '';
      if ($('analytics-year-select')) $('analytics-year-select').value = '';
      loadAnalyticsView('date', this.value, '', '', '', '', '');
    }
  });
}

// ผูก Event Listener ให้ช่องเลือกเดือน
var monthPicker = $('analytics-month-picker');
if (monthPicker) {
  monthPicker.addEventListener('change', function () {
    if (this.value) {
      if ($('analytics-date-picker')) $('analytics-date-picker').value = '';
      if ($('analytics-year-select')) $('analytics-year-select').value = '';
      loadAnalyticsView('custom_month', '', this.value, '', '', '', '');
    }
  });
}

// ผูก Event Listener ให้ช่องเลือกปี
var yearSelect = $('analytics-year-select');
if (yearSelect) {
  yearSelect.addEventListener('change', function () {
    if (this.value) {
      if ($('analytics-date-picker')) $('analytics-date-picker').value = '';
      if ($('analytics-month-picker')) $('analytics-month-picker').value = '';
      loadAnalyticsView('custom_year', '', '', '', '', '', this.value);
    }
  });
}

// ผูก Event Listener ปุ่มล้างข้อมูลทดสอบ (Reset Test Data)
var resetTestBtn = $('btn-reset-test-data');
if (resetTestBtn) {
  resetTestBtn.addEventListener('click', function () {
    if (confirm('คำเตือน: คุณต้องการล้างประวัติการขายและบิลทดสอบทั้งหมดก่อนเปิดร้านจริงใช่หรือไม่? (เมนูอาหารจะไม่ถูกลบ)')) {
      API.clearOrderHistory().then(function (res) {
        toast('ล้างข้อมูลทดสอบเรียบร้อยแล้ว');
        loadAnalyticsView('all', '', '', '', '', '', '');
        if (typeof loadOrders === 'function') loadOrders();
        if (typeof loadTablesView === 'function') loadTablesView(true);
      }).catch(function (err) {
        toast('เกิดข้อผิดพลาด: ' + err.message, 'err');
      });
    }
  });
}

// ===== ระบบ Discord Webhook & Multi-Channel Automation =====
var btnOpenDiscord = $('btn-open-discord-modal');
if (btnOpenDiscord) {
  btnOpenDiscord.addEventListener('click', function () {
    API.getDiscordSettings().then(function (data) {
      if (data) {
        if ($('discord-webhook-daily')) $('discord-webhook-daily').value = data.webhookDaily || data.webhookUrl || '';
        if ($('discord-webhook-weekly')) $('discord-webhook-weekly').value = data.webhookWeekly || data.webhookUrl || '';
        if ($('discord-webhook-monthly')) $('discord-webhook-monthly').value = data.webhookMonthly || data.webhookUrl || '';
        if ($('discord-webhook-yearly')) $('discord-webhook-yearly').value = data.webhookYearly || data.webhookUrl || '';
      }
      openModal('discord-modal');
    }).catch(function () {
      openModal('discord-modal');
    });
  });
}

$('btn-save-discord-webhook').addEventListener('click', function () {
  var settings = {
    webhookDaily: ($('discord-webhook-daily') ? $('discord-webhook-daily').value.trim() : ''),
    webhookWeekly: ($('discord-webhook-weekly') ? $('discord-webhook-weekly').value.trim() : ''),
    webhookMonthly: ($('discord-webhook-monthly') ? $('discord-webhook-monthly').value.trim() : ''),
    webhookYearly: ($('discord-webhook-yearly') ? $('discord-webhook-yearly').value.trim() : '')
  };

  if (!settings.webhookDaily && !settings.webhookWeekly && !settings.webhookMonthly && !settings.webhookYearly) {
    toast('กรุณาระบุ Webhook URL อย่างน้อย 1 ห้อง', 'err');
    return;
  }

  API.saveDiscordSettings(settings).then(function (res) {
    toast('บันทึกลิงก์ Webhook ทุกห้องเรียบร้อยแล้ว');
  }).catch(function (err) {
    toast('บันทึกไม่สำเร็จ: ' + err.message, 'err');
  });
});

$('btn-send-discord-daily').addEventListener('click', function () {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'กำลังส่ง...';
  var targetDate = (CURRENT_ANALYTICS_PERIOD === 'date' && CURRENT_CUSTOM_DATE) ? CURRENT_CUSTOM_DATE : null;

  API.triggerDiscordSummary('daily', targetDate, null, null).then(function (res) {
    if (res && res.success) toast(res.message || 'ส่งสรุปยอดรายวันเข้าห้อง Daily เรียบร้อยแล้ว');
    else toast(res.message || 'ส่งไม่สำเร็จ', 'err');
  }).catch(function (err) {
    toast('ส่งไม่สำเร็จ: ' + err.message, 'err');
  }).finally(function () {
    btn.disabled = false;
    btn.textContent = 'ส่งสรุปรายวัน (Daily)';
  });
});

$('btn-send-discord-weekly').addEventListener('click', function () {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'กำลังส่ง...';

  API.triggerDiscordSummary('weekly', null, null, null).then(function (res) {
    if (res && res.success) toast(res.message || 'ส่งสรุปสัปดาห์เข้าห้อง Weekly เรียบร้อยแล้ว');
    else toast(res.message || 'ส่งไม่สำเร็จ', 'err');
  }).catch(function (err) {
    toast('ส่งไม่สำเร็จ: ' + err.message, 'err');
  }).finally(function () {
    btn.disabled = false;
    btn.textContent = 'ส่งสรุปสัปดาห์นี้ (Weekly)';
  });
});

$('btn-send-discord-monthly').addEventListener('click', function () {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'กำลังส่ง...';
  var targetMonth = (CURRENT_ANALYTICS_PERIOD === 'custom_month' && CURRENT_CUSTOM_MONTH) ? CURRENT_CUSTOM_MONTH : null;

  API.triggerDiscordSummary('monthly', null, targetMonth, null).then(function (res) {
    if (res && res.success) toast(res.message || 'ส่งสรุปเดือนเข้าห้อง Monthly เรียบร้อยแล้ว');
    else toast(res.message || 'ส่งไม่สำเร็จ', 'err');
  }).catch(function (err) {
    toast('ส่งไม่สำเร็จ: ' + err.message, 'err');
  }).finally(function () {
    btn.disabled = false;
    btn.textContent = 'ส่งสรุปเดือนนี้ (Monthly)';
  });
});

var btnSendDiscordYearly = $('btn-send-discord-yearly');
if (btnSendDiscordYearly) {
  btnSendDiscordYearly.addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'กำลังส่ง...';
    var targetYear = (CURRENT_ANALYTICS_PERIOD === 'custom_year' && CURRENT_CUSTOM_YEAR) ? CURRENT_CUSTOM_YEAR : null;

    API.triggerDiscordSummary('yearly', null, null, targetYear).then(function (res) {
      if (res && res.success) toast(res.message || 'ส่งสรุปรายปีเข้าห้อง Yearly เรียบร้อยแล้ว');
      else toast(res.message || 'ส่งไม่สำเร็จ', 'err');
    }).catch(function (err) {
      toast('ส่งไม่สำเร็จ: ' + err.message, 'err');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = 'ส่งสรุปปีนี้ (Yearly)';
    });
  });
}

$('btn-test-discord-webhook').addEventListener('click', function () {
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'กำลังทดสอบส่งทุกห้อง...';

  API.triggerDiscordSummary('test', null, null, null).then(function (res) {
    if (res && res.success) toast(res.message || 'ส่งข้อความทดสอบเข้า Discord สำเร็จแล้ว!');
    else toast(res.message || 'ทดสอบไม่สำเร็จ', 'err');
  }).catch(function (err) {
    toast('ทดสอบไม่สำเร็จ: ' + err.message, 'err');
  }).finally(function () {
    btn.disabled = false;
    btn.textContent = 'ทดสอบการเชื่อมต่อส่งข้อความทุกห้อง';
  });
});

/* ---------- จัดการ 4 โต๊ะ (Dine-in Tables) ---------- */
var _lastTablesSnapshot = '';

function renderTablesHtml(tables) {
  var grid = $('tables-grid');
  if (!grid) return;
  if (!tables || !tables.length) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:30px;">ไม่มีข้อมูลโต๊ะ</div>';
    return;
  }
  window._cachedTables = tables;

  var occupiedCount = 0;
  grid.innerHTML = tables.map(function (t) {
    var isOccupied = t.status === 'occupied' || (t.activeBillTotal > 0);
    if (isOccupied) occupiedCount++;
    var statusColor = isOccupied ? (t.hasTakeaway ? '#ea580c' : '#ef4444') : '#10b981';
    var statusBg = isOccupied ? (t.hasTakeaway ? '#fff7ed' : '#fef2f2') : '#f0fdf4';
    var statusText = isOccupied ? (t.hasTakeaway ? 'สั่งกลับบ้าน' : 'กำลังนั่งทาน (มีออเดอร์)') : 'โต๊ะว่าง';

    var itemsListHtml = '';
    if (isOccupied && t.items && t.items.length) {
      itemsListHtml = '<div style="margin:12px 0; background:#f8fafc; border-radius:8px; padding:10px; max-height:120px; overflow-y:auto; font-size:13px;">' +
        t.items.map(function (it) {
          return '<div style="display:flex; justify-content:space-between; margin-bottom:4px;">' +
            '<span>' + esc(it.name) + ' x' + esc(it.qty) + '</span>' +
            '<span style="font-weight:600;">' + baht(it.price * it.qty) + '</span>' +
          '</div>';
        }).join('') +
      '</div>';
    }
    var tableNum = String(t.table_id || '').replace('T0', '').replace('T', '') || '1';
    var orderUrl = t.orderUrl || (window.location.protocol + '//' + window.location.host + '/order.html?table=' + tableNum);

    var checkoutBtnHtml = isOccupied
      ? '<div style="margin-top:14px; display:grid; grid-template-columns:1fr auto; gap:8px;">' +
          '<button class="btn-solid" style="background:#10b981; border:none; padding:10px 14px; font-size:13.5px;" onclick="triggerCheckoutTable(\'' + esc(t.table_name) + '\', ' + (t.activeBillTotal || 0) + ')">เช็กบิล / รับเงิน</button>' +
          '<button class="btn-line" style="padding:10px 12px; font-size:13px;" title="พิมพ์ใบส่งครัว (Kitchen Slip)" onclick="printTableKitchenSlip(\'' + esc(t.table_name) + '\')">ครัว</button>' +
        '</div>'
      : '';

    return '<div class="panel" style="padding:16px; border-top: 4px solid ' + statusColor + ';">' +
      '<div style="display:flex; justify-content:space-between; align-items:center;">' +
        '<h3 style="font-size:18px; font-weight:700;">' + esc(t.table_name) + '</h3>' +
        '<span style="background:' + statusBg + '; color:' + statusColor + '; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:700;">' +
          statusText +
        '</span>' +
      '</div>' +

      itemsListHtml +

      '<div style="margin-top:14px; display:flex; justify-content:space-between; align-items:baseline;">' +
        '<span style="font-size:13px; color:#64748b;">ยอดรวมปัจจุบัน:</span>' +
        '<b style="font-size:20px; color:' + (isOccupied ? '#ff6b35' : '#0f172a') + ';">' + baht(t.activeBillTotal || 0) + '</b>' +
      '</div>' +

      checkoutBtnHtml +
    '</div>';
  }).join('');

function openExternalUrl(url, event) {
  if (!url) return;
  var isDesktopApp = !!window.pywebview || (window.navigator.userAgent && window.navigator.userAgent.indexOf('pywebview') !== -1);
  if (isDesktopApp) {
    if (event && event.preventDefault) {
      event.preventDefault();
    }
    if (window.API && typeof API.openBrowser === 'function') {
      API.openBrowser(url).catch(function () {
        window.open(url, '_blank');
      });
    } else {
      window.open(url, '_blank');
    }
  } else {
    if (!event || !event.target || event.target.tagName !== 'A') {
      window.open(url, '_blank');
    }
  }
}

  // เรนเดอร์การ์ด QR Code ในส่วน "ลิงก์สั่งอาหารสำหรับลูกค้า" ด้านล่าง
  var qrGrid = $('table-qr-grid');
  if (qrGrid) {
    qrGrid.innerHTML = tables.map(function (t) {
      var tableNum = String(t.table_id || '').replace('T0', '').replace('T', '') || '1';
      var orderUrl = t.orderUrl || (window.location.protocol + '//' + window.location.host + '/order.html?table=' + tableNum);

      var statusBadge = t.isPublic
        ? '<span style="font-size:11px; background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:10px; font-weight:700; margin-bottom:10px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#16a34a;"></span>ออนไลน์ (4G/5G)</span>'
        : '<span style="font-size:11px; color:#64748b; margin-bottom:10px; display:inline-flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#94a3b8;"></span>เครือข่ายร้าน (Wi-Fi)</span>';

      return '<div class="panel" style="padding:16px; display:flex; flex-direction:column; align-items:center; text-align:center; border:1px solid #e2e8f0; background:#fff; border-radius:12px;">' +
        '<h3 style="font-size:16px; font-weight:700; margin-bottom:6px; color:#0f172a;">' + esc(t.table_name) + '</h3>' +
        statusBadge +
        '<div id="table-qr-' + esc(tableNum) + '" style="background:#fff; padding:10px; border-radius:12px; border:1px solid #e2e8f0; display:inline-flex; justify-content:center; align-items:center; box-shadow:0 2px 6px rgba(0,0,0,0.05); cursor:pointer;" title="คลิกเพื่อเปิดหน้าสั่งอาหารโต๊ะนี้" onclick="openExternalUrl(\'' + esc(orderUrl) + '\')"></div>' +
        '<a href="' + esc(orderUrl) + '" target="_blank" rel="noopener" class="btn-line" style="margin-top:12px; width:100%; display:block; box-sizing:border-box; text-align:center; font-weight:600; font-size:12.5px; padding:8px 0; text-decoration:none; cursor:pointer;" onclick="openExternalUrl(\'' + esc(orderUrl) + '\', event)">' +
          'เปิดสั่งอาหาร ' + esc(t.table_name) +
        '</a>' +
        '<a href="' + esc(orderUrl) + '" target="_blank" rel="noopener" style="font-size:11px; color:#3b82f6; text-decoration:underline; margin-top:6px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block;" title="' + esc(orderUrl) + '" onclick="openExternalUrl(\'' + esc(orderUrl) + '\', event)">' +
          esc(orderUrl) +
        '</a>' +
      '</div>';
    }).join('');

    // วาดภาพ QR Code ในแต่ละช่อง
    tables.forEach(function (t) {
      var tableNum = String(t.table_id || '').replace('T0', '').replace('T', '') || '1';
      var box = $('table-qr-' + tableNum);
      if (!box) return;
      box.innerHTML = '';
      var orderUrl = t.orderUrl || (window.location.protocol + '//' + window.location.host + '/order.html?table=' + tableNum);

      if (typeof QRCode !== 'undefined') {
        new QRCode(box, {
          text: orderUrl,
          width: 140,
          height: 140,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    });
  }

  var tag = $('tables-tag');
  if (tag) {
    if (occupiedCount > 0) {
      tag.textContent = occupiedCount;
      tag.style.display = 'inline-block';
    } else {
      tag.style.display = 'none';
    }
  }
}

function loadTablesView(silent) {
  var grid = $('tables-grid');
  if (!grid) return;
  if (!silent && !grid.innerHTML.trim()) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:30px; color:#64748b;">กำลังโหลดสถานะโต๊ะ...</div>';
  }

  API.getTables().then(function (tables) {
    if (!tables) return;
    var snapshot = JSON.stringify(tables);
    // ตรวจสอบว่าข้อมูลเปลี่ยนไปจากเดิมหรือไม่ (ถ้าไม่ใช่ silent ให้เรนเดอร์เสมอ)
    if (!silent || snapshot !== _lastTablesSnapshot || !$('table-qr-grid') || !$('table-qr-grid').children.length) {
      _lastTablesSnapshot = snapshot;
      renderTablesHtml(tables);
    }
  }).catch(function (err) {
    if (!silent) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:30px; color:red;">เกิดข้อผิดพลาด: ' + esc(err.message) + '</div>';
    }
  });
}

/* เล่นเสียงแจ้งเตือนสังเคราะห์ผ่าน Web Audio API โดยไม่ต้องพึ่งพาไฟล์เสียงภายนอก */
function playOrderSound() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // โน้ต D5
    osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.15); // โน้ต A5
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) { }
}

/* รัน Auto-Polling ตรวจสอบออเดอร์อัตโนมัติทุก 3 วินาทีแบบ Silent (ไร้การกระพริบ) */
var TABLE_POLL_TIMER = null;
function startTablePolling() {
  if (TABLE_POLL_TIMER) clearInterval(TABLE_POLL_TIMER);
  TABLE_POLL_TIMER = setInterval(function () {
    if (ME) {
      API.getTables().then(function (tables) {
        if (!tables) return;
        var occupiedCount = tables.filter(function (t) {
          return t.status === 'occupied' || (t.activeBillTotal > 0);
        }).length;

        var prev = window._lastOccupiedCount || 0;
        if (occupiedCount > prev) {
          playOrderSound();
          toast('มีออเดอร์ใหม่เข้ามาจากลูกค้า!');
        }
        window._lastOccupiedCount = occupiedCount;

        var tag = $('tables-tag');
        if (tag) {
          if (occupiedCount > 0) {
            tag.textContent = occupiedCount;
            tag.style.display = 'inline-block';
          } else {
            tag.style.display = 'none';
          }
        }

        // อัปเดตเฉพาะเมื่อข้อมูลเปลี่ยนแปลงจริง (Silent check ไม่กระพริบ)
        var snapshot = JSON.stringify(tables);
        if (TAB === 'tables' && snapshot !== _lastTablesSnapshot) {
          _lastTablesSnapshot = snapshot;
          renderTablesHtml(tables);
        }
      }).catch(function () {});
    }
  }, 3000);
}

var _checkoutTargetTable = null;
var _checkoutTargetAmount = 0;
var _currentReceiptData = null;

/* ---------- ระบบพิมพ์สลิปความร้อน (80mm Thermal Slip Generator) ---------- */
function printThermalContent(htmlContent) {
  var iframe = document.getElementById('print-iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
  }
  var doc = iframe.contentWindow.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print Thermal Slip</title>');
  doc.write('<style>');
  doc.write('@page { size: 80mm auto; margin: 0; }');
  doc.write('body { font-family: "Courier New", Courier, monospace, -apple-system, sans-serif; font-size: 13px; color: #000; margin: 0; padding: 12px 10px; width: 72mm; }');
  doc.write('.text-center { text-align: center; }');
  doc.write('.text-right { text-align: right; }');
  doc.write('.bold { font-weight: bold; }');
  doc.write('.divider { border-top: 1px dashed #000; margin: 8px 0; }');
  doc.write('.row { display: flex; justify-content: space-between; margin-bottom: 4px; }');
  doc.write('table { width: 100%; border-collapse: collapse; margin: 6px 0; }');
  doc.write('th, td { text-align: left; padding: 3px 0; font-size: 13px; }');
  doc.write('th.r, td.r { text-align: right; }');
  doc.write('</style></head><body>');
  doc.write(htmlContent);
  doc.write('</body></html>');
  doc.close();
  setTimeout(function () {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  }, 250);
}

function generateReceiptHtml(data) {
  var items = data.items || [];
  var itemsRows = items.map(function (it) {
    var lineTotal = (Number(it.price) || 0) * (Number(it.qty) || 1);
    return '<tr>'
      + '<td>' + esc(it.name) + '</td>'
      + '<td class="r num">' + esc(it.qty) + '</td>'
      + '<td class="r num">' + (Number(it.price) || 0).toFixed(0) + '</td>'
      + '<td class="r num bold">' + lineTotal.toFixed(2) + '</td>'
      + '</tr>';
  }).join('');

  var cashReceivedHtml = '';
  if (String(data.payment).indexOf('สด') >= 0 && data.cashReceived) {
    cashReceivedHtml = '<div class="row"><span>รับเงินสดมา</span><span class="num">' + baht(data.cashReceived) + '</span></div>'
      + '<div class="row"><span>เงินทอน</span><span class="num bold" style="font-size:14px; color:#10b981;">' + baht(data.change || 0) + '</span></div>';
  }

  var billNo = data.billNo || data.orderId || ('RCP-' + ymd(new Date()).replace(/-/g, '') + '-0001');

  return '<div class="text-center">'
    + '<div style="font-size: 16px; font-weight: bold;">Food POS Suite</div>'
    + '<div style="font-size: 11px; color:#475569;">สาขาหลัก • Dine-in & Takeaway</div>'
    + '<div class="divider"></div>'
    + '<div class="row"><span>วันที่: ' + esc(data.time || new Date().toLocaleString('th-TH')) + '</span></div>'
    + '<div class="row"><span>เลขที่: ' + esc(billNo) + '</span><span class="bold">' + esc(data.table || '-') + '</span></div>'
    + '<div class="row"><span>พนักงาน: ' + esc((ME && ME.username) || 'Staff') + '</span></div>'
    + '<div class="divider"></div>'
    + '</div>'
    + '<table>'
    + '<thead><tr style="border-bottom:1px dashed #000;"><th>รายการ</th><th class="r">จน.</th><th class="r">ราคา</th><th class="r">รวม</th></tr></thead>'
    + '<tbody>' + itemsRows + '</tbody>'
    + '</table>'
    + '<div class="divider"></div>'
    + '<div class="row" style="font-size:15px; font-weight:bold;"><span>ยอดรวมสุทธิ</span><span class="num">' + baht(data.total || 0) + '</span></div>'
    + '<div class="row"><span>วิธีชำระ</span><span class="bold">' + esc(data.payment || 'เงินสด') + '</span></div>'
    + cashReceivedHtml
    + '<div class="divider"></div>'
    + '<div class="text-center" style="font-size:11px; margin-top:8px;">*** ขอบคุณที่ใช้บริการ / Thank you! ***</div>';
}

function generateKitchenSlipHtml(data) {
  var items = data.items || [];
  var itemsRows = items.map(function (it, idx) {
    return '<tr>'
      + '<td style="padding:4px 0; font-size:15px; font-weight:bold;">' + (idx + 1) + '. ' + esc(it.name) + '</td>'
      + '<td style="padding:4px 0; text-align:right; font-size:18px; font-weight:900;">x ' + esc(it.qty) + '</td>'
      + '</tr>';
  }).join('');

  return '<div class="text-center">'
    + '<div style="font-size:16px; font-weight:bold;">[ ใบสั่งทำอาหาร / ห้องครัว ]</div>'
    + '<div style="font-size:24px; font-weight:900; margin:6px 0;">*** ' + esc(data.table || 'ไม่ระบุโต๊ะ') + ' ***</div>'
    + '<div style="font-size:12px;">เวลา: ' + esc(data.time || new Date().toLocaleString('th-TH')) + '</div>'
    + '<div style="font-size:11px;">บิล: ' + esc(data.billNo || data.orderId || '-') + '</div>'
    + '<div class="divider"></div>'
    + '</div>'
    + '<table style="width:100%; border-collapse:collapse;">'
    + '<thead><tr style="border-bottom:1px solid #000;"><th style="text-align:left; padding-bottom:4px;">รายการอาหาร</th><th style="text-align:right; padding-bottom:4px;">จำนวน</th></tr></thead>'
    + '<tbody>' + itemsRows + '</tbody>'
    + '</table>'
    + '<div class="divider"></div>'
    + '<div class="text-center" style="font-size:12px; margin-top:6px;">กรุณาตรวจสอบและเสิร์ฟตามลำดับ</div>';
}

function openReceiptModal(data) {
  _currentReceiptData = data;
  var paper = $('thermal-receipt-paper');
  if (paper) {
    paper.innerHTML = generateReceiptHtml(data);
  }
  openModal('receipt-modal');
}

function printCurrentReceipt() {
  if (!_currentReceiptData) return;
  printThermalContent(generateReceiptHtml(_currentReceiptData));
}

function printCurrentKitchenTicket() {
  if (!_currentReceiptData) return;
  printThermalContent(generateKitchenSlipHtml(_currentReceiptData));
}

function printTableKitchenSlip(tableName) {
  var tables = window._cachedTables || [];
  var t = tables.find(function (x) { return x.table_name === tableName; });
  if (!t || !t.items || !t.items.length) {
    toast('โต๊ะนี้ยังไม่มีรายการอาหารค้างทำในครัว', 'err');
    return;
  }
  var data = {
    table: tableName,
    time: new Date().toLocaleTimeString('th-TH'),
    orderId: 'โต๊ะ ' + tableName,
    items: t.items
  };
  printThermalContent(generateKitchenSlipHtml(data));
}

function setupCashCalculator(amount) {
  var input = $('input-cash-received');
  var changeLbl = $('lbl-cash-change');
  var quickContainer = $('cash-quick-btns');
  if (!input) return;

  input.value = amount;
  if (changeLbl) changeLbl.textContent = '฿0.00';

  var quicks = [amount];
  [100, 500, 1000].forEach(function (v) {
    if (v > amount && quicks.indexOf(v) < 0) quicks.push(v);
  });
  if (amount >= 1000) {
    var next500 = Math.ceil(amount / 500) * 500;
    if (quicks.indexOf(next500) < 0) quicks.push(next500);
  }

  if (quickContainer) {
    quickContainer.innerHTML = quicks.map(function (v, idx) {
      var label = (idx === 0) ? 'พอดี (' + v + ')' : '' + v;
      return '<button type="button" class="btn-line" style="flex:1; padding:6px 2px; font-size:12px; font-weight:600;" onclick="setCashAmount(' + v + ')">' + label + '</button>';
    }).join('');
  }

  input.oninput = function () {
    var val = Number(input.value) || 0;
    var ch = Math.max(0, val - _checkoutTargetAmount);
    if (changeLbl) changeLbl.textContent = baht(ch);
  };
}

function setCashAmount(val) {
  var input = $('input-cash-received');
  var changeLbl = $('lbl-cash-change');
  if (input) input.value = val;
  var ch = Math.max(0, val - _checkoutTargetAmount);
  if (changeLbl) changeLbl.textContent = baht(ch);
}

function triggerCheckoutTable(tableName, amount) {
  _checkoutTargetTable = tableName;
  _checkoutTargetAmount = Number(amount) || 0;
  var titleEl = $('modal-table-title');
  var amountEl = $('modal-table-amount');
  if (titleEl) titleEl.textContent = 'เช็กบิล ' + tableName;
  if (amountEl) amountEl.textContent = baht(_checkoutTargetAmount);

  var methodSelector = $('checkout-method-selector');
  var cashPanel = $('checkout-cash-panel');
  if (methodSelector) methodSelector.style.display = 'block';
  if (cashPanel) cashPanel.style.display = 'none';

  openModal('table-checkout-modal');
}

function processTablePayment(method, cashReceived, change) {
  if (!_checkoutTargetTable) return;
  var tableName = _checkoutTargetTable;
  closeModal('table-checkout-modal');

  API.checkoutTable(tableName, method).then(function (res) {
    if (res.success) {
      toast('เช็กบิล ' + tableName + ' สำเร็จ (' + baht(res.totalPaid) + ' - ' + method + ')');
      _lastTablesSnapshot = ''; // บังคับรีเฟรชหน้าจอโต๊ะทันที
      loadTablesView();
      if (ORDERS_DATE) loadOrders(ORDERS_DATE);

      // เปิดใบเสร็จรับเงินทันที
      openReceiptModal({
        billNo: res.billNo,
        table: res.table,
        time: res.time,
        total: res.totalPaid,
        payment: res.payment,
        items: res.items,
        cashReceived: cashReceived,
        change: change
      });
    } else {
      toast(res.message || 'เช็กบิลไม่สำเร็จ', 'err');
    }
  }).catch(function (e) {
    toast('ข้อผิดพลาด: ' + e.message, 'err');
  }).finally(function () {
    _checkoutTargetTable = null;
  });
}

$('btn-pay-cash').addEventListener('click', function () {
  var methodSelector = $('checkout-method-selector');
  var cashPanel = $('checkout-cash-panel');
  if (methodSelector) methodSelector.style.display = 'none';
  if (cashPanel) cashPanel.style.display = 'block';
  setupCashCalculator(_checkoutTargetAmount);
  var input = $('input-cash-received');
  if (input) input.focus();
});

var btnBackCash = $('btn-back-from-cash');
if (btnBackCash) {
  btnBackCash.addEventListener('click', function () {
    var methodSelector = $('checkout-method-selector');
    var cashPanel = $('checkout-cash-panel');
    if (methodSelector) methodSelector.style.display = 'block';
    if (cashPanel) cashPanel.style.display = 'none';
  });
}

var btnConfirmCash = $('btn-confirm-cash');
if (btnConfirmCash) {
  btnConfirmCash.addEventListener('click', function () {
    var input = $('input-cash-received');
    var cash = Number(input ? input.value : 0) || 0;
    if (cash < _checkoutTargetAmount) {
      toast('จำนวนเงินสดที่รับมาน้อยกว่ายอดชำระ', 'err');
      return;
    }
    var change = cash - _checkoutTargetAmount;
    if (window._checkoutIsCart) {
      executeCartCheckout('เงินสด', cash, change);
    } else {
      processTablePayment('เงินสด', cash, change);
    }
  });
}

$('btn-pay-qr').addEventListener('click', function () {
  if (window._checkoutIsCart) {
    executeCartCheckout('โอนเงิน', _checkoutTargetAmount, 0);
  } else {
    processTablePayment('โอนเงิน', _checkoutTargetAmount, 0);
  }
});

var btnPrintRec = $('btn-print-receipt');
if (btnPrintRec) btnPrintRec.addEventListener('click', printCurrentReceipt);

var btnPrintKitch = $('btn-print-kitchen-from-receipt');
if (btnPrintKitch) btnPrintKitch.addEventListener('click', printCurrentKitchenTicket);

document.querySelectorAll('.side-nav button').forEach(function (b) {
  b.addEventListener('click', function () {
    showTab(b.dataset.tab);
    setNav(false);
  });
});

/* ---------- โหลดข้อมูล ---------- */
function onError(err) {
  console.error(err);
  toast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ: ' + (err && err.message ? err.message : err), 'err');
}

var MENU_CACHE_KEY = 'pos.menu';

function saveMenuCache() {
  try { localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(MENU)); } catch (e) { }
}

function loadMenuCache() {
  try {
    var raw = localStorage.getItem(MENU_CACHE_KEY);
    var list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

function loadMenu() {
  if (!HAS_BACKEND) return Promise.resolve();

  /* วาดเมนูของรอบก่อนออกมาก่อนเลย แล้วค่อยทับด้วยของจริงเมื่อโหลดเสร็จ — ไม่ต้องนั่งดูสปินเนอร์ */
  if (!MENU.length) {
    MENU = loadMenuCache();
    renderCats();
    renderCatOptions();
  }

  LOADING_MENU = true;
  renderGrid();
  renderMenuTable();

  return API.getAllMenuForAdmin()
    .then(function (data) {
      MENU = (data || []).map(function (it) {
        var img = it.image || it.imageUrl || (it.fileId ? imgUrl(it.fileId) : '');
        return {
          id: it.id,
          name: it.name,
          category: it.category,
          price: Number(it.price) || 0,
          active: !!it.active,
          driveId: it.driveId || '',
          fileId: it.fileId || '',
          image: img,
          imageUrl: img
        };
      });
      saveMenuCache();
    })
    .catch(onError)
    .finally(function () {
      LOADING_MENU = false;
      renderCats();
      renderGrid();
      renderMenuTable();
      renderCatOptions();
    });
}

function loadOrders(date) {
  if (!HAS_BACKEND) return Promise.resolve();
  var next = date || ORDERS_DATE || ymd(new Date());
  /* เปลี่ยนวันแล้วต้องล้างของเดิม ไม่งั้นยอดสรุปยังเป็นของวันก่อนระหว่างรอโหลด */
  if (next !== ORDERS_DATE) ORDERS = [];
  ORDERS_DATE = next;
  $('day-date').value = ORDERS_DATE;
  LOADING_ORDERS = true;
  renderOrders();

  /* กดเปลี่ยนวันรัว ๆ ผลลัพธ์ของวันเก่าอาจกลับมาทีหลัง จึงต้องทิ้งถ้าไม่ใช่วันที่ดูอยู่ */
  var want = ORDERS_DATE;
  return API.getOrdersByDate(ORDERS_DATE)
    .then(function (data) {
      if (want !== ORDERS_DATE) return;
      ORDERS = (data && data.orders) || [];
    })
    .catch(function (e) { if (want === ORDERS_DATE) onError(e); })
    .finally(function () {
      if (want !== ORDERS_DATE) return;
      LOADING_ORDERS = false;
      renderOrders();
    });
}

/* ---------- หน้าขาย ---------- */
function renderCats() {
  var cats = [];
  MENU.forEach(function (m) {
    if (m.active && m.category && cats.indexOf(m.category) < 0) cats.push(m.category);
  });
  if (CATEGORY !== 'all' && cats.indexOf(CATEGORY) < 0) CATEGORY = 'all';

  var box = $('cats');
  box.innerHTML = '';
  ['all'].concat(cats).forEach(function (c) {
    var b = document.createElement('button');
    b.className = CATEGORY === c ? 'on' : '';
    b.textContent = c === 'all' ? 'ทั้งหมด' : c;
    b.addEventListener('click', function () {
      CATEGORY = c;
      renderCats();
      renderGrid();
    });
    box.appendChild(b);
  });
}

function cartQty(id) {
  var line = CART.filter(function (c) { return String(c.id) === String(id); })[0];
  return line ? line.qty : 0;
}

function renderGrid() {
  var grid = $('grid');

  /* โชว์สปินเนอร์เฉพาะตอนยังไม่มีข้อมูลในมือ ถ้ามีของเดิมอยู่แล้วให้คงไว้ก่อน จะได้ไม่กะพริบ */
  if (LOADING_MENU && !MENU.length) {
    grid.innerHTML = spinnerBox('กำลังโหลดเมนู…');
    return;
  }

  var list = MENU.filter(function (m) {
    if (!m.active) return false;
    return CATEGORY === 'all' || m.category === CATEGORY;
  });

  if (!list.length) {
    grid.innerHTML = '<div class="empty">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h11a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3z"/><path d="M18 8h2v13H7"/></svg>'
      + (MENU.length ? 'ไม่มีเมนูในหมวดนี้' : 'ยังไม่มีเมนูในระบบ — เพิ่มได้ที่หน้าเมนูและราคา')
      + '</div>';
    return;
  }

  grid.innerHTML = list.map(function (m) {
    var q = cartQty(m.id);
    var pic = picTag(m.image || m.imageUrl, m.name, m.fileId);
    return '<button type="button" class="card" data-id="' + esc(m.id) + '">'
      + '<span class="card-pic">' + pic + '</span>'
      + (q ? '<span class="card-qty">' + q + '</span>' : '')
      + '<span class="card-body">'
      + '<span class="card-name">' + esc(m.name) + '</span>'
      + '<span class="card-price">' + baht(m.price) + '</span>'
      + '</span></button>';
  }).join('');

  grid.querySelectorAll('.card').forEach(function (card) {
    card.addEventListener('click', function () { addToCart(card.dataset.id); });
  });
}

/* ---------- บิล ---------- */
function addToCart(id) {
  var item = MENU.filter(function (m) { return String(m.id) === String(id); })[0];
  if (!item) return;

  var line = CART.filter(function (c) { return String(c.id) === String(id); })[0];
  if (line) line.qty++;
  else CART.push({ id: item.id, name: item.name, price: item.price, qty: 1 });

  renderBill();
  renderGrid();
}

function cartTotal() {
  return CART.reduce(function (s, c) { return s + c.price * c.qty; }, 0);
}

function renderBill() {
  var total = cartTotal();
  var pieces = CART.reduce(function (s, c) { return s + c.qty; }, 0);
  var net = total / (1 + VAT_RATE);

  $('sum-net').textContent = baht(net, 2);
  $('sum-vat').textContent = baht(total - net, 2);
  $('bill-sum').hidden = !CART.length;

  $('checkout-btn').disabled = !CART.length;
  $('checkout-btn').textContent = 'ชำระเงิน ' + baht(total);
  $('clear-cart-btn').disabled = !CART.length;

  var tag = $('cart-tag');
  tag.textContent = pieces;
  tag.classList.toggle('on', pieces > 0);

  var box = $('bill-items');
  if (!CART.length) {
    box.innerHTML = '<div class="bill-empty">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 7H6"/></svg>'
      + 'ยังไม่มีรายการ<br>กดที่การ์ดเมนูเพื่อเพิ่มลงบิล</div>';
    return;
  }

  box.innerHTML = CART.map(function (c, i) {
    return '<div class="bi">'
      + '<span class="bi-name">' + esc(c.name) + ' <i>×' + c.qty + '</i></span>'
      + '<span class="bi-total">' + baht(c.price * c.qty) + '</span>'
      + '<span class="bi-unit">' + baht(c.price) + ' / หน่วย</span>'
      + '<span class="bi-qty">'
      + '<button type="button" data-act="minus" data-i="' + i + '" aria-label="ลดจำนวน"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg></button>'
      + '<b>' + c.qty + '</b>'
      + '<button type="button" data-act="plus" data-i="' + i + '" aria-label="เพิ่มจำนวน"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>'
      + '<button type="button" class="rm" data-act="remove" data-i="' + i + '" aria-label="เอาออก"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
      + '</span></div>';
  }).join('');

  box.querySelectorAll('button[data-act]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = Number(b.dataset.i);
      var act = b.dataset.act;
      if (act === 'plus') {
        CART[i].qty++;
      } else if (act === 'minus') {
        CART[i].qty--;
        if (CART[i].qty <= 0) CART.splice(i, 1);
      } else {
        CART.splice(i, 1);
      }
      renderBill();
      renderGrid();
    });
  });
}

$('clear-cart-btn').addEventListener('click', function () {
  CART = [];
  renderBill();
  renderGrid();
});

function setPayment(name) {
  PAYMENT = name;
  $('bill-pay').querySelectorAll('button').forEach(function (x) {
    x.className = x.dataset.pay === name ? 'on' : '';
  });
}

$('bill-pay').querySelectorAll('button').forEach(function (b) {
  b.addEventListener('click', function () { setPayment(b.dataset.pay); });
});

/* ---------- ชำระเงิน ---------- */
function checkout() {
  if (!CART.length) return;
  if (!HAS_BACKEND) { toast('ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์', 'err'); return; }

  var total = CART.reduce(function (sum, item) { return sum + (item.price * item.qty); }, 0);
  var table = $('table-no').value.trim() || 'สั่งกลับบ้าน / ไม่ระบุ';

  window._checkoutIsCart = true;
  _checkoutTargetTable = table;
  _checkoutTargetAmount = total;

  var titleEl = $('modal-table-title');
  var amountEl = $('modal-table-amount');
  if (titleEl) titleEl.textContent = 'ชำระเงิน: ' + table;
  if (amountEl) amountEl.textContent = baht(_checkoutTargetAmount);

  var methodSelector = $('checkout-method-selector');
  var cashPanel = $('checkout-cash-panel');

  if (PAYMENT === 'เงินสด') {
    if (methodSelector) methodSelector.style.display = 'none';
    if (cashPanel) cashPanel.style.display = 'block';
    setupCashCalculator(_checkoutTargetAmount);
    var input = $('input-cash-received');
    if (input) setTimeout(function () { input.focus(); }, 100);
  } else {
    if (methodSelector) methodSelector.style.display = 'block';
    if (cashPanel) cashPanel.style.display = 'none';
  }

  openModal('table-checkout-modal');
}

function executeCartCheckout(paymentMethod, cashReceived, change) {
  closeModal('table-checkout-modal');
  var table = _checkoutTargetTable || 'สั่งกลับบ้าน / ไม่ระบุ';
  var order = {
    tableName: table,
    payment: paymentMethod,
    items: CART.map(function (c) { return { name: c.name, price: c.price, qty: c.qty }; })
  };

  $('checkout-btn').disabled = true;

  API.submitOrder(order)
    .then(function (res) {
      if (!res || !res.success) {
        toast((res && res.message) || 'บันทึกออเดอร์ไม่สำเร็จ', 'err');
        $('checkout-btn').disabled = false;
        return;
      }
      toast('บันทึกบิล ' + (res.billNo || res.orderId) + ' เรียบร้อย');
      var boughtItems = CART.slice();
      CART = [];
      $('table-no').value = '';
      renderBill();
      renderGrid();
      loadOrders(ymd(new Date()));

      // เปิดใบเสร็จรับเงินทันที
      openReceiptModal({
        billNo: res.billNo || res.orderId,
        orderId: res.orderId,
        table: res.table || table,
        time: res.time,
        total: res.total,
        payment: paymentMethod,
        items: boughtItems,
        cashReceived: cashReceived,
        change: change
      });
    })
    .catch(function (e) {
      $('checkout-btn').disabled = false;
      console.error(e);
      toast('บันทึกบิลไม่สำเร็จ — ตรวจที่ประวัติการขายก่อนกดชำระเงินซ้ำ', 'err');
    })
    .finally(function () {
      window._checkoutIsCart = false;
      _checkoutTargetTable = null;
    });
}

$('checkout-btn').addEventListener('click', checkout);

/* ---------- ประวัติการขาย ---------- */
$('day-date').addEventListener('change', function () {
  if (this.value) loadOrders(this.value);
  else this.value = ORDERS_DATE;
});
$('day-prev').addEventListener('click', function () { loadOrders(shiftYmd(ORDERS_DATE, -1)); });
$('day-next').addEventListener('click', function () { loadOrders(shiftYmd(ORDERS_DATE, 1)); });
$('day-today').addEventListener('click', function () { loadOrders(ymd(new Date())); });

function viewPastReceipt(idx) {
  var list = window._lastRenderedOrders || [];
  var o = list[idx];
  if (!o) return;
  openReceiptModal({
    billNo: o.orderId,
    orderId: o.orderId,
    table: o.table,
    time: o.time,
    total: o.total,
    payment: o.payment,
    items: o.items || [],
    cashReceived: o.total,
    change: 0
  });
}

function renderOrders() {
  var today = ymd(new Date());
  var isToday = ORDERS_DATE === today;
  var dayWord = isToday ? 'วันนี้' : 'วันที่เลือก';

  /* เครื่องแคชเชียร์เปิดค้างข้ามคืน ถ้าตั้ง max แค่ตอนล็อกอินจะเลือกวันนี้ไม่ได้ในวันถัดมา */
  $('day-date').max = today;
  $('day-next').disabled = !ORDERS_DATE || ORDERS_DATE >= today;
  $('day-today').disabled = isToday;
  $('day-label').textContent = ORDERS_DATE ? thaiDate(ORDERS_DATE) : '';

  var total = ORDERS.reduce(function (s, o) { return s + (Number(o.total) || 0); }, 0);

  $('stat-sales-label').textContent = 'ยอดขาย' + dayWord;
  $('stat-sales').textContent = baht(total);
  $('stat-count').textContent = ORDERS.length;
  $('stat-avg').textContent = baht(ORDERS.length ? total / ORDERS.length : 0);
  $('orders-head').textContent = 'บิลของ' + dayWord;

  var body = $('orders-rows');
  if (LOADING_ORDERS && !ORDERS.length) {
    $('orders-count').textContent = '';
    body.innerHTML = '<tr><td colspan="7">' + spinnerBox('กำลังโหลดบิล…') + '</td></tr>';
    return;
  }

  var q = TAB === 'orders' ? $('admin-search').value.trim().toLowerCase() : '';
  var list = ORDERS.filter(function (o) {
    return !q || (o.orderId + ' ' + o.table).toLowerCase().indexOf(q) >= 0;
  });

  $('orders-count').textContent = list.length + ' บิล';

  if (!list.length) {
    body.innerHTML = '<tr><td colspan="7"><div class="empty">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>'
      + (ORDERS.length ? 'ไม่พบบิลที่ตรงกับที่ค้นหา' : 'ไม่มีบิลของ' + dayWord) + '</div></td></tr>';
    return;
  }

  window._lastRenderedOrders = list;
  body.innerHTML = list.map(function (o, idx) {
    var items = (o.items || []).map(function (it) { return it.name + ' ×' + it.qty; }).join(', ');
    var cash = String(o.payment).indexOf('สด') >= 0;
    return '<tr>'
      + '<td class="l t-time" title="' + esc(o.time) + '">' + esc(clockOf(o.time)) + '</td>'
      + '<td class="l t-id">' + esc(o.orderId) + '</td>'
      + '<td class="l c-table">' + esc(o.table) + '</td>'
      + '<td class="l c-items t-sub">' + esc(items) + '</td>'
      + '<td><span class="pill ' + (cash ? 'p-cash' : 'p-trans') + '">' + esc(o.payment) + '</span></td>'
      + '<td class="r t-money">' + baht(o.total) + '</td>'
      + '<td style="text-align:center;"><button type="button" class="btn-line" style="padding:4px 8px; font-size:12px; height:auto;" onclick="viewPastReceipt(' + idx + ')">สลิป</button></td>'
      + '</tr>';
  }).join('');
}

/* ---------- เมนูและราคา ---------- */
function renderCatOptions() {
  var all = [];
  MENU.forEach(function (m) { if (m.category && all.indexOf(m.category) < 0) all.push(m.category); });
  $('cat-options').innerHTML = all.map(function (c) {
    return '<option value="' + esc(c) + '"></option>';
  }).join('');
}

function renderMenuTable() {
  var body = $('menu-rows');
  if (LOADING_MENU && !MENU.length) {
    $('menu-count').textContent = '';
    body.innerHTML = '<tr><td colspan="6">' + spinnerBox('กำลังโหลดเมนู…') + '</td></tr>';
    return;
  }

  var list = MENU;
  $('menu-count').textContent = list.length + ' รายการ';

  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h11a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3z"/><path d="M18 8h2v13H7"/></svg>'
      + 'ยังไม่มีเมนูในระบบ — กดปุ่ม “+ เพิ่มเมนู” เพื่อเพิ่มรายการ</div></td></tr>';
    return;
  }

  body.innerHTML = list.map(function (m) {
    var pic = picTag(m.image || m.imageUrl, m.name, m.fileId);
    return '<tr>'
      + '<td class="c-img"><span class="t-pic">' + pic + '</span></td>'
      + '<td class="l t-name">' + esc(m.name) + '</td>'
      + '<td class="l c-cat t-sub">' + esc(m.category) + '</td>'
      + '<td class="r t-money">' + baht(m.price) + '</td>'
      + '<td><span class="pill ' + (m.active ? 'p-on' : 'p-off') + '">' + (m.active ? 'เปิดขาย' : 'ปิดขาย') + '</span></td>'
      + '<td><span class="acts">'
      + '<button class="mini" data-act="edit" data-id="' + esc(m.id) + '">แก้ไข</button>'
      + '<button class="mini ' + (m.active ? 'warn' : 'go') + '" data-act="toggle" data-id="' + esc(m.id) + '">' + (m.active ? 'ปิดขาย' : 'เปิดขาย') + '</button>'
      + '<button class="mini danger" data-act="delete" data-id="' + esc(m.id) + '">ลบ</button>'
      + '</span></td></tr>';
  }).join('');

  body.querySelectorAll('button[data-act]').forEach(function (b) {
    b.addEventListener('click', function () {
      var item = MENU.filter(function (m) { return String(m.id) === b.dataset.id; })[0];
      if (!item) return;
      if (b.dataset.act === 'edit') openMenuForm(item);
      else if (b.dataset.act === 'delete') askDeleteMenu(item);
      else toggleActive(item);
    });
  });
}

$('admin-search').addEventListener('input', function () {
  if (TAB === 'orders') renderOrders();
});

function setPreview(src, fileId) {
  $('image-preview').innerHTML = src ? picTag(src, 'ตัวอย่างรูปเมนู', fileId) : 'ไม่มีรูป';
  $('clear-image-btn').hidden = !src;
}

function openMenuForm(item) {
  $('menu-form').reset();
  PENDING_IMAGE = null;
  CLEAR_IMAGE = false;

  $('menu-id').value = item ? item.id : '';
  $('menu-name').value = item ? item.name : '';
  $('menu-category').value = item ? item.category : '';
  $('menu-price').value = item ? item.price : '';
  setPreview(item ? (item.image || item.imageUrl) : '', item ? item.fileId : '');

  $('menu-modal-title').textContent = item ? 'แก้ไขเมนู — ' + item.name : 'เพิ่มเมนู';

  openModal('menu-modal');
  $('menu-name').focus();
}

$('add-menu-btn').addEventListener('click', function () { openMenuForm(null); });
$('pick-image-btn').addEventListener('click', function () { $('menu-image-input').click(); });

/* รูปจากมือถือมักใหญ่หลายเมกะไบต์ ส่ง base64 ดิบไปให้ Apps Script อัปโหลดจะช้ามาก
   ย่อฝั่งเบราว์เซอร์ก่อนจึงเหลือหลักร้อยกิโลไบต์ */
var IMAGE_MAX_PX = 900;

function compressImage(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('อ่านไฟล์รูปไม่สำเร็จ')); };
    reader.onload = function (ev) {
      var img = new Image();
      img.onerror = function () { reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพ')); };
      img.onload = function () {
        var scale = Math.min(1, IMAGE_MAX_PX / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        var ctx = canvas.getContext('2d');
        /* JPEG ไม่มีช่องโปร่งใส ส่วนที่โปร่งของ PNG จะกลายเป็นสีดำถ้าไม่รองพื้นขาวไว้ก่อน */
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

$('menu-image-input').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  compressImage(file)
    .then(function (dataUrl) {
      PENDING_IMAGE = dataUrl;
      CLEAR_IMAGE = false;
      setPreview(PENDING_IMAGE);
    })
    .catch(function (err) {
      $('menu-image-input').value = '';
      toast(err.message, 'err');
    });
});

$('clear-image-btn').addEventListener('click', function () {
  PENDING_IMAGE = null;
  CLEAR_IMAGE = true;
  $('menu-image-input').value = '';
  setPreview('');
});

$('menu-form').addEventListener('submit', function (e) {
  e.preventDefault();
  if (!HAS_BACKEND) { toast('ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์', 'err'); return; }

  var id = $('menu-id').value;
  var name = $('menu-name').value.trim();
  var category = $('menu-category').value.trim();
  var priceRaw = $('menu-price').value;
  var price = Number(priceRaw);

  if (!name || !category || priceRaw === '' || !(price >= 0)) {
    toast('กรอกชื่อเมนู หมวดหมู่ และราคาให้ครบ', 'err');
    return;
  }

  var payload = { name: name, category: category, price: price };
  if (PENDING_IMAGE) payload.imageBase64 = PENDING_IMAGE;
  else if (CLEAR_IMAGE) payload.imageBase64 = '';

  var existing = MENU.filter(function (m) { return String(m.id) === String(id); })[0];
  if (existing) {
    payload.id = id;
    payload.active = existing.active;
    /* ไม่ได้เลือกรูปใหม่และไม่ได้กดเอารูปออก = เก็บรูปเดิมไว้ */
    if (!PENDING_IMAGE && !CLEAR_IMAGE) payload.driveId = existing.driveId;
  }

  var btn = $('menu-save-btn');
  btn.disabled = true;
  btn.textContent = PENDING_IMAGE ? 'กำลังอัปโหลดรูป…' : 'กำลังบันทึก…';

  (existing ? API.updateMenuItem(payload) : API.addMenuItem(payload))
    .then(function (res) {
      if (!res || !res.success) {
        toast((res && res.message) || 'บันทึกเมนูไม่สำเร็จ', 'err');
        return;
      }
      closeModal('menu-modal');
      toast((existing ? 'แก้ไขเมนู "' : 'เพิ่มเมนู "') + name + '" เรียบร้อยแล้ว');
      loadMenu();
    })
    .catch(onError)
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'บันทึกเมนู';
    });
});

function toggleActive(item) {
  if (!HAS_BACKEND) { toast('ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์', 'err'); return; }
  API.updateMenuItem({
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price,
    active: !item.active,
    driveId: item.driveId
  })
    .then(function (res) {
      if (!res || !res.success) {
        toast((res && res.message) || 'อัปเดตสถานะไม่สำเร็จ', 'err');
        return;
      }
      toast((item.active ? 'ปิดขาย "' : 'เปิดขาย "') + item.name + '" แล้ว');
      loadMenu();
    })
    .catch(onError);
}

var DELETE_TARGET = null;

function askDeleteMenu(item) {
  DELETE_TARGET = item;
  $('delete-name').textContent = item.name;
  openModal('delete-modal');
}

$('delete-confirm-btn').addEventListener('click', function () {
  if (!DELETE_TARGET) return;
  if (!HAS_BACKEND) { toast('ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์', 'err'); return; }

  var item = DELETE_TARGET;
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'กำลังลบ…';

  API.deleteMenuItem(item.id)
    .then(function (res) {
      if (!res || !res.success) toast((res && res.message) || 'ลบเมนูไม่สำเร็จ', 'err');
      else toast('ลบเมนู "' + item.name + '" แล้ว');
    })
    .catch(onError)
    .finally(function () {
      btn.disabled = false;
      btn.textContent = 'ลบเมนู';
      DELETE_TARGET = null;
      closeModal('delete-modal');
      /* การตอบกลับหลุดได้ทั้งที่เซิร์ฟเวอร์ลบไปแล้ว จึงยึดรายการจริงจากเซิร์ฟเวอร์เสมอ
         ไม่อย่างนั้นตารางจะค้างแสดงเมนูที่ไม่มีอยู่จริง */
      loadMenu().then(dropMissingFromCart);
    });
});

/* เมนูที่หายไปจากเซิร์ฟเวอร์ต้องออกจากบิลที่ยังไม่ได้ชำระด้วย
   ไม่งั้นจะกดชำระเงินด้วยเมนูที่ถูกลบไปแล้ว */
function dropMissingFromCart() {
  var before = CART.length;
  CART = CART.filter(function (c) {
    return MENU.some(function (m) { return String(m.id) === String(c.id); });
  });
  if (CART.length !== before) renderBill();
}

/* ---------- เริ่มต้น ---------- */
if (!HAS_BACKEND) {
  console.warn('ยังไม่ได้ตั้งค่า API_URL ใน api.js — ใส่ URL ของ Web App (Deploy > Web app) ก่อน ถึงจะเรียก backend ได้');
} else {
  console.info('เชื่อมต่อ backend ผ่าน ' + API.mode());
}

showTab('pos');
renderBill();

/* คืนสถานะล็อกอินหลังรีเฟรชหน้า ไม่ต้องกรอกใหม่ทุกครั้ง */
var SAVED = HAS_BACKEND ? loadSession() : null;

if (SAVED) {
  ME = SAVED;
  enterApp(true);
}
