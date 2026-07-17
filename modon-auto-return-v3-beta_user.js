// ==UserScript==
// @name         Modon Auto Return v3.0 BETA
// @namespace    modon-auto
// @version      3.1.0
// @match        https://modon-express.net/recycling_users/scan*
// @match        https://modon-express.net/recycling_users/city_returned_orders/scan*
// @match        https://modon-express.net/recycling_users/city_returned_orders/box*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {

'use strict';

/*==============================
=            STATE            =
==============================*/

const STATE={
    IDLE:'IDLE',
    SCAN:'SCAN',
    WAIT:'WAIT',
    DECISION:'DECISION',
    BAGHDAD:'BAGHDAD',
    DONE:'DONE',
    POSTPONED:'ERROR - مؤجل',
    STOPPED:'⛔ متوقف - خطأ حرج'
};

/*==============================
=          الروابط          =
==============================*/

const PAGE_A = 'https://modon-express.net/recycling_users/scan';
const PAGE_B_BOX = 'https://modon-express.net/recycling_users/city_returned_orders/box';
const PAGE_B_SCAN = 'https://modon-express.net/recycling_users/city_returned_orders/scan';

/*==============================
=       اعتراض نوافذ النظام فوراً      =
==============================*/

// نعترض نافذة تسمية الصندوق ونافذة التأكيد من أول لحظة تحميل الصفحة (قبل كود الموقع نفسه)
window.prompt = function(message, defaultValue){

    const now = new Date();

    const day = String(now.getDate()).padStart(2, '0');

    const month = String(now.getMonth() + 1).padStart(2, '0');

    const year = now.getFullYear();

    return `${day}-${month}-${year}`;

};

window.confirm = function(){

    return true;

};

window.alert = function(){

    return undefined;

};

/*==============================
=       تخزين دائم بين الصفحات      =
==============================*/

const KEY_PENDING_ORDER = 'modon_v3_pending_order';
const KEY_AUTO_FLAG = 'modon_v3_auto_flag';
const KEY_BOX_DATE = 'modon_v3_box_date'; // تاريخ آخر يوم انفتح فيه صندوق
const KEY_FORCE_OPEN = 'modon_v3_force_open'; // علم: الإرسال المباشر فشل، لازم نفتح صندوق أولاً
const KEY_STORE_COUNT = 'modon_v3_store_count'; // عداد المخزن (يومي، محفوظ دائماً)
const KEY_SORT_COUNT = 'modon_v3_sort_count'; // عداد الفرز (يومي، محفوظ دائماً)
const KEY_COUNT_DATE = 'modon_v3_count_date'; // تاريخ آخر تصفير للعداد
const KEY_PROCESSED_ORDERS = 'modon_v3_processed_orders'; // قائمة الطلبات اللي سبق إرسالها لبغداد اليوم
const KEY_RETRY_COUNT = 'modon_v3_retry_count'; // عداد محاولات فتح الصندوق المتتالية - حماية من أي لوب غير متوقع

/*==============================
=            STORE            =
==============================*/

const App={

    state:STATE.IDLE,

    currentOrder:'',

    todayBox:'',

    storeCount:0,

    sortCount:0,

    lastAction:'جاهز'

};

/*==============================
=         DASHBOARD          =
==============================*/

/*==============================
=         DASHBOARD          =
==============================*/

let panel;


/*==============================
=           INIT            =
==============================*/
function render(){

    if(!panel){

        panel=document.createElement('div');

        panel.style.cssText=`
position:fixed;
top:0;
left:0;
right:0;
z-index:999999;
background:#14532d;
color:#fff;
padding:8px 16px;
font-size:13px;
text-align:center;
direction:rtl;
font-family:sans-serif;
box-shadow:0 2px 6px rgba(0,0,0,.3);
`;

        document.documentElement.appendChild(panel);

    }

    panel.innerHTML=
        `🟢 الحالة: ${App.state}`+
        ` | 📦 الطلب: ${App.currentOrder||'------'}`+
        ` | 📍 المرحلة: ${App.lastAction}`+
        (App.todayBox ? ` | 🗂️ الصندوق: ${App.todayBox}` : '')+
        ` | 📦 المخزن: ${App.storeCount}`+
        ` | 🔄 الفرز: ${App.sortCount}`;

}

function log(text){

    App.lastAction=text;

    render();

}

function setState(state){

    App.state=state;

    render();

}
function getInput(){

    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')];

    if(inputs.length) return inputs[inputs.length - 1];

    return document.querySelector('input');

}

/*==============================
=      عداد دائم يومي      =
==============================*/

