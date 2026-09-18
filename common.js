/* Humanly Review shared frontend helpers — customer flow v6.4.1. */
const HR_CONFIG = Object.freeze({
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbxuhZ9TBwvBDAkDzz2XJoXGA4Ziy_mWgZn6kQXSShlN9BcM-9FAXeIiLQDIPl67-5yOzQ/exec',
  SITE_URL: 'https://humanlyreview.com',
  SUPPORT_PAGE: '/help.html',
  DELIVERY_PAGE: '/delivery.html',
  MAX_NETWORK_RETRIES: 1,
  CLIENT_VERSION: '6.4.1',
  REVIEW_RETENTION_MS: 48 * 60 * 60 * 1000
});

const HR_STORAGE = Object.freeze({
  REVIEW: 'hr_current_review_v2',
  LEGACY_SESSION: 'hr_session_token',
  LEGACY_EMAIL: 'hr_email',
  LEGACY_ORDER: 'hr_order_ref',
  LEGACY_TICKET: 'hr_custom_ticket',
  PAYMENT_EVENT: 'hr_payment_event',
  DRAFT_DB: 'hr_review_draft_db_v3',
  DRAFT_STORE: 'files',
  VERIFIED_SESSION: 'hr_verified_session_v1',
  PUBLIC_CONFIG_CACHE: 'hr_public_config_cache_v2'
});

