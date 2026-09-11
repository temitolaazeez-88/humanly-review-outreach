/**
 * Shared helper functions for every page of the site.
 * Nothing here needs editing — it just talks to your backend.
 */

async function hrCall(action, payload) {
  const res = await fetch(HR_CONFIG.API_URL, {
    method: 'POST',
    body: JSON.stringify({ action: action, payload: payload || {} })
  });
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
    if (s.primary_color) root.setProperty('--primary', s.primary_color);
    if (s.accent_color) root.setProperty('--accent', s.accent_color);
    if (s.background_color) root.setProperty('--bg', s.background_color);
    if (s.text_color) root.setProperty('--text', s.text_color);
    if (s.success_color) root.setProperty('--success', s.success_color);
    if (s.warning_color) root.setProperty('--warning', s.warning_color);
    if (s.danger_color) root.setProperty('--danger', s.danger_color);
    document.querySelectorAll('[data-site-name]').forEach(function(el){ el.innerText = s.site_name || 'Humanly Review'; });
    document.querySelectorAll('[data-hero-title]').forEach(function(el){ el.innerText = s.hero_title || el.innerText; });
    document.querySelectorAll('[data-hero-subtitle]').forEach(function(el){ el.innerText = s.hero_subtitle || el.innerText; });
    document.querySelectorAll('[data-cta-text]').forEach(function(el){ el.innerText = s.cta_text || el.innerText; });
    return s;
  } catch (e) {
    console.warn('Could not load site settings — using defaults.', e);
    return {};
  }
}

function hrShowError(el, message) {
  el.innerHTML = '<div class="error-box">' + hrEscape(message) + '</div>';
}

function hrShowSuccess(el, message) {
  el.innerHTML = '<div class="success-box">' + hrEscape(message) + '</div>';
}

function hrGetParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Downloads a file the backend returns as base64 text (see handleDownload_ in Code.gs). */
async function hrDownloadFile(apiUrl, token, fileType, suggestedName) {
  const url = apiUrl + '?action=download&token=' + encodeURIComponent(token) + '&file=' + fileType;
  const res = await fetch(url);
  const base64 = await res.text();
  let parsed;
  try { parsed = JSON.parse(base64); } catch (e) { parsed = null; }
  if (parsed && parsed.ok === false) throw new Error(parsed.error);

  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  const mime = fileType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const blob = new Blob([byteArray], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = suggestedName || ('report.' + fileType);
  document.body.appendChild(link);
  link.click();
  link.remove();
}