// نصفّر العداد تلقائياً لو تغيّر التاريخ عن آخر مرة
function resetCounterIfNewDay(){

    const today = getTodayDateString();

    const savedDate = localStorage.getItem(KEY_COUNT_DATE);

    if(savedDate !== today){

        localStorage.setItem(KEY_STORE_COUNT, '0');

        localStorage.setItem(KEY_SORT_COUNT, '0');

        localStorage.setItem(KEY_COUNT_DATE, today);

        localStorage.setItem(KEY_PROCESSED_ORDERS, '[]');

    }

}

function getCount(key){

    return Number(localStorage.getItem(key) || 0);

}

// منع إرسال نفس الطلب لبغداد أكثر من مرة بنفس اليوم
function getProcessedOrders(){

    resetCounterIfNewDay();

    try{

        return JSON.parse(localStorage.getItem(KEY_PROCESSED_ORDERS) || '[]');

    }catch(e){

        return [];

    }

}

function isOrderProcessed(code){

    return !!code && getProcessedOrders().includes(code);

}

function markOrderProcessed(code){

    if(!code) return;

    const list = getProcessedOrders();

    if(!list.includes(code)){

        list.push(code);

        localStorage.setItem(KEY_PROCESSED_ORDERS, JSON.stringify(list));

    }

}

function addCount(key){

    resetCounterIfNewDay();

    const n = getCount(key) + 1;

    localStorage.setItem(key, String(n));

    App.storeCount = getCount(KEY_STORE_COUNT);

    App.sortCount = getCount(KEY_SORT_COUNT);

    render();

}

function focusInput(){

    const input = getInput();

    if(!input) return;

    if(document.activeElement !== input){

        input.focus();

    }

}

/*==============================
=       أدوات مساعدة عامة      =
==============================*/

// تعبئة حقل input بطريقة تخلي أطر العمل مثل Vue/React تتفاعل معه
function setNativeValue(el, value){

    const proto = Object.getPrototypeOf(el);

    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');

    if(descriptor && descriptor.set){

        descriptor.set.call(el, value);

    }else{

        el.value = value;

    }

    el.dispatchEvent(new Event('input', { bubbles: true }));

    el.dispatchEvent(new Event('change', { bubbles: true }));

}

// تاريخ اليوم بصيغة يوم-شهر-سنة، يُستخدم كاسم للصندوق تلقائياً
function getTodayDateString(){

    const now = new Date();

    const day = String(now.getDate()).padStart(2, '0');

    const month = String(now.getMonth() + 1).padStart(2, '0');

    const year = now.getFullYear();

    return `${day}-${month}-${year}`;

}

let scanning = false;

// نربط مستمع بزر Scan الحقيقي نفسه - يشتغل سواء ضغطته إنت يدوياً أو انضغط تلقائياً من Enter (قارئ الباركود)
let scanBtnListenerAttached = false;

function attachScanButtonListener(){

    const btn = getScanButton();

    if(btn && !scanBtnListenerAttached){

        scanBtnListenerAttached = true;

        btn.addEventListener('click', ()=>{

            if(scanning) return;

            const input = getInput();

            const value = input ? input.value.trim() : '';

            if(!value) return;

            scanning = true;

            App.currentOrder = value;

            setState(STATE.SCAN);

            log("تم إرسال الطلب");

            waitForOrderData(()=>{

                log("ظهرت بيانات الطلب");

                decisionEngine();

            });

        });

    }

}

// قارئ الباركود يرسل Enter بعد الرقم - نستغلها لضغط زر Scan الحقيقي تلقائياً (يفعّل المستمع أعلاه من نفسه)
function attachEnterTrigger(){

    document.addEventListener('keydown', (e)=>{

        if(e.key === 'Enter'){

            const input = getInput();

            if(input && e.target === input && input.value.trim().length > 3){

                const btn = getScanButton();

                if(btn) btn.click();

            }

        }

    }, true);

}
function getScanButton(){

    return [...document.querySelectorAll("button")]
        .find(btn=>btn.textContent.trim()=="Scan");

}

function clickScan(){

    const btn = getScanButton();

    if(!btn){

        scanning = false;

        return false;

    }

    log("تم إرسال الطلب");

    btn.click();

    waitForOrderData(()=>{

        log("ظهرت بيانات الطلب");

        decisionEngine();

    });

    return true;

}
function getProvince(){

    const inputs = document.querySelectorAll("input");

    if(inputs.length < 11){

        return "";

    }

    return inputs[10].value.trim();
}

