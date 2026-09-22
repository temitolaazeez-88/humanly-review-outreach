/* HumanlyReview shared frontend helpers — v7.0.0 (redesign). Public API kept 100% compatible with v6.4.x pages. */
const HR_CONFIG = Object.freeze({
  BACKEND_URL: 'https://script.google.com/macros/s/AKfycbxuhZ9TBwvBDAkDzz2XJoXGA4Ziy_mWgZn6kQXSShlN9BcM-9FAXeIiLQDIPl67-5yOzQ/exec',
  SITE_URL: 'https://humanlyreview.com',
  SUPPORT_PAGE: '/help.html',
  DELIVERY_PAGE: '/delivery.html',
  MAX_NETWORK_RETRIES: 1,
  CLIENT_VERSION: '7.0.0',
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
  return {version:5,startedAt:Number(existing.startedAt)||now,updatedAt:now,expiresAt:Number(existing.expiresAt)||now+HR_CONFIG.REVIEW_RETENTION_MS,sessionToken:existing.sessionToken||'',pendingSessionToken:existing.pendingSessionToken||'',email:existing.email||'',orderRef:existing.orderRef||'',customTicketRef:existing.customTicketRef||'',status:existing.status||'draft',resumeStep:existing.resumeStep||'step-email',briefChoice:existing.briefChoice||'',instructionText:existing.instructionText||'',workFilesMeta:Array.isArray(existing.workFilesMeta)?existing.workFilesMeta:[],instructionFilesMeta:Array.isArray(existing.instructionFilesMeta)?existing.instructionFilesMeta:[]};
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
    const req=indexedDB.open(HR_STORAGE.DRAFT_DB,2);
    req.onupgradeneeded=()=>{const db=req.result;if(db.objectStoreNames.contains(HR_STORAGE.DRAFT_STORE))db.deleteObjectStore(HR_STORAGE.DRAFT_STORE);db.createObjectStore(HR_STORAGE.DRAFT_STORE,{keyPath:['kind','index']});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Could not open draft storage.'));
  });
}
async function hrPersistDraftFiles(kind,files){
  try{
    const realFiles=(files||[]).filter(f=>f && typeof f.arrayBuffer==='function' && Number.isFinite(Number(f.size)) && Number(f.size)>0);
    const db=await hrDraftOpenDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(HR_STORAGE.DRAFT_STORE,'readwrite');
      const store=tx.objectStore(HR_STORAGE.DRAFT_STORE);
      const allReq=store.getAll();
      allReq.onsuccess=()=>{
        try{
          (allReq.result||[]).filter(row=>row.kind===kind).forEach(row=>store.delete([kind,row.index]));
          realFiles.forEach((f,i)=>store.put({kind,index:i,name:f.name,size:Number(f.size||0),type:f.type||'application/octet-stream',lastModified:Number(f.lastModified||Date.now()),blob:f}));
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
    const restored=[];
    for(const r of rows){
      const blob=r?.blob;
      const expected=Number(r?.size||0);
      if(!(blob instanceof Blob) || expected<=0 || Number(blob.size)!==expected){
        hrTrack('draft-file-invalid',{kind,name:r?.name||'',expected,actual:blob instanceof Blob?blob.size:null});
        continue;
      }
      try{restored.push(new File([blob],r.name,{type:r.type,lastModified:r.lastModified}));}catch(_){}
    }
    return restored;
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
function hrDraftMetaList(meta,kind){
  const list=kind==='work'?meta?.workFilesMeta:meta?.instructionFilesMeta;
  return Array.isArray(list)?list.filter(x=>x&&x.name):[];
}
function hrMakeMissingDraftFile(item){
  return {name:String(item.name||'Saved file'),size:Number(item.size)>0?Number(item.size):null,type:item.type||'application/octet-stream',lastModified:Number(item.lastModified||Date.now()),__draftMissing:true};
}
function hrMergeRestoredDraftFiles(kind,metaItems,actualFiles){
  const actual=[...(actualFiles||[])];
  if(!metaItems.length)return actual;
  const used=new Set();
  return metaItems.map(item=>{
    const key=`${item.name}__${Number(item.size||0)}`;
    const idx=actual.findIndex((f,i)=>!used.has(i)&&hrFileKey(f)===key);
    if(idx>=0){used.add(idx);return actual[idx];}
    return hrMakeMissingDraftFile(item);
  }).concat(actual.filter((_,i)=>!used.has(i)));
}
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
    hrState.selectedWorkFiles=hrMergeRestoredDraftFiles('work',hrDraftMetaList(meta,'work'),work);
    hrState.selectedInstructionFiles=hrMergeRestoredDraftFiles('instruction',hrDraftMetaList(meta,'instruction'),instructions);
  }catch(_){
    hrState.selectedWorkFiles=[];hrState.selectedInstructionFiles=[];
  }
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
function hrFormatMoney(amount,currency='NGN'){const n=Number(amount||0);try{return new Intl.NumberFormat('en-NG',{style:'currency',currency,minimumFractionDigits:Number.isInteger(n)?0:2,maximumFractionDigits:2}).format(n);}catch(e){return `${currency} ${n.toLocaleString()}`;}}
function hrFormatDate(iso){if(!iso)return '—';const d=new Date(iso);if(Number.isNaN(d.getTime()))return '—';return d.toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'});}
function hrEscape(text){return String(text??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function hrStatusLabel(status){const map={awaiting_payment:'Awaiting payment',submitted:'Submitted',in_review:'In review',delivered:'Report ready',downloaded:'Downloaded',acknowledged:'Acknowledged',deleted:'Completed',abandoned_expired:'Expired'};return map[status]||status||'Unknown';}
function hrShow(el,show=true){if(el)el.classList.toggle('hidden',!show);}
function hrSetBusy(button,busy,busyText='Processing…'){if(!button)return;if(busy){if(button.getAttribute('aria-busy')!=='true')button.dataset.originalText=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent=busyText;}else{button.disabled=false;button.removeAttribute('aria-busy');button.textContent=button.dataset.originalText||button.textContent;}}
function hrToast(message,type='info'){
  let host=document.getElementById('toast-host');
  if(!host){host=document.createElement('div');host.id='toast-host';host.setAttribute('role','status');host.setAttribute('aria-live','polite');document.body.appendChild(host);}
  const text=String(message==null?'':message);
  Array.from(host.children).forEach(c=>{if(c.dataset.msg===text)c.remove();});
  while(host.children.length>=3)host.firstElementChild.remove();
  const item=document.createElement('div');item.className='toast '+type;item.dataset.msg=text;
  const tx=document.createElement('span');tx.className='tx';tx.textContent=text;
  const x=document.createElement('span');x.className='tc';x.setAttribute('aria-hidden','true');x.textContent='\u00d7';
  item.appendChild(tx);item.appendChild(x);host.appendChild(item);
  let gone=false;
  const close=()=>{if(gone)return;gone=true;item.classList.remove('visible');setTimeout(()=>item.remove(),250);};
  item.addEventListener('click',close);
  setTimeout(()=>item.classList.add('visible'),10);
  setTimeout(close,(type==='danger'||type==='warning')?7000:4200);
  return close;
}
const HR_ERROR_INPUTS={'otp-error':'otp','support-otp-error':'support-otp'};
function hrSetError(el,message=''){if(el){el.textContent=message;el.classList.toggle('hidden',!message);if(message)el.setAttribute('role','alert');else el.removeAttribute('role');const inp=HR_ERROR_INPUTS[el.id]&&document.getElementById(HR_ERROR_INPUTS[el.id]);if(inp){inp.classList.toggle('is-invalid',!!message);if(message)inp.classList.remove('is-valid');else if(/^\d{6}$/.test(inp.value))inp.classList.add('is-valid');}}}
function hrClearNearbyErrors(node){const root=node?.closest?.('.flow-step,.card,.form-wrap')||document;root.querySelectorAll('.notice.danger:not([data-keep-error="true"])').forEach(el=>{if(!el.classList.contains('hidden'))hrSetError(el,'');});}
function hrBindErrorClearing(){
  const isField=t=>t&&t.tagName&&['INPUT','TEXTAREA','SELECT'].includes(t.tagName);
  document.addEventListener('input',ev=>{if(isField(ev.target))hrClearNearbyErrors(ev.target);});
  document.addEventListener('change',ev=>{if(isField(ev.target))hrClearNearbyErrors(ev.target);});
  /* v7: errors also disappear the moment the person focuses a field or clicks/taps anything nearby.
     Capture phase = runs BEFORE the clicked button's own handler, so a fresh error is never wiped. */
  document.addEventListener('focusin',ev=>{if(isField(ev.target)&&ev.target.type!=='file')hrClearNearbyErrors(ev.target);});
  document.addEventListener('click',ev=>{const t=ev.target;if(!t||!t.closest)return;if(t.closest('[data-keep-error="true"]'))return;hrClearNearbyErrors(t);},true);
}
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
    const ok=await hrConfirm(hasServerRecord
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
    const slot=document.getElementById('resume-slot'),band=document.getElementById('resume');
    if(!hrHasActiveReview()){if(band)band.hidden=true;return;}
    const start=document.getElementById('start-btn');
    if(!start&&!slot)return;
    const meta=hrGetReviewMeta()||{};
    const step=hrGetResumeStep();
    const label=hrResumeStepLabel(step);
    const box=document.createElement('div');
    box.id='hr-resume-box';
    if(slot){
      box.className='resume';
      box.setAttribute('role','region');box.setAttribute('aria-label','Saved review');
      box.innerHTML=`<h2>Your review is waiting.</h2><p>Pick up where you stopped. Last step: <b>${hrEscape(label)}</b>. Your details are saved on this device.</p><div class="btns"><button type="button" class="btn" id="hr-continue-review">Continue my review</button><button type="button" class="btn out dk" id="hr-new-review">Begin a new review</button></div>`;
      slot.appendChild(box);if(band)band.hidden=false;
    }else{
      box.className='notice info';
      box.style.marginTop='16px';
      box.innerHTML=`<strong>You have a review in progress.</strong><div class="small muted" style="margin-top:5px">Last place saved: <strong>${hrEscape(label)}</strong>.</div><div class="small muted" style="margin-top:3px">Continue to return to the same step, with your saved details and files.</div><div class="actions" style="margin-top:12px"><button type="button" class="btn" id="hr-continue-review">Continue Review</button><button type="button" class="btn secondary" id="hr-new-review">Start New Review</button></div>`;
      start.parentElement?.appendChild(box);
    }
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
      const target=ev.target?.closest?.('#start-btn,#hero-upload-btn,[data-start-review]');
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

/* =====================================================================
   HumanlyReview 7.0 additions
   - live email / OTP validation (green tick, typo hint)
   - branded confirm dialog (replaces window.confirm)
   - display options (text size / contrast) and mobile menu
   ===================================================================== */
const HR_EMAIL_DOMAINS=['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','live.com','yahoo.co.uk','proton.me','protonmail.com','aol.com','msn.com','ymail.com','me.com','mail.com','gmx.com','zoho.com','yandex.com','rocketmail.com','googlemail.com','hotmail.co.uk','outlook.co.uk'];
function hrEditDistance(a,b){
  a=String(a);b=String(b);const d=[];
  for(let i=0;i<=a.length;i++){d[i]=[i];}
  for(let j=0;j<=b.length;j++){d[0][j]=j;}
  for(let i=1;i<=a.length;i++){for(let j=1;j<=b.length;j++){
    const c=a[i-1]===b[j-1]?0:1;
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c);
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
  }}
  return d[a.length][b.length];
}
function hrEmailSuggest(email){
  const m=/^([^\s@]+)@([^\s@]+)$/.exec(String(email||'').trim().toLowerCase());
  if(!m)return '';
  const dom=m[2];
  if(HR_EMAIL_DOMAINS.includes(dom))return '';
  let best='';
  for(const d of HR_EMAIL_DOMAINS){if(hrEditDistance(dom,d)===1){best=d;break;}}
  return best?m[1]+'@'+best:'';
}
function hrEnhanceEmailInput(input){
  if(!input||input.dataset.hrLive)return;
  input.dataset.hrLive='1';
  const hint=document.createElement('div');
  hint.className='field-hint hidden';
  hint.setAttribute('aria-live','polite');
  if(!input.id)input.id='email-'+Math.random().toString(36).slice(2,8);
  hint.id=input.id+'-hint';
  input.setAttribute('aria-describedby',hint.id);
  input.insertAdjacentElement('afterend',hint);
  let timer=null;
  const setHint=(text,kind,html)=>{
    if(!text&&!html){hint.className='field-hint hidden';hint.textContent='';hint.dataset.sig='';return;}
    const sig=(html?html.textContent:text)+'|'+(kind||'');
    if(hint.dataset.sig===sig)return;
    hint.dataset.sig=sig;
    hint.className='field-hint '+(kind||'');
    if(html){hint.innerHTML='';hint.appendChild(html);}else hint.textContent=text;
  };
  const reset=()=>{input.classList.remove('is-valid','is-invalid');input.removeAttribute('aria-invalid');setHint('');};
  const evaluate=(final)=>{
    clearTimeout(timer);
    if(input.disabled||input.readOnly){reset();return;}
    const v=input.value.trim();
    if(!v){reset();return;}
    if(hrValidateEmail(v)){
      input.classList.add('is-valid');input.classList.remove('is-invalid');input.removeAttribute('aria-invalid');
      const s=hrEmailSuggest(v);
      if(s){
        const span=document.createElement('span');
        span.appendChild(document.createTextNode('Looks valid. Did you mean '));
        const b=document.createElement('button');b.type='button';b.textContent=s;b.addEventListener('mousedown',e=>e.preventDefault());
        b.addEventListener('click',()=>{input.value=s;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});
        span.appendChild(b);span.appendChild(document.createTextNode('?'));
        setHint('','',span);
      }else setHint('Email format looks good.','ok');
    }else{
      input.classList.remove('is-valid');
      if(final){
        input.classList.add('is-invalid');input.setAttribute('aria-invalid','true');
        setHint(v.indexOf('@')<0?'Add your @ and domain, like name@example.com.':'Check the address. It should look like name@example.com.','bad');
      }else{
        input.classList.remove('is-invalid');input.removeAttribute('aria-invalid');setHint('');
        timer=setTimeout(()=>evaluate(true),1100);
      }
    }
  };
  input.addEventListener('input',()=>evaluate(false));
  input.addEventListener('blur',()=>evaluate(true));
  input.addEventListener('change',()=>evaluate(true));
  try{
    const desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    Object.defineProperty(input,'value',{configurable:true,enumerable:true,get(){return desc.get.call(this);},set(v){desc.set.call(this,v);Promise.resolve().then(()=>evaluate(false));}});
  }catch(_){}
  new MutationObserver(()=>evaluate(false)).observe(input,{attributes:true,attributeFilter:['disabled','readonly']});
  evaluate(false);
}
function hrEnhanceOtpInput(input){
  if(!input||input.dataset.hrLive)return;
  input.dataset.hrLive='1';
  input.setAttribute('pattern','[0-9]*');
  const paint=()=>{
    const v=input.value;
    input.classList.toggle('is-valid',/^\d{6}$/.test(v));
    input.classList.remove('is-invalid');
  };
  input.addEventListener('input',()=>{
    const clean=input.value.replace(/\D/g,'').slice(0,6);
    if(clean!==input.value)input.value=clean;
    paint();
  });
  try{
    const desc=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    Object.defineProperty(input,'value',{configurable:true,enumerable:true,get(){return desc.get.call(this);},set(v){desc.set.call(this,v);paint();}});
  }catch(_){}
}
const HR_ENTER_MAP={'email-manual-entry':['send-otp'],'otp':['verify-otp','verify-code'],'support-email':['support-start'],'support-otp':['support-verify'],'email':['send-code'],'admin-key':['login-btn']};
function hrInstallEnterKeys(){
  document.addEventListener('keydown',ev=>{
    if(ev.key!=='Enter'||ev.isComposing||ev.shiftKey)return;
    const t=ev.target;
    if(!t||t.tagName!=='INPUT'||t.type==='checkbox'||t.type==='radio'||t.type==='file')return;
    const list=HR_ENTER_MAP[t.id];
    if(!list)return;
    for(const id of list){
      const b=document.getElementById(id);
      if(b&&!b.disabled&&!b.classList.contains('hidden')&&b.offsetParent!==null){ev.preventDefault();b.click();return;}
    }
  });
}
function hrEnhanceAll(root){
  (root||document).querySelectorAll('input[type="email"]').forEach(hrEnhanceEmailInput);
  (root||document).querySelectorAll('input.otp-input,input[autocomplete="one-time-code"]').forEach(hrEnhanceOtpInput);
}

/* Branded confirm dialog. Resolves true/false. Falls back to window.confirm. */
function hrConfirm(message,opts){
  opts=opts||{};
  return new Promise(resolve=>{
    let wrap;
    try{
      const prev=document.activeElement;
      wrap=document.createElement('div');
      wrap.className='hr-confirm';
      wrap.innerHTML='<div class="hr-confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="hrc-t" aria-describedby="hrc-m"><h3 id="hrc-t"></h3><p id="hrc-m"></p><div class="actions"><button type="button" class="btn secondary" data-no></button><button type="button" class="btn" data-yes></button></div></div>';
      wrap.querySelector('#hrc-t').textContent=opts.title||'Please confirm';
      wrap.querySelector('#hrc-m').textContent=String(message||'');
      const yes=wrap.querySelector('[data-yes]'),no=wrap.querySelector('[data-no]');
      yes.textContent=opts.confirmText||'Yes, continue';
      no.textContent=opts.cancelText||'Cancel';
      const done=v=>{window.removeEventListener('keydown',onKey,true);wrap.remove();try{prev&&prev.focus&&prev.focus();}catch(_){}resolve(v);};
      const onKey=e=>{
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(false);return;}
        if(e.key==='Tab'){const f=[no,yes];const i=f.indexOf(document.activeElement);e.preventDefault();f[(i+(e.shiftKey?-1:1)+f.length)%f.length].focus();}
      };
      yes.addEventListener('click',()=>done(true));
      no.addEventListener('click',()=>done(false));
      wrap.addEventListener('click',e=>{if(e.target===wrap)done(false);});
      window.addEventListener('keydown',onKey,true);
      document.body.appendChild(wrap);
      no.focus();
    }catch(e){try{if(wrap)wrap.remove();}catch(_){}resolve(window.confirm(String(message||'')));}
  });
}

/* Display options (text size + high contrast) shared by every public page. */
function hrInitDisplayControls(){
  const root=document.documentElement,aa=document.getElementById('aa'),pn=document.getElementById('a11y'),hc=document.getElementById('hc'),rs=document.getElementById('rs');
  let A={size:'0',contrast:'0'};
  try{A=Object.assign(A,JSON.parse(localStorage.getItem('hr_display')||'{}'));}catch(_){}
  try{if(!localStorage.getItem('hr_display')&&window.matchMedia&&matchMedia('(prefers-contrast: more)').matches)A.contrast='1';}catch(_){}
  const paint=()=>{
    root.setAttribute('data-size',A.size);root.setAttribute('data-contrast',A.contrast);
    document.querySelectorAll('#a11y [data-size]').forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute('data-size')===A.size)));
    if(hc)hc.setAttribute('aria-checked',String(A.contrast==='1'));
  };
  const save=()=>{try{localStorage.setItem('hr_display',JSON.stringify(A));}catch(_){}paint();};
  paint();
  if(!aa||!pn)return;
  aa.addEventListener('click',()=>{const open=pn.hidden;pn.hidden=!open;aa.setAttribute('aria-expanded',String(open));});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pn.hidden){pn.hidden=true;aa.setAttribute('aria-expanded','false');aa.focus();}});
  document.addEventListener('click',e=>{if(!pn.hidden&&!pn.contains(e.target)&&!aa.contains(e.target)){pn.hidden=true;aa.setAttribute('aria-expanded','false');}});
  document.querySelectorAll('#a11y [data-size]').forEach(b=>b.addEventListener('click',()=>{A.size=b.getAttribute('data-size');save();}));
  if(hc)hc.addEventListener('click',()=>{A.contrast=A.contrast==='1'?'0':'1';save();});
  if(rs)rs.addEventListener('click',()=>{A={size:'0',contrast:'0'};save();});
}
function hrInitMobileMenu(){
  const btn=document.getElementById('menu-btn'),nav=document.getElementById('mobile-nav');
  if(!btn||!nav)return;
  const close=()=>{nav.hidden=true;btn.setAttribute('aria-expanded','false');};
  btn.addEventListener('click',()=>{const open=nav.hidden;nav.hidden=!open;btn.setAttribute('aria-expanded',String(open));});
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!nav.hidden){close();btn.focus();}});
  document.addEventListener('click',e=>{if(!nav.hidden&&!nav.contains(e.target)&&!btn.contains(e.target))close();});
  window.addEventListener('resize',()=>{if(window.innerWidth>=920)close();});
}
function hrBootUx(){hrEnhanceAll();hrInstallEnterKeys();hrInitDisplayControls();hrInitMobileMenu();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',hrBootUx);else hrBootUx();