function hrReadJson(key, fallback=null){
  try{return JSON.parse(localStorage.getItem(key)||'null') ?? fallback;}
  catch(_){return fallback;}
}
function hrWriteJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(_){} }
function hrBuildReviewMeta(existing={}){
  const now=Date.now();
  return {version:4,startedAt:Number(existing.startedAt)||now,updatedAt:now,expiresAt:Number(existing.expiresAt)||now+HR_CONFIG.REVIEW_RETENTION_MS,sessionToken:existing.sessionToken||'',pendingSessionToken:existing.pendingSessionToken||'',email:existing.email||'',orderRef:existing.orderRef||'',customTicketRef:existing.customTicketRef||'',status:existing.status||'draft',resumeStep:existing.resumeStep||'step-email',briefChoice:existing.briefChoice||'',instructionText:existing.instructionText||''};
}
function hrGetReviewMeta(){
  let meta=hrReadJson(HR_STORAGE.REVIEW,null);
  if(meta && Number(meta.expiresAt) && Number(meta.expiresAt)<Date.now()){hrClearCurrentReviewStorage();return null;}
  if(!meta){
    const legacyOrder=localStorage.getItem(HR_STORAGE.LEGACY_ORDER)||'';
    const legacySession=localStorage.getItem(HR_STORAGE.LEGACY_SESSION)||'';
    const legacyEmail=localStorage.getItem(HR_STORAGE.LEGACY_EMAIL)||'';
    const legacyTicket=localStorage.getItem(HR_STORAGE.LEGACY_TICKET)||'';
    if(legacySession&&legacyEmail&&!hrReadJson(HR_STORAGE.VERIFIED_SESSION,null)){
      hrWriteJson(HR_STORAGE.VERIFIED_SESSION,{sessionToken:legacySession,email:legacyEmail,verifiedAt:Date.now()});
    }
    if(legacyOrder||legacyTicket){
      meta=hrBuildReviewMeta({sessionToken:legacySession,email:legacyEmail,orderRef:legacyOrder,customTicketRef:legacyTicket,status:legacyOrder?'order':'custom_quote'});
      hrWriteJson(HR_STORAGE.REVIEW,meta);
    }
  }
  return meta;
}
function hrPersistReviewMeta(patch={}){
  const current=hrGetReviewMeta()||hrBuildReviewMeta({});
  const next=hrBuildReviewMeta({...current,...patch,updatedAt:Date.now()});
  hrWriteJson(HR_STORAGE.REVIEW,next);
  if(next.sessionToken)localStorage.setItem(HR_STORAGE.LEGACY_SESSION,next.sessionToken);else localStorage.removeItem(HR_STORAGE.LEGACY_SESSION);
  if(next.email)localStorage.setItem(HR_STORAGE.LEGACY_EMAIL,next.email);else localStorage.removeItem(HR_STORAGE.LEGACY_EMAIL);
  if(next.orderRef)localStorage.setItem(HR_STORAGE.LEGACY_ORDER,next.orderRef);else localStorage.removeItem(HR_STORAGE.LEGACY_ORDER);
  if(next.customTicketRef)localStorage.setItem(HR_STORAGE.LEGACY_TICKET,next.customTicketRef);else localStorage.removeItem(HR_STORAGE.LEGACY_TICKET);
  return next;
}
function hrDraftOpenDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('Browser draft storage is unavailable.'));return;}
    const req=indexedDB.open(HR_STORAGE.DRAFT_DB,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(HR_STORAGE.DRAFT_STORE))req.result.createObjectStore(HR_STORAGE.DRAFT_STORE,['kind','index']);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Could not open draft storage.'));
  });
}
async function hrPersistDraftFiles(kind,files){
  try{
    const db=await hrDraftOpenDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(HR_STORAGE.DRAFT_STORE,'readwrite');
      const store=tx.objectStore(HR_STORAGE.DRAFT_STORE);
      const allReq=store.getAll();
      allReq.onsuccess=()=>{
        try{
          (allReq.result||[]).filter(row=>row.kind===kind).forEach(row=>store.delete([kind,row.index]));
          (files||[]).forEach((f,i)=>store.put({kind,index:i,name:f.name,size:Number(f.size||0),type:f.type||'application/octet-stream',lastModified:Number(f.lastModified||Date.now()),blob:f}));
        }catch(err){ reject(err); }
      };
      allReq.onerror=()=>reject(allReq.error||new Error('Could not update draft files.'));
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Could not save draft files.'));
    });
    db.close();
    return true;
  }catch(e){
    hrTrack('draft-file-save-failed',{kind,message:e.message});
    return false;
  }
}
async function hrRestoreDraftFiles(kind){
  try{
    const db=await hrDraftOpenDb();
    const rows=await new Promise((resolve,reject)=>{
      const tx=db.transaction(HR_STORAGE.DRAFT_STORE,'readonly');
      const req=tx.objectStore(HR_STORAGE.DRAFT_STORE).getAll();
      req.onsuccess=()=>resolve((req.result||[]).filter(x=>x.kind===kind).sort((a,b)=>a.index-b.index));
      req.onerror=()=>reject(req.error||new Error('Could not read draft files.'));
    });
    db.close();
    return rows.map(r=>new File([r.blob],r.name,{type:r.type,lastModified:r.lastModified}));
  }catch(e){
    hrTrack('draft-file-restore-failed',{kind,message:e.message});
    return [];
  }
}
async function hrClearDraftFiles(){
  try{
    const db=await hrDraftOpenDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(HR_STORAGE.DRAFT_STORE,'readwrite');
      tx.objectStore(HR_STORAGE.DRAFT_STORE).clear();
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    db.close();
  }catch(_){}
}
function hrGetVerifiedSession(){return hrReadJson(HR_STORAGE.VERIFIED_SESSION,null);}
function hrHasVerifiedSession(){const v=hrGetVerifiedSession();return !!(v&&v.sessionToken&&v.email);}
function hrSetVerifiedSession(token,email,expiresAt=''){if(token&&email)hrWriteJson(HR_STORAGE.VERIFIED_SESSION,{sessionToken:String(token),email:String(email).trim().toLowerCase(),verifiedAt:Date.now(),expiresAt:expiresAt||''});}
function hrClearVerifiedSession(){try{localStorage.removeItem(HR_STORAGE.VERIFIED_SESSION);}catch(_){} }
async function hrCheckVerifiedSession(email=hrState.email,token=hrState.sessionToken){if(!email||!token)return false;try{const r=await hrApi('checkSession',{sessionToken:token,email},{noRetry:true,timeoutMs:12000});if(r?.data?.valid){hrSetVerifiedSession(token,email,r.data.expiresAt||'');hrState.sessionToken=token;hrState.email=email;try{localStorage.setItem(HR_STORAGE.LEGACY_SESSION,token);localStorage.setItem(HR_STORAGE.LEGACY_EMAIL,email);}catch(_){}return true;}return false;}catch(_){return false;}}
function hrGetStoredVerifiedIdentity(){const v=hrGetVerifiedSession();if(v?.sessionToken&&v?.email)return v;if(hrState.sessionToken&&hrState.email)return {sessionToken:hrState.sessionToken,email:hrState.email,expiresAt:''};return null;}
function hrHasUsableStoredVerification(email=''){const v=hrGetStoredVerifiedIdentity();if(!v?.sessionToken||!v?.email)return false;const wanted=String(email||'').trim().toLowerCase();if(wanted&&String(v.email).toLowerCase()!==wanted)return false;return !v.expiresAt || Number.isNaN(new Date(v.expiresAt).getTime()) || new Date(v.expiresAt).getTime()>Date.now();}
async function hrReuseVerifiedIdentity(email){const e=String(email||'').trim().toLowerCase();if(!e)return false;const v=hrGetStoredVerifiedIdentity();if(!v?.sessionToken||!v?.email||String(v.email).toLowerCase()!==e)return false;/* Trust the saved identity locally for navigation. The protected backend action still validates the session. This removes an extra network round-trip and prevents unnecessary OTP prompts during a slow connection. */if(hrHasUsableStoredVerification(e)){hrState.newReviewMode=false;hrState.sessionToken=v.sessionToken;hrState.email=e;return true;}return await hrCheckVerifiedSession(e,v.sessionToken);}
async function hrFetchPublicConfigDirect(){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{const url=HR_CONFIG.BACKEND_URL+(HR_CONFIG.BACKEND_URL.includes('?')?'&':'?')+'action=public';const res=await fetch(url,{method:'GET',redirect:'follow',cache:'no-store',signal:controller.signal});const text=await res.text();const data=JSON.parse(text);if(!data.ok)throw new Error(data.error||'Could not load site settings.');return data.data;}finally{clearTimeout(timeout);}
}
async function hrGetPublicConfig(force=false){
  const now=Date.now(),cache=hrReadJson(HR_STORAGE.PUBLIC_CONFIG_CACHE,null),ttl=10*60*1000;
  if(cache?.data && !force){
    if(Number(cache.savedAt)+ttl>now)return cache.data;
    Promise.resolve().then(()=>hrFetchPublicConfigDirect().then(data=>hrWriteJson(HR_STORAGE.PUBLIC_CONFIG_CACHE,{savedAt:Date.now(),data})).catch(()=>{}));
    return cache.data;
  }
  const data=await hrFetchPublicConfigDirect();hrWriteJson(HR_STORAGE.PUBLIC_CONFIG_CACHE,{savedAt:Date.now(),data});return data;
}
function hrInvalidatePublicConfigCache(){try{localStorage.removeItem(HR_STORAGE.PUBLIC_CONFIG_CACHE);}catch(_){} }
function hrPersistDraftState(patch={}){
  const meta=hrGetReviewMeta()||hrBuildReviewMeta({});
  return hrPersistReviewMeta({
    ...patch,
    resumeStep:patch.resumeStep||meta.resumeStep||'step-email',
    briefChoice:patch.briefChoice!==undefined?patch.briefChoice:(meta.briefChoice||''),
    instructionText:patch.instructionText!==undefined?String(patch.instructionText):String(meta.instructionText||''),
    status:patch.status||meta.status||'draft'
  });
}
function hrGetResumeStep(){return String(hrGetReviewMeta()?.resumeStep||'step-email');}
function hrResumeStepLabel(step){const m={
  'step-email':'Email verification',
  'step-otp':'Email verification',
  'step-reverify':'Email verification',
  'step-work':'Work files',
  'step-instructions':'Assignment instructions',
  'step-summary':'Order check',
  'step-custom':'Custom request',
  'step-paying':'Payment',
  'step-submitting':'Secure submission',
  'step-recovery':'Payment recovery'
};return m[String(step)]||'Your review';}
async function hrRestoreDraftIntoState(){
  const meta=hrGetReviewMeta();
  const verified=hrGetVerifiedSession();
  if(!meta&&!verified)return false;
  hrState.sessionToken=meta?.sessionToken||verified?.sessionToken||hrState.sessionToken||'';
  hrState.pendingSessionToken=meta?.pendingSessionToken||hrState.pendingSessionToken||'';
  hrState.email=meta?.email||verified?.email||hrState.email||'';
  hrState.orderRef=meta?.orderRef||hrState.orderRef||'';
  hrState.customTicketRef=meta?.customTicketRef||hrState.customTicketRef||'';
  hrState.instructionText=meta?.instructionText||'';
  if(hrState.sessionToken&&hrState.email){
    const sameVerified=verified?.sessionToken&&String(verified.sessionToken)===String(hrState.sessionToken)&&String(verified.email||'').toLowerCase()===String(hrState.email||'').toLowerCase();
    if(!sameVerified)hrSetVerifiedSession(hrState.sessionToken,hrState.email,verified?.expiresAt||'');
  }
  try{
    const [work,instructions]=await Promise.all([hrRestoreDraftFiles('work'),hrRestoreDraftFiles('instruction')]);
    hrState.selectedWorkFiles=work;
    hrState.selectedInstructionFiles=instructions;
  }catch(_){}
  return true;
}
async function hrClearCurrentReviewStorage(){
  Object.values(HR_STORAGE).filter(k=>![HR_STORAGE.DRAFT_DB,HR_STORAGE.DRAFT_STORE,HR_STORAGE.VERIFIED_SESSION,HR_STORAGE.LEGACY_SESSION,HR_STORAGE.LEGACY_EMAIL].includes(k)).forEach(key=>localStorage.removeItem(key));
  const verified=hrGetVerifiedSession();if(verified?.sessionToken&&verified?.email){localStorage.setItem(HR_STORAGE.LEGACY_SESSION,verified.sessionToken);localStorage.setItem(HR_STORAGE.LEGACY_EMAIL,verified.email);}
  await hrClearDraftFiles();
}
function hrHasActiveReview(){const meta=hrGetReviewMeta();if(!meta)return false;return !!(meta.orderRef||meta.customTicketRef||String(meta.resumeStep||'step-email')!=='step-email');}
const _hrMeta=hrGetReviewMeta();
const _hrVerified=hrGetVerifiedSession();
const hrState={
  sessionToken:_hrMeta?.sessionToken||_hrVerified?.sessionToken||localStorage.getItem(HR_STORAGE.LEGACY_SESSION)||'',
  pendingSessionToken:_hrMeta?.pendingSessionToken||'',
  email:_hrMeta?.email||_hrVerified?.email||localStorage.getItem(HR_STORAGE.LEGACY_EMAIL)||'',
  orderRef:_hrMeta?.orderRef||localStorage.getItem(HR_STORAGE.LEGACY_ORDER)||'',
  paymentTabOpened:false,selectedFile:null,selectedWorkFiles:[],selectedInstructionFiles:[],instructionText:'',currentOrder:null,currentOrderPreview:null,isCustomQuote:false,
  customTicketRef:_hrMeta?.customTicketRef||localStorage.getItem(HR_STORAGE.LEGACY_TICKET)||''
};
function hrSaveSession(token,email,expiresAt=''){hrState.sessionToken=token||'';hrState.pendingSessionToken='';hrState.email=email||hrState.email||'';if(hrState.sessionToken&&hrState.email)hrSetVerifiedSession(hrState.sessionToken,hrState.email,expiresAt);hrPersistReviewMeta({sessionToken:hrState.sessionToken,pendingSessionToken:'',email:hrState.email,status:hrState.orderRef?'order':'draft'});}
function hrSavePendingSession(token,email){hrState.pendingSessionToken=token||'';hrState.sessionToken='';hrState.email=email||hrState.email||'';hrPersistReviewMeta({sessionToken:'',pendingSessionToken:hrState.pendingSessionToken,email:hrState.email,resumeStep:'step-otp',status:'draft'});}
function hrSaveOrder(orderRef){hrState.orderRef=orderRef||'';hrPersistReviewMeta({orderRef:hrState.orderRef,status:hrState.orderRef?'order':'draft'});}
function hrClearOrder(){hrState.orderRef='';const meta=hrGetReviewMeta()||{};hrPersistReviewMeta({...meta,orderRef:'',status:'draft'});}
function hrSaveCustomTicket(ticketRef){hrState.customTicketRef=ticketRef||'';hrPersistReviewMeta({customTicketRef:hrState.customTicketRef,status:hrState.customTicketRef?'custom_quote':'draft'});}
function hrClearCustomTicket(){hrState.customTicketRef='';const meta=hrGetReviewMeta()||{};hrPersistReviewMeta({...meta,customTicketRef:'',status:meta?.orderRef?'order':'draft'});}
async function hrStartNewReview(){
  const verified=hrGetVerifiedSession();
  try{[HR_STORAGE.REVIEW,HR_STORAGE.LEGACY_ORDER,HR_STORAGE.LEGACY_TICKET,HR_STORAGE.PAYMENT_EVENT].forEach(key=>localStorage.removeItem(key));}catch(_){ }
  if(verified?.sessionToken&&verified?.email){
    try{localStorage.setItem(HR_STORAGE.LEGACY_SESSION,verified.sessionToken);localStorage.setItem(HR_STORAGE.LEGACY_EMAIL,verified.email);}catch(_){}
    hrState.sessionToken=verified.sessionToken;hrState.email=verified.email;
  }else{hrState.sessionToken='';hrState.email='';}
  hrState.orderRef='';hrState.customTicketRef='';hrState.pendingSessionToken='';hrState.paymentTabOpened=false;hrState.selectedFile=null;hrState.selectedWorkFiles=[];hrState.selectedInstructionFiles=[];hrState.instructionText='';hrState.currentOrder=null;hrState.currentOrderPreview=null;hrState.isCustomQuote=false;hrState.customQuoteReady=false;hrState.customRequest=null;hrState.enterpriseRequired=false;hrState.newReviewMode=true;
  await hrClearDraftFiles();
  return {hasVerifiedIdentity:!!(verified?.sessionToken&&verified?.email),email:hrState.email};
}
function hrFinishCurrentReview(){hrStartNewReview().catch(()=>{});}
function hrMarkReviewActive(status='draft'){hrPersistReviewMeta({status});}
function hrUseVerifiedIdentity(){const v=hrGetVerifiedSession();if(!v?.sessionToken||!v?.email)return false;hrState.sessionToken=v.sessionToken;hrState.email=v.email;return true;}
function hrMaskEmail(email){if(!email||!email.includes('@'))return email||'';const [name,domain]=email.split('@');if(name.length<=2)return `${name[0]||'*'}***@${domain}`;return `${name.slice(0,2)}***@${domain}`;}
function hrFormatBytes(bytes){if(!Number.isFinite(Number(bytes)))return '—';let n=Number(bytes);if(n<1024)return `${n} B`;const units=['KB','MB','GB'];for(const u of units){n/=1024;if(n<1024)return `${n.toFixed(n>=100?0:n>=10?1:2)} ${u}`;}return `${n.toFixed(1)} TB`;}
function hrFormatMoney(amount,currency='NGN'){const n=Number(amount||0);try{return new Intl.NumberFormat('en-NG',{style:'currency',currency,maximumFractionDigits:2}).format(n);}catch(e){return `${currency} ${n.toLocaleString()}`;}}
function hrFormatDate(iso){if(!iso)return '—';const d=new Date(iso);if(Number.isNaN(d.getTime()))return '—';return d.toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'});}
function hrEscape(text){return String(text??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function hrStatusLabel(status){const map={awaiting_payment:'Awaiting payment',submitted:'Submitted',in_review:'In review',delivered:'Report ready',downloaded:'Downloaded',acknowledged:'Acknowledged',deleted:'Completed',abandoned_expired:'Expired'};return map[status]||status||'Unknown';}
function hrShow(el,show=true){if(el)el.classList.toggle('hidden',!show);}
function hrSetBusy(button,busy,busyText='Processing…'){if(!button)return;if(busy){button.dataset.originalText=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent=busyText;}else{button.disabled=false;button.removeAttribute('aria-busy');button.textContent=button.dataset.originalText||button.textContent;}}
function hrToast(message,type='info'){let host=document.getElementById('toast-host');if(!host){host=document.createElement('div');host.id='toast-host';document.body.appendChild(host);}const item=document.createElement('div');item.className=`toast ${type}`;item.textContent=message;host.appendChild(item);setTimeout(()=>item.classList.add('visible'),10);setTimeout(()=>{item.classList.remove('visible');setTimeout(()=>item.remove(),250)},4200);}
function hrSetError(el,message=''){if(el){el.textContent=message;el.classList.toggle('hidden',!message);}}
function hrClearNearbyErrors(node){const root=node?.closest?.('.flow-step,.card,.form-wrap')||document;root.querySelectorAll('.notice.danger:not([data-keep-error="true"])').forEach(el=>hrSetError(el,''));}
function hrBindErrorClearing(){document.addEventListener('input',ev=>{const t=ev.target;if(!t||!['INPUT','TEXTAREA','SELECT'].includes(t.tagName))return;hrClearNearbyErrors(t);});document.addEventListener('change',ev=>{const t=ev.target;if(!t||!['INPUT','TEXTAREA','SELECT'].includes(t.tagName))return;hrClearNearbyErrors(t);});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hrBindErrorClearing);else hrBindErrorClearing();
function hrValidateEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email||'').trim());}
const HR_READ_ACTIONS=new Set(['health','getPublicConfig','checkSession','matchPlan','getOrderStatus','getCustomRequestStatus','getDelivery','getPaidOrderRecovery','getDownloadChunk']);
const HR_INFLIGHT=new Map();
async function hrApi(action,payload={},options={}){
  if(!HR_CONFIG.BACKEND_URL||HR_CONFIG.BACKEND_URL.includes('PASTE_'))throw new Error('The Apps Script backend URL has not been configured yet.');
  const key=HR_READ_ACTIONS.has(action)?action+'|'+JSON.stringify(payload):'';
  if(key&&HR_INFLIGHT.has(key))return HR_INFLIGHT.get(key);
  const run=(async()=>{
    const body=JSON.stringify({action,payload,clientVersion:HR_CONFIG.CLIENT_VERSION});
    const readAction=HR_READ_ACTIONS.has(action);
    const attempts=options.noRetry?1:(readAction?Math.max(1,Number(HR_CONFIG.MAX_NETWORK_RETRIES)+1):1);
    const defaultTimeout=readAction?20000:30000;
    let lastErr;
    for(let attempt=0;attempt<attempts;attempt++){
      try{
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),options.timeoutMs||defaultTimeout);
        const res=await fetch(HR_CONFIG.BACKEND_URL,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},body,signal:controller.signal,cache:'no-store'});
        clearTimeout(timeout);
        const text=await res.text();
        let data;try{data=JSON.parse(text);}catch(e){throw new Error('The server returned an unreadable response. Please retry.');}
        if(!data.ok)throw new Error(data.error||'The request could not be completed.');
        return data;
      }catch(err){
        lastErr=err;
        if(attempt<attempts-1)await new Promise(r=>setTimeout(r,Math.min(900,300*(attempt+1))));
      }
    }
    throw new Error(lastErr?.name==='AbortError'?'The request took too long. Please try again.':(lastErr?.message||'Network error. Please check your connection and try again.'));
  })();
  if(key)HR_INFLIGHT.set(key,run);
  try{return await run;}finally{if(key)HR_INFLIGHT.delete(key);}
}
function hrFileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const result=String(reader.result||'');const comma=result.indexOf(',');resolve(comma>=0?result.slice(comma+1):result);};reader.onerror=()=>reject(new Error('Your file could not be read on this device.'));reader.readAsDataURL(file);});}
function hrPersistPaymentEvent(orderRef,verified=true){localStorage.setItem(HR_STORAGE.PAYMENT_EVENT,JSON.stringify({orderRef,verified,at:Date.now()}));window.dispatchEvent(new StorageEvent('storage',{key:HR_STORAGE.PAYMENT_EVENT,newValue:localStorage.getItem(HR_STORAGE.PAYMENT_EVENT)}));}
function hrReadPaymentEvent(){try{return JSON.parse(localStorage.getItem(HR_STORAGE.PAYMENT_EVENT)||'null');}catch(e){return null;}}
function hrClearPaymentEvent(){localStorage.removeItem(HR_STORAGE.PAYMENT_EVENT);}
function hrOnPaymentEvent(callback){window.addEventListener('storage',e=>{if(e.key===HR_STORAGE.PAYMENT_EVENT&&e.newValue){try{callback(JSON.parse(e.newValue));}catch(_){}}});}
function hrGetQuery(){return new URLSearchParams(location.search);}
function hrTrack(label,extra={}){if(window.console)console.debug('[HumanlyReview]',label,extra);}
function hrFileKey(file){return `${file.name}__${file.size}`;}
function hrExtsToAccept(value){return String(value||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.startsWith('.')?x:'.'+x).join(',');}