// نفحص كل قيم الحقول وكل النصوص الظاهرة بالصفحة بحثاً عن حالة تأجيل الطلب - لو موجودة
// نتجاهل الطلب كلياً ولا نسوي أي إجراء تلقائي عليه (لا مخزن ولا فرز ولا إرسال لبغداد).
// موقع مدن يستخدم إحدى صيغتين: "تم تأجيل الطلب من قبل الزبون" أو "تم تأجيل الطلب الى وقت غير معروف"
function isOrderPostponed(){

    let found = false;

    const isPostponedText = (t)=> t && (t.includes('تأجيل الطلب') || t.trim() === 'مؤجل');

    document.querySelectorAll('input,select,textarea').forEach(el=>{

        if(isPostponedText(el.value)) found = true;

        if(el.tagName === 'SELECT' && el.selectedOptions && el.selectedOptions[0] &&
           isPostponedText(el.selectedOptions[0].text)) found = true;

    });

    if(!found){

        document.querySelectorAll('*').forEach(el=>{

            if(el.children.length === 0 && isPostponedText(el.textContent)) found = true;

        });

    }

    return found;

}

function decisionEngine(){

    log("بدأ Decision Engine");

    if(isOrderPostponed()){

        log("❌ خطأ: هذا الطلب مؤجّل (تأجيل من الزبون أو لوقت غير معروف) - تم إيقاف المعالجة التلقائية ولن يُرسل لبغداد");

        setState(STATE.POSTPONED);

        App.currentOrder = "";

        setTimeout(focusInput, 200);

        return;

    }

    const province = getProvince();

    log("المحافظة = " + province);

    if(!province){

        log("لم يتم العثور على المحافظة");

        return;

    }

    if(province.includes("الكوت - واسط")){

        if(isOrderProcessed(App.currentOrder)){

            log("⚠️ هذا الطلب تم إرساله لبغداد مسبقاً اليوم - تم تجاهل التكرار");

            App.currentOrder = "";

            setState(STATE.IDLE);

            setTimeout(focusInput, 200);

            return;

        }

        log("القرار ➜ المخزن");

        const stored = clickStoreButton();

        if(stored){

            markOrderProcessed(App.currentOrder);

            // نكمل تلقائياً لإرسال نفس الطلب الى رواجع بغداد
            startBaghdadEngine();

        }

    }else{

        log("القرار ➜ الفرز");

        clickSortButton();

        // هذا الطلب انتهى
        App.currentOrder="";

        setState(STATE.IDLE);

        log("جاهز للعمل");

        setTimeout(focusInput,200);

    }

}

function clickStoreButton(){

    const btn = [...document.querySelectorAll("button")]
        .find(b => b.textContent.includes("المخزن"));

    if(!btn){

        log("لم يتم العثور على زر المخزن");

        return false;

    }

    btn.click();

    log("تم التحويل إلى المخزن");

    return true;

}
function clickSortButton(){

    const btn = [...document.querySelectorAll("button")]
        .find(b => b.textContent.includes("الفرز"));

    if(!btn){

        log("لم يتم العثور على زر الفرز");

        return false;

    }

    btn.click();

    addCount(KEY_SORT_COUNT);

    log("تم التحويل إلى الفرز");

    return true;

}

/*==============================
=      مرحلة إرسال بغداد      =
==============================*/

// بعد التحويل للمخزن، نقرر الوجهة: صندوق اليوم موجود مسبقاً (نروح للمسح مباشرة) أو نحتاج نفتح صندوق جديد بتاريخ اليوم
function startBaghdadEngine(){

    const orderNumber = App.currentOrder;

    if(!orderNumber){

        log("تعذر العثور على رقم الطلب لإرساله لبغداد");

        return;

    }

    setState(STATE.BAGHDAD);

    localStorage.removeItem(KEY_RETRY_COUNT);

    localStorage.setItem(KEY_PENDING_ORDER, orderNumber);

    localStorage.setItem(KEY_AUTO_FLAG, '1');

    // تحقق استباقي: لو تاريخ آخر صندوق معروف عندنا مختلف عن اليوم (يوم جديد)، نروح
    // مباشرة لفتح صندوق جديد بدل محاولة الإرسال المباشر - لأننا ما نضمن إن الموقع
    // نفسه يرفض الإرسال لصندوق قديم من يوم سابق (قد يقبله بصمت بدون رسالة خطأ)
    const today = getTodayDateString();

    const lastBoxDate = localStorage.getItem(KEY_BOX_DATE);

    const isNewDay = (lastBoxDate !== today);

    if(isNewDay){

        localStorage.setItem(KEY_FORCE_OPEN, '1');

    }

    const destination = isNewDay ? PAGE_B_BOX : PAGE_B_SCAN;

    log(isNewDay ? "يوم جديد - جاري فتح صندوق جديد بتاريخ اليوم" : "جاري التوجه لصفحة المسح لإرسال الطلب");

    setTimeout(()=>{

        window.location.href = destination;

    }, 1000);

}

