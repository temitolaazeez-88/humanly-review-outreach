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
  try {
    const res = await hrCall('getSettings', {});
    const s = res.settings || {};
    const root = document.documentElement.style;
    ['primary_color','accent_color','background_color','text_color','success_color','warning_color','danger_color'].forEach(function(k){
      const varName = '--' + k.replace('_color','').replace('background','bg');
      if (s[k]) root.setProperty(varName, s[k]);
    });
    document.querySelectorAll('[data-site-name]').forEach(function(el){ el.innerText = s.site_name || 'Humanly Review'; });
    document.querySelectorAll('[data-hero-title]').forEach(function(el){ el.innerText = s.hero_title || el.innerText; });
    document.querySelectorAll('[data-hero-subtitle]').forEach(function(el){ el.innerText = s.hero_subtitle || el.innerText; });
    document.querySelectorAll('[data-cta-text]').forEach(function(el){ el.innerText = s.cta_text || el.innerText; });
    return s;
  } catch (e) { console.warn('Could not load site settings — using defaults.', e); return {}; }
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