/* Customer-flow resume system: restore the exact unfinished stage and locally stored draft files. */
(function hrInstallCustomerFlowGuard(){
  function resetVisibleForm(){
    try{
      ['email','otp','instruction-text'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      ['work-file-input','instruction-file-input','recovery-work-input','recovery-instruction-input'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      document.querySelectorAll('input[name="has-brief"]').forEach(r=>r.checked=false);
      ['brief-yes-area','brief-no-area'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));
      ['work-file-list','instruction-file-list','recovery-work-picked','recovery-instruction-picked'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='';});
      ['work-size-notice','email-error','otp-error','reverify-error','work-error','instruction-error','summary-error','recovery-error'].forEach(id=>{const el=document.getElementById(id);if(el){el.textContent='';el.classList.add('hidden');}});
      document.getElementById('work-continue')?.setAttribute('disabled','disabled');
      document.getElementById('instructions-continue')?.setAttribute('disabled','disabled');
    }catch(_){ }
  }

  async function completelyResetBrowserReview(showFresh=true){
    const meta=hrGetReviewMeta();
    const hasSaved=!!(meta&&(meta.sessionToken||meta.email||meta.orderRef||meta.customTicketRef));
    const hasServerRecord=!!(meta&&(meta.orderRef||meta.customTicketRef));
    const ok=window.confirm(hasServerRecord
      ? 'Start another review? Your current order/request will remain active and will not be deleted. This only starts a new review on this device.'
      : hasSaved
        ? 'Start a new review? Your unfinished progress will be cleared from this device.'
        : 'Start a new review?');
    if(!ok)return false;
    try{clearInterval(window.paymentPoll);clearInterval(window.countdownTimer);}catch(_){ }
    await hrStartNewReview();
    resetVisibleForm();
    try{if(typeof closeModal==='function')closeModal();}catch(_){ }
    try{if(showFresh&&typeof openModal==='function')openModal('step-email');}catch(_){ }
    try{if(showFresh&&typeof prepareNewReviewEmailChoice==='function')prepareNewReviewEmailChoice();}catch(_){ }
    hrToast('Ready for a new review.','success');
    updateResumeBox();
    return true;
  }

  async function continueActive(){
    try{
      await hrRestoreDraftIntoState();
      if(typeof resumeSavedReview==='function'){
        await resumeSavedReview();
        return;
      }
      if(hrState.customTicketRef){
        if(typeof openModal==='function')openModal('step-custom');
        if(typeof loadCustomRequest==='function')await loadCustomRequest(true);
        return;
      }
      if(hrState.orderRef){
        if(typeof openModal==='function')openModal('step-paying');
        if(typeof resumeExistingOrder==='function')await resumeExistingOrder();
        return;
      }
      if(typeof openModal==='function')openModal(hrGetResumeStep());
    }catch(e){hrToast(e.message||'Could not continue this review.','danger');}
  }

  function updateResumeBox(){
    const old=document.getElementById('hr-resume-box');
    if(old)old.remove();
    if(!hrHasActiveReview())return;
    const start=document.getElementById('start-btn');
    if(!start)return;
    const meta=hrGetReviewMeta()||{};
    const step=hrGetResumeStep();
    const label=hrResumeStepLabel(step);
    const box=document.createElement('div');
    box.id='hr-resume-box';
    box.className='notice info';
    box.style.marginTop='16px';
    box.innerHTML=`<strong>You have a review in progress.</strong><div class="small muted" style="margin-top:5px">Last place saved: <strong>${hrEscape(label)}</strong>.</div><div class="small muted" style="margin-top:3px">Continue to return to the same step, with your saved details and files.</div><div class="actions" style="margin-top:12px"><button type="button" class="btn" id="hr-continue-review">Continue Review</button><button type="button" class="btn secondary" id="hr-new-review">Start New Review</button></div>`;
    start.parentElement?.appendChild(box);
    document.getElementById('hr-continue-review')?.addEventListener('click',continueActive);
    document.getElementById('hr-new-review')?.addEventListener('click',()=>completelyResetBrowserReview(true));
  }

  function addInFlowNewReviewButton(){
    if(!document.getElementById('app-modal'))return;
    if(!document.getElementById('hr-modal-new-review')){
      const b=document.createElement('button');
      b.type='button';b.id='hr-modal-new-review';b.className='btn secondary';b.textContent='Start New Review';
      b.style.cssText='position:absolute;left:16px;top:16px;padding:0 12px;z-index:2';
      b.addEventListener('click',()=>completelyResetBrowserReview(true));
      const card=document.querySelector('#app-modal .form-wrap');
      card?.appendChild(b);
    }
    const success=document.getElementById('step-success');
    if(success&&!document.getElementById('hr-success-new-review')){
      const close=document.getElementById('success-close');
      if(close){
        const b=document.createElement('button');
        b.type='button';b.id='hr-success-new-review';b.className='btn secondary';b.textContent='Start Another Review';
        b.addEventListener('click',()=>completelyResetBrowserReview(true));
        close.parentElement?.insertBefore(b,close);
      }
    }
  }

  function observeCompletion(){
    const success=document.getElementById('step-success');
    if(!success)return;
    let lastState=success.classList.contains('hidden');
    const observer=new MutationObserver(()=>{
      const visible=!success.classList.contains('hidden');
      if(visible&&!lastState){
        const title=(document.getElementById('success-title')?.textContent||'').toLowerCase();
        const badge=(document.getElementById('success-badge')?.textContent||'').toLowerCase();
        if(title.includes('received your submission')||title.includes('custom review request is received')||badge.includes('submitted')){
          hrFinishCurrentReview();
          updateResumeBox();
        }
      }
      lastState=visible;
    });
    observer.observe(success,{attributes:true,attributeFilter:['class']});
  }

  function install(){
    addInFlowNewReviewButton();
    observeCompletion();
    updateResumeBox();

    document.addEventListener('click',function(ev){
      const target=ev.target?.closest?.('#start-btn,#hero-upload-btn');
      if(!target||!hrHasActiveReview())return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      continueActive();
    },true);

    const modal=document.getElementById('app-modal');
    if(modal)new MutationObserver(()=>addInFlowNewReviewButton()).observe(modal,{childList:true,subtree:true});
  }

  window.hrStartFreshReview=async function(showFresh=true){return completelyResetBrowserReview(showFresh);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
  else install();
})();