// مراقبة زر "فتح الصندوق" بصفحة الصناديق - لو موجود صندوق قديم، نطلب من المستخدم إغلاقه يدوياً (ضغطة واحدة بس أول طلب باليوم)
function waitForOpenBoxButton(callback){

    let tries = 0;

    const timer = setInterval(()=>{

        tries++;

        const openBtn = [...document.querySelectorAll("button")]
            .find(b => b.textContent.trim().includes("فتح الصندوق"));

        if(openBtn){

            clearInterval(timer);

            callback(openBtn);

            return;

        }

        // كل أزرار "اغلاق الصندوق" الموجودة حالياً بالصفحة - يشمل هذا الزر الأصلي، وأيضاً زر
        // التأكيد داخل نافذة "هل انت متاكد من اغلاق الصندوق؟" لو كانت ظاهرة (نافذة مخصصة بالموقع
        // وليست window.confirm، فلازم نضغط زرها بأنفسنا بدل الاعتماد على الاعتراض بالأعلى)
        const closeBtns = [...document.querySelectorAll("button")]
            .filter(b => b.textContent.trim() === "اغلاق الصندوق");

        if(closeBtns.length){

            log("يوجد صندوق قديم - جاري إغلاقه تلقائياً لفتح صندوق جديد بتاريخ اليوم");

            // نضغط آخر زر مطابق بالصفحة، لأن نافذة التأكيد (لو ظهرت) تُضاف عادة بآخر الصفحة
            closeBtns[closeBtns.length - 1].click();

        }

        if(tries >= 100){

            clearInterval(timer);

            log("لم يتم العثور على زر فتح الصندوق");

        }

    }, 300);

}

// مراقبة صفحة بغداد لحين ظهور حقل الإدخال وزر Scan
function waitForPageBReady(callback){

    let tries = 0;

    const timer = setInterval(()=>{

        tries++;

        const input = getInput();

        const btn = getScanButton();

        if(input && btn){

            clearInterval(timer);

            callback(input, btn);

            return;

        }

        if(tries >= 40){

            clearInterval(timer);

            log("انتهت مهلة انتظار صفحة بغداد");

        }

    }, 300);

}

// صفحة "الصناديق" - نحتاج نضغط فتح الصندوق ونجاوب على نافذة التسمية تلقائياً بتاريخ اليوم
function runPageBox(){

    render();

    const autoFlag = localStorage.getItem(KEY_AUTO_FLAG);

    const pendingOrder = localStorage.getItem(KEY_PENDING_ORDER);

    localStorage.removeItem(KEY_FORCE_OPEN);

    if(autoFlag === '1' && pendingOrder){

        App.currentOrder = pendingOrder;

        setState(STATE.BAGHDAD);

        // صفحة الصناديق ما فيها حقل مسح إطلاقاً - وصولنا لها معناه نحتاج نفتح صندوق جديد
        log("جاري فتح صندوق جديد بتاريخ اليوم");

        waitForOpenBoxButton((openBtn)=>{

            openBtn.click();

            waitAndFillBoxModal((result)=>{

                if(result.oops){

                    hardStop("تعذّر فتح صندوق جديد (" + (result.message || "خطأ غير معروف") + ")", result.okBtn);

                    return;

                }

                if(result.timeout){

                    hardStop("لم تكتمل عملية فتح الصندوق (انتهت المهلة)", null);

                    return;

                }

                // نجاح فتح الصندوق - نسجّل التاريخ وننتقل لصفحة المسح الفعلية لإرسال الطلب
                setTimeout(()=>{

                    localStorage.setItem(KEY_BOX_DATE, getTodayDateString());

                    window.location.href = PAGE_B_SCAN;

                }, 500);

            });

        });

    }else{

        setState(STATE.IDLE);

        log("صفحة الصناديق جاهزة (لا يوجد طلب معلّق حالياً)");

    }

}

