// ==UserScript==
// @name         Tasheel Auto Return - أتمتة إرسال المرتجعات
// @namespace    tasheel-auto
// @version      2.0
// @description  خطوة وحدة بدل خطوتين: مسح الطلب في صفحة المخزن (مع استخراج الرقم من JSON ودعم أي لغة كيبورد) ثم تحويله تلقائياً وإرساله لصفحة بغداد
// @match        https://agg-iq.net/operation/recycling_users/scan*
// @match        https://agg-iq.net/operation/recycling_users/city_returned_orders/scan*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PAGE_A = 'https://agg-iq.net/operation/recycling_users/scan';
  const PAGE_B = 'https://agg-iq.net/operation/recycling_users/city_returned_orders/scan';

  const KEY_BOX_CODE = 'tasheel_box_code';
  const KEY_PENDING_ORDER = 'tasheel_pending_order';
  const KEY_AUTO_FLAG = 'tasheel_auto_step2';
  const KEY_PROCESSED_ORDERS = 'tasheel_processed_orders'; // قائمة الطلبات اللي سبق مسحها
  const KEY_SENT_COUNT = 'tasheel_sent_count'; // عداد الطلبات اللي وصلت فعلاً لبغداد
  const KEY_COUNT_DATE = 'tasheel_count_date'; // تاريخ آخر تصفير للعداد

  // ---------- أدوات العداد اليومي ----------
  function getTodayDateString() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}-${month}-${year}`;
  }

  function resetCountIfNewDay() {
    const today = getTodayDateString();
    const savedDate = localStorage.getItem(KEY_COUNT_DATE);
    if (savedDate !== today) {
      localStorage.setItem(KEY_SENT_COUNT, '0');
      localStorage.setItem(KEY_COUNT_DATE, today);
      localStorage.setItem(KEY_PROCESSED_ORDERS, '[]'); // نصفّر قائمة الطلبات المكررة كل يوم جديد
    }
  }

  function getSentCount() {
    return Number(localStorage.getItem(KEY_SENT_COUNT) || 0);
  }

  function addSentCount() {
    resetCountIfNewDay();
    const n = getSentCount() + 1;
    localStorage.setItem(KEY_SENT_COUNT, String(n));
    updateCounterDisplay();
  }

  function updateCounterDisplay() {
    const el = document.getElementById('tasheel-counter-badge');
    if (el) el.textContent = '📦 تم إرساله اليوم: ' + getSentCount();
  }

  // ---------- أدوات منع تكرار نفس الطلب ----------
  function getProcessedOrders() {
    resetCountIfNewDay();
    try {
      return JSON.parse(localStorage.getItem(KEY_PROCESSED_ORDERS) || '[]');
    } catch (e) {
      return [];
    }
  }

  function isOrderProcessed(code) {
    return getProcessedOrders().includes(code);
  }

  function markOrderProcessed(code) {
    const list = getProcessedOrders();
    if (!list.includes(code)) {
      list.push(code);
      localStorage.setItem(KEY_PROCESSED_ORDERS, JSON.stringify(list));
    }
  }

  // ---------- أدوات مساعدة ----------

  // تعبئة حقل input بطريقة تخلي أطر العمل مثل Vue/React تتفاعل معه
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // البحث عن عنصر (زر غالباً) يحتوي نص معين
  function findByText(selector, text) {
    const els = document.querySelectorAll(selector);
    for (const el of els) {
      if (el.textContent && el.textContent.trim().includes(text)) {
        return el;
      }
    }
    return null;
  }

  // نفحص كل قيم الحقول وكل النصوص الظاهرة بالصفحة بحثاً عن حالة "مؤجل" - لو موجودة
  // نتجاهل الطلب كلياً ولا نسوي أي إجراء تلقائي عليه
  function isOrderPostponed() {
    let found = false;
    document.querySelectorAll('input,select,textarea').forEach((el) => {
      if (el.value && el.value.includes('مؤجل')) found = true;
      if (el.tagName === 'SELECT' && el.selectedOptions && el.selectedOptions[0] &&
          el.selectedOptions[0].text.includes('مؤجل')) found = true;
    });
    if (!found) {
      document.querySelectorAll('*').forEach((el) => {
        if (el.children.length === 0 && el.textContent && el.textContent.trim() === 'مؤجل') found = true;
      });
    }
    return found;
  }

  // مراقبة الصفحة لحين ظهور شرط معين، مع مهلة قصوى
  function waitFor(checkFn, { timeout = 15000, interval = 300 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const result = checkFn();
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error('timeout'));
        }
      }, interval);
    });
  }

  // شريط حالة صغير عائم يوضح شنو يسوي السكربت
  function showStatus(msg) {
    let bar = document.getElementById('tasheel-auto-status');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tasheel-auto-status';
      bar.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
        background: #5b1a2e; color: #fff; padding: 10px 16px;
        font-size: 15px; text-align: center; direction: rtl;
        font-family: sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.3);
      `;
      document.documentElement.appendChild(bar);
    }
    if (bar.dataset.errorLocked === '1') return; // خطأ ثابت - لا نستبدله برسائل عادية
    bar.style.background = '#5b1a2e';
    bar.textContent = msg;
  }

  // رسالة خطأ واضحة (خلفية حمراء) تبقى ثابتة على الشاشة لين يبدأ طلب جديد فعلياً
  function showErrorStatus(msg) {
    let bar = document.getElementById('tasheel-auto-status');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tasheel-auto-status';
      bar.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
        color: #fff; padding: 10px 16px;
        font-size: 15px; text-align: center; direction: rtl;
        font-family: sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.3);
      `;
      document.documentElement.appendChild(bar);
    }
    bar.style.background = '#b91c1c';
    bar.textContent = msg;
    bar.dataset.errorLocked = '1';
  }

  // ---------- إعداد رمز الصندوق (تشتغل بأي صفحة) ----------
  function injectBoxCodePanel() {
    if (document.getElementById('tasheel-box-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'tasheel-box-panel';
    panel.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 999999;
      background: #222; color: #fff; padding: 10px; direction: rtl;
      font-family: sans-serif; font-size: 14px; display: flex; gap: 8px;
      align-items: center; box-shadow: 0 -2px 6px rgba(0,0,0,.4);
    `;
    panel.innerHTML = `
      <span>رمز الصندوق الحالي:</span>
      <input id="tasheel-box-input" type="text" style="flex:1; padding:6px; border-radius:4px; border:none;">
      <button id="tasheel-box-save" style="padding:6px 10px; border:none; border-radius:4px; background:#2b6; color:#fff;">حفظ</button>
      <button id="tasheel-box-new" style="padding:6px 10px; border:none; border-radius:4px; background:#c33; color:#fff;">صندوق جديد</button>
    `;
    document.documentElement.appendChild(panel);

    const input = panel.querySelector('#tasheel-box-input');
    input.value = localStorage.getItem(KEY_BOX_CODE) || '';

    panel.querySelector('#tasheel-box-save').addEventListener('click', () => {
      localStorage.setItem(KEY_BOX_CODE, input.value.trim());
      showStatus('تم حفظ رمز الصندوق: ' + input.value.trim());
    });

    panel.querySelector('#tasheel-box-new').addEventListener('click', () => {
      localStorage.removeItem(KEY_BOX_CODE);
      input.value = '';
      showStatus('تم مسح رمز الصندوق - الطلب القادم سيفتح صندوق جديد. انسخ الرمز الجديد واحفظه هنا.');
    });
  }

  // ---------- منطق صفحة أ: المخزن ----------
  function runPageA() {
    injectBoxCodePanel();
    showStatus('صفحة المخزن جاهزة - امسح/اكتب رقم الطلب واضغط Scan كالمعتاد');

    // نركّز تلقائياً على خانة رقم الطلب حتى يشتغل قارئ الباركود USB مباشرة بدون تدخل يدوي
    function focusOrderInput() {
      const inp = document.querySelector('input[type="text"]:not([type="checkbox"])');
      const active = document.activeElement;
      const isTypingElsewhere = active && active.tagName === 'INPUT' && active !== inp;
      if (inp && active !== inp && !isTypingElsewhere) {
        inp.focus();
      }
    }
    focusOrderInput();
    setTimeout(focusOrderInput, 300);
    setTimeout(focusOrderInput, 800);
    setTimeout(focusOrderInput, 1500);
    setTimeout(focusOrderInput, 3000);
    setInterval(focusOrderInput, 1000);

    // شارة صغيرة تعرض عدد الطلبات المرسلة لبغداد اليوم
    function injectCounterBadge() {
      if (document.getElementById('tasheel-counter-badge')) return;
      const badge = document.createElement('div');
      badge.id = 'tasheel-counter-badge';
      badge.style.cssText = `
        position: fixed; top: 80px; left: 8px; z-index: 999998;
        background: #333; color: #fff; border-radius: 14px;
        padding: 6px 12px; font-size: 13px; font-family: sans-serif;
        direction: rtl;
      `;
      document.documentElement.appendChild(badge);
      updateCounterDisplay();
    }
    injectCounterBadge();

    // قارئ الباركود يضغط Scan تلقائياً بنفسه - نحن بس نلتقط رقم الطلب،
    // نحول الأرقام العربية/الفارسية لإنجليزية، ونستخرج الرقم لو كانت
    // القيمة على شكل JSON مثل {"agQrNumber":"2674852"} - بغض النظر عن
    // لغة الكيبورد وقت المسح أو شكل علامات التنصيص (مستقيمة أو منحنية)
    function normalizeDigits(str) {
      return str
        .replace(/[\u0660-\u0669]/g, (d) => d.charCodeAt(0) - 0x0660)
        .replace(/[\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) - 0x06F0);
    }

    function extractCleanValue(raw) {
      const normalized = normalizeDigits(raw);
      const trimmed = normalized.trim();

      // لو القيمة تشبه JSON (فيها قوسين معقوفين)، نسحب أول رقم (4 خانات
      // أو أكثر) بين علامتي تنصيص - بدون اعتماد على اسم المفتاح نفسه
      // (زي agQrNumber)، عشان يشتغل حتى لو تحول لعربي بسبب لوحة المفاتيح
      if (/[{}]/.test(trimmed)) {
        const quoted = trimmed.match(/["'\u201C\u201D]\s*(\d{4,})\s*["'\u201C\u201D]/);
        if (quoted) return quoted[1];

        const anyDigits = trimmed.match(/(\d{4,})/);
        if (anyDigits) return anyDigits[1];

        return normalized; // احتياط أخير: نرجع النص بعد تحويل الأرقام بس
      }

      return normalized;
    }

    let lastEnteredCode = '';
    let normalizing = false;
    let firstCharTime = 0;
    let quietTimer = null;

    // حارس Scan: القارئ أحياناً يضغط Scan قبل اكتمال الرقم بالخانة - نعترض الضغطة المبكرة ونؤجلها لحين اكتمال الرقم
    let scanGuardActive = false;
    function attachScanGuard() {
      const scanBtn = findByText('button', 'Scan') || findByText('button', 'مسح');
      if (scanBtn && !scanBtn.dataset.guarded) {
        scanBtn.dataset.guarded = '1';
        scanBtn.addEventListener('click', function (ev) {
          const inp = document.querySelector('input[type="text"]:not([type="checkbox"])');
          const val = inp ? inp.value.trim() : '';
          if (val.length < 4 && !scanGuardActive) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            scanGuardActive = true;
            const waitFull = setInterval(() => {
              const nowVal = inp ? inp.value.trim() : '';
              if (nowVal.length >= 4) {
                clearInterval(waitFull);
                setTimeout(() => {
                  scanGuardActive = false;
                  scanBtn.click();
                }, 150);
              }
            }, 60);
            setTimeout(() => { clearInterval(waitFull); scanGuardActive = false; }, 4000);
          }
        }, true);
      }
    }
    attachScanGuard();
    setInterval(attachScanGuard, 1000);

    // القارئ يرسل ضغطة Enter بعد الرقم - نضغط Scan
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        const val = e.target.value.trim();
        if (val.length > 3) {
          const scanBtn = findByText('button', 'Scan') || findByText('button', 'مسح');
          if (scanBtn) scanBtn.click();
        }
      }
    }, true);

    document.addEventListener('input', (e) => {
      if (normalizing) return;
      if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        const normalized = extractCleanValue(e.target.value);
        if (normalized !== e.target.value) {
          normalizing = true;
          setNativeValue(e.target, normalized);
          normalizing = false;
        }
        const val = e.target.value.trim();
        if (val && val.length > 3) {
          lastEnteredCode = val;
        }

        const now = Date.now();
        if (val.length <= 1) {
          firstCharTime = now; // أول حرف بالخانة - نبدأ نحسب من هنا
          const bar = document.getElementById('tasheel-auto-status');
          if (bar) bar.dataset.errorLocked = '0'; // طلب جديد بدأ - نلغي قفل رسالة الخطأ السابقة
        }

        clearTimeout(quietTimer);
        const targetEl = e.target;
        const startTime = firstCharTime;
        quietTimer = setTimeout(() => {
          const finalVal = targetEl.value.trim();
          if (finalVal.length > 3) {
            const totalTime = Date.now() - startTime;
            const msPerChar = totalTime / finalVal.length;
            showStatus('⏱️ السرعة المقاسة: ' + Math.round(msPerChar) + ' ملي ثانية/حرف');
            // لو الكتابة كانت سريعة جداً (أقل من 200ms لكل حرف بالمعدل)، هذا قارئ باركود
            if (msPerChar < 200) {
              const scanBtn = findByText('button', 'Scan') || findByText('button', 'مسح');
              if (scanBtn) scanBtn.click();
            }
          }
        }, 300);

        if (e.target.value.length === 0) {
          firstCharTime = 0;
          clearTimeout(quietTimer);
        }
      }
    }, true);

    // مراقبة ظهور زر "تحويل الى المخزن" بعد نجاح المسح
    const observer = new MutationObserver(() => {
      const btn = findByText('button, a, div[role="button"]', 'تحويل الى المخزن');
      if (btn && !btn.dataset.tasheelHandled) {
        btn.dataset.tasheelHandled = '1';

        // تجاهل الطلب كلياً لو حالته "مؤجل" - بدون تحويل ولا احتساب
        if (isOrderPostponed()) {
          showErrorStatus('❌ خطأ: هذا الطلب مؤجّل - تم إيقاف المعالجة التلقائية ولن يُرسل لبغداد');
          return;
        }

        // منع مسح نفس الطلب مرتين بنفس اليوم
        if (lastEnteredCode && isOrderProcessed(lastEnteredCode)) {
          showStatus('⚠️ هذا الطلب (' + lastEnteredCode + ') تم إرساله مسبقاً اليوم - تجاهله');
          return;
        }

        showStatus('تم العثور على الطلب - جاري التحويل الى المخزن تلقائياً...');
        setTimeout(() => {
          btn.click();
          if (lastEnteredCode) {
            markOrderProcessed(lastEnteredCode);
            localStorage.setItem(KEY_PENDING_ORDER, lastEnteredCode);
            localStorage.setItem(KEY_AUTO_FLAG, '1');
            showStatus('تم التحويل - جاري الانتقال الى صفحة بغداد...');
            setTimeout(() => {
              window.location.href = PAGE_B;
            }, 1200);
          } else {
            showStatus('تعذر التقاط رقم الطلب تلقائياً - كمل يدوياً هذي المرة رجاءً');
          }
        }, 500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- منطق صفحة ب: إرسال الرواجع الى بغداد ----------
  function runPageB() {
    injectBoxCodePanel();

    // دالة تولّد تاريخ اليوم بصيغة يوم-شهر-سنة
    function getTodayDateString() {
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      return `${day}-${month}-${year}`;
    }

    // اعتراض نافذة prompt() الخاصة برمز الصندوق
    window.prompt = function (message, defaultValue) {
      const savedBox = localStorage.getItem(KEY_BOX_CODE) || '';
      if (savedBox) {
        showStatus('تم الرد التلقائي على رمز الصندوق: ' + savedBox);
        return savedBox;
      }
      const todayCode = getTodayDateString();
      localStorage.setItem(KEY_BOX_CODE, todayCode);
      showStatus('تم فتح صندوق جديد بتاريخ اليوم: ' + todayCode);
      return todayCode;
    };

    const autoFlag = localStorage.getItem(KEY_AUTO_FLAG);
    const pendingOrder = localStorage.getItem(KEY_PENDING_ORDER);

    if (autoFlag === '1' && pendingOrder) {
      showStatus('جاري إرسال الطلب ' + pendingOrder + ' الى صندوق بغداد...');
      waitFor(() => {
        const input = document.querySelector('input[type="text"]:not([type="checkbox"])');
        const scanBtn = findByText('button', 'Scan') || findByText('button', 'مسح');
        const checkbox = document.querySelector('input[type="checkbox"]');
        return (input && scanBtn) ? { input, scanBtn, checkbox } : null;
      }).then(({ input, scanBtn, checkbox }) => {
        // نفعل خانة "ادخل يدوي" بصمت (بدون أي زر) حتى يقبل الموقع القيمة المُعبّأة تلقائياً
        if (checkbox && !checkbox.checked) {
          checkbox.click();
        }
        setTimeout(() => {
          setNativeValue(input, pendingOrder);
          setTimeout(() => {
            scanBtn.click();
            showStatus('تم إرسال الطلب بنجاح - جاري الرجوع لصفحة المخزن...');
            addSentCount();
            localStorage.removeItem(KEY_PENDING_ORDER);
            localStorage.removeItem(KEY_AUTO_FLAG);
            setTimeout(() => {
              window.location.href = PAGE_A;
            }, 1500);
          }, 500);
        }, 400);
      }).catch(() => {
        showStatus('لم يظهر حقل المسح خلال 15 ثانية - كمل يدوياً هذي المرة رجاءً');
      });
    } else {
      showStatus('صفحة بغداد جاهزة (وضع يدوي - لا يوجد طلب معلّق حالياً)');
    }
  }

  // ---------- تحديد الصفحة الحالية وتشغيل المنطق المناسب ----------
  function init() {
    if (location.href.indexOf('city_returned_orders') !== -1) {
      runPageB();
    } else if (location.href.indexOf('recycling_users') !== -1) {
      runPageA();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
