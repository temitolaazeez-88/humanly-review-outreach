/**
 * Shared helper functions for every page of the site (v2).
 */

async function hrCall(action, payload) {
  const res = await fetch(HR_CONFIG.API_URL, { method: 'POST', body: JSON.stringify({ action: action, payload: payload || {} }) });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function hrEscape(str) {
  const d = document.createElement('div');
  d.innerText = str == null ? '' : String(str);
  return d.innerHTML;
}

async function hrApplyTheme() {
  // Speed: show a cached copy of settings instantly (no network wait) while
  // a fresh copy loads in the background and patches anything that changed.
  const cacheKey = 'hr_settings_cache';
  let cached = null;
  try { const raw = sessionStorage.getItem(cacheKey); if (raw) cached = JSON.parse(raw); } catch (e) {}
  if (cached) applySettingsToDom_(cached);

  try {
    const res = await hrCall('getSettings', {});
    const s = res.settings || {};
    try { sessionStorage.setItem(cacheKey, JSON.stringify(s)); } catch (e) {}
    applySettingsToDom_(s);
    return s;
  } catch (e) {
    console.warn('Could not load site settings — using defaults/cache.', e);
    return cached || {};
  }
}

function applySettingsToDom_(s) {
  const root = document.documentElement.style;
  ['primary_color','accent_color','background_color','text_color','success_color','warning_color','danger_color'].forEach(function(k){
    const varName = '--' + k.replace('_color','').replace('background','bg');
    if (s[k]) root.setProperty(varName, s[k]);
  });
  document.querySelectorAll('[data-site-name]').forEach(function(el){ el.innerText = s.site_name || 'Humanly Review'; });
  document.querySelectorAll('[data-hero-title]').forEach(function(el){ el.innerText = s.hero_title || el.innerText; });
  document.querySelectorAll('[data-hero-subtitle]').forEach(function(el){ el.innerText = s.hero_subtitle || el.innerText; });
  document.querySelectorAll('[data-cta-text]').forEach(function(el){ el.innerText = s.cta_text || el.innerText; });
  if (s.logo_url) {
    document.querySelectorAll('#brandLink').forEach(function(el){
      if (!el.querySelector('img')) {
        el.innerHTML = '<img class="site-logo" src="' + s.logo_url + '" alt="" onerror="this.remove();">';
      }
    });
    document.querySelectorAll('#heroLogoSlot').forEach(function(el){
      if (!el.querySelector('img')) el.innerHTML = '<img class="hero-logo" src="' + s.logo_url + '" alt="" onerror="this.remove();">';
    });
  }
  if (s.site_slogan) {
    document.querySelectorAll('#heroSloganSlot').forEach(function(el){ el.innerHTML = '<p class="slogan">' + hrEscape(s.site_slogan) + '</p>'; });
  }
  hrApplySeoAndPixel_(s);
}

/* -------- SEO + Meta Pixel (admin-configurable, requirement) -------- */
let _hrSeoApplied = false;
function hrApplySeoAndPixel_(s) {
  if (_hrSeoApplied) return; // only needs to run once per page load
  _hrSeoApplied = true;
  try {
    if (s.seo_title) document.title = s.seo_title;
    setMeta_('description', s.seo_description);
    setMeta_('keywords', s.seo_keywords);
    setMetaProperty_('og:title', s.seo_title);
    setMetaProperty_('og:description', s.seo_description);
    if (s.og_image_url) setMetaProperty_('og:image', s.og_image_url);

    if (s.meta_pixel_id && !document.getElementById('hr-meta-pixel')) {
      const script = document.createElement('script');
      script.id = 'hr-meta-pixel';
      script.innerHTML =
        "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
        "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;" +
        "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script'," +
        "'https://connect.facebook.net/en_US/fbevents.js');fbq('init', '" + s.meta_pixel_id + "');fbq('track', 'PageView');";
      document.head.appendChild(script);
    }
  } catch (e) { console.warn('SEO/Pixel setup skipped:', e); }
}
function setMeta_(name, content) {
  if (!content) return;
  let el = document.querySelector('meta[name="' + name + '"]');
  if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
  el.setAttribute('content', content);
}
function setMetaProperty_(property, content) {
  if (!content) return;
  let el = document.querySelector('meta[property="' + property + '"]');
  if (!el) { el = document.createElement('meta'); el.setAttribute('property', property); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

function hrShowError(el, message) { el.innerHTML = '<div class="error-box">' + hrEscape(message) + '</div>'; }
function hrShowSuccess(el, message) { el.innerHTML = '<div class="success-box">' + hrEscape(message) + '</div>'; }
function hrGetParam(name) { return new URLSearchParams(window.location.search).get(name); }

/* -------- Persistence: requirement #21 (survive leaving/returning) -------- */
function hrSaveState(key, obj) {
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* quota exceeded — degrade gracefully, stays in memory only */ }
}
function hrLoadState(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function hrClearState(key) { try { localStorage.removeItem(key); } catch (e) {} }

/* -------- Countdown helpers (requirement #3 OTP + #20 delivery) -------- */
function hrStartCountdown(el, seconds, onDone) {
  let remaining = seconds;
  function tick() {
    const m = Math.floor(remaining / 60), s = remaining % 60;
    el.innerText = m + ':' + String(s).padStart(2, '0');
    if (remaining <= 0) { clearInterval(timer); if (onDone) onDone(); return; }
    remaining -= 1;
  }
  tick();
  const timer = setInterval(tick, 1000);
  return timer;
}
function hrStartDueCountdown(el, dueAtIso) {
  function tick() {
    const diff = new Date(dueAtIso).getTime() - Date.now();
    if (diff <= 0) { el.innerText = 'Any moment now'; return; }
    const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
    el.innerText = h + 'h ' + m + 'm remaining';
  }
  tick();
  return setInterval(tick, 30000);
}

/* -------- Clipboard copy (requirement #11) -------- */
function hrCopyToClipboard(text, toastEl) {
  const done = function() { if (toastEl) { toastEl.innerText = 'Copied!'; setTimeout(function(){ toastEl.innerText = ''; }, 1500); } };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function(){ fallbackCopy_(text); done(); });
  } else { fallbackCopy_(text); done(); }
}
function fallbackCopy_(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

/** Downloads a file the backend returns as base64 text. */
async function hrDownloadFile(apiUrl, token, fileId, suggestedName) {
  const url = apiUrl + '?action=download&token=' + encodeURIComponent(token) + '&file=' + encodeURIComponent(fileId);
  const res = await fetch(url);
  const base64 = await res.text();
  let parsed; try { parsed = JSON.parse(base64); } catch (e) { parsed = null; }
  if (parsed && parsed.ok === false) throw new Error(parsed.error);
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const ext = (suggestedName.split('.').pop() || '').toLowerCase();
  const mime = ext === 'pdf' ? 'application/pdf' : ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream';
  const blob = new Blob([byteArray], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = suggestedName || 'file';
  document.body.appendChild(link); link.click(); link.remove();
}

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function() { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