// صفحة "المسح" داخل صندوق مفتوح مسبقاً بنفس اليوم - نرسل الطلب مباشرة
function runPageBScan(){

    render();

    const autoFlag = localStorage.getItem(KEY_AUTO_FLAG);

    const pendingOrder = localStorage.getItem(KEY_PENDING_ORDER);

    if(autoFlag === '1' && pendingOrder){

        App.currentOrder = pendingOrder;

        setState(STATE.BAGHDAD);

        log("جاري إرسال الطلب الى صندوق اليوم");

        let tries = 0;

        const timer = setInterval(()=>{

            tries++;

            const input = getInput();

            const btn = getScanButton();

            if(input && btn){

                clearInterval(timer);

                sendOrderToBaghdad(input, btn);

                return;

            }

            if(tries >= 10){

                clearInterval(timer);

                // ما لقينا واجهة المسح - يعني ما فيه صندوق مفتوح، نفعّل علم فتح صندوق جديد وننتقل
                log("لم يظهر حقل المسح - جاري فتح صندوق جديد");

                localStorage.setItem(KEY_FORCE_OPEN, '1');

                window.location.href = PAGE_B_BOX;

            }

        }, 300);

    }else{

        setState(STATE.IDLE);

        log("صفحة المسح جاهزة (لا يوجد طلب معلّق حالياً)");

    }

}

// نحدد حاوية نافذة "قم بادخال رقم الصندوق" بدقة عبر بصمة مميزة: حاوية تحتوي زر
// "فتح الصندوق" وزر "Cancel" مع بعض بنفس الوقت (هذا التركيب موجود بس بهذي النافذة تحديداً)
function getBoxModalElements(){

    const heading = [...document.querySelectorAll('*')]
        .find(el => el.textContent && el.textContent.trim() === 'قم بادخال رقم الصندوق' && el.children.length <= 1);

    if(!heading) return null;

    let container = heading;

    for(let i = 0; i < 8 && container; i++){

        const btnTexts = [...container.querySelectorAll('button')].map(b => b.textContent.trim());

        if(btnTexts.includes('فتح الصندوق') && btnTexts.includes('Cancel')){

            const input = container.querySelector('input');

            const confirmBtn = [...container.querySelectorAll('button')]
                .find(b => b.textContent.trim() === 'فتح الصندوق');

            if(input && confirmBtn) return { input, confirmBtn };

            return null;

        }

        container = container.parentElement;

    }

    return null;

}

// نراقب باستمرار نافذة "قم بادخال رقم الصندوق" (نافذة مخصصة بالموقع) لحين ظهورها، نعبّيها
// بتاريخ اليوم ونضغط زرها، ثم نتأكد من اختفائها (نجاح) أو ظهور خطأ (فشل)
function waitAndFillBoxModal(callback){

    let tries = 0;

    let filled = false;

    let modalSeen = false;

    const timer = setInterval(()=>{

        tries++;

        const oops = findOopsError();

        if(oops){

            clearInterval(timer);

            callback({ oops:true, okBtn: oops.okBtn, message: oops.message });

            return;

        }

        const modal = getBoxModalElements();

        if(modal){

            modalSeen = true;

            const today = getTodayDateString();

            if(modal.input.value.trim() !== today){

                // نعبّي الحقل (ونعيد المحاولة كل جولة لو انمسحت القيمة لأي سبب)
                setNativeValue(modal.input, today);

            }else if(!filled){

                // تأكدنا فعلياً (بقراءة حقل النافذة نفسها) إن التاريخ انكتب صح - الآن نضغط التأكيد
                filled = true;

                modal.confirmBtn.click();

            }

        }else{

            if(modalSeen && filled){

                // النافذة اختفت بعد ما عبّيناها وضغطنا زرها - نجحت العملية
                clearInterval(timer);

                callback({ success:true });

                return;

            }

            if(!modalSeen && tries >= 5){

                // ما ظهرت أي نافذة من الأصل (يمكن الموقع فتح الصندوق مباشرة) - نعتبرها نجحت
                clearInterval(timer);

                callback({ success:true });

                return;

            }

        }

        if(tries >= 60){

            clearInterval(timer);

            callback({ timeout:true });

        }

    }, 300);

}

