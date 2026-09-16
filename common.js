/* Humanly Review shared frontend helpers. */
const HR_CONFIG = Object.freeze({
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbxuhZ9TBwvBDAkDzz2XJoXGA4Ziy_mWgZn6kQXSShlN9BcM-9FAXeIiLQDIPl67-5yOzQ/exec',
  SITE_URL: 'https://humanlyreview.com',
  SUPPORT_PAGE: '/help.html',
  DELIVERY_PAGE: '/delivery.html',
  MAX_NETWORK_RETRIES: 2,
  CLIENT_VERSION: '2.0.0'
});

const hrState = {
  sessionToken: localStorage.getItem('hr_session_token') || '',
  email: localStorage.getItem('hr_email') || '',
  orderRef: localStorage.getItem('hr_order_ref') || '',
  paymentTabOpened: false,
  selectedFile: null,
  selectedWorkFiles: [],
  selectedInstructionFiles: [],
  instructionText: '',
  currentOrder: null
};

function hrSaveSession(token, email) { hrState.sessionToken=token||''; hrState.email=email||hrState.email||''; if(token)localStorage.setItem('hr_session_token',token); if(email)localStorage.setItem('hr_email',email); }
function hrSaveOrder(orderRef) { hrState.orderRef=orderRef||''; if(orderRef)localStorage.setItem('hr_order_ref',orderRef); }
function hrClearOrder() { hrState.orderRef=''; localStorage.removeItem('hr_order_ref'); }
function hrMaskEmail(email) { if(!email||!email.includes('@'))return email||''; const [name,domain]=email.split('@'); if(name.length<=2)return `${name[0]||'*'}***@${domain}`; return `${name.slice(0,2)}***@${domain}`; }
function hrFormatBytes(bytes) { if(!Number.isFinite(Number(bytes)))return '—'; let n=Number(bytes); if(n<1024)return `${n} B`; const units=['KB','MB','GB']; for(const u of units){n/=1024;if(n<1024)return `${n.toFixed(n>=100?0:n>=10?1:2)} ${u}`;} return `${n.toFixed(1)} TB`; }
function hrFormatMoney(amount,currency='NGN') { const n=Number(amount||0); try{return new Intl.NumberFormat('en-NG',{style:'currency',currency,maximumFractionDigits:2}).format(n);}catch(e){return `${currency} ${n.toLocaleString()}`;} }
function hrFormatDate(iso) { if(!iso)return '—'; const d=new Date(iso); if(Number.isNaN(d.getTime()))return '—'; return d.toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'}); }
function hrEscape(text) { return String(text??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function hrStatusLabel(status) { const map={awaiting_payment:'Awaiting payment',submitted:'Submitted',in_review:'In review',delivered:'Report ready',downloaded:'Downloaded',acknowledged:'Acknowledged',deleted:'Completed',abandoned_expired:'Expired'}; return map[status]||status||'Unknown'; }
function hrShow(el,show=true){if(el)el.classList.toggle('hidden',!show);}
function hrSetBusy(button,busy,busyText='Processing…'){if(!button)return;if(busy){button.dataset.originalText=button.textContent;button.disabled=true;button.textContent=busyText;}else{button.disabled=false;button.textContent=button.dataset.originalText||button.textContent;}}
function hrToast(message,type='info'){let host=document.getElementById('toast-host');if(!host){host=document.createElement('div');host.id='toast-host';document.body.appendChild(host);}const item=document.createElement('div');item.className=`toast ${type}`;item.textContent=message;host.appendChild(item);setTimeout(()=>item.classList.add('visible'),10);setTimeout(()=>{item.classList.remove('visible');setTimeout(()=>item.remove(),250)},4200);}
function hrSetError(el,message=''){if(el){el.textContent=message;el.classList.toggle('hidden',!message);}}
function hrValidateEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email||'').trim());}
async function hrApi(action,payload={},options={}){
  if(!HR_CONFIG.BACKEND_URL||HR_CONFIG.BACKEND_URL.includes('PASTE_'))throw new Error('The Apps Script backend URL has not been configured yet.');
  const body=JSON.stringify({action,payload,clientVersion:HR_CONFIG.CLIENT_VERSION});let lastErr;
  for(let attempt=0;attempt<=HR_CONFIG.MAX_NETWORK_RETRIES;attempt++){
    try{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),options.timeoutMs||45000);const res=await fetch(HR_CONFIG.BACKEND_URL,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body,signal:controller.signal});clearTimeout(timeout);const text=await res.text();let data;try{data=JSON.parse(text);}catch(e){throw new Error('The server returned an unreadable response. Please retry.');}if(!data.ok)throw new Error(data.error||'The request could not be completed.');return data;}catch(err){lastErr=err;if(attempt<HR_CONFIG.MAX_NETWORK_RETRIES)await new Promise(r=>setTimeout(r,700*(attempt+1)));}
  }
  throw new Error(lastErr?.name==='AbortError'?'The request took too long. Please try again.':(lastErr?.message||'Network error. Please check your connection and try again.'));
}
function hrFileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const result=String(reader.result||'');const comma=result.indexOf(',');resolve(comma>=0?result.slice(comma+1):result);};reader.onerror=()=>reject(new Error('Your file could not be read on this device.'));reader.readAsDataURL(file);});}
function hrPersistPaymentEvent(orderRef,verified=true){localStorage.setItem('hr_payment_event',JSON.stringify({orderRef,verified,at:Date.now()}));window.dispatchEvent(new StorageEvent('storage',{key:'hr_payment_event',newValue:localStorage.getItem('hr_payment_event')}));}
function hrReadPaymentEvent(){try{return JSON.parse(localStorage.getItem('hr_payment_event')||'null');}catch(e){return null;}}
function hrClearPaymentEvent(){localStorage.removeItem('hr_payment_event');}
function hrOnPaymentEvent(callback){window.addEventListener('storage',e=>{if(e.key==='hr_payment_event'&&e.newValue){try{callback(JSON.parse(e.newValue));}catch(_){}}});}
function hrGetQuery(){return new URLSearchParams(location.search);}
function hrTrack(label,extra={}){if(window.console)console.debug('[HumanlyReview]',label,extra);}
function hrFileKey(file){return `${file.name}__${file.size}`;}
function hrExtsToAccept(value){return String(value||'').split(',').map(x=>x.trim().startsWith('.')?x.trim():'.'+x.trim()).filter(Boolean).join(',');}
