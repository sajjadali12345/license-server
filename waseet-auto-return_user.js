// ==UserScript==
// @name         Waseet Auto Return - FINAL V8.1
// @namespace    waseet-auto
// @version      8.1
// @description  USB + Manual + Reset 00:00:01 + Duplicate Protect
// @match        https://personal.alwaseet-iq.net/operation/recycling_users/scan*
// @match        https://personal.alwaseet-iq.net/operation/recycling_users/city_returned_orders/scan*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function(){
'use strict';


const PAGE_SCAN =
'https://personal.alwaseet-iq.net/operation/recycling_users/scan';


const PAGE_BAGHDAD =
'https://personal.alwaseet-iq.net/operation/recycling_users/city_returned_orders/scan';




// مفاتيح جديدة حتى يبدأ العداد من صفر

const KEY_ORDER='waseet_v81_order';
const KEY_AUTO='waseet_v81_auto';

const KEY_BOX='waseet_v81_box';
const KEY_BOX_DAY='waseet_v81_box_day';

const KEY_DAY='waseet_v81_day';

const KEY_STORE='waseet_v81_store';
const KEY_SORT='waseet_v81_sort';

const KEY_DONE='waseet_v81_done';





// تحويل الأرقام العربية والانجليزية

function cleanCode(v){


v=String(v||'');



try{

let j=JSON.parse(v);


if(j.pQrNumber){

v=String(j.pQrNumber);

}


}catch(e){}




// عربي ٠١٢

v=v.replace(/[٠-٩]/g,
x=>'٠١٢٣٤٥٦٧٨٩'.indexOf(x)
);



// فارسي

v=v.replace(/[۰-۹]/g,
x=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(x)
);



// فقط أرقام

return v.replace(/\D/g,'');


}







// تاريخ اليوم

function today(){


let d=new Date();



return d.getFullYear()
+'-'+
String(d.getMonth()+1).padStart(2,'0')
+'-'+
String(d.getDate()).padStart(2,'0');


}







// تصفير بعد 12:00:01

function resetCheck(){



let now=new Date();



let saved =
localStorage.getItem(KEY_DAY);




if(!saved){



localStorage.setItem(
KEY_DAY,
today()
);



localStorage.setItem(
KEY_STORE,
'0'
);



localStorage.setItem(
KEY_SORT,
'0'
);



localStorage.setItem(
KEY_DONE,
'{}'
);



return;


}





let resetTime =
new Date(
now.getFullYear(),
now.getMonth(),
now.getDate(),
0,
0,
1
);






if(
saved !== today() &&
now >= resetTime
){



localStorage.setItem(
KEY_DAY,
today()
);



localStorage.setItem(
KEY_STORE,
'0'
);



localStorage.setItem(
KEY_SORT,
'0'
);




localStorage.setItem(
KEY_DONE,
'{}'
);



localStorage.removeItem(KEY_BOX);


localStorage.removeItem(KEY_BOX_DAY);



}



}







function getDone(){


resetCheck();



return JSON.parse(
localStorage.getItem(KEY_DONE)||'{}'
);


}







function isDone(order){


return !!getDone()[order];


}








function saveDone(order,type){



if(!order)return;



let d=getDone();



d[order]=type;




localStorage.setItem(
KEY_DONE,
JSON.stringify(d)
);



}








// العداد

function addCounter(type,order){



if(!order)return false;




if(isDone(order)){


showStatus(
'⚠️ الطلب تمت معالجته سابقاً'
);



return false;


}





if(type==='store'){



localStorage.setItem(
KEY_STORE,
Number(localStorage.getItem(KEY_STORE)||0)+1
);


}




if(type==='sort'){



localStorage.setItem(
KEY_SORT,
Number(localStorage.getItem(KEY_SORT)||0)+1
);


}




saveDone(order,type);



return true;


}








function counter(){


resetCheck();



let s =
Number(
localStorage.getItem(KEY_STORE)||0
);



let f =
Number(
localStorage.getItem(KEY_SORT)||0
);



return (
' | 📦 المخزن: '+s+
' | 🔀 الفرز: '+f+
' | 📊 الكلي: '+(s+f)
);


}








function showStatus(t){



let bar =
document.getElementById(
'waseet_bar'
);




if(!bar){


bar=document.createElement('div');



bar.id='waseet_bar';




bar.style.cssText=
'position:fixed;top:0;left:0;right:0;z-index:999999;background:#173b63;color:white;padding:8px;text-align:center;direction:rtl;font-size:14px';




document.documentElement.appendChild(bar);



}




bar.textContent =
t+counter();


}

function resetBarColor(){

let bar = document.getElementById('waseet_bar');

if(bar) bar.style.background = '#173b63';

}

// أدوات

function setVal(el,v){

let p=Object.getPrototypeOf(el);
let d=Object.getOwnPropertyDescriptor(p,'value');

if(d&&d.set){
d.set.call(el,v);
}else{
el.value=v;
}

el.dispatchEvent(
new Event('input',{bubbles:true})
);

el.dispatchEvent(
new Event('change',{bubbles:true})
);

}



function findText(sel,text){

for(let e of document.querySelectorAll(sel)){

if(
e.innerText &&
e.innerText.includes(text)
){

return e;

}

}

return null;

}



let currentOrder='';




// صفحة المسح