// نبحث عن نافذة خطأ "Oops" (تظهرها الواجهة عند فشل عملية، مثل الإرسال لصندوق أصبح غير موجود/مغلق)
// نقرأ اسم/تاريخ الصندوق المعروض حالياً بأعلى صفحة الصناديق (تحت عنوان "اسم الصندوق الحالي")
// يرجع نص التاريخ لو فيه صندوق مفتوح، أو null لو ما فيه (أو كان النص "-")
// ننتظر تحميل صفحة الصناديق فعلياً (لأن بياناتها تجي بالخلفية وما تكون جاهزة فوراً عند تحميل
// الصفحة) لحد ما نلقى إما: زر "فتح الصندوق" (ما فيه صندوق مفتوح)، أو اسم الصندوق الحالي مع
// أزرار "اكمال على نفس الصندوق"/"اغلاق الصندوق" (فيه صندوق مفتوح)
function waitForBoxPageReady(callback){

    let tries = 0;

    // نشترط ظهور نفس الحالة (نوع الزر) مرتين متتاليتين قبل ما نثق فيها - لأن الصفحة
    // أول ما تحمّل ممكن تعرض "ما فيه صندوق مفتوح" لحظياً وبشكل خاطئ قبل ما توصل بياناتها
    // الحقيقية من السيرفر، وهذا كان يخلينا نقرر بناءً على حالة مؤقتة غير صحيحة
    let lastSignature = null;

    let stableCount = 0;

    const timer = setInterval(()=>{

        tries++;

        const openBtn = [...document.querySelectorAll("button")]
            .find(b => b.textContent.trim().includes("فتح الصندوق"));

        const continueBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent.trim() === 'اكمال على نفس الصندوق');

        const closeBtn = [...document.querySelectorAll('button')]
            .find(b => b.textContent.trim() === 'اغلاق الصندوق');

        const boxName = getCurrentOpenBoxName();

        const signature = `${openBtn?'O':''}${continueBtn?'C':''}${closeBtn?'X':''}|${boxName||''}`;

        if((openBtn || continueBtn || closeBtn)){

            if(signature === lastSignature){

                stableCount++;

            }else{

                stableCount = 1;

                lastSignature = signature;

            }

            // لازم تتكرر نفس الحالة مرتين متتاليتين (600ms) قبل ما نعتمدها
            if(stableCount >= 2){

                clearInterval(timer);

                callback({ openBtn, continueBtn, closeBtn, boxName });

                return;

            }

        }else{

            stableCount = 0;

            lastSignature = null;

        }

        if(tries >= 40){

            clearInterval(timer);

            // ما لقينا شي واضح ومستقر - نرجع نتيجة فاضية ونخلي الكود يتعامل معها كـ"ما فيه صندوق"
            callback({ openBtn: null, continueBtn: null, closeBtn: null, boxName: null });

        }

    }, 300);

}

function getCurrentOpenBoxName(){

    const label = [...document.querySelectorAll('*')]
        .find(el => el.textContent && el.textContent.trim() === 'اسم الصندوق الحالي');

    if(!label) return null;

    // نطلع لأعلى بحد أقصى 3 مستويات ونفتش كل النصوص الطرفية بكل مستوى، تحسباً
    // لاختلاف بنية الصفحة (مش شرط يكون التاريخ بنفس مستوى العنوان مباشرة)
    let container = label.parentElement;

    for(let i = 0; i < 3 && container; i++){

        const candidates = [...container.querySelectorAll('*')]
            .filter(el => el.children.length === 0)
            .map(el => el.textContent.trim())
            .filter(t => t && t !== 'اسم الصندوق الحالي' && t !== '-');

        if(candidates.length){

            // نفضّل أي نص شكله يشبه تاريخ فعلي (أرقام وشرطات بس) لو موجود، وإلا نرجع أول مرشح
            const dateLike = candidates.find(t => /\d/.test(t) && /^[\d\-\/\s]+$/.test(t));

            return dateLike || candidates[0];

        }

        container = container.parentElement;

    }

    return null;

}

// توقف طارئ كامل: نستخدمه لأي خطأ غير مرتبط بالصندوق (زي "لا يمكن التعرف على الطلب")
// عشان نتجنب لوب لا نهائي يفتح صناديق فاضية بدون داعي. يمسح كل حالة العمل المعلّقة
// ولا يعيد المحاولة ولا يفتح صندوق - يحتاج تدخل يدوي منك بعدها
function hardStop(reason, okBtn){

    if(okBtn) okBtn.click();

    localStorage.removeItem(KEY_PENDING_ORDER);

    localStorage.removeItem(KEY_AUTO_FLAG);

    localStorage.removeItem(KEY_FORCE_OPEN);

    App.currentOrder = "";

    setState(STATE.STOPPED);

    log("⛔ توقف كامل: " + reason + " - راجع الطلب يدوياً، السكربت لن يعيد المحاولة تلقائياً");

}

function findOopsError(){

    const heading = [...document.querySelectorAll('*')]
        .find(el => el.children.length === 0 && el.textContent.trim() === 'Oops...');

    if(!heading) return null;

    const okBtn = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'OK');

    // نلتقط نص الرسالة الفعلي (تحت عنوان Oops) عشان نفرّق بين أنواع الأخطاء المختلفة
    let message = '';

    let container = heading.parentElement;

    for(let i = 0; i < 4 && container; i++){

        const candidates = [...container.querySelectorAll('*')]
            .filter(el => el.children.length === 0)
            .map(el => el.textContent.trim())
            .filter(t => t && t !== 'Oops...' && t !== 'OK');

        if(candidates.length){ message = candidates[0]; break; }

        container = container.parentElement;

    }

    // الأخطاء المتعلقة فعلياً بحالة الصندوق (غير موجود / مغلق) آمن نعالجها بفتح صندوق جديد.
    // أي خطأ ثاني (زي "لا يمكن التعرف على الطلب") لازم نوقف كل شي فوراً بدل إعادة المحاولة،
    // لأنه مو مرتبط بالصندوق إطلاقاً وإعادة المحاولة تدخلنا بلوب لا نهائي يفتح صناديق فاضية
    const isBoxRelated = message.includes('صندوق');

    return { okBtn, message, isBoxRelated };

}

// تعبئة رقم الطلب وإرساله عبر زر Scan، ثم التحقق الفعلي من نجاح الإرسال قبل اعتباره منتهياً
function sendOrderToBaghdad(input, btn){

    setNativeValue(input, App.currentOrder);

    setTimeout(()=>{

        btn.click();

        // ننتظر شوي ونتحقق: هل ظهرت رسالة خطأ (يعني الصندوق المحفوظ بذاكرتنا غير صالح فعلياً)؟
        setTimeout(()=>{

            const oops = findOopsError();

            if(oops){

                if(oops.isBoxRelated){

                    const retries = Number(localStorage.getItem(KEY_RETRY_COUNT) || 0);

                    if(retries >= 2){

                        hardStop("تكررت مشكلة الصندوق أكثر من مرتين (" + (oops.message || "") + ") - إيقاف احترازي لمنع فتح صناديق زايدة", oops.okBtn);

                        localStorage.removeItem(KEY_RETRY_COUNT);

                        return;

                    }

                    localStorage.setItem(KEY_RETRY_COUNT, String(retries + 1));

                    log("لا يوجد صندوق مفتوح - جاري فتح صندوق جديد بتاريخ اليوم وإعادة المحاولة");

                    if(oops.okBtn) oops.okBtn.click();

                    // نمسح تاريخ الصندوق المحفوظ ونفعّل علم "افتح صندوق أولاً" قبل إعادة المحاولة
                    localStorage.removeItem(KEY_BOX_DATE);

                    localStorage.setItem(KEY_FORCE_OPEN, '1');

                    setTimeout(()=>{

                        window.location.href = PAGE_B_BOX;

                    }, 500);

                    return;

                }

                // خطأ غير مرتبط بالصندوق (زي "لا يمكن التعرف على الطلب") - نوقف كل شي فوراً
                // بدون أي إعادة محاولة أو فتح صندوق، لأن هذا كان يسبب لوب لا نهائي يفتح
                // صناديق فاضية بدون داعي طول ما المشكلة الحقيقية (الطلب نفسه) لسا موجودة
                hardStop("الموقع رفض التعرف على الطلب (" + (oops.message || "خطأ غير معروف") + ")", oops.okBtn);

                return;

            }

            log("تم إرسال الطلب بنجاح الى بغداد");

            localStorage.removeItem(KEY_RETRY_COUNT);

            addCount(KEY_STORE_COUNT);

            localStorage.setItem(KEY_BOX_DATE, getTodayDateString());

            localStorage.removeItem(KEY_PENDING_ORDER);

            localStorage.removeItem(KEY_AUTO_FLAG);

            setState(STATE.DONE);

            setTimeout(()=>{

                log("جاري الرجوع الى خانة المسح الأولى");

                window.location.href = PAGE_A;

            }, 1200);

        }, 700);

    }, 400);

}

function waitForOrderData(callback){

    let tries = 0;

    const timer = setInterval(()=>{

        tries++;

        const province = getProvince();

        if(province){

            clearInterval(timer);
            
            callback();

            const input = getInput();

            if(input){

                input.value = "";

            }

            scanning = false;

            return;

        }

        if(tries >= 40){

            clearInterval(timer);

            log("انتهت مهلة انتظار بيانات الطلب");

            scanning = false;

        }

    },500);

}
function getOrderNumber(){

    const input=getInput();

    if(!input) return "";

    return input.value.trim();

}

/*==============================
=            START            =
==============================*/