function runScan(){


showStatus('جاهز - امسح الطلب');



// تفعيل يدوي

setInterval(()=>{

let c=document.querySelector(
'input[type="checkbox"]'
);

if(c&&!c.checked){

c.click();

}

},500);




// تركيز خانة الطلب

setInterval(()=>{

let i=document.querySelector(
'input[type="text"]'
);

if(i){

i.focus();

}

},400);





// Scan يدوي عربي + انجليزي

document.addEventListener(
'click',
e=>{


let btn=e.target.closest('button');

if(!btn)return;



if(
btn.innerText.includes('Scan') ||
btn.innerText.includes('مسح')
){


let input=document.querySelector(
'input[type="text"]'
);


if(input){


let code=
cleanCode(input.value);



if(code){


currentOrder=code;

resetBarColor();


// تحويل العربي لانجليزي

setVal(
input,
code
);


}


}


}


},
true
);






// قارئ USB

let buffer='';
let timer=null;



document.addEventListener(
'keydown',
e=>{


if(e.key==='Enter'){



e.preventDefault();
e.stopPropagation();



let code=
cleanCode(buffer);



buffer='';




if(code.length<5){

return;

}



if(isDone(code)){


showStatus(
'⚠️ الطلب تمت معالجته سابقاً'
);


return;


}




let input=document.querySelector(
'input[type="text"]'
);



if(input){



currentOrder=code;

resetBarColor();



setVal(
input,
code
);



let scan =
findText('button','Scan') ||
findText('button','مسح');



if(scan){


setTimeout(()=>{

scan.click();

},50);


}



}



return;


}




if(e.key.length===1){



buffer+=e.key;



clearTimeout(timer);



timer=setTimeout(()=>{

buffer='';

},300);



}


},
true
);






// مراقبة ظهور معلومات الطلب

let observer =
new MutationObserver(()=>{



let storeBtn =
findText(
'button,a,div[role="button"]',
'تحويل الى المخزن'
);



let sortBtn =
findText(
'button,a,div[role="button"]',
'تحويل الى الفرز'
);




if(!storeBtn||!sortBtn)return;


if(storeBtn.dataset.done)return;



storeBtn.dataset.done='1';

sortBtn.dataset.done='1';





if(isDone(currentOrder)){


showStatus(
'⚠️ هذا الطلب تمت معالجته سابقاً'
);


return;

}




let all='';



document
.querySelectorAll('*')
.forEach(e=>{

if(e.innerText){

all+=' '+e.innerText;

}

});




document
.querySelectorAll(
'input,textarea,select'
)
.forEach(e=>{


if(e.value){

all+=' '+e.value;

}



if(e.options&&e.selectedIndex>=0){

all+=' '+e.options[e.selectedIndex].text;

}


});





let isKut =

all.includes('الكوت');



// تجاهل الطلب كلياً لو حالته مؤجلة - بدون تحويل لا للمخزن ولا للفرز ولا لبغداد
let isPostponed =

all.includes('مؤجل') ||

all.includes('تأجيل الطلب');



if(isPostponed){



showStatus(
'❌ خطأ: هذا الطلب مؤجّل - تم إيقاف المعالجة التلقائية'
);



let bar = document.getElementById('waseet_bar');

if(bar) bar.style.background = '#b91c1c';



return;


}






if(isKut){



showStatus(
'📦 تحويل للمخزن'
);



storeBtn.click();




localStorage.setItem(
KEY_ORDER,
currentOrder
);



localStorage.setItem(
KEY_AUTO,
'1'
);





setTimeout(()=>{


location.href=
PAGE_BAGHDAD;


},300);





}else{



showStatus(
'🔀 تحويل للفرز'
);



sortBtn.click();



addCounter(
'sort',
currentOrder
);



// نمسح أي علامة "جاهز للإرسال لبغداد" متبقية من طلب سابق (كوت/واسط) لم تكتمل عمليته -
// هذا الطلب الحالي غير منتمٍ للمحافظة، فما نبيه يتحول لبغداد بأي شكل ولا نبي بيانات
// طلب قديم تضل عالقة وتُعالَج بالغلط لاحقاً
localStorage.removeItem(KEY_ORDER);

localStorage.removeItem(KEY_AUTO);



}




});




observer.observe(
document.body,
{
childList:true,
subtree:true
});



}







function waitFor(fn){

return new Promise(resolve=>{


let t=setInterval(()=>{


let r=fn();


if(r){

clearInterval(t);

resolve(r);

}


},50);


});


}








// صفحة بغداد

function runBaghdad(){



window.prompt=function(){



let box=
localStorage.getItem(KEY_BOX);


let day=
localStorage.getItem(KEY_BOX_DAY);



if(box&&day===today()){

return box;

}



let b=today();



localStorage.setItem(KEY_BOX,b);

localStorage.setItem(KEY_BOX_DAY,today());



return b;


};





let order=
localStorage.getItem(KEY_ORDER);



let auto=
localStorage.getItem(KEY_AUTO);





if(order&&auto==='1'){



showStatus(
'📤 إرسال بغداد'
);




waitFor(()=>{


let inputs=[
...document.querySelectorAll(
'input[type="text"]'
)
];



let input=
inputs[inputs.length-1];



let scan=
findText('button','Scan') ||
findText('button','مسح');



let check=
document.querySelector(
'input[type="checkbox"]'
);



if(input&&scan){

return {input,scan,check};

}


}).then(({input,scan,check})=>{



if(check&&!check.checked){

check.click();

}



input.focus();



setVal(
input,
order
);




setTimeout(()=>{


scan.click();




setTimeout(()=>{


addCounter(
'store',
order
);



localStorage.removeItem(KEY_ORDER);

localStorage.removeItem(KEY_AUTO);




location.href=
PAGE_SCAN;



},350);



},80);




});



}else{


showStatus('جاهز');


}



}







// تشغيل

function start(){



if(
location.href.includes(
'city_returned_orders'
)
){


runBaghdad();


}else{


runScan();


}


}




if(document.readyState==='loading'){


document.addEventListener(
'DOMContentLoaded',
start
);


}else{


start();


}



})();