function start(){

    render();

    log("جاهز للعمل");

    setState(STATE.IDLE);

    // محاولات متعددة بتوقيتات مختلفة (قد تفشل بصرياً بدون لمسة حقيقية، لكن نجربها احتياطاً)
    focusInput();

    setTimeout(focusInput, 300);

    setTimeout(focusInput, 800);

    setTimeout(focusInput, 1500);

    setTimeout(focusInput, 3000);

    setInterval(focusInput, 1000);

    // نلتقط رقم الطلب بس، ونحول أي أرقام عربية (١٢٣) لإنجليزية (123) - بدون أي ضغط تلقائي على Scan
    // (قارئ الباركود يضغط Scan بنفسه، والكتابة اليدوية تحتاج ضغطة المستخدم نفسه)
    function normalizeDigits(str){

        const arabicDigits = '٠١٢٣٤٥٦٧٨٩';

        return str.replace(/[٠-٩]/g, (d)=> arabicDigits.indexOf(d));

    }

    let normalizing = false;

    let firstCharTime = 0;

    let quietTimer = null;

    // حماية موحّدة ضد الضغط المزدوج: مستمع Enter ومؤقّت سرعة الكتابة كانا يقدر يضغطان
    // زر Scan لنفس رقم الطلب مرتين خلال أقل من نصف ثانية (مرة فورية، ومرة بعد 300ms) -
    // هذا كان يسبب إرسال الطلب مرتين للسيرفر ويطلع أخطاء "صندوق مغلق" على المحاولة الثانية
    let lastAutoScanValue = '';

    let lastAutoScanTime = 0;

    function autoClickScan(value){

        const now = Date.now();

        if(value === lastAutoScanValue && (now - lastAutoScanTime) < 2000){

            return; // نفس الطلب انضغط له Scan قبل شوي - نتجاهل الضغطة المكررة

        }

        const btn = getScanButton();

        if(!btn) return;

        lastAutoScanValue = value;

        lastAutoScanTime = now;

        clearTimeout(quietTimer); // نلغي أي ضغطة ثانية مجدولة لنفس الطلب

        btn.click();

    }

    // القارئ يرسل ضغطة Enter بعد الرقم - نلتقطها مباشرة ونضغط Scan فوراً
    document.addEventListener('keydown', (e)=>{

        if(e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox'){

            const val = e.target.value.trim();

            if(val.length > 3){

                autoClickScan(val);

            }

        }

    }, true);

    document.addEventListener('input', (e)=>{

        if(normalizing) return;

        if(e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox'){

            const normalized = normalizeDigits(e.target.value);

            if(normalized !== e.target.value){

                normalizing = true;

                setNativeValue(e.target, normalized);

                normalizing = false;

            }

            const val = e.target.value.trim();

            if(val.length > 3){

                App.currentOrder = val;

            }

            const now = Date.now();

            if(val.length <= 1){

                firstCharTime = now;

            }

            clearTimeout(quietTimer);

            const targetEl = e.target;

            const startTime = firstCharTime;

            quietTimer = setTimeout(()=>{

                const finalVal = targetEl.value.trim();

                if(finalVal.length > 3){

                    const totalTime = Date.now() - startTime;

                    const msPerChar = totalTime / finalVal.length;

                    // لو الكتابة كانت سريعة جداً (أقل من 80ms لكل حرف بالمعدل)، هذا قارئ باركود
                    if(msPerChar < 80){

                        autoClickScan(finalVal);

                    }

                }

            }, 300);

            if(e.target.value.length === 0){

                firstCharTime = 0;

                clearTimeout(quietTimer);

            }

        }

    }, true);

    // نراقب ظهور نتيجة المسح (بغض النظر مين ضغط Scan) ونبدأ محرك القرار تلقائياً
    let orderObserverBusy = false;

    let observerDebounce = null;

    const orderObserver = new MutationObserver(()=>{

        // نجمع كل التغييرات المتقاربة (خلال 150ms) ونفحص مرة وحدة بس - بدل فحص كامل
        // فوري مع كل تغيير بسيط بالصفحة (هذا كان السبب الرئيسي للبطء)
        clearTimeout(observerDebounce);

        observerDebounce = setTimeout(()=>{

            if(orderObserverBusy) return;

            const province = getProvince();

            if(province && App.currentOrder){

                orderObserverBusy = true;

                log("ظهرت بيانات الطلب");

                decisionEngine();

                const input = getInput();

                if(input){ input.value = ""; }

                setTimeout(()=>{ orderObserverBusy = false; }, 3000);

            }

        }, 150);

    });

    orderObserver.observe(document.body, { childList: true, subtree: true });

}

// نحدد أي صفحة نحن فيها ونشغّل المنطق المناسب لها
function init(){

    resetCounterIfNewDay();

    App.storeCount = getCount(KEY_STORE_COUNT);

    App.sortCount = getCount(KEY_SORT_COUNT);

    if(location.href.indexOf('city_returned_orders/box') !== -1){

        runPageBox();

    }else if(location.href.indexOf('city_returned_orders') !== -1){

        runPageBScan();

    }else{

        start();

    }

}

if(document.readyState==='loading'){

    document.addEventListener('DOMContentLoaded',init);

}else{

    init();


}

})();
